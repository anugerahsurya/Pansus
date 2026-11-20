import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowDownToLine, ArrowRight, ArrowUpRight, BarChart3, CalendarDays, ClipboardList, ExternalLink, FileSpreadsheet, LayoutTemplate, MapPin, Search, Smartphone } from 'lucide-react'
import type { Report, TemplateId } from '../../../packages/contracts/index'
import { DashboardWidgets, Hero } from '../../../packages/widgets/index'
import { api, conditionDate, type Account, type CatalogItem, type Sorts, type TemplateInfo } from './api'
import { Alert, Breadcrumb, Loading, useAuth, useData } from './common'
import { Select } from './select'

export function Reader({ demo = false }: { demo?: boolean }) {
  const { user } = useAuth()
  const params = useParams()
  const slug = demo ? 'progres-lapangan-pes' : params.slug!
  const [query, setQuery] = useSearchParams()
  const release = query.get('release')
  const request = useData<Report>(`/d/${slug}${release ? `?release=${encodeURIComponent(release)}` : ''}`, slug)
  const [sorts, setSorts] = useState<Sorts>({})
  const [job, setJob] = useState<{ id: string; status: string; error?: string; pages?: number }>()
  const [exportError, setExportError] = useState('')
  const [busy, setBusy] = useState(false)
  const [includeDetail, setIncludeDetail] = useState(false)
  const report = request.data
  useEffect(() => { setJob(undefined); setExportError('') }, [slug, release])
  useEffect(() => {
    if (!job || !['queued', 'processing'].includes(job.status)) return
    const timeout = window.setTimeout(() => api<typeof job>(`/jobs/${job.id}`).then(setJob, error => setExportError(error.message)), 1200)
    return () => window.clearTimeout(timeout)
  }, [job])
  async function startExport() {
    if (!report || request.loading) return
    setBusy(true)
    setExportError('')
    try { setJob(await api(`/dashboards/${report.id}/exports`, 'POST', { releaseId: report.currentRelease, sort: sorts, includeDetail })) }
    catch (error) { setExportError((error as Error).message) }
    finally { setBusy(false) }
  }
  return <>
    {demo && <Breadcrumb parts={[user ? { label: 'Portal pembaca', to: '/katalog' } : 'Dashboard terbit', 'Ringkasan contoh']} />}
    {request.loading && !report && <Loading />}
    {request.error && <div className="panel state-panel"><Alert>{request.error}</Alert><div className="actions"><button className="button" onClick={request.reload}>Coba lagi</button><Link className="button" to={'/masuk?' + new URLSearchParams({ lanjut: `/d/${slug}${release ? '?' + new URLSearchParams({ release }) : ''}` })}>Masuk dengan akun undangan</Link>{user && <Link to="/katalog" className="button subtle">Buka katalog kegiatan</Link>}</div></div>}
    {report && <>
      <div className="report-toolbar">
        <div className="report-context"><span className="tag"><i />{report.demo ? 'Dashboard contoh' : report.activityStatus === 'closed' ? 'Kegiatan selesai' : 'Kegiatan berjalan'}</span></div>
        <div className="report-actions">
          <label className="select-button"><CalendarDays size={16} /><span className="sr-only">Kondisi data</span><Select className="react-select-inline" ariaLabel="Kondisi data" value={release ?? report.currentRelease} options={report.history.map(item => ({ value: item.id, label: `${conditionDate(item.date)} · ${item.time} WIB${report.history.some(other => other.id !== item.id && other.date === item.date && other.time === item.time) ? ` · v${item.version}` : ''}` }))} onChange={value => setQuery({ release: value })} /></label>
          {job?.status === 'ready' && !request.loading ? <a className="button primary" href={`/api/exports/${job.id}/download`}><ArrowDownToLine size={17} /> Unduh {job.pages && job.pages > 1 ? 'ZIP laporan' : 'PNG'}</a>
            : <button className="button primary" onClick={startExport} disabled={request.loading || busy || !exportError && (job?.status === 'queued' || job?.status === 'processing')}><ArrowDownToLine size={17} /> {busy || !exportError && (job?.status === 'queued' || job?.status === 'processing') ? 'Menyiapkan PNG…' : 'Unduh PNG'}</button>}
        </div>
      </div>
      <span role="status" className="sr-only">{request.loading ? 'Memuat kondisi data…' : ''}</span>
      {Object.values(report.data).some(dataset => dataset.detail?.length) && <label className="check export-choice"><input type="checkbox" checked={includeDetail} onChange={event => { setIncludeDetail(event.target.checked); setJob(undefined) }} /> Sertakan rincian sampai SLS dalam unduhan <small>({Object.values(report.data).reduce((total, dataset) => total + (dataset.detail?.length ?? 0), 0)} baris tambahan)</small></label>}
      {(job?.error || exportError) && <Alert>{exportError || job?.error}</Alert>}
      <Hero report={report} />
      <DashboardWidgets report={report} sorts={sorts} onSort={(id, sort) => {
        setSorts(current => { const next = { ...current }; if (sort) next[id] = sort; else delete next[id]; return next })
        if (job?.status === 'ready') setJob(undefined)
      }} />
      <footer className="page-footer"><span>{report.demo ? 'Data sintetis untuk demonstrasi.' : report.definition.satker}</span>{user && <Link to="/katalog">Lihat katalog kegiatan <ArrowUpRight size={14} /></Link>}</footer>
    </>}
  </>
}

export function PrintReport() {
  const { ticket } = useParams()
  const { data, error } = useData<{ report: Report; sort?: Sorts }>(`/internal/render/${ticket}`)
  if (error) return <Alert>{error}</Alert>
  if (!data) return <Loading />
  return <main className="print-report" data-report-ready><DashboardWidgets report={data.report} sorts={data.sort} print /></main>
}

export function ShareExchange() {
  const navigate = useNavigate()
  const [error, setError] = useState('')
  useEffect(() => {
    const fragment = window.location.hash.slice(1)
    window.history.replaceState(null, '', '/bagikan')
    const [slug, secret] = fragment.split('.')
    if (!slug || !secret) { setError('Tautan tidak lengkap.'); return }
    api<{ slug: string }>('/share/exchange', 'POST', { slug, secret }).then(data => navigate(`/${data.slug}`, { replace: true }), error => setError(error.message))
  }, [navigate])
  return <>{error ? <Alert>{error}</Alert> : <Loading />}</>
}

export function Catalog() {
  const { data, error, loading, reload } = useData<CatalogItem[]>('/catalog')
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('all')
  const search = query.trim().toLocaleLowerCase('id-ID')
  const items = data?.filter(item => (status === 'all' || item.activityStatus === status) && [item.title, item.satker, item.period].some(item => item.toLocaleLowerCase('id-ID').includes(search))) ?? []
  return <>
    <Breadcrumb parts={[{ label: 'Portal pembaca', to: '/' }, 'Katalog kegiatan']} />
    <div className="page-heading"><div><h1>Katalog kegiatan</h1><p>Laporan kegiatan yang diterbitkan untuk publik.</p></div></div>
    <div className="catalog-tools"><label className="search"><Search size={18} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Cari nama kegiatan, satker, atau periode…" aria-label="Cari kegiatan" /></label><Select ariaLabel="Status kegiatan" value={status} options={[{ value: 'all', label: 'Semua status' }, { value: 'active', label: 'Berjalan' }, { value: 'closed', label: 'Selesai' }]} onChange={setStatus} /></div>
    {loading && !data && <Loading />}{error && <Alert>{error} <button className="text-button" onClick={reload}>Coba lagi</button></Alert>}
    {!loading && !error && !items.length && <div className="panel state-panel">Tidak ada kegiatan yang cocok.</div>}
    <div className="catalog-grid">{items.map(item => <article className="panel catalog-card" key={item.slug}>
      <div className={`catalog-banner theme-${item.theme}`}><BarChart3 size={35} /><span className="catalog-badge">{item.demo ? 'Data sintetis' : item.activityStatus === 'active' ? 'Berjalan' : 'Selesai'}</span></div>
      <div className="catalog-content"><span className="card-satker"><MapPin size={14} /> {item.satker}</span><h2>{item.title}</h2><p>{item.description}</p><div className="catalog-date"><CalendarDays size={16} /> {conditionDate(item.date)} · {item.time} WIB</div><Link className="button" to={`/${item.slug}`}>Buka dashboard <ArrowRight size={16} /></Link></div>
    </article>)}</div>
  </>
}

export function Templates() {
  const { data, error, loading } = useData<TemplateInfo[]>('/templates')
  const { user } = useAuth()
  const navigate = useNavigate()
  const [creating, setCreating] = useState<TemplateId>()
  const [failed, setFailed] = useState('')
  const [mobile, setMobile] = useState(false)
  async function useTemplate(id: TemplateId) {
    if (!user) { navigate(`/masuk?lanjut=${encodeURIComponent('/template')}`); return }
    setFailed(''); setCreating(id)
    try { const result = await api<{ id: string }>('/admin/dashboards', 'POST', { template: id }); navigate(`/studio/${result.id}`) }
    catch (error) { setFailed((error as Error).message) }
    finally { setCreating(undefined) }
  }
  return <>
    <Breadcrumb parts={[{ label: 'Portal pembaca', to: '/' }, 'Galeri template']} />
    <div className="page-heading"><div><h1>Galeri template</h1><p>Pilih contoh sesuai sumber data atau susun dashboard sendiri.</p></div><button className="button" aria-pressed={mobile} onClick={() => setMobile(!mobile)}>{mobile ? <LayoutTemplate size={17} /> : <Smartphone size={17} />}{mobile ? 'Pratinjau desktop' : 'Pratinjau ponsel'}</button></div>
    {loading && !data && <Loading />}{(error || failed) && <Alert>{error || failed}</Alert>}
    <div className="catalog-grid templates-grid">{data?.map(item => <article className="panel catalog-card" key={item.id}>
      <div className={`template-banner theme-${item.definition.theme}`}><div className={'mini-dashboard' + (mobile ? ' mini-mobile' : '')} aria-hidden="true"><div /><div className="mini-metrics"><i /><i /><i /></div><div className="mini-chart"><i /><i /><i /></div></div></div>
      <div className="catalog-content"><h2>{item.name}</h2><p>{item.description}</p>
        {item.id !== 'custom' && <><div className="example-links"><Link to={item.id === 'pes' ? '/d/progres-lapangan-pes' : '/d/pengolahan-susenas-seruti'}>Lihat contoh <ExternalLink size={13} /></Link></div>
        <details className="example-downloads"><summary><FileSpreadsheet size={15} /> Berkas contoh dua hari</summary>{[0, 1].map(day => <div key={day}><b>{day ? 'Hari H' : 'Hari H−1'}</b>{(item.id === 'pes' ? ['sls', 'nonub', 'ub', 'sls_detail'] : ['workbook']).map(slot => <a href={`/api/templates/${item.id}/examples/${day}/${slot}`} key={slot}>{slot === 'workbook' ? 'Workbook XLSX' : `${slot === 'nonub' ? 'Non-UB' : slot === 'sls_detail' ? 'Rincian SSLS' : slot.toUpperCase()} CSV`}</a>)}</div>)}</details></>}
        <button className="button primary" onClick={() => useTemplate(item.id)} disabled={!!creating}>{creating === item.id ? 'Membuat draf…' : item.id === 'custom' ? 'Susun sendiri' : 'Gunakan contoh'} <ArrowRight size={16} /></button>
      </div>
    </article>)}</div>
  </>
}

export function Login() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { setUser } = useAuth()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('')
    const fields = new FormData(event.currentTarget)
    try {
      const user = await api<Account>('/auth/login', 'POST', { email: fields.get('email'), password: fields.get('password') })
      setUser(user)
      const to = params.get('lanjut')
      const home = user.permissions.dashboards || user.role === 'operator' ? '/studio' : user.permissions.users ? '/pengguna' : '/katalog'
      navigate(to && /^\/(?:[a-z][a-z0-9/-]*)?(?:\?[^\\#]*)?$/i.test(to) ? to : home, { replace: true })
    } catch (error) { setError((error as Error).message) }
    finally { setBusy(false) }
  }
  return <div className="auth-container">
    <div className="panel login-panel"><span className="metric-icon"><ClipboardList size={22} /></span><h1>Masuk ke portal</h1><p>Gunakan akun pengelola, operator data, atau pembaca undangan.</p>
      {error && <Alert>{error}</Alert>}
      <form className="form-stack" onSubmit={submit}><label>Email<input type="email" name="email" autoComplete="username" required maxLength={100} placeholder="nama@bps.go.id" /></label>
      <label>Kata sandi<input type="password" name="password" autoComplete="current-password" required maxLength={200} /></label><button className="button primary" disabled={busy}>{busy ? 'Memeriksa…' : 'Masuk'} <ArrowRight size={17} /></button></form>
    </div>
  </div>
}

export function Guide() {
  return <><Breadcrumb parts={[{ label: 'Portal pembaca', to: '/' }, 'Panduan operator']} /><div className="page-heading"><div><h1>Panduan operator</h1><p>Mulai dari contoh dan terbitkan kondisi data pertama.</p></div></div><div className="panel prose"><ol>
    <li><b>Pilih template.</b> Buka galeri, coba dashboard, dan unduh dua hari data contoh.</li><li><b>Buat draf.</b> Masuk menggunakan akun satker. Salin template atau susun sendiri, lalu periksa judul, indikator, dan susunan komponen.</li>
    <li><b>Perbarui data.</b> Pilih tanggal dan jam kondisi dalam WIB. Untuk PES, pilih tiga ekspor sekaligus atau tetapkan berkas per dataset. Periksa sumber, wilayah, dan target sebelum menerapkan dengan konfirmasi kata sandi.</li><li><b>Terbitkan.</b> Pilih akses publik, tautan rahasia, atau undangan. Tautan publik tetap sama saat pembaruan harian berhasil.</li>
    <li><b>Bandingkan kondisi.</b> Pilih tanggal di halaman pembaca dan lihat delta H−1. Unduh PNG untuk menyimpan seluruh rincian wilayah.</li>
  </ol><Link className="button primary" to="/template">Buka galeri template <ArrowRight size={16} /></Link></div></>
}
