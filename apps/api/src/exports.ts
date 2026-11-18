import { randomUUID } from 'node:crypto'
import { chromium } from 'playwright'
import { zipSync } from 'fflate'
import type { Report } from '../../../packages/contracts/index'
import { fail, hash, token, type Dashboard } from './model'
import type { Credentials, Monitoring } from './monitoring'
import { JobQueue } from './queues'

export type Sort = Record<string, { field: string; reverse: boolean }>
type Job = {
  id: string; dashboardId: string; accessRevision: number; scope: string; status: 'queued' | 'processing' | 'ready' | 'failed';
  report?: Report; sort?: Sort; created: number; lease?: number; ticket?: string; error?: string; extension?: 'png' | 'zip'; pages?: number; claim?: string; storedClaim?: string;
}
const lifetime = 60 * 60 * 1000
const keyFor = (job: Job, extension: string) => `exports/${job.id}-${job.claim ?? job.storedClaim}.${extension}`

export class Exports {
  private working = false
  private readonly queue = new JobQueue('bps-monitoring-exports')
  constructor(private readonly app: Monitoring) {}

  private scope(credentials: Credentials, dashboard: Dashboard) {
    if (dashboard.visibility === 'public') return 'public'
    return hash(`${credentials.session ?? ''}|${credentials.shared ?? ''}`)
  }
  async create(credentials: Credentials, dashboardId: string, releaseId: string, sort?: Sort, includeDetail = false) {
    const report = await this.app.reader(credentials, dashboardId, releaseId, true)
    if (!includeDetail) for (const dataset of Object.values(report.data)) delete dataset.detail
    const created = await this.app.store.write(db => {
      const dashboard = db.get<Dashboard>('dashboard:' + dashboardId)
      if (!dashboard || !this.app.authorize(db, credentials, dashboard)) fail(404, 'NOT_FOUND', 'Dashboard tidak ditemukan.')
      const scope = this.scope(credentials, dashboard)
      const candidates = db.list<Job>('export:').filter(job => job.dashboardId === dashboardId && job.created > Date.now() - lifetime && job.accessRevision === dashboard.accessRevision)
      if (candidates.filter(job => job.status === 'queued' || job.status === 'processing').length >= 5) fail(429, 'EXPORT_LIMIT', 'Terlalu banyak laporan sedang dibuat. Coba kembali sebentar lagi.')
      const job: Job = { id: randomUUID(), report, sort, status: 'queued', scope, dashboardId, accessRevision: dashboard.accessRevision, created: Date.now() }
      db.put('export:' + job.id, job)
      return { id: job.id, status: job.status }
    })
    this.queue.send(created.id)
    return created
  }
  private async authorised(credentials: Credentials, id: string) {
    return this.app.store.read(db => {
      const job = db.get<Job>('export:' + id)
      const dashboard = job && db.get<Dashboard>('dashboard:' + job.dashboardId)
      if (!job || !dashboard || job.created <= Date.now() - lifetime || dashboard.accessRevision !== job.accessRevision || !this.app.authorize(db, credentials, dashboard) || job.scope !== this.scope(credentials, dashboard)) fail(404, 'NOT_FOUND', 'Ekspor tidak tersedia atau izin telah berubah.')
      return { job, dashboard }
    })
  }
  async status(credentials: Credentials, id: string) {
    const { job } = await this.authorised(credentials, id)
    return { id, status: job.status, error: job.error, pages: job.pages }
  }
  async download(credentials: Credentials, id: string) {
    const { job, dashboard } = await this.authorised(credentials, id)
    if (job.status !== 'ready' || !job.extension) fail(409, 'NOT_READY', 'Laporan sedang diproses.')
    const bytes = await this.app.objects.get(keyFor(job, job.extension)).catch(() => fail(404, 'NOT_FOUND', 'Berkas laporan tidak tersedia. Buat laporan baru.'))
    await this.authorised(credentials, id)
    return { bytes, filename: `${dashboard.slug}.${job.extension}` }
  }
  async ticket(key: string) {
    if (!/^[\w-]{43}$/.test(key)) fail(404, 'NOT_FOUND', 'Tiket laporan tidak tersedia.')
    const requested = hash(key)
    return this.app.store.read(db => {
      const job = db.list<Job>('export:').find(job => job.ticket === requested && (job.lease ?? 0) > Date.now())
      const dashboard = job && db.get<Dashboard>('dashboard:' + job.dashboardId)
      if (!job?.report || job.status !== 'processing' || dashboard?.accessRevision !== job.accessRevision) fail(404, 'NOT_FOUND', 'Tiket laporan tidak tersedia.')
      return { report: job.report, sort: job.sort }
    })
  }
  start() {
    this.queue.start(id => this.run(id))
  }
  private async run(id?: string) {
    if (this.working) return
    this.working = true
    try { await this.process(id) } finally { this.working = false }
  }
  private async process(id?: string) {
    const pending = (job: Job, at: number) => (!id || id === job.id) && job.created > at - lifetime && (job.status === 'queued' || (job.status === 'processing' && (job.lease ?? 0) <= at))
    if (!await this.app.store.read(db => db.list<Job>('export:').some(job => pending(job, Date.now())))) return
    const key = token()
    const claim = randomUUID()
    const job = await this.app.store.write(db => {
      const entry = db.list<Job>('export:').find(job => pending(job, Date.now()))
      if (!entry) return
      entry.status = 'processing'
      entry.lease = Date.now() + 120_000
      entry.ticket = hash(key)
      entry.claim = claim
      db.put('export:' + entry.id, entry)
      return entry
    })
    if (!job) return
    try {
      const result = await this.render(key, job.report!)
      const objectKey = keyFor(job, result.extension)
      await this.app.objects.put(objectKey, result.bytes)
      if (!await this.finish(job, { status: 'ready', extension: result.extension, pages: result.pages })) await this.app.objects.remove(objectKey)
    } catch {
      await this.finish(job, { status: 'failed', error: 'Laporan PNG gagal dibuat. Coba lagi dalam beberapa saat.' })
    }
  }
  private async finish(job: Job, result: Partial<Job>) {
    return this.app.store.write(db => {
      const stored = db.get<Job>('export:' + job.id)
      if (!stored || stored.claim !== job.claim) return
      const dashboard = db.get<Dashboard>('dashboard:' + job.dashboardId)
      const outcome = dashboard?.accessRevision === job.accessRevision ? result : { status: 'failed' as const, error: 'Izin laporan berubah.' }
      db.put('export:' + job.id, { ...stored, ...outcome, ticket: undefined, lease: undefined, claim: undefined, storedClaim: job.claim, report: undefined })
      return outcome.status === 'ready'
    })
  }
  private async render(key: string, report: Report) {
    const channel = process.env.CHROMIUM_CHANNEL || (process.platform === 'win32' ? 'chrome' : undefined)
    const browser = await chromium.launch({ channel, executablePath: process.env.CHROMIUM_PATH, timeout: 25_000 })
    try {
      const page = await browser.newPage({ viewport: { width: 1360, height: 880 }, deviceScaleFactor: 1.25, reducedMotion: 'reduce' })
      const origin = process.env.RENDER_ORIGIN || `http://127.0.0.1:${process.argv.includes('--dev') ? 5173 : process.env.API_PORT || 3001}`
      await page.goto(`${origin}/render/${key}`, { waitUntil: 'domcontentloaded', timeout: 25_000 })
      const content = page.locator('[data-report-ready]')
      await content.waitFor({ timeout: 15_000 })
      await page.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].map(image => image.decode().catch(() => {}))) })
      for (const widget of report.definition.widgets.filter(widget => widget.type === 'table')) {
        const dataset = report.data[widget.dataset ?? '']
        const rows = [...(dataset?.rows ?? []), ...(dataset?.detail ?? [])]
        const rendered = content.locator(`[data-widget-id="${widget.id}"] tbody tr`)
        if (await rendered.count() !== rows.length || rows.length && !await rendered.filter({ hasText: rows.at(-1)!.code }).count()) throw new Error('Report table incomplete')
      }
      const box = await content.boundingBox()
      if (!box) throw new Error('Report has no bounds')
      const singlePageHeight = Number(process.env.EXPORT_SINGLE_HEIGHT || 10_000)
      if (box.height * box.width * 1.25 ** 2 <= 15_000_000 && box.height < singlePageHeight) {
        return { extension: 'png' as const, bytes: await content.screenshot({ animations: 'disabled', timeout: 25_000 }), pages: 1 }
      }
      const parts = await page.locator('.report-export-part').all()
      const files: Record<string, Uint8Array> = {}
      for (const [index, part] of parts.entries()) {
        await part.evaluate((node, label) => node.setAttribute('data-page', label), `Halaman ${index + 1} dari ${parts.length}`)
        const box = await part.boundingBox()
        if (!box || box.height * box.width * 1.25 ** 2 > 15_000_000) throw new Error('Report page exceeds pixel budget')
        files[`laporan-${String(index + 1).padStart(3, '0')}.png`] = await part.screenshot({ animations: 'disabled', timeout: 25_000 })
      }
      if (!parts.length) throw new Error('No export pages')
      return { extension: 'zip' as const, bytes: zipSync(files, { level: 0 }), pages: parts.length }
    } finally { await browser.close() }
  }
}
