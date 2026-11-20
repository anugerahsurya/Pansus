import { useEffect, useId, useState } from 'react'
import { ArrowRight, FileSpreadsheet, Link2, Plus, SlidersHorizontal } from 'lucide-react'
import { activeFields, joinIdentity, type DataRow, type Dataset, type DatasetJoin, type Definition, type Field, type UploadMapping, type Value } from '../../../packages/contracts/index'
import { formatDateTime } from '../../../packages/contracts/datetime'
import { api, conditionDate, fmt, pct, type DashboardDetail } from './api'
import { Alert } from './common'
import { Select } from './select'

export type SourceInput = { id: string; label: string; file?: File; dataset?: Dataset }
type SourcePreview = {
  columns: { label: string; unit: Field['unit']; scale?: Field['scale']; selectable: boolean }[];
  rows: Value[][]; count: number; identity?: string; sheet?: string; headerRow?: number;
}
type JoinResult = { matched: number; unmatched: number; rows: DataRow[]; condition?: { date: string; time: string } }
type JoinKey = DatasetJoin['left']
type SaveDraft = (definition: Definition, mappings?: Record<string, UploadMapping>) => Promise<void>
const unitNames: Record<Field['unit'], string> = { count: 'Hitungan', number: 'Angka', percent: 'Persen', category: 'Teks', datetime: 'Tanggal & jam' }
const joinDragType = 'application/x-pansus-join-key'
const clean = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ')
function rawField(dataset: Dataset, mapping: UploadMapping, label: string) {
  return dataset.fields.find(field => !field.derived && !field.formula && (mapping.columns?.[field.id]
    ? clean(mapping.columns[field.id]) === label : [field.id, field.label, ...field.aliases].some(item => clean(item) === label)))
}
function cellText(value: Value, unit?: Field['unit']) {
  if (unit === 'datetime' && typeof value === 'string') return formatDateTime(value)
  return value == null || value === '' ? '—' : typeof value === 'number' ? unit === 'percent' ? pct.format(value) : fmt.format(value) : value
}

export function SourceWorkbench({ detail, sources, mappings, locked, save }: {
  detail: DashboardDetail; sources: SourceInput[]; mappings: Record<string, UploadMapping>; locked: boolean; save: SaveDraft;
}) {
  const [linking, setLinking] = useState(false)
  const [keys, setKeys] = useState<JoinKey[]>([])
  const [excluded, setExcluded] = useState<string[]>([])
  const [label, setLabel] = useState('')
  const [joining, setJoining] = useState(false)
  const [finished, setFinished] = useState<{ dataset: Dataset; result: JoinResult; inputs: (File | undefined)[]; revision: number; mappings: string }>()
  const [linked, setLinked] = useState<{ dataset: Dataset; result: JoinResult }>()
  const [error, setError] = useState('')
  const heading = useId()
  const limit = detail.draft.datasets.length >= 8
  const choices = sources.filter(source => source.dataset && (source.file || detail.preview?.data[source.id]))
  const linkSources = keys.map(key => choices.find(source => source.id === key.dataset))
  const sourceFiles = linkSources.map(source => source?.file)
  const sameInput = sourceFiles.every(Boolean) || sourceFiles.every(file => !file)
  const editable = detail.canManage && detail.template === 'custom'
  const output = linkSources.flatMap((source, index) => {
    const side = index === 0 ? 'left' as const : 'right' as const
    return source?.dataset ? activeFields(source.dataset).map(field => ({ side, field, key: `${side}:${field.id}` })) : []
  })
  const selected = output.filter(item => !excluded.includes(item.key))
  const revision = detail.draftRevision
  const currentMappings = JSON.stringify(mappings)
  const fresh = finished && finished.revision === revision && finished.mappings === currentMappings && finished.inputs.every((file, index) => file === sourceFiles[index])

  function pick(key: JoinKey) {
    if (joining || locked) return
    setError(''); setFinished(undefined); setExcluded([])
    setKeys(current => {
      if (current.some(item => item.dataset === key.dataset && item.field === key.field)) return current.filter(item => item.dataset !== key.dataset)
      if (current.some(item => item.dataset === key.dataset)) return current.map(item => item.dataset === key.dataset ? key : item)
      return current.length === 2 ? [current[0], key] : [...current, key]
    })
  }
  function keyName(key: JoinKey) {
    const dataset = detail.draft.datasets.find(item => item.id === key.dataset)
    return key.field === joinIdentity ? dataset?.grain === 'person' ? 'Identitas petugas' : 'Kode wilayah' : dataset?.fields.find(field => field.id === key.field)?.label ?? key.field
  }
  function connect(from: JoinKey, to: JoinKey) {
    if (joining || locked || from.dataset === to.dataset) return
    if (![from, to].every(key => choices.some(source => source.dataset && source.id === key.dataset &&
      (key.field === joinIdentity || activeFields(source.dataset).some(field => field.id === key.field))))) return
    setKeys([from, to]); setExcluded([]); setError(''); setFinished(undefined)
  }
  async function inspect() {
    if (keys.length !== 2 || !linkSources[0]?.dataset || linkSources.some(source => !source) || !sameInput || !selected.length || selected.length > 50) return
    const datasetLabel = label.trim() || 'Hasil penggabungan'
    const dataset: Dataset = {
      id: `join_${crypto.randomUUID().slice(0, 8)}`, label: datasetLabel, grain: linkSources[0].dataset.grain,
      fields: selected.map(({ field, side }, index) => ({
        ...field, id: `gabungan_${index + 1}`, aliases: [], formula: undefined, nullable: true, derived: true,
        label: selected.some((item, at) => index !== at && clean(item.field.label) === clean(field.label))
          ? `${field.label.slice(0, 64)} · ${linkSources[side === 'left' ? 0 : 1]?.label.slice(0, 32)}` : field.label,
      })),
      join: { left: keys[0], right: keys[1], columns: Object.fromEntries(selected.map(({ field, side }, index) => [`gabungan_${index + 1}`, { side, field: field.id }])) },
    }
    const body = new FormData()
    body.append('expectedRevision', String(revision)); body.append('dataset', JSON.stringify(dataset)); body.append('mappings', currentMappings)
    sourceFiles.forEach((file, index) => { if (file) body.append(keys[index].dataset, file) })
    setError(''); setFinished(undefined); setJoining(true)
    try {
      const result = await api<JoinResult>(`/admin/dashboards/${detail.id}/join-preview`, 'POST', body)
      setFinished({ dataset, result, inputs: sourceFiles, revision, mappings: currentMappings })
    } catch (failure) { setError((failure as Error).message) }
    finally { setJoining(false) }
  }
  async function saveJoin() {
    if (!fresh || !finished || !finished.result.matched) return
    try {
      await save({ ...detail.draft, datasets: [...detail.draft.datasets, finished.dataset] })
      setLinked(finished); setFinished(undefined); setLinking(false); setKeys([]); setLabel(''); setError('')
    } catch (failure) { setError((failure as Error).message) }
  }
  return <section className="panel studio-panel wide source-workbench" id="tabel-sumber" tabIndex={-1} aria-labelledby={heading}>
    <div className="source-heading">
      <div><h2 id={heading}>Tabel sumber</h2><p>Lihat contoh isi setiap berkas dan atur kolom yang dipakai.</p></div>
      {editable && choices.length > 1 && <button type="button" className="button" aria-expanded={linking} disabled={locked || joining || limit} onClick={() => {
        setLinking(!linking); setKeys([]); setFinished(undefined); setError('')
      }}><Link2 size={16} /> {linking ? 'Tutup penggabungan' : 'Hubungkan kolom'}</button>}
    </div>
    {linking && <p className="link-instructions" role="status">{keys.length === 0 ? 'Klik kunci di tabel utama, atau seret langsung ke kunci di tabel pasangan.' : keys.length === 1 ? 'Pilih kunci di tabel pasangan.' : 'Pilih kolom hasil, lalu periksa penggabungan.'}</p>}
    <div className="source-table-grid">
      {sources.map(source => <SourceCard key={source.id} source={source} detail={detail} mapping={mappings[source.id]} editable={editable} locked={locked || joining}
        linking={linking && choices.some(item => item.id === source.id)} selectedKey={keys.find(key => key.dataset === source.id)?.field} pick={field => pick({ dataset: source.id, field })}
        connect={connect}
        save={(dataset, mapping) => save({ ...detail.draft, datasets: detail.draft.datasets.map(item => item.id === source.id ? dataset : item) }, { [source.id]: mapping })} />)}
    </div>
    {linking && keys.length > 0 && <section className="join-editor form-stack" aria-label="Penggabungan sumber">
      <div className="join-path">
        <span><small>Tabel utama</small><b>{linkSources[0]?.label}</b>{keyName(keys[0])}</span>
        <span className="join-wire" data-connected={keys.length === 2} aria-hidden="true"><i /><ArrowRight size={16} /></span>
        {keys[1] ? <span><small>Tabel pasangan</small><b>{linkSources[1]?.label}</b>{keyName(keys[1])}</span> : <span className="muted-text">Pilih kolom pasangan</span>}
      </div>
      {error && <Alert>{error}</Alert>}
      {keys.length === 2 && <>
        <label>Nama tabel hasil<input value={label} maxLength={100} placeholder="Hasil penggabungan" disabled={joining || locked} onChange={event => { setLabel(event.target.value); setFinished(undefined) }} /></label>
        <p className="muted-text">Semua baris tabel utama dipertahankan. Kunci pada tabel pasangan harus unik.</p>
        <details className="mapping"><summary>Kolom hasil ({selected.length}/50)</summary><div className="join-column-options">
          {linkSources.map((source, index) => <fieldset className="bare-fieldset form-stack" key={source?.id ?? index}><legend>{source?.label}</legend>
            {output.filter(item => item.side === (index === 0 ? 'left' : 'right')).map(item => <label className="check" key={item.key}><input type="checkbox" checked={!excluded.includes(item.key)} disabled={joining || locked} onChange={event => {
              setExcluded(event.target.checked ? excluded.filter(key => key !== item.key) : [...excluded, item.key]); setFinished(undefined)
            }} />{item.field.label}</label>)}
          </fieldset>)}
        </div></details>
        {!sameInput && <p className="muted-text">Pilih berkas baru untuk kedua sumber agar kondisinya sebanding.</p>}
        <button type="button" className="button" disabled={locked || joining || !sameInput || !selected.length || selected.length > 50} onClick={() => void inspect()}><Link2 size={16} /> Periksa penggabungan</button>
        {joining && <div className="join-progress" role="status"><span>Mencocokkan baris dari kedua sumber…</span><progress aria-label="Progres penggabungan" /></div>}
        {fresh && finished && <><JoinSample dataset={finished.dataset} result={finished.result} /><button type="button" className="button primary" disabled={locked || !finished.result.matched} onClick={() => void saveJoin()}>Simpan penggabungan</button></>}
      </>}
    </section>}
    {linked && <Alert tone="success">Penggabungan disimpan. Periksa unggahan baru atau gunakan kondisi terakhir untuk memakai hasilnya pada dashboard.</Alert>}
    {detail.draft.datasets.some(dataset => dataset.join) && <div className="saved-joins form-stack">
      <h3>Hubungan tersimpan</h3>
      <div className="source-table-grid">{detail.draft.datasets.flatMap(dataset => dataset.join ? [<div className="saved-join form-stack" key={dataset.id}>
        <p><Link2 size={16} aria-hidden="true" /><span>{detail.draft.datasets.find(item => item.id === dataset.join?.left.dataset)?.label} · {keyName(dataset.join.left)} → {detail.draft.datasets.find(item => item.id === dataset.join?.right.dataset)?.label} · {keyName(dataset.join.right)}</span></p>
        <SourceCard source={{ id: dataset.id, label: dataset.label, dataset }} detail={detail} editable={editable} locked={locked || joining} linking={false}
          sample={linked?.dataset.id === dataset.id ? linked.result.rows : undefined}
          save={next => save({ ...detail.draft, datasets: detail.draft.datasets.map(item => item.id === dataset.id ? next : item) })} />
      </div>] : [])}</div>
    </div>}
  </section>
}

function JoinSample({ dataset, result }: { dataset: Dataset; result: JoinResult }) {
  return <div className="form-stack">
    <h3>{dataset.label}</h3>
    <p className="muted-text">{result.matched} cocok · {result.unmatched} tanpa pasangan{result.condition && ` · Kondisi ${conditionDate(result.condition.date)} ${result.condition.time} WIB`}</p>
    {!result.matched && <Alert tone="info">Belum ada baris yang cocok. Pilih pasangan kolom lain.</Alert>}
    <div className="table-scroll source-scroll" tabIndex={0} role="region" aria-label={`Pratinjau ${dataset.label}`}><table>
      <thead><tr><th scope="col">Identitas</th>{dataset.fields.map(field => <th scope="col" key={field.id}>{field.label}</th>)}</tr></thead>
      <tbody>{result.rows.map(row => <tr key={row.code}><th scope="row">{row.name}</th>{dataset.fields.map(field => <td key={field.id}>{cellText(row.values[field.id], field.unit)}</td>)}</tr>)}</tbody>
    </table></div>
  </div>
}

function SourceCard({ source, detail, mapping, editable, locked, linking, selectedKey, pick, connect, save, sample }: {
  source: SourceInput; detail: DashboardDetail; mapping?: UploadMapping; editable: boolean; locked: boolean; linking: boolean; selectedKey?: string;
  pick?: (field: string) => void; connect?: (from: JoinKey, to: JoinKey) => void;
  save: (dataset: Dataset, mapping: UploadMapping) => Promise<void>; sample?: DataRow[];
}) {
  const [raw, setRaw] = useState<SourcePreview>()
  const [inspectError, setInspectError] = useState('')
  const [configError, setConfigError] = useState('')
  const [edit, setEdit] = useState<{ fields: Field[]; config: UploadMapping }>()
  const [add, setAdd] = useState('')
  const dataset = source.dataset
  const { sheet, headerRow, stopRow, region, jsonPath, columns } = mapping ?? {}
  useEffect(() => {
    setRaw(undefined); setInspectError('')
    if (!source.file) return
    let current = true
    const body = new FormData()
    body.append('file', source.file); body.append('slot', source.id)
    body.append('mapping', JSON.stringify({ sheet, headerRow, stopRow, region, jsonPath, columns }))
    const timer = window.setTimeout(() => api<SourcePreview>(`/admin/dashboards/${detail.id}/source-preview`, 'POST', body).then(
      value => { if (current) setRaw(value) },
      failure => { if (current) setInspectError((failure as Error).message) },
    ), 180)
    return () => { current = false; window.clearTimeout(timer) }
  }, [detail.id, source.id, source.file, sheet, headerRow, stopRow, region, jsonPath, columns])
  const applied = dataset && !source.file ? detail.preview?.data[dataset.id] : undefined
  const normalized = applied?.rows ?? sample
  const shownFields = dataset ? activeFields(dataset) : []
  const identity = region ? clean(region) : raw?.identity
  const headers = raw?.columns.filter(column => column.selectable && column.label !== identity) ?? []
  const titleId = useId()
  function editColumn(id: string, update: Partial<Field>) {
    setEdit(current => current && { ...current, fields: current.fields.map(field => field.id === id ? { ...field, ...update } : field) })
  }
  async function apply() {
    if (!edit || !dataset) return
    setConfigError('')
    try {
      await save({ ...dataset, fields: edit.fields }, edit.config)
      setEdit(undefined); setAdd('')
    } catch (failure) { setConfigError((failure as Error).message) }
  }
  function addColumn() {
    const picked = headers.find(column => column.label === add)
    if (!picked || !edit) return
    const id = `field_${crypto.randomUUID().slice(0, 8)}`
    setEdit({ fields: [...edit.fields, { id, label: picked.label.slice(0, 100), unit: picked.unit, scale: picked.scale, nullable: true, public: false, aliases: [] }],
      config: { ...edit.config, columns: { ...edit.config.columns, [id]: picked.label } } })
    setAdd('')
  }
  const linkButton = (key: string, name: string) => linking && <button type="button" className="source-key" aria-label={`Pilih kunci ${source.label} · ${name}`}
    title="Pilih atau seret kunci" aria-pressed={selectedKey === key} disabled={locked} draggable={!locked} onClick={() => pick?.(key)}
    onDragStart={event => {
      event.dataTransfer.effectAllowed = 'link'
      event.dataTransfer.setData(joinDragType, `${source.id}|${key}`)
    }} onDragOver={event => {
      if (locked || !event.dataTransfer.types.includes(joinDragType)) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'link'
    }} onDrop={event => {
      if (locked || !event.dataTransfer.types.includes(joinDragType)) return
      event.preventDefault()
      const [dataset, field] = event.dataTransfer.getData(joinDragType).split('|')
      if (dataset && field) connect?.({ dataset, field }, { dataset: source.id, field: key })
    }}><Link2 size={15} aria-hidden="true" /></button>
  return <article className="source-card" aria-labelledby={titleId}>
    <div className="source-card-heading"><FileSpreadsheet size={19} aria-hidden="true" /><div>
      <h3 id={titleId}>{source.label}</h3><p>{source.file?.name || (applied ? 'Kondisi terakhir diterapkan' : dataset?.join ? sample ? 'Contoh hasil penggabungan' : 'Terapkan unggahan untuk melihat hasil' : 'Berkas belum dipilih')}{raw && ` · ${raw.count} baris`}{raw?.sheet && ` · ${raw.sheet}`}</p>
    </div>{editable && dataset && <button type="button" className="button" aria-expanded={!!edit} disabled={locked || linking} onClick={() => {
      setConfigError('')
      setEdit(edit ? undefined : { fields: dataset.fields, config: { ...mapping, region: mapping?.region ?? raw?.identity, headerRow: mapping?.headerRow ?? raw?.headerRow, sheet: mapping?.sheet ?? raw?.sheet } })
    }}><SlidersHorizontal size={15} /> Edit kolom</button>}</div>
    {inspectError && <Alert>{inspectError}</Alert>}
    {source.file && !raw && !inspectError && <p role="status" className="source-message">Membaca tabel…</p>}
    {raw && <div className="table-scroll source-scroll" tabIndex={0} role="region" aria-label={`Pratinjau berkas ${source.label}`}><table>
      <thead><tr>{raw.columns.map((column, index) => {
        const field = dataset && rawField(dataset, mapping ?? {}, column.label)
        const key = column.label === identity ? joinIdentity : field?.enabled !== false ? field?.id : undefined
        return <th key={index} scope="col" data-key-selected={!!key && selectedKey === key}><span>{column.label || `Kolom ${index + 1}`}</span>
          {column.unit === 'datetime' && <small className="source-field-state">{unitNames.datetime}</small>}
          {field?.enabled === false && <small className="source-field-state">Tidak dipakai</small>}{column.selectable && key && linkButton(key, column.label)}</th>
      })}</tr></thead>
      <tbody>{raw.rows.map((row, index) => <tr key={index}>{raw.columns.map(({ unit }, column) => <td key={column}>{cellText(row[column], unit === 'datetime' ? unit : undefined)}</td>)}</tr>)}</tbody>
    </table></div>}
    {normalized && <div className="table-scroll source-scroll" tabIndex={0} role="region" aria-label={`Pratinjau ${source.label}`}><table>
      <thead><tr><th scope="col">Identitas{linkButton(joinIdentity, 'Identitas')}</th>{shownFields.map(field => <th scope="col" key={field.id} data-key-selected={selectedKey === field.id}>{field.label}{linkButton(field.id, field.label)}</th>)}</tr></thead>
      <tbody>{normalized.slice(0, 6).map(row => <tr key={row.code}><th scope="row">{row.name}</th>{shownFields.map(field => <td key={field.id}>{cellText(row.values[field.id], field.unit)}</td>)}</tr>)}</tbody>
    </table></div>}
    {edit && <div className="source-column-editor form-stack">
      {configError && <Alert>{configError}</Alert>}
      <p className="muted-text">Lepaskan kolom dari komponen, rumus, atau penggabungan sebelum menonaktifkannya.</p>
      {raw && <label>Kolom identitas<Select value={edit.config.region ?? ''} disabled={locked} options={[{ value: '', label: 'Deteksi otomatis' }, ...raw.columns.filter(column => column.selectable).map(column => ({ value: column.label, label: column.label }))]} onChange={value => setEdit({ ...edit, config: { ...edit.config, region: value || undefined } })} /></label>}
      <div className="table-scroll source-scroll" tabIndex={0} role="region" aria-label={`Pengaturan kolom ${source.label}`}><table>
        <thead><tr><th scope="col">Pakai</th><th scope="col">Nama kolom</th><th scope="col">Judul di berkas</th><th scope="col">Tipe</th><th scope="col">Pembaca</th></tr></thead>
        <tbody>{edit.fields.map(field => {
          const bound = edit.config.columns?.[field.id] ?? raw?.columns.find(column => dataset && rawField(dataset, edit.config, column.label)?.id === field.id)?.label ?? ''
          return <tr key={field.id} data-inactive={field.enabled === false}>
            <td><input type="checkbox" aria-label={`Gunakan ${field.label}`} checked={field.enabled !== false} disabled={locked} onChange={event => editColumn(field.id, { enabled: event.target.checked ? undefined : false })} /></td>
            <td><input aria-label={`Nama kolom ${field.id}`} value={field.label} maxLength={100} disabled={locked} onChange={event => editColumn(field.id, { label: event.target.value })} /></td>
            <td>{raw && !field.derived && !field.formula ? <Select ariaLabel={`Sumber kolom ${field.label}`} value={bound} disabled={locked} options={[
              { value: '', label: 'Deteksi otomatis' },
              ...(bound && !headers.some(column => column.label === bound) ? [{ value: bound, label: bound }] : []),
              ...headers.map(column => ({ value: column.label, label: column.label })),
            ]} onChange={value => {
              const next = { ...edit.config.columns }
              if (value) next[field.id] = value
              else delete next[field.id]
              setEdit({ ...edit, config: { ...edit.config, columns: next } })
            }} /> : <span>{field.formula ? 'Rumus' : field.derived ? 'Turunan' : bound || 'Otomatis'}</span>}</td>
            <td><Select ariaLabel={`Tipe kolom ${field.label}`} value={field.unit === 'percent' ? field.scale ?? 'percentage' : field.unit} disabled={locked || field.derived} options={[
              { value: 'count', label: unitNames.count }, { value: 'number', label: unitNames.number }, { value: 'category', label: unitNames.category },
              { value: 'datetime', label: unitNames.datetime }, { value: 'percentage', label: 'Persen 0–100' }, { value: 'fraction', label: 'Persen 0–1' },
            ]} onChange={next => {
              editColumn(field.id, next === 'fraction' || next === 'percentage' ? { unit: 'percent', scale: next } : { unit: next as Field['unit'], scale: undefined })
            }} /></td>
            <td><input type="checkbox" aria-label={`Tampilkan ${field.label} kepada pembaca`} checked={field.public} disabled={locked || field.enabled === false} onChange={event => editColumn(field.id, { public: event.target.checked })} /></td>
          </tr>
        })}</tbody>
      </table></div>
      {headers.length > 0 && <div className="actions"><Select ariaLabel="Pilih kolom untuk ditambahkan" value={add} disabled={locked} options={[
        { value: '', label: 'Pilih kolom dari berkas' },
        ...headers.filter(column => dataset && !rawField({ ...dataset, fields: edit.fields }, edit.config, column.label)).map(column => ({ value: column.label, label: column.label })),
      ]} onChange={setAdd} />
        <button type="button" className="button" disabled={locked || !add || edit.fields.length >= 50} onClick={addColumn}><Plus size={15} /> Tambah</button></div>}
      <div className="actions"><button type="button" className="button primary" disabled={locked} onClick={() => void apply()}>Simpan kolom</button><button type="button" className="button" disabled={locked} onClick={() => { setEdit(undefined); setConfigError('') }}>Batal</button></div>
    </div>}
  </article>
}
