import { Body, Controller, Delete, Get, HttpException, Inject, Param, Patch, Post, Query, Req, Res, UploadedFiles, UseInterceptors } from '@nestjs/common'
import { AnyFilesInterceptor } from '@nestjs/platform-express'
import type { Request, Response } from 'express'
import type {} from 'multer'
import { z } from 'zod'
import { idSchema, visibilitySchema, widgetWidths } from '../../../packages/contracts/index'
import { csvAnalysisStream, type CsvAnalysisEvent } from '../../../packages/contracts/csv-analysis'
import { avatarCount, memberRoles } from '../../../packages/contracts/accounts'
import { aggregate, sortRows } from '../../../packages/metrics/index'
import { exampleFiles } from '../../../fixtures/synthetic/index'
import type { InputFile } from '../../../packages/adapters/index'
import { fail } from './model'
import { mappingsSchema, Monitoring, slugSchema, templateCatalog, uploadSchema, type Credentials } from './monitoring'
import { Exports } from './exports'

export function payload<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input)
  if (!result.success) fail(422, 'INVALID_INPUT', 'Periksa isian pada formulir.', result.error.issues[0].path.join('.'))
  return result.data
}
export const cookies = { session: 'monitoring_session', shared: 'monitoring_share' }
export function credentials(req: Request): Credentials {
  const values = new Map((req.headers.cookie ?? '').split(';').map(pair => {
    const separator = pair.indexOf('=')
    return [pair.slice(0, separator).trim(), pair.slice(separator + 1)]
  }))
  return { session: values.get(cookies.session), shared: values.get(cookies.shared) }
}
function cookieOptions() {
  return { httpOnly: true, secure: process.env.NODE_ENV === 'production' || process.env.SECURE_COOKIES === 'true', sameSite: 'lax' as const, path: '/' }
}
const revision = z.number().int().nonnegative()
const password = z.string().min(1).max(200)
const newPassword = z.string().min(12).max(200)
const memberRole = z.enum(memberRoles)
const personName = z.string().trim().min(2).max(100)
const policy = z.object({ dashboards: z.boolean(), users: z.boolean() })
const secret = z.string().regex(/^[\w-]{43}$/)
const reason = z.string().trim().min(3).max(300)
function uploadJson(value: string | undefined): unknown {
  if (!value) return undefined
  try { return JSON.parse(value) }
  catch { fail(422, 'INVALID_MAPPING', 'Pengaturan unggahan tidak valid.') }
}

@Controller()
export class ControllerRoutes {
  constructor(@Inject(Monitoring) private readonly app: Monitoring, @Inject(Exports) private readonly exports: Exports) {}

  @Get('health') health() { return { ok: true } }
  @Get('catalog') catalog(@Req() req: Request) { return this.app.catalog(credentials(req)) }
  @Get('templates') templates(@Req() req: Request) {
    return this.app.store.read(db => {
      this.app.requireUser(db, credentials(req))
      return templateCatalog()
    })
  }
  @Get('templates/:id/examples/:day/:slot') async example(@Req() req: Request, @Param('id') id: string, @Param('day') day: string, @Param('slot') slot: string, @Res() res: Response) {
    await this.app.store.read(db => this.app.requireUser(db, credentials(req)))
    const file = exampleFiles(payload(z.enum(['pes', 'susenas']), id), Number(payload(z.enum(['0', '1']), day)) as 0 | 1)[slot]
    if (!file || !(file.bytes instanceof Uint8Array)) fail(404, 'NOT_FOUND', 'Berkas contoh tidak tersedia.')
    return res.attachment(file.name).send(Buffer.from(file.bytes))
  }
  @Get('admin/widget-catalog') widgets(@Req() req: Request) {
    return this.app.store.read(db => {
      this.app.requireUser(db, credentials(req))
      return ['progress', 'kpi', 'bars', 'donut', 'table', 'text', 'schedule', 'link'].map(type => ({ type, version: 1, widths: widgetWidths }))
    })
  }
  @Get('d/:slug') report(@Req() req: Request, @Param('slug') slug: string, @Query('release') release?: string) {
    return this.app.reader(credentials(req), slug, release)
  }
  @Get('dashboards/:id/history') async history(@Req() req: Request, @Param('id') id: string) {
    return (await this.app.reader(credentials(req), id, undefined, true)).history
  }
  @Get('dashboards/:id/view') view(@Req() req: Request, @Param('id') id: string, @Query('release') release?: string) {
    return this.app.reader(credentials(req), id, release, true)
  }
  @Get('dashboards/:id/children') async children(@Req() req: Request, @Param('id') id: string, @Query() query: unknown) {
    const { release, dataset, parent, sort, reverse, cursor, q } = payload(z.object({
      release: z.uuid().optional(), dataset: idSchema, parent: z.string().optional(), sort: z.string().optional(), reverse: z.enum(['true', 'false']).optional(),
      cursor: z.coerce.number().int().min(0).default(0), q: z.string().max(100).optional(),
    }), query)
    const report = await this.app.reader(credentials(req), id, release, true)
    const data = Object.hasOwn(report.data, dataset) ? report.data[dataset] : null
    if (!data) fail(404, 'NOT_FOUND', 'Dataset tidak tersedia.')
    let rows = parent && parent !== '13' ? data.detail?.filter(row => row.parent === parent) ?? [] : data.rows
    if (q) rows = rows.filter(row => `${row.code} ${row.name}`.toLowerCase().includes(q.toLowerCase()))
    if (sort) rows = sortRows(rows, sort, reverse === 'true')
    const totals = Object.fromEntries(Object.keys(data.rows[0]?.values ?? {}).map(field => [field, aggregate(data, field).coverage]))
    const parents = new Set(data.detail?.map(row => row.parent))
    return { rows: rows.slice(cursor, cursor + 20).map(row => ({ ...row, hasChildren: parents.has(row.code) })), nextCursor: rows.length > cursor + 20 ? cursor + 20 : null, total: rows.length, coverage: totals, deltaReason: report.baselineReason }
  }
  @Get('auth/me') me(@Req() req: Request) { return this.app.me(credentials(req)) }
  @Patch('auth/profile') profile(@Req() req: Request, @Body() body: unknown) {
    return this.app.updateProfile(credentials(req), payload(z.object({ name: personName, avatar: z.number().int().min(1).max(avatarCount).nullable() }), body))
  }
  @Patch('auth/password') password(@Req() req: Request, @Body() body: unknown) {
    const input = payload(z.object({ currentPassword: password, newPassword }), body)
    return this.app.changePassword(credentials(req), input.currentPassword, input.newPassword, req.ip ?? 'local')
  }
  @Post('auth/login') async login(@Body() body: unknown, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const input = payload(z.object({ email: z.email().max(100).transform(text => text.toLowerCase()), password }), body)
    const { session, user } = await this.app.login(input.email, input.password, req.ip ?? 'local')
    res.cookie(cookies.session, session, { ...cookieOptions(), maxAge: 28_800_000 })
    return user
  }
  @Post('auth/logout') async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.app.logout(credentials(req))
    res.clearCookie(cookies.session, cookieOptions())
    return { ok: true }
  }
  @Post('auth/confirm') confirm(@Req() req: Request, @Body() body: unknown) {
    const input = payload(z.object({ jobId: z.uuid(), password }), body)
    return this.app.confirm(credentials(req), input.jobId, input.password, req.ip ?? 'local')
  }
  @Post('share/exchange') async exchange(@Body() body: unknown, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const input = payload(z.object({ slug: z.string().max(80), secret }), body)
    const result = await this.app.exchange(input.slug, input.secret, req.ip ?? 'local')
    res.cookie(cookies.shared, result.value, { ...cookieOptions(), maxAge: 28_800_000 })
    return { slug: result.slug }
  }
  @Get('admin/dashboards') studio(@Req() req: Request) { return this.app.studio(credentials(req)) }
  @Get('admin/members') members(@Req() req: Request) { return this.app.members(credentials(req)) }
  @Post('admin/members') addMember(@Req() req: Request, @Body() body: unknown) {
    return this.app.createMember(credentials(req), payload(z.object({ name: personName, email: z.email().max(100).transform(email => email.toLowerCase()), role: memberRole, password: newPassword }), body))
  }
  @Patch('admin/members/:id/role') memberRole(@Req() req: Request, @Param('id') id: string, @Body() body: unknown) {
    const input = payload(z.object({ role: memberRole, expectedRole: memberRole }), body)
    return this.app.changeRole(credentials(req), id, input.role, input.expectedRole)
  }
  @Patch('admin/roles/superadmin') configureSuperadmin(@Req() req: Request, @Body() body: unknown) {
    const input = payload(z.object({ policy, expected: policy }), body)
    return this.app.updateSuperadminPolicy(credentials(req), input.policy, input.expected)
  }
  @Post('admin/dashboards') create(@Req() req: Request, @Body() body: unknown) {
    const input = payload(z.object({ template: z.enum(['pes', 'susenas', 'custom']), title: z.string().trim().min(3).max(100).optional() }), body)
    return this.app.create(credentials(req), input.template, input.title)
  }
  @Get('admin/dashboards/:id') detail(@Req() req: Request, @Param('id') id: string) { return this.app.detail(credentials(req), id) }
  @Post('admin/dashboards/:id/ai-status') checkAi(@Req() req: Request, @Param('id') id: string) {
    return this.app.aiStatus(credentials(req), id)
  }
  @Get('admin/dashboards/:id/preview') async draftPreview(@Req() req: Request, @Param('id') id: string) {
    const { preview, draftRevision } = await this.app.detail(credentials(req), id)
    return { preview, draftRevision }
  }
  @Patch('admin/dashboards/:id/draft') save(@Req() req: Request, @Param('id') id: string, @Body() body: unknown) {
    return this.app.saveDraft(credentials(req), id, payload(z.object({ definition: z.unknown(), expectedRevision: revision, mappings: mappingsSchema.optional() }), body))
  }
  @Post('admin/dashboards/:id/source-preview')
  @UseInterceptors(AnyFilesInterceptor({ limits: { fileSize: 4 * 1024 * 1024, files: 1, fields: 2, fieldSize: 25_000, parts: 4 } }))
  sourcePreview(@Req() req: Request, @Param('id') id: string, @Body() body: unknown, @UploadedFiles() files: Express.Multer.File[]) {
    const { slot, mapping } = payload(z.object({ slot: idSchema, mapping: z.string().max(20_000).optional() }), body)
    const file = files?.[0]
    if (file?.fieldname !== 'file') fail(422, 'FILE_REQUIRED', 'Pilih satu berkas untuk membuka pratinjau.')
    const mapped = payload(mappingsSchema, { [slot]: uploadJson(mapping) ?? {} })
    return this.app.inspectSource(credentials(req), id, slot, { name: file.originalname.slice(0, 140), bytes: file.buffer }, mapped[slot])
  }
  @Post('admin/dashboards/:id/join-preview')
  @UseInterceptors(AnyFilesInterceptor({ limits: { fileSize: 4 * 1024 * 1024, files: 2, fields: 3, fieldSize: 25_000, parts: 6 } }))
  joinPreview(@Req() req: Request, @Param('id') id: string, @Body() body: unknown, @UploadedFiles() files: Express.Multer.File[]) {
    const input = payload(z.object({ expectedRevision: z.coerce.number().int().nonnegative(), dataset: z.string().max(24_000), mappings: z.string().max(20_000).optional() }), body)
    const mapped = Object.create(null) as Record<string, InputFile>
    for (const file of files ?? []) {
      const key = payload(idSchema, file.fieldname)
      if (Object.hasOwn(mapped, key)) fail(422, 'DUPLICATE_SLOT', 'Pilih satu berkas per sumber.')
      mapped[key] = { name: file.originalname.slice(0, 140), bytes: file.buffer }
    }
    return this.app.previewJoin(credentials(req), id, input.expectedRevision, uploadJson(input.dataset), mapped, payload(mappingsSchema, uploadJson(input.mappings) ?? {}))
  }
  @Post('admin/dashboards/:id/imports')
  @UseInterceptors(AnyFilesInterceptor({ limits: { fileSize: 4 * 1024 * 1024, files: 8, fields: 4, fieldSize: 25_000, parts: 12 } }))
  import(@Req() req: Request, @Param('id') id: string, @Body() body: unknown, @UploadedFiles() files: Express.Multer.File[]) {
    const { date, time, mappings: raw, reuseSnapshot } = payload(uploadSchema, body)
    let mappings: unknown
    try { if (raw !== undefined) mappings = JSON.parse(raw) } catch { fail(422, 'INVALID_MAPPING', 'Format pemetaan belum valid.') }
    const mapped = Object.create(null) as Record<string, InputFile>
    for (const file of files ?? []) {
      const key = payload(idSchema, file.fieldname)
      if (Object.hasOwn(mapped, key)) fail(422, 'DUPLICATE_SLOT', 'Pilih satu berkas per slot.')
      mapped[key] = { name: file.originalname.slice(0, 140), bytes: file.buffer }
    }
    return this.app.prepare(credentials(req), id, { date, time }, mapped, mappings === undefined ? undefined : payload(mappingsSchema, mappings), reuseSnapshot)
  }
  @Get('admin/imports/:id/preview') preview(@Req() req: Request, @Param('id') id: string) { return this.app.preview(credentials(req), id) }
  @Get('admin/imports/:id/errors') async importErrors(@Req() req: Request, @Res() res: Response, @Param('id') id: string) {
    const { errors, warnings } = await this.app.preview(credentials(req), id)
    return res.attachment('hasil-pemeriksaan.json').json({ errors, warnings })
  }
  @Post('admin/imports/:id/commit') commit(@Req() req: Request, @Param('id') id: string, @Body() body: unknown) {
    const input = payload(z.object({ proof: secret, hash: z.string().regex(/^[\da-f]{64}$/), idempotencyKey: z.uuid(), reason: reason.optional() }), body)
    return this.app.commit(credentials(req), id, input)
  }
  @Post('admin/dashboards/:id/publish') publish(@Req() req: Request, @Param('id') id: string, @Body() body: unknown) {
    const input = payload(z.object({ expectedRevision: revision, visibility: visibilitySchema, slug: slugSchema.optional() }), body)
    return this.app.publish(credentials(req), id, input.expectedRevision, input.visibility, input.slug)
  }
  @Patch('admin/dashboards/:id/slug') updateSlug(@Req() req: Request, @Param('id') id: string, @Body() body: unknown) {
    const input = payload(z.object({ slug: slugSchema }), body)
    return this.app.updateSlug(credentials(req), id, input.slug)
  }
  @Post('admin/dashboards/:id/rollback') rollback(@Req() req: Request, @Param('id') id: string, @Body() body: unknown) {
    const input = payload(z.object({ releaseId: z.uuid(), expectedRevision: revision }), body)
    return this.app.rollback(credentials(req), id, input.releaseId, input.expectedRevision)
  }
  @Post('admin/dashboards/:id/archive') archive(@Req() req: Request, @Param('id') id: string, @Body() body: unknown) {
    const input = payload(z.object({ expectedRevision: revision, reason: reason.optional() }), body)
    return this.app.archive(credentials(req), id, input.expectedRevision, input.reason)
  }
  @Patch('admin/dashboards/:id/access') access(@Req() req: Request, @Param('id') id: string, @Body() body: unknown) {
    return this.app.changeAccess(credentials(req), id, payload(z.object({ visibility: visibilitySchema }), body).visibility)
  }
  @Post('admin/dashboards/:id/grants') grant(@Req() req: Request, @Param('id') id: string, @Body() body: unknown) {
    const input = payload(z.object({ email: z.email().max(100).optional(), hours: z.number().int().min(1).max(720).optional() }), body)
    return this.app.grant(credentials(req), id, input.email, input.hours)
  }
  @Delete('admin/dashboards/:id/grants/:grant') revoke(@Req() req: Request, @Param('id') id: string, @Param('grant') grant: string) {
    return this.app.revoke(credentials(req), id, grant)
  }
  @Patch('admin/dashboards/:id/operators/:member') operators(@Req() req: Request, @Param('id') id: string, @Param('member') member: string, @Body() body: unknown) {
    return this.app.operators(credentials(req), id, member, payload(z.object({ enabled: z.boolean() }), body).enabled)
  }
  @Post('admin/dashboards/:id/close') close(@Req() req: Request, @Param('id') id: string, @Body() body: unknown) {
    const input = payload(z.object({ expectedActivityRevision: revision, reason: reason.optional() }), body)
    return this.app.changeStatus(credentials(req), id, true, input.expectedActivityRevision, input.reason)
  }
  @Post('admin/dashboards/:id/reopen') reopen(@Req() req: Request, @Param('id') id: string, @Body() body: unknown) {
    const input = payload(z.object({ expectedActivityRevision: revision, reason }), body)
    return this.app.changeStatus(credentials(req), id, false, input.expectedActivityRevision, input.reason)
  }
  @Post('admin/dashboards/:id/formulas/preview') formula(@Req() req: Request, @Param('id') id: string, @Body() body: unknown) {
    const input = payload(z.object({ dataset: idSchema, field: idSchema, formula: z.string().trim().min(1).max(256) }), body)
    return this.app.formula(credentials(req), id, input.dataset, input.field, input.formula)
  }
  @Post('admin/dashboards/:id/ai-drafts')
  @UseInterceptors(AnyFilesInterceptor({ limits: { fileSize: 4 * 1024 * 1024, files: 1, fields: 5, fieldSize: 120, parts: 7 } }))
  async ai(@Req() req: Request, @Res() res: Response, @Param('id') id: string, @Body() body: unknown, @UploadedFiles() files: Express.Multer.File[]) {
    const input = payload(z.object({
      slot: idSchema, headerRow: z.coerce.number().int().min(1).max(10_000).optional(),
      stopRow: z.coerce.number().int().min(2).max(10_100).optional(),
      identity: z.string().trim().min(1).max(120).optional(),
      sheet: z.string().min(1).max(80).optional(),
    }), body)
    const file = files?.[0]
    if (!file || (file.fieldname !== 'file' && file.fieldname !== 'csv')) fail(422, 'AI_FILE_REQUIRED', 'Pilih satu berkas CSV atau Excel untuk dianalisis.')
    const source = { name: file.originalname.slice(0, 140), bytes: file.buffer }
    const user = credentials(req)
    const stream = req.get('accept') === csvAnalysisStream
    const emit = (event: CsvAnalysisEvent<Awaited<ReturnType<Monitoring['aiDraft']>>>) => {
      if (res.destroyed) return
      if (!res.headersSent) res.status(200).type(csvAnalysisStream).flushHeaders()
      res.write(JSON.stringify(event) + '\n')
    }
    try {
      const data = await this.app.aiDraft(user, id, source, input, stream ? stage => emit({ type: 'progress', stage }) : undefined)
      if (!stream) { res.status(201).json(data); return }
      emit({ type: 'result', data })
    } catch (error) {
      if (!res.headersSent) throw error
      const response = error instanceof HttpException ? error.getResponse() : undefined
      const message = response && typeof response === 'object' && 'message' in response ? response.message : undefined
      const code = response && typeof response === 'object' && 'code' in response ? response.code : undefined
      emit({
        type: 'error', status: error instanceof HttpException ? error.getStatus() : 500,
        message: typeof message === 'string' ? message : 'Analisis berkas belum selesai. Coba lagi.',
        code: typeof code === 'string' ? code : undefined,
      })
    }
    res.end()
  }
  @Post('dashboards/:id/exports') requestExport(@Req() req: Request, @Param('id') id: string, @Body() body: unknown) {
    const input = payload(z.object({ releaseId: z.uuid(), sort: z.record(idSchema, z.object({ field: z.string().max(40), reverse: z.boolean() })).optional(), includeDetail: z.boolean().default(false) }), body)
    return this.exports.create(credentials(req), id, input.releaseId, input.sort, input.includeDetail)
  }
  @Get('jobs/:id') status(@Req() req: Request, @Param('id') id: string) { return this.exports.status(credentials(req), id) }
  @Get('exports/:id/download') async download(@Req() req: Request, @Param('id') id: string, @Res() res: Response) {
    const file = await this.exports.download(credentials(req), id)
    return res.attachment(file.filename).send(Buffer.from(file.bytes))
  }
  @Get('internal/render/:ticket') internal(@Param('ticket') ticket: string) { return this.exports.ticket(ticket) }
}
