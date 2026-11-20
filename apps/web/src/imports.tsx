import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { ArrowDown, FileSpreadsheet, Info, Plus, Settings2 } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import type { Dataset, Definition, UploadMapping } from '../../../packages/contracts/index'
import { analysisFormat, type CsvAnalysisStage, type GeminiStatus } from '../../../packages/contracts/csv-analysis'
import { ApiError, api, conditionDate, currentWib, fmt, requestCsvAnalysis, type CsvSuggestion, type DashboardDetail, type ImportJob } from './api'
import { Alert } from './common'
import { SourceWorkbench } from './source-workbench'

const tabularFormats = '.csv,.tsv,.xlsx,.xls,.json'
const csvUnits = { count: 'Hitungan', number: 'Angka', percent: 'Persen', category: 'Kategori' }
const geminiLabels: Record<GeminiStatus, string> = { unconfigured: 'Belum dikonfigurasi', configured: 'Belum dicek', ready: 'Terhubung', unavailable: 'Koneksi bermasalah' }
const analysisStages: Record<CsvAnalysisStage, { percent: number; message: string }> = {
  reading: { percent: 20, message: 'Membaca struktur berkas…' },
  mapping: { percent: 45, message: 'Menunggu usulan pemetaan dari Gemini…' },
  validating: { percent: 85, message: 'Memeriksa usulan dengan data sumber…' },
}
type CsvProgress = { label: string; percent: number; message: string }

function CsvAnalysisDialog({ progress, open, onClose }: { progress: CsvProgress; open: boolean; onClose: () => void }) {
  const element = useRef<HTMLDialogElement>(null)
  const heading = useId()
  const stage = useId()
  useEffect(() => {
    const dialog = element.current
    if (open && !dialog?.open) dialog?.showModal()
    if (!open && dialog?.open) dialog.close()
  }, [open])

  return <dialog ref={element} className="csv-progress-dialog" aria-labelledby={heading} onClose={onClose}>
    <h2 id={heading}>{progress.label}</h2>
    <div className="csv-progress-status">
      <p id={stage} role="status">{progress.message}</p>
      <strong aria-hidden="true">{progress.percent}%</strong>
    </div>
    <progress value={progress.percent} max={100} aria-label="Progres analisis berkas" aria-describedby={stage} />
    <div className="actions">
      <button type="button" className={progress.percent === 100 ? 'button primary' : 'button'} onClick={() => element.current?.close()}>
        {progress.percent === 100 ? 'Lihat usulan' : 'Sembunyikan'}
      </button>
    </div>
  </dialog>
}

export function UploadPanel({ detail, onUpdate, draftPending }: { detail: DashboardDetail; onUpdate: () => void; draftPending: boolean }) {
  const [query, setQuery] = useSearchParams()
  const [date, setDate] = useState(() => currentWib()[0])
  const [time, setTime] = useState(() => currentWib()[1])
  const [workbook, setWorkbook] = useState(detail.template === 'susenas')
  const [auto, setAuto] = useState(detail.template === 'pes')
  const [batch, setBatch] = useState<File[]>([])
  const [files, setFiles] = useState<Record<string, File | undefined>>({})
  const [inputRevision, setInputRevision] = useState(0)
  const [mappings, setMappings] = useState(detail.mappings)
  const grains = useRef(new Map(detail.draft.datasets.map(dataset => [dataset.id, dataset.grain])))
  const [selectedJob, setJob] = useState<ImportJob>()
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [busy, setBusy] = useState(false)
  const [analysis, setAnalysis] = useState<CsvProgress>()
  const [aiStatus, setAiStatus] = useState<GeminiStatus>()
  const [checkingAi, setCheckingAi] = useState(false)
  const [showAnalysis, setShowAnalysis] = useState(false)
  const reviewRef = useRef<HTMLElement>(null)
  const [aiError, setAiError] = useState('')
  const [suggestion, setSuggestion] = useState<{ slot: string; result: CsvSuggestion }>()
  const [applied, setApplied] = useState<{ slot: string; designed: boolean }>()
  const [addingSource, setAddingSource] = useState(false)
  const [sourceError, setSourceError] = useState('')
  const [idempotency] = useState(() => crypto.randomUUID())
  const closed = detail.activityStatus === 'closed'
  const custom = detail.template === 'custom'
  const physical = detail.draft.datasets.filter(dataset => !dataset.join)
  const slots = workbook ? [{ id: 'workbook', label: 'Workbook Susenas–Seruti', fields: [] }] : [
    ...physical, ...(detail.template === 'pes' ? [{ id: 'sls_detail', label: 'Rincian SSLS (opsional)', fields: [] }] : []),
  ]
  const jobId = query.get('tab') === 'data' ? query.get('job') : null
  const job = selectedJob?.id === jobId ? selectedJob : undefined
  const processing = job?.status === 'uploaded' || job?.status === 'validating'
  const suggesting = Boolean(analysis && analysis.percent < 100)
  const aiSlots = auto || workbook ? [] : slots.flatMap(slot => {
    const format = slot.id === 'sls_detail' ? undefined : analysisFormat(files[slot.id]?.name ?? '')
    return format ? [{ ...slot, format }] : []
  })
  const health = detail.aiAvailable ? aiStatus ?? (detail.aiHealth === 'unconfigured' ? undefined : detail.aiHealth) ?? 'configured' : 'unconfigured'
  const aiEnabled = detail.aiAvailable && health !== 'unconfigured'
  const analysisHint = !aiEnabled ? 'Gemini belum tersedia di server ini. Pemetaan manual tetap bisa digunakan.' :
    auto || workbook ? 'Untuk menganalisis CSV atau Excel dengan Gemini, pilih satu berkas per dataset.' :
    aiSlots.length ? 'Gemini menerima struktur kolom yang disaring dan tipe nilainya. Isi baris dan angka diproses di Pansus.' :
    'Pilih berkas CSV atau Excel (XLSX/XLS) pada salah satu sumber untuk memulai analisis.'
  const savedInputs = detail.savedInputs
  const matchingInputs = savedInputs?.date === date && savedInputs.time === time ? savedInputs : undefined
  const updatedFiles = slots.some(slot => files[slot.id])
  const missingFiles = slots.some(slot => slot.id !== 'sls_detail' && !files[slot.id] && !matchingInputs?.files[slot.id])
  const usesSaved = slots.some(slot => !files[slot.id] && matchingInputs?.files[slot.id])
  const canReapply = matchingInputs?.schemaChanged && !missingFiles
  const tableSources = auto ? [
    ...batch.map((file, index) => ({ id: `auto_${index + 1}`, label: `Ekspor PES ${index + 1}`, file })),
    ...(files.sls_detail ? [{ id: 'sls_detail', label: 'Rincian SSLS', file: files.sls_detail }] : []),
  ] : slots.flatMap(slot => {
    const dataset = physical.find(item => item.id === slot.id)
    const file = files[slot.id]
    return file || dataset && detail.preview?.data[slot.id] ? [{ id: slot.id, label: slot.label, file, dataset }] : []
  })

  useEffect(() => {
    const nextGrains = new Map(detail.draft.datasets.map(dataset => [dataset.id, dataset.grain]))
    const changed = [...grains.current].filter(([id, grain]) => nextGrains.get(id) !== grain).map(([id]) => id)
    grains.current = nextGrains
    if (!changed.length) return
    setMappings(current => {
      const next = { ...current }
      for (const id of changed) {
        if (detail.mappings[id]) next[id] = detail.mappings[id]
        else delete next[id]
      }
      return next
    })
  }, [detail.draft.datasets, detail.mappings])

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

  async function addSource(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const name = String(new FormData(event.currentTarget).get('sourceName') ?? '').trim()
    if (!name || draftPending || detail.draft.datasets.length >= 8) return
    const source: Dataset = {
      id: `sumber_${crypto.randomUUID().slice(0, 8)}`,
      label: name,
      grain: 'district',
      fields: [{ id: 'nilai', label: 'Nilai', unit: 'count', public: false, nullable: true, aliases: [] }],
    }
    setBusy(true); setSourceError('')
    try {
      await api(`/admin/dashboards/${detail.id}/draft`, 'PATCH', {
        expectedRevision: detail.draftRevision,
        definition: { ...detail.draft, datasets: [...detail.draft.datasets, source] },
      })
      setAddingSource(false)
      setSuggestion(undefined)
      onUpdate()
    } catch (failure) { setSourceError((failure as Error).message) }
    finally { setBusy(false) }
  }

  async function saveFromTable(definition: Definition, nextMappings?: Record<string, UploadMapping>) {
    setBusy(true)
    try {
      await api(`/admin/dashboards/${detail.id}/draft`, 'PATCH', { definition, expectedRevision: detail.draftRevision, mappings: nextMappings })
      if (nextMappings) setMappings(current => ({ ...current, ...nextMappings }))
      setSuggestion(undefined)
      onUpdate()
    } finally { setBusy(false) }
  }

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

  async function checkAi() {
    setCheckingAi(true)
    try {
      const { status } = await api<{ status: GeminiStatus }>(`/admin/dashboards/${detail.id}/ai-status`, 'POST')
      setAiStatus(status)
      if ((status !== 'unconfigured') !== detail.aiAvailable) onUpdate()
    }
    catch { setAiStatus('unavailable') }
    finally { setCheckingAi(false) }
  }

  async function analyzeFile(slot: string) {
    const file = files[slot]
    if (!file || suggesting || !aiEnabled) return
    const source = aiSlots.find(item => item.id === slot)
    if (!source) return
    const label = `Analisis ${source.format} ${source.label}`
    setAnalysis({ label, percent: 0, message: 'Mengirim berkas untuk dianalisis…' })
    setShowAnalysis(true); setAiError(''); setSuggestion(undefined); setApplied(undefined)
    const body = new FormData()
    body.append('file', file)
    body.append('slot', slot)
    if (source.format === 'Excel' && mappings[slot]?.sheet) body.append('sheet', mappings[slot].sheet)
    if (mappings[slot]?.headerRow) body.append('headerRow', String(mappings[slot].headerRow))
    if (mappings[slot]?.stopRow) body.append('stopRow', String(mappings[slot].stopRow))
    const dataset = detail.draft.datasets.find(item => item.id === slot)
    if (dataset?.grain === 'person' && mappings[slot]?.region) body.append('identity', mappings[slot].region)
    try {
      const result = await requestCsvAnalysis(detail.id, body, stage => {
        const progress = analysisStages[stage]
        setAnalysis(current => ({ label, percent: Math.max(current?.percent ?? 0, progress.percent), message: progress.message }))
      })
      setSuggestion({ slot, result })
      setAiStatus('ready')
      setAnalysis({ label, percent: 100, message: 'Analisis selesai. Usulan siap ditinjau.' })
    } catch (failure) {
      const error = failure as Error
      if (error instanceof ApiError && error.code === 'AI_DISABLED') setAiStatus('unconfigured')
      else if (error.name === 'TimeoutError' || error instanceof ApiError && error.status >= 500) setAiStatus('unavailable')
      setAiError(error.name === 'TimeoutError' ? 'Analisis berkas terlalu lama. Coba lagi.' : error.message)
      setShowAnalysis(false)
      setAnalysis(undefined)
      requestAnimationFrame(() => reviewRef.current?.focus())
    }
  }

  async function applySuggestion() {
    if (!suggestion) return
    const { slot, result } = suggestion
    setBusy(true); setAiError(''); setApplied(undefined)
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
      setApplied({ slot, designed: Boolean(result.definition) })
      setSuggestion(undefined)
    } catch (failure) { setAiError((failure as Error).message) }
    finally { setBusy(false) }
  }
  async function preview(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(''); setSuccess('')
    const body = new FormData()
    body.append('date', date); body.append('time', time); body.append('mappings', JSON.stringify(auto ? {} : mappings))
    if (usesSaved && matchingInputs) body.append('reuseSnapshot', matchingInputs.snapshotId)
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
      const result = await api<{ snapshotId: string; releaseId: string | null }>(`/admin/imports/${job.id}/commit`, 'POST', { proof, hash: job.hash, idempotencyKey: idempotency, reason: fields.get('reason') || undefined })
      setJob({ ...job, status: 'published' })
      setSuccess(!result.releaseId ? 'Data tersimpan pada draf. Tinjau sebagai pembaca, lalu terbitkan.' :
        result.releaseId === detail.activeRelease ? 'Data tersimpan. Tinjau hasilnya di pratinjau Studio.' :
          'Pembaruan tersimpan. Periksa kondisi data pada tautan pembaca.')
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
      {custom && <section className="upload-sources form-stack" aria-label="Sumber data">
        <div className="editor-fields-heading">
          <div><h3>{slots.length} sumber data</h3><p className="muted-text">Sediakan satu berkas per sumber untuk kondisi baru.</p></div>
          {detail.canManage && <button type="button" className="button" aria-expanded={addingSource} disabled={closed || busy || suggesting || processing || draftPending || detail.draft.datasets.length >= 8} onClick={() => { setAddingSource(!addingSource); setSourceError('') }}><Plus size={16} /> Tambah sumber data</button>}
        </div>
        {detail.canManage && detail.draft.datasets.length >= 8 && <p className="muted-text">Batas delapan sumber dan tabel hasil per dashboard tercapai.</p>}
        {addingSource && <form className="form-stack" onSubmit={addSource}>
          <label>Nama sumber baru<input name="sourceName" type="text" required maxLength={100} placeholder="Misalnya Progres pencacahan" autoFocus /></label>
          <button className="button primary" disabled={closed || busy || suggesting || processing || draftPending}>Simpan sumber</button>
        </form>}
        {sourceError && <Alert>{sourceError}</Alert>}
      </section>}
      <form className="form-stack" onSubmit={preview}>
        <fieldset key={inputRevision} disabled={closed || busy || suggesting} className="form-stack bare-fieldset">
          <div className="form-columns"><label>Tanggal kondisi<input type="date" required value={date} onChange={event => setDate(event.target.value)} /></label><label>Jam kondisi (WIB)<input type="time" required value={time} onChange={event => setTime(event.target.value)} /></label></div>
          {savedInputs && !matchingInputs && <button type="button" className="button subtle" onClick={() => { setDate(savedInputs.date); setTime(savedInputs.time) }}>Pakai kondisi terakhir · {conditionDate(savedInputs.date)} · {savedInputs.time} WIB</button>}
          {matchingInputs && <p className="muted-text">{canReapply ? 'Periksa ulang berkas tersimpan untuk menerapkan perubahan kolom atau penggabungan pada kondisi ini.' : 'Berkas tersimpan dapat digunakan kembali pada kondisi ini. Pilih berkas baru untuk sumber yang ingin ditambah atau diganti.'}</p>}
          {detail.template === 'susenas' && <label>Profil sumber<select value={workbook ? 'workbook' : 'separate'} onChange={event => { setWorkbook(event.target.value === 'workbook'); setSuggestion(undefined) }}><option value="workbook">Satu workbook Susenas dan Seruti</option><option value="separate">Berkas terpisah per dataset</option></select></label>}
          {detail.template === 'pes' && <label>Cara memilih berkas<select value={auto ? 'auto' : 'manual'} onChange={event => { setAuto(event.target.value === 'auto'); setSuggestion(undefined) }}><option value="auto">Deteksi otomatis</option><option value="manual">Pilih per dataset{detail.aiAvailable ? ' (manual atau Gemini)' : ''}</option></select></label>}
          <section className="form-stack csv-assist" aria-label="Bantuan Gemini">
            <div className="ai-panel-heading">
              <h3>Bantuan Gemini</h3>
              <span className="ai-health" data-status={health} role="status">{suggesting ? 'Sedang menganalisis' : checkingAi ? 'Memeriksa koneksi…' : geminiLabels[health]}</span>
            </div>
            <p>{analysisHint}</p>
            {health === 'unavailable' && <p>Coba cek koneksi kembali atau lanjutkan dengan pemetaan manual.</p>}
            <div className="actions">
              {aiSlots.length ? aiSlots.map(slot => <button className="button" type="button" key={slot.id} onClick={() => void analyzeFile(slot.id)} disabled={!aiEnabled || processing || draftPending}>Analisis {slot.format} {slot.label}</button>) :
                <button className="button" type="button" disabled>Analisis berkas</button>}
              {detail.aiAvailable && (auto || workbook) && <button className="text-button" type="button" onClick={() => { setAuto(false); setWorkbook(false); setSuggestion(undefined) }}>Pilih berkas per dataset</button>}
              <button className="text-button" type="button" onClick={() => void checkAi()} disabled={checkingAi}>Cek koneksi Gemini</button>
            </div>
          </section>
          {auto && <div className="form-stack">
            <label className="file-slot">
              <FileSpreadsheet size={20} aria-hidden="true" /><span><b>Tiga ekspor progres PES</b><small>Pilih ringkasan SLS dan dua ekspor assignment sekaligus. Urutan bebas. CSV, TSV, Excel, atau JSON.</small></span>
              <input aria-label="Tiga ekspor progres PES" aria-describedby="batch-selection" type="file" multiple accept={tabularFormats} onChange={event => setBatch(Array.from(event.target.files ?? []))} />
            </label>
            <div id="batch-selection" className="selection-summary" aria-live="polite">{batch.length}/3 berkas dipilih
              {!!batch.length && <ul>{batch.map((file, index) => <li key={index}>{file.name}</li>)}</ul>}
            </div>
          </div>}
          {slots.filter(slot => !auto || slot.id === 'sls_detail').map(slot => {
            const savedFile = matchingInputs?.files[slot.id]
            const hint = savedFile ? `Tersimpan · ${savedFile}` : workbook ? 'Pilih workbook XLSX atau XLS' : slot.id === 'sls_detail' ? 'CSV SSLS atau Excel Sheet9' : 'Pilih CSV, TSV, Excel, atau JSON'
            return <label key={slot.id} className="file-slot"><FileSpreadsheet size={20} aria-hidden="true" /><span><b>{slot.label}</b><small>{files[slot.id]?.name || hint}</small></span><input aria-label={slot.label} type="file" accept={workbook ? '.xlsx,.xls' : tabularFormats} required={slot.id !== 'sls_detail' && !files[slot.id] && !savedFile} onChange={event => {
            const file = event.target.files?.[0]
            setFiles(current => ({ ...current, [slot.id]: file }))
            if (suggestion?.slot === slot.id) setSuggestion(undefined)
            setApplied(undefined); setAiError('')
          }} /></label>})}
          {!auto && <details className="mapping"><summary><Settings2 size={16} aria-hidden="true" /> Pemetaan berkas</summary><p>Tentukan letak judul dan kolom jika berkas perlu dipetakan secara manual.</p>
            {slots.map(slot => <details className="mapping-slot" key={slot.id}><summary>{slot.label}</summary>
              <div className="form-stack mapping-fields">
                <fieldset className="form-stack mapping-group"><legend>Pengaturan berkas</legend>
                  <label>Nama lembar<input value={mappings[slot.id]?.sheet ?? ''} onChange={event => setMapping(slot.id, 'sheet', event.target.value)} placeholder="Otomatis" /></label>
                  <label>Baris judul<input type="number" min="1" value={mappings[slot.id]?.headerRow ?? ''} onChange={event => setMapping(slot.id, 'headerRow', event.target.value)} placeholder="Otomatis" /></label>
                  <label>Baris terakhir<input type="number" min="2" value={mappings[slot.id]?.stopRow ?? ''} onChange={event => setMapping(slot.id, 'stopRow', event.target.value)} placeholder="Otomatis" /></label>
                  {!workbook && slot.id !== 'sls_detail' && <label>Jalur daftar JSON<input value={mappings[slot.id]?.jsonPath ?? ''} onChange={event => setMapping(slot.id, 'jsonPath', event.target.value)} placeholder="Contoh data.wilayah" /></label>}
                </fieldset>
                {!workbook && slot.id !== 'sls_detail' && <fieldset className="form-stack mapping-group"><legend>Pemetaan kolom</legend>
                  <label>{detail.draft.datasets.find(item => item.id === slot.id)?.grain === 'person' ? 'Judul kolom nama atau kode petugas' : 'Judul kolom wilayah'}<input value={mappings[slot.id]?.region ?? ''} onChange={event => setMapping(slot.id, 'region', event.target.value)} placeholder="Otomatis" /></label>
                  {slot.fields.filter(field => field.enabled !== false && !field.derived && !field.formula).map(field => <label key={field.id}>{field.label}<input value={mappings[slot.id]?.columns?.[field.id] ?? ''} onChange={event => setColumn(slot.id, field.id, event.target.value)} placeholder="Judul sumber atau jalur JSON" /></label>)}
                </fieldset>}
              </div>
            </details>)}
          </details>}
          {draftPending && <p className="muted-text" role="status">Pemeriksaan tersedia setelah draf tersimpan.</p>}
          {!!tableSources.length && <a href="#tabel-sumber" className="text-button source-jump">Lihat tabel sumber <ArrowDown size={14} aria-hidden="true" /></a>}
          <button className="button primary" disabled={draftPending || processing || (auto ? batch.length !== 3 : missingFiles || !updatedFiles && !canReapply)}>{busy || processing ? 'Memproses…' : 'Periksa unggahan'}</button>
        </fieldset>
      </form>
    </section>
    <div className="import-review">
    {(suggesting || aiError || suggestion || applied) && <section ref={reviewRef} tabIndex={-1} className="panel studio-panel ai-suggestion" aria-label="Usulan Gemini">
      <div className="panel-heading"><h2>Usulan Gemini</h2></div>
      {suggesting && !showAnalysis && analysis && <div className="form-stack">
        <p role="status">{analysis.percent}% · {analysis.message}</p>
        <button type="button" className="button" onClick={() => setShowAnalysis(true)}>Lihat progres analisis</button>
      </div>}
      {aiError && <Alert>{aiError}</Alert>}
      {applied && <Alert tone="success">{applied.designed ? 'Usulan disimpan ke draf.' : 'Usulan dimasukkan ke pemetaan.'}
        {detail.canManage && <div className="actions"><button className="text-button" type="button" onClick={() => setQuery({ tab: 'editor', section: 'fields', source: applied.slot })}>Atur kolom sumber</button></div>}
      </Alert>}
      {suggestion && <div className="form-stack">
        <p>{suggestion.result.model} · {suggestion.result.rows} {suggestion.result.grain === 'person' ? 'petugas' : 'wilayah'} diperiksa{suggestion.result.mapping.sheet && ` · Lembar ${suggestion.result.mapping.sheet}`} · Baris judul {suggestion.result.mapping.headerRow}</p>
        <div className="table-scroll source-scroll" tabIndex={0} role="region" aria-label="Pemetaan yang disarankan"><table>
          <thead><tr><th scope="col">Kolom</th><th scope="col">Judul sumber</th><th scope="col">Tipe</th></tr></thead>
          <tbody><tr><th scope="row">{suggestion.result.grain === 'person' ? 'Identitas petugas' : 'Wilayah'}</th><td>{suggestion.result.mapping.region}</td><td>Kunci</td></tr>
          {suggestion.result.fields.map(field => <tr key={field.id}><th scope="row">{field.label}</th><td>{suggestion.result.mapping.columns?.[field.id]}</td>
            <td>{csvUnits[field.unit]}{field.scale === 'fraction' ? ' (0–1)' : field.scale === 'percentage' ? ' (0–100)' : ''}{!field.public ? ' · Privat' : ''}</td></tr>)}</tbody>
        </table></div>
        {suggestion.result.definition && <p>Usulan mengganti kolom dan komponen untuk sumber {slots.find(slot => slot.id === suggestion.slot)?.label}.</p>}
        {Boolean(suggestion.result.recommendations?.length) && <div className="form-stack"><h3>Rekomendasi tampilan</h3>{suggestion.result.recommendations?.map(message => <p key={message}>{message}</p>)}</div>}
        {suggestion.result.warnings.map(message => <p key={message}>{message}</p>)}
        <div className="actions">
          <button type="button" className="button primary" disabled={busy || closed || processing || draftPending} onClick={() => void applySuggestion()}>{suggestion.result.definition ? 'Terapkan ke draf' : 'Gunakan pemetaan'}</button>
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
      {!!job?.differences.length && <div className="import-results">{job.differences.map(diff => {
        const dataset = detail.draft.datasets.find(item => item.id === diff.id)
        const person = dataset?.grain === 'person'
        return <details className="result-card" key={diff.id}>
          <summary><span><b>{dataset?.label ?? diff.id}</b><small>{diff.rows} {person ? 'petugas' : 'wilayah'}{diff.detailed ? ` · ${diff.detailed} rincian SSLS` : ''}</small></span>{!person && <span>Target <b>{diff.target == null ? '—' : fmt.format(diff.target)}</b></span>}{diff.source && <small className="result-source">{diff.source}</small>}</summary>
          <div className="sample">{person ? <p>{diff.newCodes.length} petugas baru · {diff.gone.length} petugas keluar dari data</p> :
            <p>Target sebelumnya {diff.before == null ? '—' : fmt.format(diff.before)}{diff.newCodes.length ? ` · Wilayah baru ${diff.newCodes.join(', ')}` : ''}{diff.gone.length ? ` · Wilayah hilang ${diff.gone.join(', ')}` : ''}</p>}
            {diff.samples.map(row => <p key={row.code}><b>{row.name}</b> {Object.entries(row.values).map(([key, value]) => `${key} ${value ?? '—'}`).join(' · ')}</p>)}</div>
        </details>
      })}</div>}
      {job?.collection?.map(item => <p className="empty-inline" key={item.date}>Backup/Split · {conditionDate(item.date)}{item.time && ` · ${item.time} WIB`} · {item.count} wilayah</p>)}
      {job?.status === 'ready' && !closed && <form className="form-stack confirmation" onSubmit={commit}>
        <p><Info size={16} /> Masukkan kata sandi akun untuk menerapkan hasil pemeriksaan ini.</p>
        {job.warnings.length > 0 && <label>Alasan menerima peringatan<input name="reason" required minLength={3} maxLength={300} /></label>}
        <label>Kata sandi konfirmasi<input type="password" name="password" autoComplete="current-password" required maxLength={200} /></label>
        <button className="button primary" disabled={busy || draftPending}>{busy ? 'Menerapkan…' : 'Terapkan hasil unggahan'}</button>
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
    {(tableSources.length > 0 || detail.draft.datasets.some(dataset => dataset.join)) && <SourceWorkbench detail={detail} sources={tableSources} mappings={mappings}
      locked={closed || busy || suggesting || processing || draftPending} save={saveFromTable} />}
    {analysis && <CsvAnalysisDialog progress={analysis} open={showAnalysis} onClose={() => {
      setShowAnalysis(false)
      if (analysis.percent === 100) reviewRef.current?.focus()
    }} />}
  </div>
}
