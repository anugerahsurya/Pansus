import { useMemo, useState } from 'react'
import { definitionSchema, type Definition, type Report, type SnapshotData } from '../../../packages/contracts/index'
import { applyFormulas } from '../../../packages/metrics/index'
import { DashboardWidgets, Hero } from '../../../packages/widgets/index'
import { currentWib, type DashboardDetail, type Sorts } from './api'
import { Alert } from './common'

export function DraftPreview({ detail, draft = detail.draft, inline = false }: { detail: DashboardDetail; draft?: Definition; inline?: boolean }) {
  const [sorts, setSorts] = useState<Sorts>({})
  const snapshot = detail.preview
  const { report, error } = useMemo(() => {
    const [date, time] = currentWib()
    const base: Report = snapshot ?? {
      id: detail.id, slug: detail.slug, template: detail.template, definition: draft, demo: false,
      condition: { date, time }, data: {}, baseline: null, baselineReason: null, history: [], currentRelease: '',
      activityStatus: detail.activityStatus, closedAt: detail.closedAt,
    }
    const identity = { ...draft, title: draft.title.trim() || 'Judul kegiatan' }
    const result = definitionSchema.safeParse(identity)
    const fallback = { ...base, definition: { ...identity, widgets: [] } }
    if (!result.success) return { report: fallback, error: result.error.issues[0]?.message }
    try {
      const calculate = (source: SnapshotData): SnapshotData => Object.fromEntries(result.data.datasets.map(dataset => {
        const input = source[dataset.id] ?? { rows: [] }
        const data = applyFormulas(dataset, input)
        return [dataset.id, { ...data, detail: dataset.publicDetail ? data.detail : undefined }]
      }))
      return { report: { ...base, definition: result.data, data: calculate(base.data), baseline: base.baseline && calculate(base.baseline) }, error: undefined }
    } catch (failure) { return { report: fallback, error: (failure as Error).message } }
  }, [draft, snapshot, detail.id, detail.slug, detail.template, detail.activityStatus, detail.closedAt])

  const status = snapshot?.demo ? 'Data contoh untuk penyusunan draf' : !snapshot ? 'Belum ada data kegiatan' : 'Kondisi data terakhir yang diterapkan'
  return <div className={inline ? 'draft-preview draft-preview-inline' : 'draft-preview'}>
    <p className="preview-source">{status}</p>
    <Hero report={report} heading={inline ? 'h3' : 'h2'} showCondition={Boolean(snapshot)} />
    {error ? <Alert tone="info">Lengkapi pengaturan untuk menampilkan komponen. {error}</Alert> :
      <DashboardWidgets report={report} sorts={sorts} onSort={(id, sort) => setSorts(current => {
        const next = { ...current }
        if (sort) next[id] = sort
        else delete next[id]
        return next
      })} />}
  </div>
}
