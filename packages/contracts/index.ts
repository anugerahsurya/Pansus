import { z } from 'zod'
import { activeFields } from './fields'
export { activeFields } from './fields'

export const idSchema = z.string().regex(/^[a-z][a-z0-9_]{0,39}$/).refine(id => id !== 'constructor' && id !== 'prototype')
export const dateSchema = z.iso.date()
export const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)
export const visibilitySchema = z.enum(['public', 'link', 'invite'])
export const aggregateSchema = z.enum(['sum', 'count', 'mean', 'mode', 'ratioOfSums', 'weightedMean', 'none', 'reportedValue', 'difference', 'formula'])
export const ruleSchema = z.object({
  op: aggregateSchema, numerator: idSchema.optional(), denominator: idSchema.optional(),
})
const fieldSchema = z.object({
  id: idSchema, label: z.string().trim().min(1).max(100),
  unit: z.enum(['count', 'number', 'percent', 'category']), aliases: z.array(z.string().min(1).max(120)).max(16).default([]),
  scale: z.enum(['fraction', 'percentage']).optional(), nullable: z.boolean().default(true),
  public: z.boolean().default(true), derived: z.boolean().optional(), enabled: z.boolean().optional(),
  formula: z.string().trim().min(1).max(256).optional(),
})
export const joinIdentity = '$row'
const joinKey = z.object({ dataset: idSchema, field: z.union([idSchema, z.literal(joinIdentity)]) })
export const joinSchema = z.object({
  left: joinKey, right: joinKey,
  columns: z.record(idSchema, z.object({ side: z.enum(['left', 'right']), field: idSchema })),
})
const datasetSchema = z.object({
  id: idSchema, label: z.string().trim().min(1).max(100), grain: z.enum(['district', 'person']).default('district'),
  fields: z.array(fieldSchema).min(1).max(50), publicDetail: z.boolean().optional(), join: joinSchema.optional(),
})
const widgetType = z.enum(['progress', 'kpi', 'bars', 'donut', 'table', 'link', 'schedule'])
export const widgetWidths = ['quarter', 'third', 'half', 'two-thirds', 'full'] as const
export const dashboardThemes = ['teal', 'blue', 'plum', 'economy', 'slate'] as const
const widgetSchema = z.object({
  id: idSchema, title: z.string().trim().min(1).max(120), version: z.literal(1).default(1),
  width: z.enum(widgetWidths).default('half'), type: widgetType,
  dataset: idSchema.optional(), field: idSchema.optional(), fields: z.array(idSchema).max(16).optional(),
  target: idSchema.optional(), description: z.string().max(300).optional(),
  url: z.url({ protocol: /^https?$/ }).max(500).optional(),
  provinceFooter: z.object({ enabled: z.boolean(), rules: z.record(idSchema, ruleSchema) }).optional(),
  progressGroup: z.object({ field: idSchema, target: idSchema.optional() }).optional(),
})
export const definitionSchema = z.object({
  schemaVersion: z.literal(1), title: z.string().trim().min(3).max(100),
  description: z.string().trim().max(300), satker: z.string().trim().min(2).max(100),
  period: z.string().trim().min(1).max(60), timezone: z.literal('Asia/Jakarta'),
  theme: z.enum(dashboardThemes),
  datasets: z.array(datasetSchema).min(1).max(8),
  widgets: z.array(widgetSchema).max(24),
}).superRefine((definition, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: 'custom', message })
  const datasets = new Map(definition.datasets.map(dataset => [dataset.id, dataset]))
  if (datasets.size !== definition.datasets.length) issue('ID dataset harus unik.')
  if (new Set(definition.widgets.map(widget => widget.id)).size !== definition.widgets.length) issue('ID komponen harus unik.')
  for (const dataset of definition.datasets) {
    if (new Set(dataset.fields.map(field => field.id)).size !== dataset.fields.length) issue(`ID kolom pada ${dataset.label} harus unik.`)
    const fields = activeFields(dataset)
    if (!fields.length) issue(`Gunakan setidaknya satu kolom pada ${dataset.label}.`)
    if (!dataset.join) continue
    const { left, right, columns } = dataset.join
    const leftSource = datasets.get(left.dataset), rightSource = datasets.get(right.dataset)
    const leftField = leftSource && activeFields(leftSource).find(field => field.id === left.field)
    const rightField = rightSource && activeFields(rightSource).find(field => field.id === right.field)
    if (!leftSource || !rightSource || left.dataset === right.dataset || leftSource.join || rightSource.join || dataset.grain !== leftSource.grain ||
      left.field !== joinIdentity && !leftField || right.field !== joinIdentity && !rightField) {
      issue(`Pilih dua sumber dan kolom kunci yang aktif untuk ${dataset.label}.`)
      continue
    }
    for (const field of fields) {
      const column = columns[field.id]
      const source = column && (column.side === 'left' ? leftSource : rightSource)
      const input = source && activeFields(source).find(item => item.id === column.field)
      if (!input || !field.derived || field.formula || input.unit !== field.unit || input.scale !== field.scale || field.public && !input.public) {
        issue(`Kolom ${field.label} di ${dataset.label} harus terhubung ke kolom sumber yang aktif dan sesuai satuan serta aksesnya.`)
      }
    }
  }
  for (const widget of definition.widgets) {
    if (widget.type === 'link') {
      if (!widget.url) issue(`Isi alamat tautan untuk ${widget.title}.`)
      continue
    }
    if (widget.type === 'schedule') continue
    const dataset = widget.dataset && datasets.get(widget.dataset)
    if (!dataset) { issue(`Pilih dataset untuk ${widget.title}.`); continue }
    const fields = new Map(activeFields(dataset).map(field => [field.id, field]))
    const ids = [widget.field, widget.target, ...(widget.fields ?? [])].filter(Boolean) as string[]
    if (!ids.length || ids.some(id => !fields.get(id)?.public)) issue(`Pilih kolom publik yang tersedia untuk ${widget.title}.`)
    if (['progress', 'kpi', 'bars'].includes(widget.type) && !widget.field) issue(`Pilih indikator utama untuk ${widget.title}.`)
    if (['table', 'donut'].includes(widget.type) && !widget.fields?.length) issue(`Pilih kolom untuk ${widget.title}.`)
    if (widget.type !== 'table' && ids.some(id => fields.get(id)?.unit === 'category')) issue(`Pilih indikator numerik untuk ${widget.title}.`)
    if (widget.type === 'donut' && ids.some(id => fields.get(id)?.unit !== 'count')) issue(`Pilih kategori hitungan yang saling lepas untuk ${widget.title}.`)
    if (widget.type === 'bars' && ((widget.fields?.length ?? 0) > 3 || widget.fields?.some(id => fields.get(id)?.unit !== fields.get(widget.field ?? '')?.unit))) issue(`Pilih maksimal empat seri dengan satuan yang sama untuk ${widget.title}.`)
    if (widget.progressGroup) {
      const { field, target } = widget.progressGroup
      const progress = fields.get(field)
      const denominator = target ? fields.get(target) : undefined
      if (widget.type !== 'table' || dataset.grain !== 'person' || !progress?.public || (target
        ? !denominator?.public || field === target || progress.unit !== denominator.unit || !['number', 'count'].includes(progress.unit)
        : progress.unit !== 'percent')) issue(`Pilih kolom persentase atau pasangan aktual dan target yang sesuai untuk ${widget.title}.`)
    }
    for (const [id, rule] of Object.entries(widget.provinceFooter?.rules ?? {})) {
      const field = fields.get(id)
      if (!field?.public || (field.unit === 'category' && !['none', 'mode', 'count', 'reportedValue'].includes(rule.op))) issue(`Aturan ringkasan ${id} tidak sesuai dengan tipe kolom.`)
      if (rule.op === 'formula' && !field?.formula) issue(`Kolom ${id} memerlukan rumus untuk ringkasan provinsi.`)
      const operands = [rule.numerator, rule.denominator].filter(Boolean) as string[]
      if (['ratioOfSums', 'weightedMean', 'difference'].includes(rule.op) && operands.length !== 2) issue(`Pilih dua kolom ringkasan untuk ${id}.`)
      if (operands.some(operand => !fields.get(operand)?.public || fields.get(operand)?.unit === 'category')) issue(`Pilih komponen numerik publik untuk ringkasan ${id}.`)
    }
  }
})

export type Definition = z.infer<typeof definitionSchema>
export type Dataset = z.infer<typeof datasetSchema>
export type Field = z.infer<typeof fieldSchema>
export type DatasetJoin = z.infer<typeof joinSchema>
export type Widget = z.infer<typeof widgetSchema>
export type Rule = z.infer<typeof ruleSchema>
export type Visibility = z.infer<typeof visibilitySchema>
export type Value = number | string | null
export type Values = Record<string, Value>
export type AreaLevel = 'district' | 'subdistrict' | 'village' | 'sls'
export type DataRow = { code: string; name: string; values: Values; source?: string; level?: AreaLevel; parent?: string }
export type DatasetData = { rows: DataRow[]; reported?: Values; detail?: DataRow[] }
export type SnapshotData = Record<string, DatasetData>
export type Condition = { date: string; time: string }
export type CollectionReport = { date: string; time: string | null; rows: { code: string; name: string; backup: boolean | null; split: boolean | null; received: string | null }[] }
export type Notice = { code: string; message: string; location?: string }
export type UploadMapping = { sheet?: string; headerRow?: number; jsonPath?: string; stopRow?: number; region?: string; columns?: Record<string, string> }
export type TemplateId = 'pes' | 'susenas' | 'custom'
export type ReleaseSummary = Condition & { id: string; version: number; createdAt: string }
export type Report = {
  id: string; slug: string; definition: Definition; template: TemplateId; demo: boolean; condition: Condition;
  data: SnapshotData; baseline: SnapshotData | null; baselineReason: string | null; history: ReleaseSummary[];
  collection?: CollectionReport[];
  currentRelease: string; activityStatus: 'active' | 'closed'; closedAt: string | null;
}
