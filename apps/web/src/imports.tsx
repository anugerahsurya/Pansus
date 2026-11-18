import { useEffect, useState, type FormEvent } from 'react'
import { FileSpreadsheet, Info, Settings2 } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import type { UploadMapping } from '../../../packages/contracts/index'
import { api, conditionDate, currentWib, fmt, type CsvSuggestion, type DashboardDetail, type ImportJob } from './api'
import { Alert } from './common'

const tabularFormats = '.csv,.tsv,.xlsx,.xls,.json'
const csvUnits = { count: 'Hitungan', number: 'Angka', percent: 'Persen', category: 'Kategori' }

export function UploadPanel({ detail, onUpdate }: { detail: DashboardDetail; onUpdate: () => void }) {
  const [query, setQuery] = useSearchParams()
  const [date, setDate] = useState(() => currentWib()[0])
  const [time, setTime] = useState(() => currentWib()[1])
  const [workbook, setWorkbook] = useState(detail.template === 'susenas')
  const [auto, setAuto] = useState(detail.template === 'pes')
  const [batch, setBatch] = useState<File[]>([])
  const [files, setFiles] = useState<Record<string, File | undefined>>({})
  const [inputRevision, setInputRevision] = useState(0)
  const [mappings, setMappings] = useState(detail.mappings)
  const [selectedJob, setJob] = useState<ImportJob>()
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [busy, setBusy] = useState(false)
  const [suggesting, setSuggesting] = useState('')
  const [aiError, setAiError] = useState('')
  const [suggestion, setSuggestion] = useState<{ slot: string; result: CsvSuggestion }>()
  const [applied, setApplied] = useState('')
  const [idempotency] = useState(() => crypto.randomUUID())
  const closed = detail.activityStatus === 'closed'
  const slots = workbook ? [{ id: 'workbook', label: 'Workbook Susenas–Seruti', fields: [] }] : [
    ...detail.draft.datasets, ...(detail.template === 'pes' ? [{ id: 'sls_detail', label: 'Rincian SSLS (opsional)', fields: [] }] : []),
  ]
  const jobId = query.get('job')
  const job = selectedJob?.id === jobId ? selectedJob : undefined
  const processing = job?.status === 'uploaded' || job?.status === 'validating'
  const aiSlots = !auto && !workbook && detail.aiAvailable ? slots.filter(slot => slot.id !== 'sls_detail' && /\.csv$/i.test(files[slot.id]?.name ?? '')) : []

  useEffect(() => {
    if (!jobId) return
    let current = true
    api<ImportJob>(`/admin/imports/${jobId}/preview`).then(value => { if (current) setJob(value) }, failure => { if (current) setError(failure.message) })
    return () => { current = false }
  }, [jobId])
  useEffect(() => {
    if (!jobId || !processing) return
    let current = true
    const timer = window.setTimeout(() => api<ImportJob>(`/admin/imports/${jobId}/preview`).then(value => {
      if (!current) return
      setJob(value)
      if (value.status !== 'uploaded' && value.status !== 'validating') onUpdate()
    }, failure => { if (current) setError(failure.message) }), 850)
    return () => { current = false; window.clearTimeout(timer) }
  }, [job, jobId, processing])

  function setMapping(slot: string, key: keyof Omit<UploadMapping, 'columns'>, value: string) {
    const parsed = value.trim() ? key === 'headerRow' || key === 'stopRow' ? Number(value) : value : undefined
    setMappings(current => ({ ...current, [slot]: { ...current[slot], [key]: parsed } }))
  }
  function setColumn(slot: string, key: string, value: string) {
    setMappings(current => {
      const columns = { ...current[slot]?.columns }
      if (value.trim()) columns[key] = value
      else delete columns[key]
      return { ...current, [slot]: { ...current[slot], columns } }
    })
  }

  async function analyzeCsv(slot: string) {
    const file = files[slot]
    if (!file) return
    setSuggesting(slot); setAiError(''); setSuggestion(undefined); setApplied('')
    const body = new FormData()
    body.append('csv', file)
    body.append('slot', slot)
    if (mappings[slot]?.headerRow) body.append('headerRow', String(mappings[slot].headerRow))
    if (mappings[slot]?.stopRow) body.append('stopRow', String(mappings[slot].stopRow))
    try {
      const result = await api<CsvSuggestion>(`/admin/dashboards/${detail.id}/ai-drafts`, 'POST', body)
      setSuggestion({ slot, result })
    } catch (failure) { setAiError((failure as Error).message) }
    finally { setSuggesting('') }
  }

  async function applySuggestion() {
    if (!suggestion) return
    const { slot, result } = suggestion
    setBusy(true); setAiError(''); setApplied('')
    try {
      if (result.definition) {
        await api(`/admin/dashboards/${detail.id}/draft`, 'PATCH', {
          definition: result.definition, expectedRevision: result.expectedRevision, mappings: { [slot]: result.mapping },
        })
        onUpdate()
      } else if (result.expectedRevision !== detail.draftRevision) {
        throw new Error('Draf sudah berubah. Minta saran ulang untuk konfigurasi terbaru.')
      }
      setMappings(current => ({ ...current, [slot]: result.mapping }))
      setApplied(result.definition ? 'Konfigurasi draf disimpan. Periksa unggahan untuk menambahkan data.' : 'Usulan dimasukkan ke pemetaan. Kamu bisa mengubahnya sebelum memeriksa unggahan.')
      setSuggestion(undefined)
    } catch (failure) { setAiError((failure as Error).message) }
    finally { setBusy(false) }
  }
  async function preview(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(''); setSuccess('')
    const body = new FormData()
    body.append('date', date); body.append('time', time); body.append('mappings', JSON.stringify(auto ? {} : mappings))
    if (auto) batch.forEach((file, index) => body.append(`auto_${index + 1}`, file))
    for (const slot of slots) {
      const file = files[slot.id]
      if (file && (!auto || slot.id === 'sls_detail')) body.append(slot.id, file)
    }
    try {
      const result = await api<ImportJob>(`/admin/dashboards/${detail.id}/imports`, 'POST', body)
      setJob(result)
      setQuery({ tab: 'data', job: result.id }, { replace: true })
      onUpdate()
    } catch (failure) { setError((failure as Error).message) }
    finally { setBusy(false) }
  }
  async function commit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!job) return
    setBusy(true); setError(''); setSuccess('')
    const fields = new FormData(event.currentTarget)
    try {
      const { proof } = await api<{ proof: string }>('/auth/confirm', 'POST', { jobId: job.id, password: fields.get('password') })
      await api(`/admin/imports/${job.id}/commit`, 'POST', { proof, hash: job.hash, idempotencyKey: idempotency, reason: fields.get('reason') || undefined })
      setJob({ ...job, status: 'published' })
      setSuccess(detail.activeRelease ? 'Pembaruan tersimpan. Periksa kondisi data pada tautan pembaca.' : 'Data tersimpan pada draf. Tinjau sebagai pembaca, lalu terbitkan.')
      setFiles({})
      setBatch([])
      setInputRevision(current => current + 1)
      onUpdate()
    } catch (failure) { setError((failure as Error).message) }
    finally { setBusy(false) }
  }
  return <div className="studio-grid">
    <section className="panel studio-panel">
      <div className="panel-heading"><div><h2>Perbarui data</h2><p>Pilih waktu yang tercatat pada ekspor, lalu periksa berkas sebelum menerapkan pembaruan.</p></div></div>
      {closed && <Alert tone="info">Kegiatan selesai{detail.closedAt && ` pada ${new Intl.DateTimeFormat('id-ID', { dateStyle: 'long', timeZone: 'Asia/Jakarta' }).format(new Date(detail.closedAt))}`}. Hubungi admin untuk membuka kembali.</Alert>}
      <form className="form-stack" onSubmit={preview}>
        <fieldset key={inputRevision} disabled={closed || busy || Boolean(suggesting)} className="form-stack bare-fieldset">
          <div className="form-columns"><label>Tanggal kondisi<input type="date" required value={date} onChange={event => setDate(event.target.value)} /></label><label>Jam kondisi (WIB)<input type="time" required value={time} onChange={event => setTime(event.target.value)} /></label></div>
          {detail.template === 'susenas' && <label>Profil sumber<select value={workbook ? 'workbook' : 'separate'} onChange={event => { setWorkbook(event.target.value === 'workbook'); setSuggestion(undefined) }}><option value="workbook">Satu workbook Susenas dan Seruti</option><option value="separate">Berkas terpisah per dataset</option></select></label>}
          {detail.template === 'pes' && <label>Cara memilih berkas<select value={auto ? 'auto' : 'manual'} onChange={event => { setAuto(event.target.value === 'auto'); setSuggestion(undefined) }}><option value="auto">Deteksi otomatis</option><option value="manual">Pilih per dataset{detail.aiAvailable ? ' (manual atau Gemini)' : ''}</option></select></label>}
          {auto && <div className="form-stack">
            <label className="file-slot">
              <FileSpreadsheet size={20} aria-hidden="true" /><span><b>Tiga ekspor progres PES</b><small>Pilih ringkasan SLS dan dua ekspor assignment sekaligus. Urutan bebas. CSV, TSV, Excel, atau JSON.</small></span>
              <input aria-label="Tiga ekspor progres PES" aria-describedby="batch-selection" type="file" multiple accept={tabularFormats} onChange={event => setBatch(Array.from(event.target.files ?? []))} />
            </label>
            <div id="batch-selection" className="selection-summary" aria-live="polite">{batch.length}/3 berkas dipilih
              {!!batch.length && <ul>{batch.map((file, index) => <li key={index}>{file.name}</li>)}</ul>}
            </div>
          </div>}
          {slots.filter(slot => !auto || slot.id === 'sls_detail').map(slot => <label key={slot.id} className="file-slot"><FileSpreadsheet size={20} aria-hidden="true" /><span><b>{slot.label}</b><small>{files[slot.id]?.name || (workbook ? 'Pilih workbook XLSX atau XLS' : slot.id === 'sls_detail' ? 'CSV SSLS atau Excel Sheet9' : 'Pilih CSV, TSV, Excel, atau JSON')}</small></span><input aria-label={slot.label} type="file" accept={workbook ? '.xlsx,.xls' : tabularFormats} required={slot.id !== 'sls_detail' && !files[slot.id]} onChange={event => {
            setFiles({ ...files, [slot.id]: event.target.files?.[0] })
            if (suggestion?.slot === slot.id) setSuggestion(undefined)
            setApplied(''); setAiError('')
          }} /></label>)}
          {!auto && !workbook && detail.aiAvailable && <div className="form-stack csv-assist">
            <div><h3>Bantuan Gemini</h3><p>Gemini menerima struktur kolom yang disaring dan tipe nilainya. Isi baris dan angka CSV diproses di Pansus.</p></div>
            {aiSlots.length ? <div className="actions">{aiSlots.map(slot => <button className="button" type="button" key={slot.id} onClick={() => void analyzeCsv(slot.id)} disabled={processing}>Analisis CSV {slot.label}</button>)}</div> : <p>Pilih berkas CSV untuk melihat opsi analisis.</p>}
          </div>}
          {!auto && <details className="mapping"><summary><Settings2 size={16} aria-hidden="true" /> Pemetaan kolom dan lembar</summary><p>Isi pengaturan ini jika judul, lembar, atau jalur JSON perlu dipilih secara eksplisit.</p>
            {slots.map(slot => <div className="mapping-slot form-stack" key={slot.id}><strong>{slot.label}</strong>
              <div className="form-columns"><label>Nama lembar<input value={mappings[slot.id]?.sheet ?? ''} onChange={event => setMapping(slot.id, 'sheet', event.target.value)} placeholder="Otomatis" /></label><label>Baris judul<input type="number" min="1" value={mappings[slot.id]?.headerRow ?? ''} onChange={event => setMapping(slot.id, 'headerRow', event.target.value)} placeholder="Otomatis" /></label><label>Baris terakhir<input type="number" min="2" value={mappings[slot.id]?.stopRow ?? ''} onChange={event => setMapping(slot.id, 'stopRow', event.target.value)} placeholder="Otomatis" /></label></div>
              {!workbook && slot.id !== 'sls_detail' && <><div className="form-columns"><label>Judul kolom wilayah<input value={mappings[slot.id]?.region ?? ''} onChange={event => setMapping(slot.id, 'region', event.target.value)} placeholder="Otomatis" /></label><label>Jalur daftar JSON<input value={mappings[slot.id]?.jsonPath ?? ''} onChange={event => setMapping(slot.id, 'jsonPath', event.target.value)} placeholder="contoh: data.wilayah" /></label></div>
              <div className="form-columns">{slot.fields.filter(field => !field.derived && !field.formula).map(field => <label key={field.id}>{field.label}<input value={mappings[slot.id]?.columns?.[field.id] ?? ''} onChange={event => setColumn(slot.id, field.id, event.target.value)} placeholder="Judul sumber atau jalur JSON" /></label>)}</div></>}
            </div>)}
          </details>}
          <button className="button primary" disabled={processing || (auto ? batch.length !== 3 : slots.some(slot => slot.id !== 'sls_detail' && !files[slot.id]))}>{busy || processing ? 'Memproses…' : 'Periksa unggahan'}</button>
        </fieldset>
      </form>
    </section>
    <div className="import-review">
    {(suggesting || aiError || suggestion || applied) && <section className="panel studio-panel ai-suggestion" aria-label="Usulan Gemini">
      <div className="panel-heading"><h2>Usulan Gemini</h2></div>
      {suggesting && <p role="status">Menganalisis struktur CSV dan memeriksa usulan terhadap berkas…</p>}
      {aiError && <Alert>{aiError}</Alert>}
      {applied && <Alert tone="success">{applied}</Alert>}
      {suggestion && <div className="form-stack">
        <p>{suggestion.result.model} · {suggestion.result.rows} wilayah diperiksa · Baris judul {suggestion.result.mapping.headerRow}</p>
        <dl><div><dt>Wilayah</dt><dd>{suggestion.result.mapping.region}</dd></div>
          {suggestion.result.fields.map(field => <div key={field.id}><dt>{field.label}</dt><dd>{suggestion.result.mapping.columns?.[field.id]}
            {suggestion.result.definition && <small className="suggestion-unit">{csvUnits[field.unit]}{field.scale === 'fraction' ? ' (0–1)' : field.scale === 'percentage' ? ' (0–100)' : ''}{!field.public ? ' · Privat' : ''}</small>}
          </dd></div>)}
        </dl>
        {suggestion.result.definition && <p>Usulan mengganti kolom dan komponen draf. Komponen yang disiapkan {suggestion.result.definition.widgets.map(widget => widget.title).join(', ') || 'belum ada'}.</p>}
        {suggestion.result.warnings.map(message => <p key={message}>{message}</p>)}
        <div className="actions">
          <button type="button" className="button primary" disabled={busy || closed || processing} onClick={() => void applySuggestion()}>{suggestion.result.definition ? 'Terapkan ke draf' : 'Gunakan pemetaan'}</button>
          <button type="button" className="button" disabled={busy} onClick={() => { setSuggestion(undefined); setAiError('') }}>Abaikan usulan</button>
        </div>
      </div>}
    </section>}
    {(error || success || job) && <section className="panel studio-panel" aria-live="polite">
      <div className="panel-heading"><div><h2>Hasil pemeriksaan</h2>{job && <p>{conditionDate(job.date)} · {job.time} WIB</p>}</div></div>
      {error && <Alert>{error}</Alert>}{success && <Alert tone="success">{success}</Alert>}
      {processing && <Alert tone="info">Worker sedang memeriksa berkas. Anda dapat membuka kembali pekerjaan ini dari riwayat unggahan.</Alert>}
      {job?.errors.map((item, index) => <Alert key={index}>{item.location && <b>{item.location} · </b>}{item.message}</Alert>)}
      {job?.warnings.map((item, index) => <Alert key={index} tone="info">{item.message}</Alert>)}
      {!!job?.errors.length && <a href={`/api/admin/imports/${job.id}/errors`} className="button">Unduh daftar kesalahan</a>}
      {job?.status === 'published' && !success && <Alert tone="success">Pekerjaan ini sudah diterapkan.</Alert>}
      {!!job?.differences.length && <div className="import-results">{job.differences.map(diff => <details className="result-card" key={diff.id}>
        <summary><span><b>{detail.draft.datasets.find(dataset => dataset.id === diff.id)?.label ?? diff.id}</b><small>{diff.rows} wilayah{diff.detailed ? ` · ${diff.detailed} rincian SSLS` : ''}</small></span><span>Target <b>{diff.target == null ? '—' : fmt.format(diff.target)}</b></span>{diff.source && <small className="result-source">{diff.source}</small>}</summary>
        <div className="sample"><p>Target sebelumnya {diff.before == null ? '—' : fmt.format(diff.before)}{diff.newCodes.length ? ` · Wilayah baru ${diff.newCodes.join(', ')}` : ''}{diff.gone.length ? ` · Wilayah hilang ${diff.gone.join(', ')}` : ''}</p>
          {diff.samples.map(row => <p key={row.code}><b>{row.name}</b> {Object.entries(row.values).map(([key, value]) => `${key} ${value ?? '—'}`).join(' · ')}</p>)}</div>
      </details>)}</div>}
      {job?.collection?.map(item => <p className="empty-inline" key={item.date}>Backup/Split · {conditionDate(item.date)}{item.time && ` · ${item.time} WIB`} · {item.count} wilayah</p>)}
      {job?.status === 'ready' && !closed && <form className="form-stack confirmation" onSubmit={commit}>
        <p><Info size={16} /> Masukkan kata sandi akun untuk menerapkan hasil pemeriksaan ini.</p>
        {job.warnings.length > 0 && <label>Alasan menerima peringatan<input name="reason" required minLength={3} maxLength={300} /></label>}
        <label>Kata sandi konfirmasi<input type="password" name="password" autoComplete="current-password" required maxLength={200} /></label>
        <button className="button primary" disabled={busy}>{busy ? 'Menerapkan…' : 'Terapkan hasil unggahan'}</button>
      </form>}
    </section>}
    <section className="panel studio-panel">
      <div className="panel-heading"><h2>Riwayat unggahan</h2></div>
      <div className="job-list">{detail.jobs.length ? detail.jobs.map(item => <button type="button" aria-pressed={item.id === jobId} className={item.id === jobId ? 'selected' : ''} key={item.id} onClick={() => {
        if (item.id === jobId) return
        setError(''); setSuccess(''); setJob(undefined); setQuery({ tab: 'data', job: item.id })
      }}>
        <span><b>{conditionDate(item.date)} · {item.time} WIB</b><small>{Object.values(item.files).join(', ')}</small></span><span className="pill">{item.status === 'ready' ? 'Siap' : item.status === 'published' ? 'Tersimpan' : ['uploaded', 'validating'].includes(item.status) ? 'Memeriksa' : 'Perlu koreksi'}</span>
      </button>) : <p className="empty-inline">Belum ada pekerjaan unggahan.</p>}</div>
    </section>
    </div>
  </div>
}
