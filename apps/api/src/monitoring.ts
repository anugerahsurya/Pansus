import { randomUUID } from 'node:crypto'
import { hash as passwordHash, verify, Algorithm } from '@node-rs/argon2'
import { z } from 'zod'
import { activeFields, dateSchema, definitionSchema, timeSchema, type CollectionReport, type Condition, type Dataset, type Definition, type Notice, type Report, type SnapshotData, type TemplateId, type UploadMapping, type Visibility } from '../../../packages/contracts/index'
import type { CsvAnalysisStage } from '../../../packages/contracts/csv-analysis'
import type { MemberRole, SuperadminPolicy } from '../../../packages/contracts/accounts'
import { aggregate, applyFormulas, previousDay } from '../../../packages/metrics/index'
import { compileFormulas, evaluate, parseFormula } from '../../../packages/metrics/formula'
import { ImportError, joinDataset, normalizeUpload, previewSource, readDataset, type InputFile } from '../../../packages/adapters/index'
import { templateDefinition, templates } from '../../../templates/index'
import { exampleDates, exampleFiles } from '../../../fixtures/synthetic/index'
import { account, audit, datasetSignature, fail, hash, now, permissions, superadminPolicy, superadminPolicyKey, token, type AccessSession, type Dashboard, type Grant, type ImportJob, type Proof, type Release, type Session, type Snapshot, type User } from './model'
import type { Records, Store } from './store'
import { openObjects, type Objects } from './objects'
import { JobQueue } from './queues'
import { cachedGeminiStatus, checkGeminiStatus, geminiAvailable, suggestCsv } from './gemini'

export type Credentials = { session?: string; shared?: string }
const duration = 8 * 60 * 60 * 1000
const byCondition = (a: Condition, b: Condition) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time)
const releaseKey = (d: Dashboard, id: string) => `release:${d.id}:${id}`
const snapshotKey = (d: Dashboard, id: string) => `snapshot:${d.id}:${id}`
const importObject = (job: string, slot: string) => `imports/${job}/${slot}`
const requireDashboard = (db: Records, id: string) => db.get<Dashboard>(`dashboard:${id}`) ?? fail(404, 'NOT_FOUND', 'Dashboard tidak ditemukan.')
const canManage = (db: Records, user: User, dashboard: Dashboard) => user.tenant === dashboard.tenant && permissions(db, user).dashboards
const canEdit = (db: Records, user: User, dashboard: Dashboard) => canManage(db, user, dashboard) || (user.tenant === dashboard.tenant && user.role === 'operator' && dashboard.operators.includes(user.id))
const sessionKey = (session: string) => 'session:' + hash(session)
const userKey = (id: string) => 'user:' + id
const hasPersonalRows = (definition: Definition) => definition.datasets.some(dataset => dataset.grain === 'person')
function checkPersonalAccess(definition: Definition, visibility: Visibility) {
  if (hasPersonalRows(definition) && visibility === 'public') fail(422, 'PERSONAL_DATA_REQUIRES_INVITES', 'Dashboard yang memuat progres per orang tidak dapat masuk katalog publik. Gunakan tautan berbagi atau undangan.')
}
const assertOpen = (dashboard: Dashboard) => { if (dashboard.activityStatus === 'closed') fail(409, 'ACTIVITY_CLOSED', 'Kegiatan sudah selesai. Hubungi admin untuk membuka kembali.') }
const putDashboard = (db: Records, dashboard: Dashboard) => db.put(`dashboard:${dashboard.id}`, dashboard)
function checkRevision(actual: number, expected: number) {
  if (actual !== expected) fail(409, 'REVISION_CONFLICT', 'Ada perubahan sejak halaman ini dibuka. Muat ulang dan tinjau data terbaru.')
}
function safeDefinition(input: unknown) {
  const result = definitionSchema.safeParse(input)
  if (!result.success) fail(422, 'INVALID_DEFINITION', result.error.issues[0].message, result.error.issues[0].path.join('.'))
  try { for (const dataset of result.data.datasets) compileFormulas(dataset) }
  catch (error) { fail(422, 'INVALID_FORMULA', (error as Error).message) }
  return result.data
}

function latestSnapshot(db: Records, dashboard: Dashboard): Snapshot | undefined {
  return dashboard.snapshotIds.map(id => db.get<Snapshot>(snapshotKey(dashboard, id))!).sort((a, b) => Number(a.demo) - Number(b.demo) || byCondition(b, a) || b.revision - a.revision)[0]
}
function addRelease(db: Records, dashboard: Dashboard, definition: Definition, snapshot: Snapshot) {
  const release: Release = { id: randomUUID(), snapshotId: snapshot.id, definition, date: snapshot.date, time: snapshot.time, createdAt: now(), version: dashboard.releaseIds.length + 1 }
  db.put(releaseKey(dashboard, release.id), release)
  dashboard.releaseIds.push(release.id)
  return release
}
const sameGrain = (snapshot: Snapshot, dataset: Dataset) => (snapshot.grains?.[dataset.id] ?? 'district') === dataset.grain
function reusableInputs(dashboard: Dashboard, snapshot: Snapshot, job: ImportJob) {
  return Object.fromEntries(dashboard.draft.datasets.filter(dataset => sameGrain(snapshot, dataset) && Object.hasOwn(job.files, dataset.id)).map(dataset => [dataset.id, job.files[dataset.id]]))
}
function snapshotData(definition: Definition, snapshot: Snapshot, publicOnly: boolean): SnapshotData {
  return Object.fromEntries(definition.datasets.flatMap(dataset => {
    const source = snapshot.data[dataset.id]
    if (!source || !sameGrain(snapshot, dataset)) return []
    const normalized = applyFormulas(dataset, source)
    const fields = activeFields(dataset).filter(field => !publicOnly || field.public)
    const project = (values: Record<string, string | number | null>) => Object.fromEntries(fields.map(field => [field.id, values[field.id] ?? null]))
    const projectRow = ({ source, ...row }: (typeof normalized.rows)[number]) => ({ ...row, ...(!publicOnly ? { source } : {}), values: project(row.values) })
    return [[dataset.id, { rows: normalized.rows.map(projectRow), reported: normalized.reported && project(normalized.reported), detail: (!publicOnly || dataset.publicDetail) ? normalized.detail?.map(projectRow) : undefined }]]
  }))
}
const publicDefinition = (definition: Definition): Definition => ({ ...definition, datasets: definition.datasets.map(({ join: _join, ...dataset }) => ({ ...dataset, fields: activeFields(dataset).filter(field => field.public).map(({ aliases: _aliases, ...field }) => ({ ...field, aliases: [] })) })) })

export class Monitoring {
  private readonly attempts = new Map<string, { count: number; until: number }>()
  readonly objects: Objects
  readonly onDemandJobs: boolean
  private readonly imports = new JobQueue('bps-monitoring-imports')
  private importRunning = false
  private dummyHash = ''
  constructor(readonly store: Store, { onDemandJobs = false } = {}) {
    this.objects = store.objects ?? openObjects()
    this.onDemandJobs = onDemandJobs
  }

  async initialize() {
    this.dummyHash = await passwordHash(token(), { algorithm: Algorithm.Argon2id })
    const production = this.onDemandJobs || process.env.NODE_ENV === 'production'
    const hasUser = await this.store.read(db => db.list<User>('user:').length > 0)
    if (!hasUser && (!this.onDemandJobs || process.env.ADMIN_PASSWORD)) {
      const password = process.env.ADMIN_PASSWORD || (!production ? 'Monitoring!2026' : '')
      if (password.length < 12) throw new Error('Set ADMIN_PASSWORD (minimum 12 characters) before the first start.')
      const users: User[] = [{ id: 'admin', tenant: 'sumbar', role: 'admin', name: 'Admin Sumatera Barat', email: process.env.ADMIN_EMAIL || 'admin@example.test', hash: await passwordHash(password, { algorithm: Algorithm.Argon2id }) }]
      if (!production && !process.env.ADMIN_PASSWORD) {
        for (const role of ['operator', 'reader'] as const) users.push({ id: role, tenant: 'sumbar', role, name: role === 'operator' ? 'Operator Data' : 'Pembaca Undangan', email: `${role}@example.test`, hash: users[0].hash })
        if (process.env.NODE_ENV === 'test') users.push({ id: 'developer', tenant: 'sumbar', role: 'developer', name: 'Developer Pengujian', email: 'developer@example.test', hash: users[0].hash })
      }
      await this.store.write(db => {
        if (!db.list<User>('user:').length) for (const user of users) db.put(`user:${user.id}`, user)
      })
    }
    if (!production || (this.onDemandJobs && process.env.SEED_DEMOS !== 'false') || process.env.SEED_DEMOS === 'true') {
      await this.store.write(db => {
        for (const name of ['pes', 'susenas'] as const) {
          const existing = db.get<Dashboard>(`dashboard:demo-${name}`)
          if (existing && (!existing.demo || existing.demoVersion === 2)) continue
          const dashboard = this.newDashboard(name, 'sumbar', 'admin', true)
          dashboard.id = `demo-${name}`
          dashboard.demoVersion = 2
          dashboard.slug = name === 'pes' ? 'progres-lapangan-pes' : 'pengolahan-susenas-seruti'
          for (const day of [0, 1] as const) {
            const files = exampleFiles(name, day)
            const { data, collection } = normalizeUpload(name, dashboard.draft.datasets, files)
            const snapshot = this.addSnapshot(db, dashboard, { date: exampleDates[name][day], time: name === 'pes' && day ? '13:00' : '15:10' }, data, `synthetic-${day}`, true, collection)
            dashboard.activeRelease = addRelease(db, dashboard, dashboard.draft, snapshot).id
          }
          dashboard.visibility = 'public'
          putDashboard(db, dashboard)
        }
      })
    }
  }

  user(db: Records, credentials: Credentials) {
    if (!credentials.session || !/^[\w-]{43}$/.test(credentials.session)) return undefined
    const session = db.get<Session>(sessionKey(credentials.session))
    if (!session || session.expires <= Date.now()) return
    const user = db.get<User>(userKey(session.userId))
    return user && (user.passwordVersion ?? 0) === (session.passwordVersion ?? 0) ? user : undefined
  }
  requireUser(db: Records, credentials: Credentials) { return this.user(db, credentials) ?? fail(401, 'LOGIN_REQUIRED', 'Masuk untuk melanjutkan.') }
  async me(credentials: Credentials) { return this.store.read(db => { const user = this.user(db, credentials); return user ? account(db, user) : null }) }

  private rate(key: string) {
    const timestamp = Date.now()
    if (this.attempts.size > 5000) for (const [key, value] of this.attempts) if (value.until <= timestamp) this.attempts.delete(key)
    if (this.attempts.size >= 10_000 && !this.attempts.has(key)) fail(429, 'RATE_LIMIT', 'Terlalu banyak percobaan. Coba lagi nanti.')
    const current = this.attempts.get(key)
    const value = !current || current.until <= timestamp ? { count: 0, until: timestamp + 300_000 } : current
    if (++value.count > 8) fail(429, 'RATE_LIMIT', 'Terlalu banyak percobaan. Coba lagi dalam lima menit.')
    this.attempts.set(key, value)
  }
  async login(email: string, password: string, ip: string) {
    this.rate(`ip:${ip}`)
    this.rate(`email:${email}`)
    const user = await this.store.read(db => db.list<User>('user:').find(item => item.email.toLowerCase() === email))
    const valid = await verify(user?.hash ?? this.dummyHash, password)
    if (!user || !valid) fail(401, 'LOGIN_FAILED', 'Email atau kata sandi tidak sesuai.')
    this.attempts.delete(`email:${email}`)
    const session = token()
    return this.store.write(db => {
      const current = db.get<User>(userKey(user.id))
      if (!current || current.hash !== user.hash) fail(401, 'LOGIN_FAILED', 'Email atau kata sandi tidak sesuai.')
      db.put<Session>(sessionKey(session), { userId: user.id, expires: Date.now() + duration, passwordVersion: current.passwordVersion })
      return { session, user: account(db, current) }
    })
  }
  async logout(credentials: Credentials) {
    if (credentials.session) await this.store.write(db => db.delete(sessionKey(credentials.session!)))
  }

  async updateProfile(credentials: Credentials, input: { name: string; avatar: number | null }) {
    return this.store.write(db => {
      const user = this.requireUser(db, credentials)
      const next = { ...user, name: input.name, avatar: input.avatar ?? undefined }
      db.put(userKey(user.id), next)
      return account(db, next)
    })
  }
  async changePassword(credentials: Credentials, currentPassword: string, nextPassword: string, ip: string) {
    const user = await this.store.read(db => this.requireUser(db, credentials))
    const rateKey = `password:${user.id}:${ip}`
    this.rate(rateKey)
    if (!await verify(user.hash, currentPassword)) fail(401, 'PASSWORD_INCORRECT', 'Kata sandi saat ini tidak sesuai.')
    if (currentPassword === nextPassword) fail(422, 'PASSWORD_UNCHANGED', 'Gunakan kata sandi baru yang berbeda.')
    const nextHash = await passwordHash(nextPassword, { algorithm: Algorithm.Argon2id })
    await this.store.write(db => {
      const current = this.requireUser(db, credentials)
      if (current.hash !== user.hash) fail(409, 'PASSWORD_CHANGED', 'Kata sandi baru saja berubah. Ulangi dengan kata sandi saat ini.')
      const key = sessionKey(credentials.session!)
      const session = db.get<Session>(key)!
      const passwordVersion = (current.passwordVersion ?? 0) + 1
      db.put(userKey(current.id), { ...current, hash: nextHash, passwordVersion })
      db.put(key, { ...session, passwordVersion })
      db.put('audit:' + token(), { user: user.id, tenant: user.tenant, action: 'password_changed', at: now() })
    })
    this.attempts.delete(rateKey)
    return { ok: true }
  }
  async members(credentials: Credentials) {
    return this.store.read(db => {
      const user = this.requireUser(db, credentials)
      const access = permissions(db, user)
      if (!access.users) fail(403, 'FORBIDDEN', 'Anda tidak punya izin mengelola pengguna.')
      return {
        members: db.list<User>('user:').filter(item => item.tenant === user.tenant && (access.roles || item.role === 'operator' || item.role === 'reader')).map(item => account(db, item)),
        policy: access.roles ? superadminPolicy(db, user.tenant) : undefined,
      }
    })
  }
  async createMember(credentials: Credentials, input: { name: string; email: string; role: MemberRole; password: string }) {
    const authorized = (db: Records) => {
      const user = this.requireUser(db, credentials)
      const access = permissions(db, user)
      if (!access.users || (!access.roles && input.role !== 'operator' && input.role !== 'reader')) fail(403, 'FORBIDDEN', 'Anda tidak punya izin menambahkan pengguna dengan role ini.')
      return user
    }
    await this.store.read(authorized)
    const hash = await passwordHash(input.password, { algorithm: Algorithm.Argon2id })
    return this.store.write(db => {
      const creator = authorized(db)
      if (db.list<User>('user:').some(user => user.email.toLowerCase() === input.email)) fail(409, 'EMAIL_EXISTS', 'Email tersebut sudah terdaftar.')
      const member: User = { id: randomUUID(), tenant: creator.tenant, email: input.email, name: input.name, role: input.role, hash }
      db.put(userKey(member.id), member)
      db.put('audit:' + token(), { user: creator.id, tenant: creator.tenant, action: 'member_created', memberId: member.id, role: member.role, at: now() })
      return account(db, member)
    })
  }
  async changeRole(credentials: Credentials, id: string, role: MemberRole, expectedRole: MemberRole) {
    return this.store.write(db => {
      const user = this.requireUser(db, credentials)
      if (!permissions(db, user).roles) fail(403, 'FORBIDDEN', 'Hanya developer yang dapat mengubah role pengguna.')
      const member = db.get<User>(userKey(id))
      if (!member || member.tenant !== user.tenant) fail(404, 'NOT_FOUND', 'Pengguna tidak ditemukan.')
      if (member.role === 'developer') fail(403, 'FORBIDDEN', 'Role developer dikelola melalui server.')
      if (member.role !== expectedRole) fail(409, 'ROLE_CHANGED', 'Role sudah berubah. Muat ulang daftar pengguna.')
      const next = { ...member, role }
      db.put(userKey(id), next)
      db.put('audit:' + token(), { user: user.id, tenant: user.tenant, action: 'role_changed', memberId: id, before: member.role, role, at: now() })
      return account(db, next)
    })
  }
  async updateSuperadminPolicy(credentials: Credentials, policy: SuperadminPolicy, expected: SuperadminPolicy) {
    return this.store.write(db => {
      const user = this.requireUser(db, credentials)
      if (!permissions(db, user).roles) fail(403, 'FORBIDDEN', 'Hanya developer yang dapat mengubah izin superadmin.')
      const current = superadminPolicy(db, user.tenant)
      if (current.dashboards !== expected.dashboards || current.users !== expected.users) fail(409, 'POLICY_CHANGED', 'Izin sudah berubah. Muat ulang pengaturan role.')
      db.put(superadminPolicyKey(user.tenant), policy)
      db.put('audit:' + token(), { user: user.id, tenant: user.tenant, action: 'superadmin_policy_changed', before: current, policy, at: now() })
      return policy
    })
  }

  private newDashboard(template: TemplateId, tenant: string, owner: string, demo = false, title?: string): Dashboard {
    const id = randomUUID()
    const draft = templateDefinition(template)
    if (demo && template === 'pes') draft.datasets[0].publicDetail = true
    if (title) draft.title = title
    const slug = draft.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 54) || 'dashboard'
    return {
      id, slug: `${slug}-${id.slice(0, 8)}`, tenant, owner, template, draft, demo, draftRevision: 1, activityRevision: 0,
      accessRevision: 0, activityStatus: 'active', closedAt: null, visibility: 'invite', activeRelease: null, snapshotIds: [], releaseIds: [], mappings: {}, operators: [], grants: [],
    }
  }
  private addSnapshot(db: Records, dashboard: Dashboard, condition: Condition, data: SnapshotData, fileHash: string, demo: boolean, collection?: CollectionReport[]) {
    const grains = Object.fromEntries(dashboard.draft.datasets.map(dataset => [dataset.id, dataset.grain]))
    const snapshot: Snapshot = { id: randomUUID(), ...condition, data, collection, hash: fileHash, demo, createdAt: now(), revision: ++dashboard.activityRevision, signature: datasetSignature(dashboard.draft), grains }
    db.put(snapshotKey(dashboard, snapshot.id), snapshot)
    dashboard.snapshotIds.push(snapshot.id)
    return snapshot
  }
  authorize(db: Records, credentials: Credentials, dashboard: Dashboard) {
    if (dashboard.archivedAt || !dashboard.activeRelease) return false
    if (dashboard.demo) return !!this.user(db, credentials)
    if (dashboard.visibility === 'public') return true
    const user = this.user(db, credentials)
    if (user && canEdit(db, user, dashboard)) return true
    const active = (grant: Grant) => !grant.expires || grant.expires > Date.now()
    if (dashboard.visibility === 'invite') return !!user && dashboard.grants.some(grant => grant.mode === 'invite' && grant.email === user.email.toLowerCase() && active(grant))
    if (!credentials.shared || !/^[\w-]{43}$/.test(credentials.shared)) return false
    const session = db.get<AccessSession>('share:' + hash(credentials.shared))
    return !!session && session.dashboardId === dashboard.id && session.expires > Date.now() && dashboard.grants.some(grant => grant.id === session.grantId && grant.mode === 'link' && active(grant))
  }
  async catalog(credentials: Credentials) {
    return this.store.read(db => {
      this.requireUser(db, credentials)
      return db.list<Dashboard>('dashboard:').filter(dashboard => dashboard.activeRelease && !dashboard.archivedAt && dashboard.visibility === 'public')
        .map(dashboard => {
          const release = db.get<Release>(releaseKey(dashboard, dashboard.activeRelease!))!
          const { title, description, period, satker, theme } = release.definition
          return { slug: dashboard.slug, title, description, period, satker, theme, template: dashboard.template, demo: dashboard.demo, activityStatus: dashboard.activityStatus, date: release.date, time: release.time }
        }).sort((a, b) => Number(b.demo) - Number(a.demo) || b.date.localeCompare(a.date))
    })
  }

  private report(db: Records, dashboard: Dashboard, release?: Release): Report {
    const snapshot = release ? db.get<Snapshot>(snapshotKey(dashboard, release.snapshotId)) : latestSnapshot(db, dashboard)
    if (!snapshot) fail(404, 'DATA_EMPTY', 'Belum ada data kondisi yang bisa ditampilkan.')
    const definition = release?.definition ?? dashboard.draft
    const previous = previousDay(snapshot.date)
    const history = dashboard.releaseIds.map(id => db.get<Release>(releaseKey(dashboard, id))!)
      .filter(item => dashboard.visibility !== 'public' || !hasPersonalRows(item.definition))
      .sort((a, b) => byCondition(b, a) || b.version - a.version)
    let baseline: Snapshot | undefined
    if (release) {
      const entry = history.find(item => item.date === previous)
      if (entry) baseline = db.get<Snapshot>(snapshotKey(dashboard, entry.snapshotId))
    } else baseline = dashboard.snapshotIds.map(id => db.get<Snapshot>(snapshotKey(dashboard, id))!).filter(item => item.date === previous && item.demo === snapshot.demo).sort((a, b) => byCondition(b, a) || b.revision - a.revision)[0]
    const compatible = baseline && baseline.signature === snapshot.signature && baseline.demo === snapshot.demo ? baseline : null
    return {
      id: dashboard.id, slug: dashboard.slug, template: dashboard.template, demo: snapshot.demo,
      definition: release ? publicDefinition(definition) : definition, condition: { date: snapshot.date, time: snapshot.time },
      data: snapshotData(definition, snapshot, !!release), baseline: compatible ? snapshotData(definition, compatible, !!release) : null,
      collection: definition.widgets.some(widget => widget.type === 'schedule') ? snapshot.collection : undefined,
      baselineReason: compatible ? null : baseline ? 'Definisi atau sumber H−1 berbeda.' : 'Kondisi H−1 belum tersedia.',
      currentRelease: release?.id ?? '', history: history.map(({ id, date, time, createdAt, version }) => ({ id, date, time, createdAt, version })),
      activityStatus: dashboard.activityStatus, closedAt: dashboard.closedAt,
    }
  }
  async reader(credentials: Credentials, slugOrId: string, selected?: string, idLookup = false) {
    return this.store.read(db => {
      const dashboard = idLookup ? db.get<Dashboard>('dashboard:' + slugOrId) : db.list<Dashboard>('dashboard:').find(item => item.slug === slugOrId)
      if (!dashboard || !this.authorize(db, credentials, dashboard)) fail(404, 'NOT_FOUND', 'Dashboard tidak ditemukan atau akses diperlukan.')
      if (selected && !dashboard.releaseIds.includes(selected)) fail(404, 'NOT_FOUND', 'Versi laporan tidak ditemukan.')
      const release = db.get<Release>(releaseKey(dashboard, selected || dashboard.activeRelease!))
      if (!release || (dashboard.visibility === 'public' && hasPersonalRows(release.definition))) fail(404, 'NOT_FOUND', 'Versi laporan tidak ditemukan.')
      return this.report(db, dashboard, release)
    })
  }
  async studio(credentials: Credentials) {
    return this.store.read(db => {
      const user = this.requireUser(db, credentials)
      return db.list<Dashboard>('dashboard:').filter(dashboard => !dashboard.demo && canEdit(db, user, dashboard)).map(({ id, slug, draft, template, activityStatus, visibility, activeRelease, archivedAt }) => ({ id, slug, title: draft.title, template, activityStatus, visibility, activeRelease, archivedAt }))
    })
  }
  private protect(db: Records, credentials: Credentials, id: string, manage = false) {
    const user = this.requireUser(db, credentials)
    const dashboard = requireDashboard(db, id)
    if (dashboard.demo || !(manage ? canManage(db, user, dashboard) : canEdit(db, user, dashboard))) fail(403, 'FORBIDDEN', 'Anda tidak punya izin untuk dashboard ini.')
    return { user, dashboard }
  }
  async create(credentials: Credentials, template: TemplateId, title?: string) {
    return this.store.write(db => {
      const user = this.requireUser(db, credentials)
      if (!permissions(db, user).dashboards) fail(403, 'FORBIDDEN', 'Anda tidak punya izin membuat dashboard.')
      const dashboard = this.newDashboard(template, user.tenant, user.id, false, title)
      if (template !== 'custom') for (const day of [0, 1] as const) {
        const { data, collection } = normalizeUpload(template, dashboard.draft.datasets, exampleFiles(template, day))
        this.addSnapshot(db, dashboard, { date: exampleDates[template][day], time: '14:00' }, data, `synthetic-${day}`, true, collection)
      }
      putDashboard(db, dashboard)
      audit(db, user.id, 'create', dashboard)
      return { id: dashboard.id }
    })
  }
  async detail(credentials: Credentials, id: string) {
    return this.store.read(db => {
      const { user, dashboard } = this.protect(db, credentials, id)
      const manage = canManage(db, user, dashboard)
      const dashboardJobs = db.list<ImportJob>('import:').filter(job => job.dashboardId === id)
      const jobs = dashboardJobs.filter(job => manage || job.owner === user.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      const snapshot = dashboard.template === 'custom' ? latestSnapshot(db, dashboard) : undefined
      const applied = snapshot && dashboardJobs.find(job => job.status === 'published' && job.snapshotId === snapshot.id)
      const active = dashboard.activeRelease ? db.get<Release>(releaseKey(dashboard, dashboard.activeRelease)) : undefined
      const { grants, operators, ...detail } = dashboard
      return {
        ...detail, canManage: manage, canClose: manage, aiAvailable: geminiAvailable(), aiHealth: cachedGeminiStatus(),
        grants: manage ? grants.map(({ hash: _hash, ...grant }) => grant) : [],
        operators: manage ? db.list<User>('user:').filter(member => member.role === 'operator' && member.tenant === dashboard.tenant).map(member => ({ id: member.id, name: member.name, email: member.email, assigned: operators.includes(member.id) })) : [],
        jobs: jobs.map(({ data: _data, hash: _hash, mappings: _mappings, reusedFiles: _reusedFiles, baseSnapshotId: _baseSnapshotId, ...job }) => job),
        activePersonal: active ? hasPersonalRows(active.definition) : false,
        savedInputs: snapshot && applied && { snapshotId: applied.snapshotId, date: applied.date, time: applied.time,
          files: reusableInputs(dashboard, snapshot, applied), schemaChanged: snapshot.signature !== datasetSignature(dashboard.draft) },
        preview: dashboard.snapshotIds.length ? this.report(db, dashboard) : null,
      }
    })
  }
  async saveDraft(credentials: Credentials, id: string, body: { definition: unknown; expectedRevision: number; mappings?: Record<string, UploadMapping> }) {
    const definition = safeDefinition(body.definition)
    return this.store.write(db => {
      const { user, dashboard } = this.protect(db, credentials, id, true)
      checkRevision(dashboard.draftRevision, body.expectedRevision)
      const original = templateDefinition(dashboard.template)
      if (dashboard.template !== 'custom' && (definition.datasets.length !== original.datasets.length || original.datasets.some(dataset => {
        const next = definition.datasets.find(item => item.id === dataset.id)
        return !next || next.join || next.grain !== dataset.grain || dataset.fields.some(field => !activeFields(next).some(item => item.id === field.id && item.unit === field.unit && item.scale === field.scale && item.derived === field.derived))
      }))) fail(422, 'REQUIRED_TEMPLATE_FIELDS', 'Kolom baku template diperlukan untuk membaca sumber kegiatan.')
      if (body.mappings && Object.keys(body.mappings).some(id => !definition.datasets.some(dataset => dataset.id === id))) {
        fail(422, 'INVALID_MAPPING', 'Pemetaan harus merujuk ke dataset pada draf.')
      }
      dashboard.mappings = Object.fromEntries(Object.entries(dashboard.mappings).filter(([id]) => {
        const before = dashboard.draft.datasets.find(dataset => dataset.id === id)
        const after = definition.datasets.find(dataset => dataset.id === id)
        return after && before?.grain === after.grain
      }))
      dashboard.draft = definition
      if (body.mappings) dashboard.mappings = { ...dashboard.mappings, ...body.mappings }
      dashboard.draftRevision++
      putDashboard(db, dashboard)
      audit(db, user.id, 'draft', dashboard, { revision: dashboard.draftRevision })
      return { draftRevision: dashboard.draftRevision, definition }
    })
  }

  async aiDraft(credentials: Credentials, id: string, file: InputFile, input: { slot: string; sheet?: string; headerRow?: number; stopRow?: number; identity?: string }, onProgress?: (stage: CsvAnalysisStage) => void) {
    const { user, dashboard, snapshot, manage } = await this.store.read(db => {
      const auth = this.protect(db, credentials, id)
      return { ...auth, snapshot: latestSnapshot(db, auth.dashboard), manage: canManage(db, auth.user, auth.dashboard) }
    })
    assertOpen(dashboard)
    const dataset = dashboard.draft.datasets.find(item => item.id === input.slot)
    if (!dataset || dataset.join) fail(422, 'AI_SLOT', 'Pilih sumber berkas yang tersedia pada draf.')
    const design = dashboard.template === 'custom' && !snapshot?.data[dataset.id] && manage
    this.rate(`gemini:${user.id}`)
    try {
      return await suggestCsv({ ...input, file, dataset, design, definition: dashboard.draft, template: dashboard.template, expectedRevision: dashboard.draftRevision, onProgress })
    } catch (error) {
      if (error instanceof ImportError) fail(422, error.notice.code, error.message, error.notice.location)
      throw error
    }
  }
  async aiStatus(credentials: Credentials, id: string) {
    await this.store.read(db => this.protect(db, credentials, id))
    return { status: await checkGeminiStatus() }
  }

  async inspectSource(credentials: Credentials, id: string, slot: string, file: InputFile, mapping: UploadMapping) {
    const dataset = await this.store.read(db => {
      const { dashboard } = this.protect(db, credentials, id)
      const dataset = dashboard.draft.datasets.find(item => item.id === slot && !item.join)
      const isTemplateInput = dashboard.template === 'pes' && /^(auto_[123]|sls_detail)$/.test(slot) || dashboard.template === 'susenas' && slot === 'workbook'
      if (!dataset && !isTemplateInput) fail(422, 'INVALID_SOURCE', 'Sumber berkas tidak tersedia pada draf.')
      return dataset
    })
    try { return previewSource(file, dataset, mapping) }
    catch (error) {
      if (error instanceof ImportError) fail(422, error.notice.code, error.message, error.notice.location)
      throw error
    }
  }

  async previewJoin(credentials: Credentials, id: string, expectedRevision: number, candidate: unknown, files: Record<string, InputFile>, mappings: Record<string, UploadMapping>) {
    const { dashboard, snapshot } = await this.store.read(db => {
      const { dashboard } = this.protect(db, credentials, id, true)
      assertOpen(dashboard)
      if (dashboard.template !== 'custom') fail(422, 'JOIN_CUSTOM_ONLY', 'Penggabungan tersedia pada dashboard Susun sendiri.')
      checkRevision(dashboard.draftRevision, expectedRevision)
      return { dashboard, snapshot: latestSnapshot(db, dashboard) }
    })
    const dataset = safeDefinition({ ...dashboard.draft, datasets: [...dashboard.draft.datasets, candidate] }).datasets.at(-1)!
    if (!dataset.join) fail(422, 'INVALID_JOIN', 'Pilih hubungan antara dua sumber.')
    const sourceIds = [dataset.join.left.dataset, dataset.join.right.dataset]
    if (Object.keys(files).length && (Object.keys(files).length !== 2 || sourceIds.some(slot => !Object.hasOwn(files, slot)))) {
      fail(422, 'JOIN_SOURCE_REQUIRED', 'Pilih berkas baru untuk kedua sumber, atau gunakan kedua sumber dari kondisi yang sudah diterapkan.')
    }
    try {
      const data = Object.fromEntries(sourceIds.map(slot => {
        const source = dashboard.draft.datasets.find(item => item.id === slot)!
        const file = files[slot]
        const current = snapshot && sameGrain(snapshot, source) ? snapshot.data[slot] : undefined
        if (file) return [slot, readDataset(file, source, mappings[slot] ?? dashboard.mappings[slot] ?? {}, false)]
        if (!current) fail(422, 'JOIN_SOURCE_REQUIRED', 'Pilih berkas untuk kedua sumber sebelum memeriksa hasil penggabungan.')
        return [slot, applyFormulas(source, current)]
      }))
      const result = joinDataset(dataset, data)
      return { matched: result.matched, unmatched: result.unmatched, rows: result.data.rows.slice(0, 6), condition: Object.keys(files).length ? undefined : snapshot && { date: snapshot.date, time: snapshot.time } }
    } catch (error) {
      if (error instanceof ImportError) fail(422, error.notice.code, error.message, error.notice.location)
      throw error
    }
  }

  async prepare(credentials: Credentials, id: string, condition: Condition, files: Record<string, InputFile>, inputMappings: Record<string, UploadMapping> | undefined, reuseSnapshot?: string) {
    const { user, dashboard, applied, schemaChanged } = await this.store.read(db => {
      const auth = this.protect(db, credentials, id)
      if (!reuseSnapshot) return { ...auth, applied: undefined, schemaChanged: false }
      const snapshot = latestSnapshot(db, auth.dashboard)
      if (auth.dashboard.template !== 'custom' || snapshot?.id !== reuseSnapshot || byCondition(condition, snapshot) !== 0) {
        fail(409, 'SOURCE_CONDITION_CHANGED', 'Kondisi sumber tersimpan berubah. Muat ulang halaman dan periksa berkas untuk kondisi ini.')
      }
      const job = db.list<ImportJob>('import:').find(job => job.dashboardId === id && job.status === 'published' && job.snapshotId === snapshot.id)
      if (!job) fail(409, 'SOURCE_CONDITION_CHANGED', 'Berkas untuk kondisi ini perlu diunggah kembali.')
      return { ...auth, applied: { ...job, files: reusableInputs(auth.dashboard, snapshot, job) }, schemaChanged: snapshot.signature !== datasetSignature(auth.dashboard.draft) }
    })
    assertOpen(dashboard)
    const slots = Object.keys(files)
    if (!slots.length && (!schemaChanged || dashboard.draft.datasets.some(dataset => !dataset.join && !Object.hasOwn(applied?.files ?? {}, dataset.id)))) {
      fail(422, 'FILE_REQUIRED', 'Pilih setidaknya satu berkas untuk diunggah.')
    }
    const reused = applied ? await Promise.all(dashboard.draft.datasets.filter(({ id }) => !Object.hasOwn(files, id) && Object.hasOwn(applied.files, id)).map(async ({ id: slot, label }) => {
      const objectJob = applied.reusedFiles?.[slot] ?? applied.id
      try {
        const bytes = await this.objects.get(importObject(objectJob, slot))
        return { slot, objectJob, file: { name: applied.files[slot], bytes } }
      } catch {
        fail(503, 'SOURCE_UNAVAILABLE', `Berkas tersimpan untuk ${label} belum dapat dibaca. Pilih berkas kembali.`)
      }
    })) : []
    const allFiles = { ...Object.fromEntries(reused.map(({ slot, file }) => [slot, file])), ...files }
    const mappings = inputMappings ?? dashboard.mappings
    const autoSlots = ['auto_1', 'auto_2', 'auto_3']
    const completeBatch = dashboard.template === 'pes' && autoSlots.every(slot => Object.hasOwn(files, slot))
    const contents = Object.entries(allFiles).map(([slot, file]) => [
      completeBatch && autoSlots.includes(slot) ? 'auto' : slot,
      file.name.toLowerCase().split('.').at(-1),
      hash(file.bytes),
    ]).sort()
    const fileHash = hash(JSON.stringify([condition, contents, mappings, datasetSignature(dashboard.draft)]))
    const jobId = randomUUID()
    const discard = () => Promise.allSettled(slots.map(slot => this.objects.remove(importObject(jobId, slot))))
    let result
    try {
      const staged = await Promise.allSettled(slots.map(slot => this.objects.put(importObject(jobId, slot), files[slot].bytes)))
      if (staged.some(entry => entry.status === 'rejected')) fail(503, 'STORAGE_UNAVAILABLE', 'Berkas belum tersimpan. Coba unggah lagi.')
      result = await this.store.write(db => {
        const current = this.protect(db, credentials, id).dashboard
        assertOpen(current)
        if (reused.length && latestSnapshot(db, current)?.id !== reuseSnapshot) {
          fail(409, 'SOURCE_CONDITION_CHANGED', 'Berkas untuk kondisi ini sudah berubah. Muat ulang dan buat pemeriksaan baru.')
        }
        const previous = db.list<ImportJob>('import:').find(job => {
          if (job.dashboardId !== id || job.owner !== user.id || job.hash !== fileHash) return false
          return job.status === 'published' || (
            ['ready', 'uploaded', 'validating'].includes(job.status) &&
            job.activityRevision === current.activityRevision && job.draftRevision === current.draftRevision &&
            (!job.baseSnapshotId || job.baseSnapshotId === reuseSnapshot)
          )
        })
        if (previous) return this.importPreview(db, current, previous)
        const pending = db.list<ImportJob>('import:').filter(job => job.dashboardId === id && ['uploaded', 'validating'].includes(job.status))
        if (pending.length >= 5) fail(429, 'IMPORT_LIMIT', 'Terlalu banyak berkas menunggu. Coba kembali sebentar lagi.')
        checkRevision(current.activityRevision, dashboard.activityRevision)
        checkRevision(current.draftRevision, dashboard.draftRevision)
        const job: ImportJob = {
          id: jobId, dashboardId: id, owner: user.id, ...condition, hash: fileHash, status: 'uploaded', warnings: [], errors: [],
          mappings, draftRevision: current.draftRevision, activityRevision: current.activityRevision, createdAt: now(),
          files: Object.fromEntries(Object.entries(allFiles).map(([slot, file]) => [slot, file.name])),
          ...(reused.length ? { reusedFiles: Object.fromEntries(reused.map(({ slot, objectJob }) => [slot, objectJob])), baseSnapshotId: reuseSnapshot } : {}),
        }
        db.put('import:' + job.id, job)
        audit(db, user.id, 'import_upload', current, { jobId: job.id })
        return this.importPreview(db, current, job)
      })
    } catch (error) {
      // Keep staged objects if the final write result could not be determined.
      if (error instanceof Error && 'getStatus' in error) await discard()
      throw error
    }
    if (result.id !== jobId) await discard()
    else this.imports.send(result.id)
    return result
  }
  startImports() { this.imports.start(id => this.processImports(id)) }
  private async processImports(requested?: string) {
    if (this.importRunning) return
    this.importRunning = true
    try { await this.runImport(requested) } finally { this.importRunning = false }
  }
  private async runImport(requested?: string) {
    const pending = (job: ImportJob) => (!requested || requested === job.id) && (job.status === 'uploaded' || (job.status === 'validating' && (job.lease ?? 0) <= Date.now()))
    if (!await this.store.read(db => db.list<ImportJob>('import:').some(pending))) return
    const claim = randomUUID()
    const work = await this.store.write(db => {
      const job = db.list<ImportJob>('import:').find(pending)
      if (!job) return
      const dashboard = requireDashboard(db, job.dashboardId)
      job.status = 'validating'
      job.claim = claim
      job.lease = Date.now() + 90_000
      db.put('import:' + job.id, job)
      return { job, dashboard }
    })
    if (!work) return
    const { job, dashboard } = work
    let data: SnapshotData | undefined
    let sources: Record<string, string> | undefined
    let collection: CollectionReport[] | undefined
    let warnings: Notice[] = []
    let status: ImportJob['status'] = 'ready'
    const errors: Notice[] = []
    try {
      const files = Object.fromEntries(await Promise.all(Object.entries(job.files).map(async ([slot, name]) => [slot, { name, bytes: await this.objects.get(importObject(job.reusedFiles?.[slot] ?? job.id, slot)) }])))
      ;({ data, warnings, collection, sources } = normalizeUpload(dashboard.template, dashboard.draft.datasets, files, job.mappings))
      for (const slot of sampleSlots(dashboard.template, data)) errors.push({ code: 'EXAMPLE_DATA', message: `Dataset ${slot} masih berisi berkas contoh yang disediakan. Ganti dengan data kegiatan untuk menerbitkannya.` })
    } catch (error) {
      if (error instanceof ImportError) errors.push(error.notice)
      else {
        status = 'failed'
        errors.push({ code: 'IMPORT_FAILED', message: 'Berkas belum dapat diproses. Coba unggah kembali.' })
      }
    }
    await this.store.write(db => {
      const saved = db.get<ImportJob>('import:' + job.id)
      if (!saved || saved.claim !== claim) return
      const current = requireDashboard(db, job.dashboardId)
      const owner = db.get<User>('user:' + job.owner)
      if (!owner || !canEdit(db, owner, current)) errors.push({ code: 'FORBIDDEN', message: 'Izin pengelola pada dashboard telah berubah.' })
      else if (current.activityStatus === 'closed') errors.push({ code: 'ACTIVITY_CLOSED', message: 'Kegiatan ditutup sebelum pemeriksaan selesai.' })
      else if (current.activityRevision !== job.activityRevision || current.draftRevision !== job.draftRevision) errors.push({ code: 'REVISION_CONFLICT', message: 'Dashboard berubah. Buat pratinjau ulang untuk data ini.' })
      saved.status = status === 'failed' ? status : errors.length ? 'invalid' : 'ready'
      saved.data = saved.status === 'ready' ? data : undefined
      saved.sources = sources
      saved.collection = saved.status === 'ready' ? collection : undefined
      saved.errors = errors
      saved.warnings = warnings
      delete saved.lease
      delete saved.claim
      db.put('import:' + job.id, saved)
      audit(db, job.owner, 'import_preview', current, { jobId: job.id, status: saved.status })
    })
  }
  private importPreview(db: Records, dashboard: Dashboard, job: ImportJob) {
    const previous = latestSnapshot(db, dashboard)
    const differences = Object.entries(job.data ?? {}).map(([id, data]) => {
      const from = previous?.data[id]
      const target = aggregate(data, 'target').value
      const before = from && !previous?.demo ? aggregate(from, 'target').value : null
      const newCodes = data.rows.filter(row => !from?.rows.some(item => item.code === row.code)).map(row => row.name)
      const gone = from?.rows.filter(row => !data.rows.some(item => item.code === row.code)).map(row => row.name) ?? []
      return { id, source: job.sources?.[id] ?? job.files[id] ?? job.files.workbook, rows: data.rows.length, detailed: data.detail?.filter(row => row.level === 'sls').length, target, before, newCodes, gone, samples: data.rows.slice(0, 3), reported: data.reported }
    })
    const { data: _data, collection, claim: _claim, lease: _lease, reusedFiles: _reusedFiles, baseSnapshotId: _baseSnapshotId, ...publicJob } = job
    return { ...publicJob, differences, collection: collection?.map(({ date, time, rows }) => ({ date, time, count: rows.length })) }
  }
  private getJob(db: Records, credentials: Credentials, id: string) {
    const job = db.get<ImportJob>('import:' + id) ?? fail(404, 'NOT_FOUND', 'Pekerjaan unggahan tidak ditemukan.')
    const { user, dashboard } = this.protect(db, credentials, job.dashboardId)
    if (job.owner !== user.id && !canManage(db, user, dashboard)) fail(404, 'NOT_FOUND', 'Pekerjaan unggahan tidak ditemukan.')
    return { job, user, dashboard }
  }
  async preview(credentials: Credentials, id: string) {
    if (this.onDemandJobs) {
      const { job } = await this.store.read(db => this.getJob(db, credentials, id))
      if (job.status === 'uploaded' || (job.status === 'validating' && (job.lease ?? 0) <= Date.now())) await this.processImports(id)
    }
    return this.store.read(db => { const { dashboard, job } = this.getJob(db, credentials, id); return this.importPreview(db, dashboard, job) })
  }
  async confirm(credentials: Credentials, id: string, password: string, ip: string) {
    const { user, job } = await this.store.read(db => this.getJob(db, credentials, id))
    if (job.status !== 'ready') fail(409, 'IMPORT_NOT_READY', 'Pekerjaan ini belum siap diterapkan.')
    this.rate(`confirm:${user.id}:${ip}`)
    if (!await verify(user.hash, password)) fail(401, 'PASSWORD_INCORRECT', 'Kata sandi akun tidak sesuai.')
    this.attempts.delete(`confirm:${user.id}:${ip}`)
    const proof = token()
    await this.store.write(db => db.put<Proof>('proof:' + hash(proof), { userId: user.id, jobId: id, dashboardId: job.dashboardId, hash: job.hash, expires: Date.now() + 180_000, passwordVersion: user.passwordVersion }))
    return { proof }
  }
  async commit(credentials: Credentials, id: string, body: { proof: string; hash: string; idempotencyKey: string; reason?: string }) {
    return this.store.write(db => {
      const { job, user, dashboard } = this.getJob(db, credentials, id)
      if (job.status === 'published' && job.commitKey === body.idempotencyKey && job.hash === body.hash) return { snapshotId: job.snapshotId, releaseId: job.appliedRelease }
      assertOpen(dashboard)
      if (job.status !== 'ready' || !job.data) fail(409, 'IMPORT_NOT_READY', 'Pekerjaan ini sudah diterapkan atau masih memerlukan koreksi.')
      checkRevision(dashboard.activityRevision, job.activityRevision)
      checkRevision(dashboard.draftRevision, job.draftRevision)
      if (job.baseSnapshotId && latestSnapshot(db, dashboard)?.id !== job.baseSnapshotId) {
        fail(409, 'SOURCE_CONDITION_CHANGED', 'Berkas untuk kondisi ini sudah berubah. Muat ulang dan buat pemeriksaan baru.')
      }
      const proofKey = 'proof:' + hash(body.proof)
      const proof = db.get<Proof>(proofKey)
      if (!proof || proof.expires <= Date.now() || proof.jobId !== id || proof.userId !== user.id || proof.dashboardId !== dashboard.id || proof.hash !== job.hash || job.hash !== body.hash || (proof.passwordVersion ?? 0) !== (user.passwordVersion ?? 0)) fail(403, 'CONFIRM_REQUIRED', 'Konfirmasi kata sandi untuk pratinjau ini perlu diulang.')
      if (job.warnings.length && !body.reason) fail(422, 'REASON_REQUIRED', 'Tulis alasan untuk menerapkan unggahan dengan peringatan.')
      const duplicate = dashboard.snapshotIds.map(snapshot => db.get<Snapshot>(snapshotKey(dashboard, snapshot))!).find(item => item.hash === job.hash)
      if (duplicate) fail(409, 'DUPLICATE_SNAPSHOT', 'Data dengan kondisi dan pemetaan yang sama sudah tersimpan.')
      const active = dashboard.activeRelease ? db.get<Release>(releaseKey(dashboard, dashboard.activeRelease)) : undefined
      const snapshot = this.addSnapshot(db, dashboard, { date: job.date, time: job.time }, job.data, job.hash, false, job.collection)
      if (active && datasetSignature(active.definition) === snapshot.signature) {
        const release = addRelease(db, dashboard, active.definition, snapshot)
        if (byCondition(release, active) >= 0) dashboard.activeRelease = release.id
      }
      if (!(dashboard.template === 'pes' && Object.hasOwn(job.files, 'auto_1'))) dashboard.mappings = job.mappings
      job.status = 'published'
      job.snapshotId = snapshot.id
      job.commitKey = body.idempotencyKey
      job.appliedRelease = dashboard.activeRelease
      delete job.data
      delete job.collection
      db.put('import:' + id, job)
      db.delete(proofKey)
      putDashboard(db, dashboard)
      audit(db, user.id, 'import_commit', dashboard, { jobId: id, snapshotId: snapshot.id, reason: body.reason })
      return { snapshotId: snapshot.id, releaseId: dashboard.activeRelease }
    })
  }

  async publish(credentials: Credentials, id: string, expected: number, visibility: Visibility) {
    return this.store.write(db => {
      const { user, dashboard } = this.protect(db, credentials, id, true)
      checkRevision(dashboard.draftRevision, expected)
      checkPersonalAccess(dashboard.draft, visibility)
      const snapshots = dashboard.snapshotIds.map(item => db.get<Snapshot>(snapshotKey(dashboard, item))!).filter(snapshot => !snapshot.demo)
        .filter(snapshot => snapshot.signature === datasetSignature(dashboard.draft)).sort((a, b) => byCondition(a, b) || a.revision - b.revision)
      if (!snapshots.length) fail(422, 'DATA_REQUIRED', 'Terapkan semua berkas kegiatan dengan definisi saat ini sebelum menerbitkan dashboard.')
      if (!dashboard.draft.widgets.length) fail(422, 'WIDGET_REQUIRED', 'Tambahkan komponen agar dashboard dapat ditampilkan.')
      for (const snapshot of snapshots.slice(0, -1)) if (!dashboard.releaseIds.some(release => db.get<Release>(releaseKey(dashboard, release))!.snapshotId === snapshot.id)) addRelease(db, dashboard, dashboard.draft, snapshot)
      const release = addRelease(db, dashboard, dashboard.draft, snapshots.at(-1)!)
      if (dashboard.visibility !== visibility || dashboard.archivedAt) dashboard.accessRevision++
      dashboard.archivedAt = null
      dashboard.visibility = visibility
      dashboard.activeRelease = release.id
      dashboard.draftRevision++
      putDashboard(db, dashboard)
      audit(db, user.id, 'publish', dashboard, { releaseId: release.id, visibility })
      return { releaseId: release.id, slug: dashboard.slug }
    })
  }
  async rollback(credentials: Credentials, id: string, releaseId: string, expected: number) {
    return this.store.write(db => {
      const { user, dashboard } = this.protect(db, credentials, id, true)
      checkRevision(dashboard.draftRevision, expected)
      const previous = db.get<Release>(releaseKey(dashboard, releaseId)) ?? fail(404, 'NOT_FOUND', 'Rilis tidak ditemukan.')
      checkPersonalAccess(previous.definition, dashboard.visibility)
      const snapshot = db.get<Snapshot>(snapshotKey(dashboard, previous.snapshotId))!
      const release = addRelease(db, dashboard, previous.definition, snapshot)
      dashboard.activeRelease = release.id
      dashboard.draftRevision++
      putDashboard(db, dashboard)
      audit(db, user.id, 'rollback', dashboard, { releaseId: release.id, previous: releaseId })
      return { releaseId: release.id }
    })
  }
  async changeStatus(credentials: Credentials, id: string, close: boolean, revision: number, reason?: string) {
    return this.store.write(db => {
      const { user, dashboard } = this.protect(db, credentials, id, true)
      if (!canManage(db, user, dashboard)) fail(403, 'FORBIDDEN', 'Anda tidak punya izin mengubah status kegiatan.')
      checkRevision(dashboard.activityRevision, revision)
      const status = close ? 'closed' : 'active'
      if (dashboard.activityStatus === status) return { activityStatus: status, activityRevision: revision }
      dashboard.activityStatus = status
      dashboard.closedAt = close ? now() : null
      dashboard.activityRevision++
      putDashboard(db, dashboard)
      audit(db, user.id, close ? 'close' : 'reopen', dashboard, { reason })
      return { activityStatus: status, activityRevision: dashboard.activityRevision }
    })
  }

  async changeAccess(credentials: Credentials, id: string, visibility: Visibility) {
    return this.store.write(db => {
      const { user, dashboard } = this.protect(db, credentials, id, true)
      const active = dashboard.activeRelease ? db.get<Release>(releaseKey(dashboard, dashboard.activeRelease)) : undefined
      checkPersonalAccess(active?.definition ?? dashboard.draft, visibility)
      if (dashboard.visibility === visibility) return { visibility }
      dashboard.visibility = visibility
      dashboard.accessRevision++
      putDashboard(db, dashboard)
      audit(db, user.id, 'access', dashboard, { visibility })
      return { visibility }
    })
  }
  async archive(credentials: Credentials, id: string, expected: number, reason?: string) {
    return this.store.write(db => {
      const { user, dashboard } = this.protect(db, credentials, id, true)
      checkRevision(dashboard.draftRevision, expected)
      if (!dashboard.activeRelease) fail(422, 'NOT_PUBLISHED', 'Terbitkan dashboard sebelum mengarsipkannya.')
      if (dashboard.archivedAt) return { archivedAt: dashboard.archivedAt }
      dashboard.archivedAt = now()
      dashboard.draftRevision++
      dashboard.accessRevision++
      putDashboard(db, dashboard)
      audit(db, user.id, 'archive', dashboard, { reason })
      return { archivedAt: dashboard.archivedAt }
    })
  }
  async grant(credentials: Credentials, id: string, invite?: string, hours?: number) {
    return this.store.write(db => {
      const { user, dashboard } = this.protect(db, credentials, id, true)
      const secret = invite ? undefined : token()
      if (dashboard.grants.length >= 50) fail(422, 'GRANT_LIMIT', 'Cabut undangan atau tautan sebelum menambahkan izin baru.')
      const grant: Grant = invite ? { mode: 'invite', id: randomUUID(), email: invite.toLowerCase() } : { mode: 'link', id: randomUUID(), hash: hash(secret!), expires: hours ? Date.now() + hours * 3_600_000 : undefined }
      if (invite) dashboard.grants = dashboard.grants.filter(item => item.email !== grant.email)
      else dashboard.grants = dashboard.grants.filter(item => item.mode !== 'link')
      dashboard.grants.push(grant)
      dashboard.accessRevision++
      putDashboard(db, dashboard)
      audit(db, user.id, 'grant', dashboard, { grantId: grant.id, mode: grant.mode })
      return { id: grant.id, slug: dashboard.slug, secret }
    })
  }
  async revoke(credentials: Credentials, id: string, grant: string) {
    return this.store.write(db => {
      const { user, dashboard } = this.protect(db, credentials, id, true)
      dashboard.grants = dashboard.grants.filter(item => item.id !== grant)
      dashboard.accessRevision++
      putDashboard(db, dashboard)
      audit(db, user.id, 'revoke', dashboard, { grantId: grant })
      return { ok: true }
    })
  }
  async exchange(slug: string, secret: string, ip: string) {
    this.rate(`share:${ip}`)
    const value = token()
    return this.store.write(db => {
      const dashboard = db.list<Dashboard>('dashboard:').find(item => item.slug === slug)
      const grant = dashboard?.grants.find(item => item.mode === 'link' && item.hash === hash(secret) && (!item.expires || item.expires > Date.now()))
      if (!dashboard?.activeRelease || dashboard.archivedAt || dashboard.visibility !== 'link' || !grant) fail(404, 'NOT_FOUND', 'Tautan tidak berlaku atau sudah dicabut.')
      db.put<AccessSession>('share:' + hash(value), { dashboardId: dashboard.id, grantId: grant.id, expires: Math.min(Date.now() + duration, grant.expires ?? Infinity) })
      return { value, slug }
    })
  }
  async operators(credentials: Credentials, id: string, memberId: string, enabled: boolean) {
    return this.store.write(db => {
      const { user, dashboard } = this.protect(db, credentials, id, true)
      const member = db.get<User>('user:' + memberId)
      if (!member || member.tenant !== dashboard.tenant || member.role !== 'operator') fail(404, 'NOT_FOUND', 'Operator tidak ditemukan pada satker.')
      dashboard.operators = [...new Set([...dashboard.operators.filter(operator => operator !== memberId), ...(enabled ? [memberId] : [])])]
      dashboard.accessRevision++
      putDashboard(db, dashboard)
      audit(db, user.id, 'operator', dashboard, { memberId, enabled })
      return { ok: true }
    })
  }
  async formula(credentials: Credentials, id: string, datasetId: string, fieldId: string, formula: string) {
    return this.store.read(db => {
      const { dashboard } = this.protect(db, credentials, id, true)
      const dataset = structuredClone(dashboard.draft.datasets.find(item => item.id === datasetId))
      if (!dataset) fail(422, 'DATASET_UNKNOWN', 'Dataset tidak tersedia.')
      const field = dataset.fields.find(item => item.id === fieldId)
      if (field) field.formula = formula
      else dataset.fields.push({ id: fieldId, label: fieldId, public: true, nullable: true, unit: 'number', aliases: [], formula })
      let tree
      try { compileFormulas(dataset); tree = parseFormula(formula) }
      catch (error) { fail(422, 'INVALID_FORMULA', (error as Error).message) }
      const data = latestSnapshot(db, dashboard)?.data[datasetId]
      const rows = data ? applyFormulas(dataset, data).rows.slice(0, 4) : []
      return { dependencies: [...tree.fields].map(key => ({ id: key, label: dataset.fields.find(field => field.id === key)?.label ?? key })), rows: rows.map(row => ({ name: row.name, ...evaluate(tree.expression, row.values) })) }
    })
  }
}

export const uploadSchema = z.object({ date: dateSchema, time: timeSchema, mappings: z.string().max(20_000).optional(), reuseSnapshot: z.uuid().optional() })
export const mappingsSchema = z.record(z.string().regex(/^[a-z][a-z0-9_]{0,39}$/), z.object({
  sheet: z.string().trim().max(80).optional(), headerRow: z.number().int().min(1).max(10_000).optional(), stopRow: z.number().int().min(2).max(10_100).optional(),
  jsonPath: z.string().trim().max(160).optional(), region: z.string().trim().max(120).optional(), columns: z.record(z.string().regex(/^[a-z][a-z0-9_]{0,39}$/), z.string().trim().min(1).max(120)).optional(),
}))
export const templateCatalog = () => Object.entries(templates).map(([id, { name, description, definition }]) => ({ id, name, description, definition }))

const samples = new Map<TemplateId, Record<string, Set<string>>>()
function sampleSlots(template: TemplateId, data: SnapshotData) {
  if (template === 'custom') return []
  const { datasets } = templateDefinition(template)
  const fingerprint = (dataset: Definition['datasets'][number], snapshot: SnapshotData) => hash(JSON.stringify(snapshot[dataset.id].rows.map(row => [row.code, ...dataset.fields.filter(field => !field.formula).map(field => row.values[field.id])]).sort((a, b) => String(a[0]).localeCompare(String(b[0])))))
  if (!samples.has(template)) {
    const examples = ([0, 1] as const).map(day => normalizeUpload(template, datasets, exampleFiles(template, day)).data)
    samples.set(template, Object.fromEntries(datasets.map(dataset => [dataset.id, new Set(examples.map(example => fingerprint(dataset, example)))])))
  }
  const expected = samples.get(template)!
  return datasets.filter(dataset => expected[dataset.id].has(fingerprint(dataset, data))).map(dataset => dataset.label)
}
