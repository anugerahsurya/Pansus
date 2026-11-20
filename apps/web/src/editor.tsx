import { useCallback, useDeferredValue, useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Check, Pencil, Plus, Redo2, Save, Trash2, Undo2, X } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { activeFields, dashboardThemes, widgetWidths, type CardAggregation, type Definition, type Field, type Rule, type Widget } from '../../../packages/contracts/index'
import { isNumericUnit } from '../../../packages/contracts/fields'
import { donutCategoryLimit, groupedBarLimit, singleBarLimit } from '../../../packages/contracts/visualization'
import { widgetLabels } from '../../../packages/widgets/index'
import { api, fmt, type DashboardDetail } from './api'
import { Alert } from './common'
import { DraftPreview } from './preview'
import { Select } from './select'

const aggLabels: Record<Rule['op'], string> = {
  sum: 'Jumlah (Sum)', count: 'Jumlah baris terisi (Count)', mean: 'Rata-rata (Mean)', median: 'Median',
  min: 'Minimum', max: 'Maksimum', variance: 'Varians (Variance)', stdev: 'Simpangan baku (Stdev)',
  mode: 'Modus', weightedMean: 'Rata-rata tertimbang', ratioOfSums: 'Rasio jumlah', none: 'Kosongkan',
  reportedValue: 'Rekap resmi dari sumber', difference: 'Selisih', formula: 'Rumus dari angka provinsi',
}
const cardAggOptions: { value: CardAggregation; label: string }[] = [
  { value: 'auto', label: 'Otomatis (sesuai tipe kolom)' },
  { value: 'sum', label: 'Jumlah (Sum)' },
  { value: 'mean', label: 'Rata-rata (Mean)' },
  { value: 'median', label: 'Median' },
  { value: 'min', label: 'Minimum' },
  { value: 'max', label: 'Maksimum' },
  { value: 'variance', label: 'Varians (Variance)' },
  { value: 'stdev', label: 'Simpangan baku (Stdev)' },
  { value: 'count', label: 'Jumlah baris terisi (Count)' },
]
const units: Record<Field['unit'], string> = { count: 'Hitungan bulat', number: 'Angka', percent: 'Persentase', category: 'Kategori', datetime: 'Tanggal & jam' }
const widthLabels: Record<Widget['width'], string> = { quarter: 'Seperempat', third: 'Sepertiga', half: 'Setengah', 'two-thirds': 'Dua pertiga', full: 'Penuh' }
const themeLabels: Record<Definition['theme'], string> = { teal: 'Biru BPS', blue: 'Biru Gelap BPS', plum: 'Hijau Wilayah', economy: 'Sensus Ekonomi', slate: 'Abu Netral' }
function identity(prefix: string) { return `${prefix}_${crypto.randomUUID().slice(0, 8)}` }

export function Editor({ detail, onUpdate, onPendingChange, active }: { detail: DashboardDetail; onUpdate: () => void; onPendingChange: (pending: boolean) => void; active: boolean }) {
  const [query, setQuery] = useSearchParams()
  const [draft, setDraft] = useState(detail.draft)
  const [revision, setRevision] = useState(detail.draftRevision)
  const [past, setPast] = useState<Definition[]>([])
  const [future, setFuture] = useState<Definition[]>([])
  const [saved, setSaved] = useState(JSON.stringify(detail.draft))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [newField, setNewField] = useState<string>()
  const [editingWidget, setEditingWidget] = useState<string>()
  const section = query.get('section') ?? 'details'
  const dataset = draft.datasets.find(item => item.id === query.get('source')) ?? draft.datasets[0]
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
    setPast([])
    setFuture([])
  }, [busy, detail.draft, detail.draftRevision, dirty, revision])

  useEffect(() => { onPendingChange(dirty || busy) }, [onPendingChange, dirty, busy])

  function setSection(next: string) {
    setNewField(undefined)
    setQuery({ tab: 'editor', section: next, ...(next === 'fields' ? { source: dataset.id } : {}) }, { replace: true })
  }
  function addField() {
    const field: Field = { id: identity('field'), label: 'Kolom baru', unit: 'count', nullable: true, public: false, aliases: [] }
    updateFields([...dataset.fields, field])
    setNewField(field.id)
  }
  function updateFields(fields: Field[]) {
    change({ ...draft, datasets: draft.datasets.map(item => item.id === dataset.id ? { ...item, fields } : item) })
  }
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
    const fields = activeFields(dataset).filter(field => field.public && (isNumericUnit(field.unit) || type === 'table' && field.unit === 'datetime'))
    const width: Widget['width'] = type === 'table' ? 'full' : type === 'progress' || type === 'kpi' ? 'third' : 'half'
    const id = identity('widget')
    const base = { id, title: widgetLabels[type], type, version: 1 as const, width }
    if (type === 'link' || type === 'schedule' || type === 'text') {
      change({ ...draft, widgets: [...draft.widgets, { ...base, dataset: type === 'text' ? dataset.id : undefined }] })
      setEditingWidget(id)
      return
    }
    change({ ...draft, widgets: [...draft.widgets, { ...base, dataset: dataset.id, field: fields[0]?.id, fields: type === 'table' || type === 'donut' ? fields.slice(0, 3).map(field => field.id) : undefined, provinceFooter: type === 'table' ? { enabled: true, rules: {} } : undefined }] })
    setEditingWidget(id)
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
      <button type="button" className="icon-button" aria-label="Batalkan perubahan terakhir" disabled={!past.length} onClick={undo}><Undo2 size={18} /></button><button type="button" className="icon-button" aria-label="Ulangi perubahan terakhir" disabled={!future.length} onClick={redo}><Redo2 size={18} /></button>
      <button type="button" className="button primary" disabled={!dirty || busy} onClick={save}><Save size={16} /> Simpan draf</button></div></div>
    {error && <Alert>{error}</Alert>}
    <div className="segmented" aria-label="Bagian editor"><button type="button" aria-pressed={section === 'details'} className={section === 'details' ? 'selected' : ''} onClick={() => setSection('details')}>Keterangan umum</button><button type="button" aria-pressed={section === 'fields'} className={section === 'fields' ? 'selected' : ''} onClick={() => setSection('fields')}>Kolom data</button><button type="button" aria-pressed={section === 'widgets'} className={section === 'widgets' ? 'selected' : ''} onClick={() => setSection('widgets')}>Komponen</button></div>
    {section === 'details' && <section className="form-stack" aria-label="Keterangan umum">
      <label>Judul kegiatan<input value={draft.title} maxLength={100} onChange={event => change({ ...draft, title: event.target.value })} /></label>
      <label>Deskripsi<textarea value={draft.description} maxLength={300} onChange={event => change({ ...draft, description: event.target.value })} /></label>
      <label>Satker<input value={draft.satker} maxLength={100} onChange={event => change({ ...draft, satker: event.target.value })} /></label>
      <label>Periode<input value={draft.period} maxLength={60} onChange={event => change({ ...draft, period: event.target.value })} /></label>
      <fieldset className="theme-picker">
        <legend>Preset tampilan</legend>
        <div className="theme-options">{dashboardThemes.map(theme => <label className="theme-option" key={theme}>
          <input type="radio" name="dashboard-theme" value={theme} checked={draft.theme === theme} onChange={() => change({ ...draft, theme })} />
          <span className={`theme-swatch theme-${theme}`} aria-hidden="true"><i /><i /><i /></span>
          <span className="theme-option-label">{themeLabels[theme]}{draft.theme === theme && <Check size={15} aria-hidden="true" />}</span>
        </label>)}</div>
      </fieldset>
    </section>}
    {section === 'fields' && <section className="form-stack" aria-label="Kolom data">
      {draft.datasets.length > 1 && <label>Sumber data<Select value={dataset.id} options={draft.datasets.map(item => ({ value: item.id, label: item.label }))} onChange={value => {
        setNewField(undefined)
        setQuery({ tab: 'editor', section: 'fields', source: value }, { replace: true })
      }} /></label>}
      {detail.template === 'custom' && <label>Nama sumber<input value={dataset.label} maxLength={100} onChange={event => change({ ...draft, datasets: draft.datasets.map(item => item.id === dataset.id ? { ...item, label: event.target.value } : item) })} /></label>}
      {detail.template === 'custom' && !dataset.join && <label>Satu baris mewakili<Select value={dataset.grain} options={[{ value: 'district', label: 'Kabupaten atau kota' }, { value: 'person', label: 'Satu orang' }]} onChange={value => {
        const grain = value as typeof dataset.grain
        change({
          ...draft,
          datasets: draft.datasets.map(item => item.id === dataset.id ? { ...item, grain } : item),
          widgets: draft.widgets.map(widget => widget.dataset !== dataset.id ? widget : { ...widget, progressGroup: undefined, provinceFooter: grain === 'person' ? undefined : widget.provinceFooter }),
        })
      }} /></label>}
      <div className="editor-fields-heading"><h3>Kolom {dataset.label} <small>{dataset.fields.length}/50</small></h3>
        {!dataset.join && <button type="button" className="button" disabled={dataset.fields.length >= 50} onClick={addField}><Plus size={16} /> Tambah kolom</button>}
      </div>
      {detail.template === 'pes' && dataset.id === 'sls' && <label className="check"><input type="checkbox" checked={dataset.publicDetail ?? false} onChange={event => change({ ...draft, datasets: draft.datasets.map(item => item.id === dataset.id ? { ...item, publicDetail: event.target.checked } : item) })} /> Izinkan pembaca membuka rincian kecamatan, desa, dan SLS</label>}
      {dataset.fields.map(field => <FieldEditor key={`${dataset.id}:${field.id}`} field={field} allFields={dataset.fields} dashboard={detail.id} dataset={dataset.id} focus={newField === field.id} removable={dataset.fields.length > 1} configurable={detail.template === 'custom'} fixed={field.derived || detail.template !== 'custom' && !field.id.startsWith('field_')} onChange={next => updateFields(dataset.fields.map(value => value.id === field.id ? next : value))} onRemove={() => {
        const used = draft.widgets.some(widget => widget.dataset === dataset.id && [widget.field, widget.target, widget.progressGroup?.field, widget.progressGroup?.target, ...(widget.fields ?? []), ...Object.keys(widget.provinceFooter?.rules ?? {}), ...Object.values(widget.provinceFooter?.rules ?? {}).flatMap(rule => [rule.numerator, rule.denominator])].includes(field.id)) || dataset.fields.some(item => item.formula?.toLowerCase().match(/[a-z][a-z0-9_]*/g)?.includes(field.id))
        if (used) { setError('Lepaskan kolom ini dari komponen atau rumus sebelum menghapusnya.'); return }
        updateFields(dataset.fields.filter(value => value.id !== field.id))
      }} />)}
    </section>}
    {section === 'widgets' && <div className="form-stack">
      <div className="table-scroll component-table-wrap" role="region" aria-label="Daftar komponen dashboard">
        <table className="component-table">
          <thead><tr><th scope="col">Komponen</th><th scope="col">Lebar</th><th scope="col">Aksi</th></tr></thead>
          <tbody>
            {draft.widgets.map((widget, index) => {
              const selected = editingWidget === widget.id
              const typeLabel = widget.type === 'table' && draft.datasets.find(d => d.id === widget.dataset)?.grain === 'person' ? 'Tabel petugas' : widgetLabels[widget.type]
              return <tr key={widget.id} className={selected ? 'selected-row' : undefined}>
                <th scope="row">
                  <div className="component-row-title"><b>{widget.title}</b><span className="pill">{typeLabel}</span></div>
                </th>
                <td>{widthLabels[widget.width]}</td>
                <td>
                  <div className="component-row-actions">
                    <button type="button" className="icon-button compact-icon" aria-label={`Pindah ${widget.title} ke atas`} title="Pindah ke atas" onClick={() => reorder(index, -1)} disabled={!index}><ArrowUp size={14} /></button>
                    <button type="button" className="icon-button compact-icon" aria-label={`Pindah ${widget.title} ke bawah`} title="Pindah ke bawah" onClick={() => reorder(index, 1)} disabled={index === draft.widgets.length - 1}><ArrowDown size={14} /></button>
                    <button type="button" className={selected ? 'button primary compact-btn' : 'button subtle compact-btn'} aria-expanded={selected} onClick={() => setEditingWidget(selected ? undefined : widget.id)}><Pencil size={13} /> {selected ? 'Tutup' : 'Edit'}</button>
                    <button type="button" className="icon-button compact-icon danger-text" aria-label={`Hapus ${widget.title}`} title="Hapus komponen" onClick={() => {
                      if (selected) setEditingWidget(undefined)
                      change({ ...draft, widgets: draft.widgets.filter(item => item.id !== widget.id) })
                    }}><Trash2 size={14} /></button>
                  </div>
                </td>
              </tr>
            })}
            {!draft.widgets.length && <tr><td colSpan={3} className="empty-inline">Belum ada komponen. Tambahkan komponen di bawah.</td></tr>}
          </tbody>
        </table>
      </div>
      {(() => {
        const current = draft.widgets.find(widget => widget.id === editingWidget)
        if (!current) return null
        return <section className="component-editor-panel form-stack" aria-label={`Edit ${current.title}`}>
          <div className="component-editor-header">
            <div><h3>Edit komponen: {current.title}</h3><p className="muted-text">{widgetLabels[current.type]}</p></div>
            <button type="button" className="button subtle compact-btn" onClick={() => setEditingWidget(undefined)}><X size={14} /> Tutup</button>
          </div>
          <WidgetEditor widget={current} definition={draft} rows={detail.preview?.data[current.dataset ?? '']?.rows.length} onChange={next => setWidget(current.id, next)} />
        </section>
      })()}
      <div className="add-widget"><span>Tambah komponen</span><div className="actions">{(Object.keys(widgetLabels) as Widget['type'][]).map(type => <button key={type} type="button" className="button" disabled={draft.widgets.length >= 24} onClick={() => addWidget(type)}><Plus size={15} /> {widgetLabels[type]}</button>)}</div></div>
    </div>}
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

function FieldEditor({ field, allFields, dashboard, dataset, fixed, configurable, focus, removable, onChange, onRemove }: { field: Field; allFields: Field[]; dashboard: string; dataset: string; fixed?: boolean; configurable: boolean; focus: boolean; removable: boolean; onChange: (field: Field) => void; onRemove: () => void }) {
  const [preview, setPreview] = useState<{ dependencies: { id: string; label: string }[]; rows: { name: string; value: number | null; reason?: string }[] }>()
  const [error, setError] = useState('')
  const nameInput = useRef<HTMLInputElement>(null)
  useEffect(() => { if (focus) nameInput.current?.focus() }, [focus])
  const numericRefs = allFields.filter(item => item.id !== field.id && item.enabled !== false && isNumericUnit(item.unit))
  async function check() {
    setError(''); setPreview(undefined)
    try { setPreview(await api(`/admin/dashboards/${dashboard}/formulas/preview`, 'POST', { dataset, field: field.id, formula: field.formula })) }
    catch (error) { setError((error as Error).message) }
  }
  return <details className="editor-item editor-field" open={focus || undefined}>
    <summary>{field.label} <small>{field.enabled === false ? 'Tidak dipakai' : units[field.unit]}</small></summary>
    <div className="editor-item-body form-stack">
    <div className="field-editor-heading"><code title="ID untuk rumus">&lt;{field.id}&gt;</code>{!fixed && removable && <button type="button" className="icon-button danger-text" aria-label={`Hapus ${field.label}`} onClick={onRemove}><Trash2 size={16} /></button>}</div>
    <label>Nama kolom<input ref={nameInput} value={field.label} maxLength={100} onChange={event => onChange({ ...field, label: event.target.value })} /></label>
    <label>Satuan<Select value={field.unit} disabled={fixed} ariaLabel="Satuan" options={Object.entries(units).map(([key, label]) => ({ value: key, label }))} onChange={value => {
      const unit = value as Field['unit']
      onChange({ ...field, unit, scale: unit === 'percent' ? field.scale : undefined })
    }} /></label>
    {field.unit === 'percent' && <label>Skala angka sumber<Select value={field.scale ?? 'percentage'} disabled={fixed} options={[{ value: 'percentage', label: 'Persen (0–100)' }, { value: 'fraction', label: 'Pecahan (0–1)' }]} onChange={value => onChange({ ...field, scale: value as Field['scale'] })} /></label>}
    {!field.derived && <label>Alias judul sumber (pisahkan dengan |)<input key={field.aliases.join(' | ')} defaultValue={field.aliases.join(' | ')} onBlur={event => { const aliases = event.target.value.split('|').map(alias => alias.trim()).filter(Boolean); if (JSON.stringify(aliases) !== JSON.stringify(field.aliases)) onChange({ ...field, aliases }) }} /></label>}
    {configurable && <label className="check"><input type="checkbox" checked={field.enabled !== false} onChange={event => onChange({ ...field, enabled: event.target.checked ? undefined : false })} /> Gunakan kolom</label>}
    <label className="check"><input type="checkbox" checked={field.public} disabled={field.enabled === false} onChange={event => onChange({ ...field, public: event.target.checked })} /> Boleh ditampilkan kepada pembaca</label>
    {!field.derived && (isNumericUnit(field.unit) || field.formula) && <div className="form-stack"><label>Hitung dengan rumus (opsional)<input value={field.formula ?? ''} maxLength={256} onChange={event => { setError(''); setPreview(undefined); onChange({ ...field, formula: event.target.value || undefined }) }} placeholder="contoh: <kolom_1> * 10 atau round(<selesai> / <target> * 100)" /></label>
      {numericRefs.length > 0 && <div className="formula-chips" aria-label="Sisipkan kolom ke rumus">
        {numericRefs.map(item => <button key={item.id} type="button" className="formula-chip" onClick={() => {
          setError(''); setPreview(undefined)
          onChange({ ...field, formula: `${field.formula ? `${field.formula} ` : ''}<${item.id}>` })
        }}>&lt;{item.id}&gt; <small>{item.label}</small></button>)}
      </div>}
      {field.formula && <button type="button" className="button subtle" onClick={check}>Periksa rumus</button>}{error && <Alert>{error}</Alert>}{preview && <div className="formula-preview"><p>Kolom terkait {preview.dependencies.map(item => `<${item.label}>`).join(', ') || '—'}</p>{preview.rows.map(row => <p key={row.name}>{row.name} <b>{row.value == null ? '—' : fmt.format(row.value)}</b> {row.reason}</p>)}{!preview.rows.length && <p>Unggah data untuk melihat contoh hasil.</p>}</div>}
    </div>}
    </div>
  </details>
}

function WidgetEditor({ widget, definition, rows, onChange }: { widget: Widget; definition: Definition; rows?: number; onChange: (item: Widget) => void }) {
  const [pendingGroup, setPendingGroup] = useState<string>()
  const dataWidget = widget.type !== 'schedule' && widget.type !== 'link' && widget.type !== 'text'
  const isCard = widget.type === 'kpi' || widget.type === 'progress'
  const dataset = definition.datasets.find(item => item.id === widget.dataset) ?? (widget.type === 'text' || widget.type === 'schedule' || widget.type === 'link' ? definition.datasets[0] : undefined)
  const available = dataset ? activeFields(dataset).filter(field => field.public && (widget.type === 'table' || widget.type === 'text' || widget.type === 'schedule' || widget.type === 'link' || isNumericUnit(field.unit))) : []
  const choiceOptions = available.map(field => ({ value: field.id, label: field.label }))
  const multiple = widget.type === 'table' || widget.type === 'donut'
  const group = widget.progressGroup
  const groupField = dataset?.fields.find(field => field.id === (pendingGroup ?? group?.field))
  const widthOptions = widgetWidths.map(width => ({
    value: width,
    label: width === 'half' && isCard ? 'Sepertiga (format lama)' : widthLabels[width],
  }))
  const appendDescription = (snippet: string) => onChange({ ...widget, description: `${widget.description ?? ''}${snippet}` })
  const appendCardFormula = (snippet: string) => onChange({ ...widget, formula: `${widget.formula ? `${widget.formula} ` : ''}${snippet}` })

  return <div className="form-stack">
    <div className="form-columns">
      <label>Judul komponen<input value={widget.title} onChange={event => onChange({ ...widget, title: event.target.value })} /></label>
      <label>Lebar di layar lebar<Select value={widget.width} options={widthOptions} onChange={value => onChange({ ...widget, width: value as Widget['width'] })} /></label>
    </div>
    {(dataWidget || widget.type === 'text') && <label>Dataset<Select value={widget.dataset ?? (widget.type === 'text' ? dataset?.id ?? '' : '')} options={[{ value: '', label: 'Pilih dataset' }, ...definition.datasets.map(d => ({ value: d.id, label: d.label }))]} onChange={value => {
      setPendingGroup(undefined)
      onChange({ ...widget, dataset: value || undefined, field: undefined, fields: [], target: undefined, formula: undefined, progressGroup: undefined, provinceFooter: widget.provinceFooter && { enabled: widget.provinceFooter.enabled, rules: {} } })
    }} /></label>}
    {widget.type === 'donut' && <p className="muted-text">Donat cocok untuk 2–{donutCategoryLimit} kategori hitungan yang saling lepas dan membentuk satu total.</p>}
    {widget.type === 'bars' && <p className="muted-text">Grafik ringkas memuat hingga {(widget.fields?.length ?? 0) ? groupedBarLimit : singleBarLimit} {dataset?.grain === 'person' ? 'orang' : 'wilayah'}.{rows != null && rows > ((widget.fields?.length ?? 0) ? groupedBarLimit : singleBarLimit) ? ` Gunakan tabel untuk melihat seluruh ${rows} baris.` : ''}</p>}
    {dataWidget && !multiple && <div className="form-columns">
      <label>Angka yang dihitung<Select value={widget.field ?? ''} options={[{ value: '', label: 'Pilih kolom' }, ...choiceOptions]} onChange={value => onChange({ ...widget, field: value || undefined })} /></label>
      <label>Dibagi dengan<Select value={widget.target ?? ''} options={[{ value: '', label: 'Nilai langsung' }, ...choiceOptions]} onChange={value => onChange({ ...widget, target: value || undefined })} /></label>
    </div>}
    {isCard && !widget.target && <div className="form-stack">
      <label>Cara hitung kartu<Select value={widget.aggregation ?? 'auto'} options={cardAggOptions} onChange={value => onChange({ ...widget, aggregation: value === 'auto' ? undefined : value as CardAggregation })} /></label>
      <label>Rumus khusus kartu (opsional)<input value={widget.formula ?? ''} maxLength={256} placeholder="contoh: sum(<kolom_1>), stdev(<kolom_2>), variance(<kolom_2>), <kolom_1>[0]" onChange={event => onChange({ ...widget, formula: event.target.value || undefined })} /></label>
      <p className="muted-text">Mendukung <code>sum</code>, <code>mean</code>, <code>median</code>, <code>min</code>, <code>max</code>, <code>variance</code>, <code>stdev</code>, <code>count</code>, dan indeks baris <code>&lt;kolom&gt;[0]</code>.</p>
      {available.length > 0 && <div className="formula-chips" aria-label="Sisipkan rumus kartu">
        {['sum', 'mean', 'stdev', 'variance', 'min', 'max'].map(fn => <button key={fn} type="button" className="formula-chip" onClick={() => appendCardFormula(`${fn}(<${available[0].id}>)`)}>{fn}(&lt;{available[0].id}&gt;)</button>)}
        {available.slice(0, 5).map(field => <button key={field.id} type="button" className="formula-chip" onClick={() => appendCardFormula(`<${field.id}>`)}>&lt;{field.id}&gt; <small>{field.label}</small></button>)}
      </div>}
    </div>}
    {widget.type === 'bars' && widget.field && <div className="check-grid" aria-label="Seri tambahan">{available.filter(field => field.id !== widget.field && field.unit === available.find(item => item.id === widget.field)?.unit).map(field => <label className="check" key={field.id}><input type="checkbox" checked={widget.fields?.includes(field.id) ?? false} disabled={(widget.fields?.length ?? 0) >= 3 && !widget.fields?.includes(field.id)} onChange={event => onChange({ ...widget, fields: event.target.checked ? [...(widget.fields ?? []), field.id] : widget.fields?.filter(id => id !== field.id) })} /> {field.label}</label>)}</div>}
    {multiple && <div className="check-grid">{available.filter(field => widget.type !== 'donut' || field.unit === 'count').map(field => <label key={field.id} className="check"><input type="checkbox" checked={widget.fields?.includes(field.id) ?? false} onChange={event => {
      const ids = (widget.fields ?? []).filter(id => id !== field.id)
      if (event.target.checked) ids.push(field.id)
      onChange({ ...widget, fields: ids, field: undefined })
    }} /> {field.label}</label>)}</div>}
    {widget.type === 'table' && dataset?.grain === 'person' && <div className="form-stack">
      <label>Kelompok berdasarkan progres<Select value={pendingGroup ?? group?.field ?? ''} options={[
        { value: '', label: 'Tanpa kelompok' },
        ...available.filter(field => field.unit === 'percent' || ['count', 'number'].includes(field.unit) && available.some(item => item.id !== field.id && item.unit === field.unit)).map(field => ({ value: field.id, label: field.label })),
      ]} onChange={value => {
        const field = available.find(item => item.id === value)
        if (field && field.unit !== 'percent') { setPendingGroup(field.id); return }
        setPendingGroup(undefined)
        onChange({ ...widget, progressGroup: field ? { field: field.id } : undefined })
      }} /></label>
      {groupField && groupField.unit !== 'percent' && <label>Kolom target<Select value={pendingGroup ? '' : group?.target ?? ''} options={[
        { value: '', label: 'Pilih target', disabled: true },
        ...available.filter(field => field.id !== groupField.id && field.unit === groupField.unit).map(field => ({ value: field.id, label: field.label })),
      ]} onChange={value => {
        if (!value) return
        setPendingGroup(undefined)
        onChange({ ...widget, progressGroup: { field: groupField.id, target: value } })
      }} /></label>}
    </div>}
    {widget.type === 'table' && dataset?.grain !== 'person' && <div className="form-stack"><label className="check"><input type="checkbox" checked={widget.provinceFooter?.enabled ?? false} onChange={event => onChange({ ...widget, provinceFooter: { enabled: event.target.checked, rules: widget.provinceFooter?.rules ?? {} } })} /> Tampilkan baris Provinsi Sumatera Barat</label>
      {widget.provinceFooter?.enabled && widget.fields?.map(id => {
        const field = available.find(item => item.id === id)
        const rule = widget.provinceFooter!.rules[id] ?? { op: field?.unit === 'count' ? 'sum' : 'none' }
        const update = (next: Rule) => onChange({ ...widget, provinceFooter: { enabled: true, rules: { ...widget.provinceFooter?.rules, [id]: next } } })
        const opOptions = Object.entries(aggLabels).filter(([key]) => (isNumericUnit(field?.unit) || ['none', 'count', 'mode', 'reportedValue'].includes(key)) && (key !== 'formula' || field?.formula)).map(([key, label]) => ({ value: key, label }))
        return <div className="form-columns" key={id}><label>{field?.label ?? id}<Select value={rule.op} options={opOptions} onChange={value => update({ op: value as Rule['op'] })} /></label>
          {['ratioOfSums', 'weightedMean', 'difference'].includes(rule.op) && <><label>Kolom nilai<Select value={rule.numerator ?? ''} options={[{ value: '', label: 'Pilih' }, ...choiceOptions]} onChange={value => update({ ...rule, numerator: value || undefined })} /></label><label>Kolom pembagi atau bobot<Select value={rule.denominator ?? ''} options={[{ value: '', label: 'Pilih' }, ...choiceOptions]} onChange={value => update({ ...rule, denominator: value || undefined })} /></label></>}</div>
      })}</div>}
    {widget.type === 'link' && <label>Alamat tautan (HTTPS/HTTP)<input type="url" value={widget.url ?? ''} onChange={event => onChange({ ...widget, url: event.target.value || undefined })} /></label>}
    {['text', 'link', 'schedule', 'bars', 'donut'].includes(widget.type) && <div className="form-stack">
      <label>{widget.type === 'text' ? 'Isi teks / penjelasan' : 'Keterangan'}<textarea value={widget.description ?? ''} maxLength={1000} placeholder={widget.type === 'text' ? 'Tulis penjelasan atau sisipkan data tabel, misalnya: Periode <kolom_1>[0] · Total <sum(kolom_2)>' : 'Keterangan tambahan (bisa menyisipkan <kolom>[0])'} onChange={event => onChange({ ...widget, description: event.target.value })} /></label>
      {available.length > 0 && <div className="formula-chips" aria-label="Sisipkan nilai kolom ke teks">
        <button type="button" className="formula-chip" onClick={() => appendDescription('<identitas>[0]')}>&lt;identitas&gt;[0]</button>
        {available.slice(0, 6).map(field => <button key={field.id} type="button" className="formula-chip" onClick={() => appendDescription(`<${field.id}>[0]`)}>&lt;{field.id}&gt;[0] <small>{field.label}</small></button>)}
      </div>}
    </div>}
  </div>
}
