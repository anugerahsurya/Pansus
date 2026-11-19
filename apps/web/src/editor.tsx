import { useCallback, useDeferredValue, useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Plus, Redo2, Save, Trash2, Undo2 } from 'lucide-react'
import { widgetWidths, type Definition, type Field, type Rule, type Widget } from '../../../packages/contracts/index'
import { widgetLabels } from '../../../packages/widgets/index'
import { api, fmt, type DashboardDetail } from './api'
import { Alert } from './common'
import { DraftPreview } from './preview'

const aggLabels: Record<Rule['op'], string> = { sum: 'Jumlah', count: 'Jumlah baris terisi', mean: 'Rata-rata', mode: 'Modus', weightedMean: 'Rata-rata tertimbang', ratioOfSums: 'Rasio jumlah', none: 'Kosongkan', reportedValue: 'Rekap resmi dari sumber', difference: 'Selisih', formula: 'Rumus dari angka provinsi' }
const units: Record<Field['unit'], string> = { count: 'Hitungan bulat', number: 'Angka', percent: 'Persentase', category: 'Kategori' }
const widthLabels: Record<Widget['width'], string> = { quarter: 'Seperempat', third: 'Sepertiga', half: 'Setengah', 'two-thirds': 'Dua pertiga', full: 'Penuh' }
function identity(prefix: string) { return `${prefix}_${crypto.randomUUID().slice(0, 8)}` }

export function Editor({ detail, onUpdate, active }: { detail: DashboardDetail; onUpdate: () => void; active: boolean }) {
  const [draft, setDraft] = useState(detail.draft)
  const [revision, setRevision] = useState(detail.draftRevision)
  const [past, setPast] = useState<Definition[]>([])
  const [future, setFuture] = useState<Definition[]>([])
  const [saved, setSaved] = useState(JSON.stringify(detail.draft))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [section, setSection] = useState<'details' | 'fields' | 'widgets'>('details')
  const [compactView, setCompactView] = useState<'edit' | 'preview'>('edit')
  const deferredDraft = useDeferredValue(draft)
  const inFlight = useRef(false)
  const dirty = JSON.stringify(draft) !== saved
  const status = busy ? 'Menyimpan…' : error ? 'Perubahan perlu ditinjau' : dirty ? 'Perubahan belum disimpan' : 'Semua perubahan tersimpan'
  const updateRef = useRef(onUpdate)
  updateRef.current = onUpdate

  const save = useCallback(async () => {
    if (!dirty || inFlight.current) return
    inFlight.current = true
    setBusy(true); setError('')
    try {
      const result = await api<{ draftRevision: number; definition: Definition }>(`/admin/dashboards/${detail.id}/draft`, 'PATCH', { definition: draft, expectedRevision: revision })
      setSaved(JSON.stringify(draft)); setRevision(result.draftRevision); updateRef.current()
    } catch (error) { setError((error as Error).message) }
    finally { inFlight.current = false; setBusy(false) }
  }, [detail.id, draft, revision, dirty])

  useEffect(() => {
    if (!dirty) return
    const timer = window.setTimeout(save, 1200)
    return () => window.clearTimeout(timer)
  }, [save, dirty])

  useEffect(() => {
    if (dirty || busy || detail.draftRevision <= revision) return
    setDraft(detail.draft)
    setSaved(JSON.stringify(detail.draft))
    setRevision(detail.draftRevision)
  }, [busy, detail.draft, detail.draftRevision, dirty, revision])

  function change(next: Definition) {
    setPast(current => [...current.slice(-79), draft]); setFuture([]); setDraft(next); setError('')
  }
  function undo() {
    const next = past.at(-1)
    if (!next) return
    setFuture(current => [draft, ...current]); setPast(current => current.slice(0, -1)); setDraft(next); setError('')
  }
  function redo() {
    if (!future[0]) return
    setPast(current => [...current, draft]); setDraft(future[0]); setFuture(current => current.slice(1)); setError('')
  }
  const setWidget = (id: string, next: Widget) => change({ ...draft, widgets: draft.widgets.map(widget => widget.id === id ? next : widget) })
  function addWidget(type: Widget['type']) {
    const dataset = draft.datasets[0]
    const fields = dataset.fields.filter(field => field.public && field.unit !== 'category')
    const width: Widget['width'] = type === 'table' ? 'full' : type === 'progress' || type === 'kpi' ? 'third' : 'half'
    const base = { id: identity('widget'), title: widgetLabels[type], type, version: 1 as const, width }
    if (type === 'link' || type === 'schedule') { change({ ...draft, widgets: [...draft.widgets, base] }); return }
    change({ ...draft, widgets: [...draft.widgets, { ...base, dataset: dataset.id, field: fields[0]?.id, fields: type === 'table' || type === 'donut' ? fields.slice(0, 3).map(field => field.id) : undefined, provinceFooter: type === 'table' ? { enabled: true, rules: {} } : undefined }] })
  }
  function reorder(index: number, direction: number) {
    const items = [...draft.widgets]
    const target = index + direction
    if (target < 0 || target >= items.length) return
    ;[items[index], items[target]] = [items[target], items[index]]
    change({ ...draft, widgets: items })
  }
  return <div className="design-workspace" data-view={compactView}>
    <div className="design-view-control segmented" aria-label="Tampilan perancangan">
      <button type="button" aria-pressed={compactView === 'edit'} className={compactView === 'edit' ? 'selected' : ''} onClick={() => setCompactView('edit')}>Editor</button>
      <button type="button" aria-pressed={compactView === 'preview'} className={compactView === 'preview' ? 'selected' : ''} onClick={() => setCompactView('preview')}>Pratinjau langsung</button>
    </div>
    <div className="design-split">
    <section className="panel studio-panel design-editor">
    <div className="page-heading compact-heading"><div><h2>Editor dashboard</h2><p role="status">{status}</p></div><div className="actions">
      <button className="icon-button" aria-label="Batalkan perubahan terakhir" disabled={!past.length} onClick={undo}><Undo2 size={18} /></button><button className="icon-button" aria-label="Ulangi perubahan terakhir" disabled={!future.length} onClick={redo}><Redo2 size={18} /></button>
      <button className="button primary" disabled={!dirty || busy} onClick={save}><Save size={16} /> Simpan draf</button></div></div>
    {error && <Alert>{error}</Alert>}
    <div className="segmented" aria-label="Bagian editor"><button aria-pressed={section === 'details'} className={section === 'details' ? 'selected' : ''} onClick={() => setSection('details')}>Identitas</button><button aria-pressed={section === 'fields'} className={section === 'fields' ? 'selected' : ''} onClick={() => setSection('fields')}>Kolom data</button><button aria-pressed={section === 'widgets'} className={section === 'widgets' ? 'selected' : ''} onClick={() => setSection('widgets')}>Komponen</button></div>
    {section === 'details' && <div className="form-stack"><label>Judul kegiatan<input value={draft.title} maxLength={100} onChange={event => change({ ...draft, title: event.target.value })} /></label><label>Deskripsi<textarea value={draft.description} maxLength={300} onChange={event => change({ ...draft, description: event.target.value })} /></label><div className="form-columns"><label>Satker<input value={draft.satker} maxLength={100} onChange={event => change({ ...draft, satker: event.target.value })} /></label><label>Periode<input value={draft.period} maxLength={60} onChange={event => change({ ...draft, period: event.target.value })} /></label><label>Warna tampilan<select value={draft.theme} onChange={event => change({ ...draft, theme: event.target.value as Definition['theme'] })}><option value="teal">Biru BPS</option><option value="blue">Biru gelap BPS</option><option value="plum">Hijau BPS</option></select></label></div></div>}
    {section === 'fields' && <div className="editor-list">{draft.datasets.map(dataset => <details className="editor-item" key={dataset.id}><summary>{dataset.label} <small>{dataset.fields.length} kolom</small></summary>
      <div className="editor-item-body">{detail.template === 'pes' && dataset.id === 'sls' && <label className="check"><input type="checkbox" checked={dataset.publicDetail ?? false} onChange={event => change({ ...draft, datasets: draft.datasets.map(item => item.id === dataset.id ? { ...item, publicDetail: event.target.checked } : item) })} /> Izinkan pembaca membuka rincian kecamatan, desa, dan SLS</label>}
      {dataset.fields.map(field => <FieldEditor key={field.id} field={field} dashboard={detail.id} dataset={dataset.id} fixed={field.derived || detail.template !== 'custom' && !field.id.startsWith('field_')} onChange={next => change({ ...draft, datasets: draft.datasets.map(item => item.id === dataset.id ? { ...item, fields: item.fields.map(value => value.id === field.id ? next : value) } : item) })} onRemove={() => {
        const used = draft.widgets.some(widget => widget.dataset === dataset.id && [widget.field, widget.target, ...(widget.fields ?? []), ...Object.keys(widget.provinceFooter?.rules ?? {}), ...Object.values(widget.provinceFooter?.rules ?? {}).flatMap(rule => [rule.numerator, rule.denominator])].includes(field.id)) || dataset.fields.some(item => item.formula?.toLowerCase().match(/[a-z][a-z0-9_]*/g)?.includes(field.id))
        if (used) { setError('Lepaskan kolom ini dari komponen atau rumus sebelum menghapusnya.'); return }
        change({ ...draft, datasets: draft.datasets.map(item => item.id === dataset.id ? { ...item, fields: item.fields.filter(value => value.id !== field.id) } : item) })
      }} />)}
      <button className="button subtle" disabled={dataset.fields.length >= 50} onClick={() => change({ ...draft, datasets: draft.datasets.map(item => item.id === dataset.id ? { ...item, fields: [...item.fields, { id: identity('field'), label: 'Kolom baru', unit: 'count', nullable: true, public: false, aliases: [] }] } : item) })}><Plus size={16} /> Tambah kolom</button></div>
    </details>)}</div>}
    {section === 'widgets' && <><div className="editor-list">{draft.widgets.map((widget, index) => <details className="editor-item" key={widget.id}><summary><b>{widget.title}</b><small>{widgetLabels[widget.type]}</small></summary>
      <div className="editor-item-body"><div className="actions"><button className="button subtle" onClick={() => reorder(index, -1)} disabled={!index}><ArrowUp size={15} /> Pindah ke atas</button><button className="button subtle" onClick={() => reorder(index, 1)} disabled={index === draft.widgets.length - 1}><ArrowDown size={15} /> Pindah ke bawah</button><button className="button subtle danger-text" onClick={() => change({ ...draft, widgets: draft.widgets.filter(item => item.id !== widget.id) })}><Trash2 size={15} /> Hapus</button></div>
      <WidgetEditor widget={widget} definition={draft} onChange={next => setWidget(widget.id, next)} /></div>
    </details>)}</div><div className="add-widget"><span>Tambah komponen</span><div className="actions">{(Object.keys(widgetLabels) as Widget['type'][]).map(type => <button key={type} className="button" disabled={draft.widgets.length >= 24} onClick={() => addWidget(type)}><Plus size={15} /> {widgetLabels[type]}</button>)}</div></div></>}
    </section>
    {active && <section className="design-preview" aria-labelledby="live-preview-title">
      <div className="design-preview-heading"><h2 id="live-preview-title">Pratinjau langsung</h2></div>
      <div className="design-preview-body" tabIndex={0} role="region" aria-label="Isi pratinjau dashboard">
        <DraftPreview detail={detail} draft={deferredDraft} inline />
      </div>
    </section>}
    </div>
  </div>
}

function FieldEditor({ field, dashboard, dataset, fixed, onChange, onRemove }: { field: Field; dashboard: string; dataset: string; fixed?: boolean; onChange: (field: Field) => void; onRemove: () => void }) {
  const [preview, setPreview] = useState<{ dependencies: { id: string; label: string }[]; rows: { name: string; value: number | null; reason?: string }[] }>()
  const [error, setError] = useState('')
  async function check() {
    setError(''); setPreview(undefined)
    try { setPreview(await api(`/admin/dashboards/${dashboard}/formulas/preview`, 'POST', { dataset, field: field.id, formula: field.formula })) }
    catch (error) { setError((error as Error).message) }
  }
  return <div className="field-editor form-stack">
    <div className="field-editor-heading"><code>{field.id}</code>{!fixed && <button className="icon-button danger-text" aria-label={`Hapus ${field.label}`} onClick={onRemove}><Trash2 size={16} /></button>}</div>
    <div className="form-columns"><label>Nama kolom<input value={field.label} maxLength={100} onChange={event => onChange({ ...field, label: event.target.value })} /></label><label>Satuan<select value={field.unit} disabled={fixed} onChange={event => onChange({ ...field, unit: event.target.value as Field['unit'] })}>{Object.entries(units).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label>
    {field.unit === 'percent' && <label>Skala angka sumber<select value={field.scale ?? 'percentage'} disabled={fixed} onChange={event => onChange({ ...field, scale: event.target.value as Field['scale'] })}><option value="percentage">Persen (0–100)</option><option value="fraction">Pecahan (0–1)</option></select></label>}</div>
    {!field.derived && <label>Alias judul sumber (pisahkan dengan |)<input defaultValue={field.aliases.join(' | ')} onBlur={event => { const aliases = event.target.value.split('|').map(alias => alias.trim()).filter(Boolean); if (JSON.stringify(aliases) !== JSON.stringify(field.aliases)) onChange({ ...field, aliases }) }} /></label>}
    <label className="check"><input type="checkbox" checked={field.public} onChange={event => onChange({ ...field, public: event.target.checked })} /> Boleh ditampilkan kepada pembaca</label>
    {!field.derived && field.unit !== 'category' && <div className="form-stack"><label>Hitung dengan rumus (opsional)<input value={field.formula ?? ''} maxLength={256} onChange={event => { setError(''); setPreview(undefined); onChange({ ...field, formula: event.target.value || undefined }) }} placeholder="contoh: target * 2 + selesai" /></label>
      {field.formula && <button className="button subtle" onClick={check}>Periksa rumus</button>}{error && <Alert>{error}</Alert>}{preview && <div className="formula-preview"><p>Kolom terkait {preview.dependencies.map(item => `[${item.label}]`).join(', ') || '—'}</p>{preview.rows.map(row => <p key={row.name}>{row.name} <b>{row.value == null ? '—' : fmt.format(row.value)}</b> {row.reason}</p>)}{!preview.rows.length && <p>Unggah data untuk melihat contoh hasil.</p>}</div>}
    </div>}
  </div>
}

function WidgetEditor({ widget, definition, onChange }: { widget: Widget; definition: Definition; onChange: (item: Widget) => void }) {
  const dataWidget = widget.type !== 'schedule' && widget.type !== 'link'
  const dataset = definition.datasets.find(item => item.id === widget.dataset)
  const available = dataset?.fields.filter(field => field.public && (widget.type === 'table' || field.unit !== 'category')) ?? []
  const choice = available.map(field => <option value={field.id} key={field.id}>{field.label}</option>)
  const multiple = widget.type === 'table' || widget.type === 'donut'
  return <div className="form-stack">
    <div className="form-columns"><label>Judul komponen<input value={widget.title} onChange={event => onChange({ ...widget, title: event.target.value })} /></label><label>Lebar di layar lebar<select value={widget.width} onChange={event => onChange({ ...widget, width: event.target.value as Widget['width'] })}>{widgetWidths.map(width => <option key={width} value={width}>{width === 'half' && (widget.type === 'progress' || widget.type === 'kpi') ? 'Sepertiga (format lama)' : widthLabels[width]}</option>)}</select></label></div>
    {dataWidget && <label>Dataset<select value={widget.dataset ?? ''} onChange={event => onChange({ ...widget, dataset: event.target.value, field: undefined, fields: [], target: undefined, provinceFooter: widget.provinceFooter && { enabled: widget.provinceFooter.enabled, rules: {} } })}><option value="">Pilih dataset</option>{definition.datasets.map(dataset => <option key={dataset.id} value={dataset.id}>{dataset.label}</option>)}</select></label>}
    {dataWidget && !multiple && <div className="form-columns"><label>Angka yang dihitung<select value={widget.field ?? ''} onChange={event => onChange({ ...widget, field: event.target.value || undefined })}><option value="">Pilih kolom</option>{choice}</select></label><label>Dibagi dengan<select value={widget.target ?? ''} onChange={event => onChange({ ...widget, target: event.target.value || undefined })}><option value="">Nilai langsung</option>{choice}</select></label></div>}
    {widget.type === 'bars' && widget.field && <div className="check-grid" aria-label="Seri tambahan">{available.filter(field => field.id !== widget.field && field.unit === available.find(item => item.id === widget.field)?.unit).map(field => <label className="check" key={field.id}><input type="checkbox" checked={widget.fields?.includes(field.id) ?? false} disabled={(widget.fields?.length ?? 0) >= 3 && !widget.fields?.includes(field.id)} onChange={event => onChange({ ...widget, fields: event.target.checked ? [...(widget.fields ?? []), field.id] : widget.fields?.filter(id => id !== field.id) })} /> {field.label}</label>)}</div>}
    {multiple && <div className="check-grid">{available.filter(field => widget.type !== 'donut' || field.unit === 'count').map(field => <label key={field.id} className="check"><input type="checkbox" checked={widget.fields?.includes(field.id) ?? false} onChange={event => {
      const ids = (widget.fields ?? []).filter(id => id !== field.id)
      if (event.target.checked) ids.push(field.id)
      onChange({ ...widget, fields: ids, field: undefined })
    }} /> {field.label}</label>)}</div>}
    {widget.type === 'table' && <div className="form-stack"><label className="check"><input type="checkbox" checked={widget.provinceFooter?.enabled ?? false} onChange={event => onChange({ ...widget, provinceFooter: { enabled: event.target.checked, rules: widget.provinceFooter?.rules ?? {} } })} /> Tampilkan baris Provinsi Sumatera Barat</label>
      {widget.provinceFooter?.enabled && widget.fields?.map(id => {
        const field = available.find(item => item.id === id)
        const rule = widget.provinceFooter!.rules[id] ?? { op: field?.unit === 'count' ? 'sum' : 'none' }
        const update = (next: Rule) => onChange({ ...widget, provinceFooter: { enabled: true, rules: { ...widget.provinceFooter?.rules, [id]: next } } })
        return <div className="form-columns" key={id}><label>{field?.label ?? id}<select value={rule.op} onChange={event => update({ op: event.target.value as Rule['op'] })}>{Object.entries(aggLabels).filter(([key]) => (field?.unit !== 'category' || ['none', 'count', 'mode', 'reportedValue'].includes(key)) && (key !== 'formula' || field?.formula)).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
          {['ratioOfSums', 'weightedMean', 'difference'].includes(rule.op) && <><label>Kolom nilai<select value={rule.numerator ?? ''} onChange={event => update({ ...rule, numerator: event.target.value || undefined })}><option value="">Pilih</option>{choice}</select></label><label>Kolom pembagi atau bobot<select value={rule.denominator ?? ''} onChange={event => update({ ...rule, denominator: event.target.value || undefined })}><option value="">Pilih</option>{choice}</select></label></>}</div>
      })}</div>}
    {widget.type === 'link' && <label>Alamat tautan (HTTPS/HTTP)<input type="url" value={widget.url ?? ''} onChange={event => onChange({ ...widget, url: event.target.value || undefined })} /></label>}
    {['link', 'schedule', 'bars', 'donut'].includes(widget.type) && <label>Keterangan<textarea value={widget.description ?? ''} maxLength={300} onChange={event => onChange({ ...widget, description: event.target.value })} /></label>}
  </div>
}
