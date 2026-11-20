import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowRight, Check, CheckCircle2, ClipboardCheck, ExternalLink, Eye, FileUp, Globe, Link2, Lock, LogOut, Plus, Settings, Users } from 'lucide-react'
import type { ReleaseSummary, Visibility } from '../../../packages/contracts/index'
import { api, conditionDate, type DashboardDetail, type DashboardItem } from './api'
import { Alert, Breadcrumb, Loading, useAuth, useData } from './common'
import { Editor } from './editor'
import { UploadPanel } from './imports'
import { DraftPreview } from './preview'
import { Select } from './select'

export default function Studio() {
  const { user, setUser } = useAuth()
  const navigate = useNavigate()
  const { id } = useParams()
  const [error, setError] = useState('')
  async function logout() {
    try { await api('/auth/logout', 'POST'); setUser(null); navigate('/') }
    catch (error) { setError((error as Error).message) }
  }
  if (user === undefined) return <Loading />
  if (!user || (!user.permissions.dashboards && user.role !== 'operator')) return <>
    <Breadcrumb parts={['Studio pengelola']} /><div className="panel state-panel"><span className="metric-icon"><Lock size={22} /></span><h1>Studio pengelola</h1><p>Masuk dengan akun admin atau operator data untuk mengelola kegiatan.</p><Link className="button primary" to={`/masuk?lanjut=${encodeURIComponent(id ? `/studio/${id}` : '/studio')}`}>Masuk ke studio <ArrowRight size={16} /></Link></div>
  </>
  return <>{error && <Alert>{error}</Alert>}{id ? <Workspace id={id} key={id} /> : <DashboardList admin={user.permissions.dashboards} logout={logout} />}</>
}

function DashboardList({ admin, logout }: { admin: boolean; logout: () => void }) {
  const { data, error, loading, reload } = useData<DashboardItem[]>('/admin/dashboards')
  return <>
    <Breadcrumb parts={['Studio pengelola']} />
    <div className="page-heading"><div><h1>Studio pengelola</h1><p>Kelola draf, sumber data, dan akses laporan satker.</p></div><div className="actions"><button className="button subtle" onClick={logout}><LogOut size={16} /> Keluar</button>{admin && <Link to="/template" className="button primary"><Plus size={17} /> Buat dashboard</Link>}</div></div>
    {loading && !data && <Loading />}{error && <Alert>{error} <button className="text-button" onClick={reload}>Coba lagi</button></Alert>}
    {!loading && !error && !data?.length && <div className="panel state-panel"><span className="metric-icon"><ClipboardCheck size={21} /></span><h2>Belum ada dashboard</h2><p>{admin ? 'Salin template PES atau Susenas–Seruti untuk memulai.' : 'Dashboard muncul setelah admin memberi penugasan.'}</p>{admin && <Link to="/template" className="button primary">Pilih template <ArrowRight size={16} /></Link>}</div>}
    {!!data?.length && <div className="panel studio-list">{data.map(item => <Link className="studio-list-item" to={`/studio/${item.id}`} key={item.id}><span className="metric-icon"><ClipboardCheck size={20} /></span><span className="studio-list-name"><b>{item.title}</b><small>{item.activityStatus === 'closed' ? 'Selesai' : 'Berjalan'} · {item.archivedAt ? 'Diarsipkan' : item.activeRelease ? accessLabels[item.visibility] : 'Draf'}</small></span><ArrowRight size={18} /></Link>)}</div>}
  </>
}

const accessLabels: Record<Visibility, string> = { public: 'Publik', link: 'Siapa pun yang punya tautan', invite: 'Hanya orang yang diundang' }
function WorkflowTree({ detail, tab, onSelect }: { detail: DashboardDetail; tab: string; onSelect: (tab: string) => void }) {
  const hasRealData = Boolean(detail.preview && !detail.preview.demo)
  const hasDesign = detail.draft.widgets.length > 0 && (detail.draftRevision > 1 || detail.draft.title !== 'Dashboard baru')
  const isPublished = Boolean(detail.activeRelease && !detail.archivedAt)
  const steps = detail.canManage ? [
    { id: 'data', label: '1. Unggah & periksa data', done: hasRealData, meta: hasRealData ? `Data masuk · ${conditionDate(detail.preview!.condition.date)}` : 'Belum ada data kegiatan' },
    { id: 'editor', label: '2. Susun & poles tampilan', done: hasDesign, meta: `${detail.draft.widgets.length} komponen` },
    { id: 'preview', label: '3. Pratinjau hasil', done: hasRealData && detail.draft.widgets.length > 0, meta: hasRealData ? 'Siap ditinjau' : 'Menunggu data' },
    { id: 'access', label: '4. Terbitkan & bagikan', done: isPublished, meta: isPublished ? `Terbit · /${detail.slug}` : 'Belum diterbitkan' },
  ] : [
    { id: 'data', label: '1. Unggah & periksa data', done: hasRealData, meta: hasRealData ? `Data masuk · ${conditionDate(detail.preview!.condition.date)}` : 'Belum ada data kegiatan' },
    { id: 'preview', label: '2. Pratinjau hasil', done: hasRealData, meta: hasRealData ? 'Siap ditinjau' : 'Menunggu data' },
  ]
  return <ol className="workflow-tree" aria-label="Progres tahapan penerbitan">
    {steps.map((step, index) => {
      const current = tab === step.id
      return <li key={step.id} className="workflow-step" data-done={step.done || undefined} data-current={current || undefined}>
        <button type="button" className="workflow-node" onClick={() => onSelect(step.id)} aria-current={current ? 'step' : undefined}>
          <span className="workflow-dot" aria-hidden="true">{step.done ? <Check size={13} /> : index + 1}</span>
          <span className="workflow-copy"><b>{step.label}</b><small>{step.meta}</small></span>
        </button>
      </li>
    })}
  </ol>
}

function Workspace({ id }: { id: string }) {
  const [query, setQuery] = useSearchParams()
  const [editorPending, setEditorPending] = useState(false)
  const { data, error, loading, reload } = useData<DashboardDetail>(`/admin/dashboards/${id}`)
  const tab = query.get('tab') ?? (data?.canManage ? 'editor' : 'data')
  const tabs = data?.canManage ? [ ['editor', 'Editor', Settings], ['data', 'Perbarui data', FileUp], ['preview', 'Pratinjau', Eye], ['access', 'Terbitkan & akses', Globe] ] as const : [['data', 'Perbarui data', FileUp], ['preview', 'Pratinjau', Eye]] as const
  return <>
    <Breadcrumb parts={[{ label: 'Studio pengelola', to: '/studio' }, data?.draft.title ?? 'Dashboard']} />
    {loading && !data && <Loading />}{error && <Alert>{error} <button className="text-button" onClick={reload}>Coba lagi</button></Alert>}
    {data && <>
      <div className="page-heading"><div><h1>{data.draft.title}</h1><p>{data.draft.period} · {data.archivedAt ? 'Diarsipkan' : data.activeRelease ? 'Terbit' : 'Draf'}{data.activityStatus === 'closed' && ' · Kegiatan selesai'}</p></div>
        {data.activeRelease && !data.archivedAt && <Link className="button" to={`/${data.slug}`}><ExternalLink size={16} /> Buka tautan pembaca</Link>}</div>
      <WorkflowTree detail={data} tab={tab} onSelect={route => setQuery({ tab: route })} />
      <nav className="workspace-tabs" aria-label="Langkah pengelolaan">{tabs.map(([route, label, Icon]) => <button key={route} type="button" aria-current={tab === route ? 'page' : undefined} className={tab === route ? 'selected' : ''} onClick={() => setQuery({ tab: route })}><Icon size={17} />{label}</button>)}</nav>
      <div hidden={tab !== 'editor'}>{data.canManage && <Editor detail={data} onUpdate={reload} onPendingChange={setEditorPending} active={tab === 'editor'} />}</div>
      <div hidden={tab !== 'data'}><UploadPanel detail={data} onUpdate={reload} draftPending={editorPending || loading} /></div>
      {tab === 'access' && data.canManage && <Access detail={data} reload={reload} />}
      {tab === 'preview' && <DraftPreview detail={data} />}
    </>}
  </>
}

function normalizeSlug(input: string) {
  return input.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-/, '').slice(0, 60)
}

function Access({ detail, reload }: { detail: DashboardDetail; reload: () => void }) {
  const path = `/admin/dashboards/${detail.id}`
  const [visibility, setVisibility] = useState(detail.visibility)
  const [slug, setSlug] = useState(detail.slug)
  useEffect(() => { setSlug(detail.slug) }, [detail.slug])
  const cleanSlug = slug.replace(/-+$/, '')
  const slugChanged = Boolean(cleanSlug) && cleanSlug !== detail.slug
  const personalRows = detail.draft.datasets.some(dataset => dataset.grain === 'person')
  const selectedVisibility: Visibility = personalRows && visibility === 'public' ? 'link' : visibility
  const canChangeAccess = detail.activeRelease && detail.visibility !== selectedVisibility && (!(personalRows || detail.activePersonal) || selectedVisibility !== 'public')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [working, setWorking] = useState(false)
  const [secret, setSecret] = useState('')
  const [history] = useState<ReleaseSummary[]>(detail.preview?.history ?? [])
  const [release, setRelease] = useState('')
  const [closeForm, setCloseForm] = useState(false)
  const [closingReason, setClosingReason] = useState('')
  const [archiveForm, setArchiveForm] = useState(false)
  const closed = detail.activityStatus === 'closed'
  const hasLinkGrant = detail.grants.some(grant => grant.mode === 'link')
  async function action<T>(callback: () => Promise<T>, message: string, after?: (value: T) => void) {
    setError(''); setSuccess(''); setWorking(true)
    try { const value = await callback(); setSuccess(message); after?.(value); reload() }
    catch (error) { setError((error as Error).message) }
    finally { setWorking(false) }
  }
  async function ensureShareLink(nextVisibility: Visibility) {
    if (nextVisibility !== 'link' || hasLinkGrant) return
    const result = await api<{ secret: string; slug: string }>(`${path}/grants`, 'POST', {})
    setSecret(`${location.origin}/bagikan#${result.slug}.${result.secret}`)
  }
  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const email = new FormData(event.currentTarget).get('email')
    await action(() => api(`${path}/grants`, 'POST', { email }), 'Undangan tersimpan.')
  }
  const readerLink = `${location.origin}/${detail.slug}`
  return <>
    {error && <Alert>{error}</Alert>}{success && <Alert tone="success">{success}</Alert>}
    <div className="studio-grid">
      <section className="panel studio-panel"><div className="panel-heading"><span className="metric-icon"><Globe size={20} /></span><div><h2>Terbitkan dashboard</h2><p>Pilih alamat tautan ringkas dan siapa yang dapat membuka laporan.</p></div></div>
        <div className="form-stack">
        <label>Alamat tautan (endpoint)<div className="slug-input-group"><span className="slug-prefix">{location.host}/</span><input value={slug} maxLength={60} placeholder="matching-sbr" onChange={event => setSlug(normalizeSlug(event.target.value))} /></div></label>
        <p className="muted-text">Tautan ringkas: <code>{location.origin}/{cleanSlug || detail.slug}</code>. Gunakan huruf kecil, angka, dan tanda hubung (-).</p>
        {slugChanged && detail.activeRelease && <button type="button" className="button" disabled={working || cleanSlug.length < 3} onClick={() => action(() => api(`${path}/slug`, 'PATCH', { slug: cleanSlug }), 'Alamat tautan diperbarui.')}>Simpan alamat tautan</button>}
        <label>Hak baca<Select value={selectedVisibility} options={Object.entries(accessLabels).filter(([key]) => !personalRows || key !== 'public').map(([key, name]) => ({ value: key, label: name }))} onChange={value => setVisibility(value as Visibility)} /></label>
        <p className="muted-text">{selectedVisibility === 'public' ? 'Dashboard akan masuk ke katalog yang dapat dilihat siapa saja.' : selectedVisibility === 'link' ? 'Siapa pun yang menerima tautan berbagi dapat langsung membuka dashboard tanpa perlu masuk akun.' : 'Pembaca perlu masuk dengan akun yang emailnya tercantum pada undangan.'}{personalRows && ' Dashboard per individu tidak ditampilkan di katalog publik.'}</p>
        <div className="actions"><button className="button primary" disabled={working || !detail.preview || detail.preview.demo || cleanSlug.length < 3} onClick={() => action(async () => {
          await api(`${path}/publish`, 'POST', { expectedRevision: detail.draftRevision, visibility: selectedVisibility, slug: cleanSlug })
          await ensureShareLink(selectedVisibility)
        }, 'Dashboard terbit.')}><CheckCircle2 size={16} /> {detail.archivedAt ? 'Terbitkan kembali' : detail.activeRelease ? 'Terbitkan perubahan draf' : 'Terbitkan dashboard'}</button>{canChangeAccess && <button className="button" disabled={working} onClick={() => action(async () => {
          await api(`${path}/access`, 'PATCH', { visibility: selectedVisibility })
          await ensureShareLink(selectedVisibility)
        }, 'Hak baca diperbarui.')}>Ubah hak baca</button>}</div>
        {(!detail.preview || detail.preview.demo) && <Alert tone="info">Terapkan berkas kegiatan untuk mengganti data contoh sebelum menerbitkan.</Alert>}
        {detail.activeRelease && !detail.archivedAt && <>
          {detail.visibility === 'link' && secret && <label>Tautan berbagi (bisa dibuka siapa saja)<input value={secret} readOnly onFocus={event => event.target.select()} /></label>}
          <label>{detail.visibility === 'link' ? 'Tautan pembaca (pengelola / penerima sesi aktif)' : 'Tautan pembaca'}<input value={readerLink} readOnly onFocus={event => event.target.select()} /></label>
          <button className="button subtle" onClick={() => setArchiveForm(!archiveForm)}>Arsipkan dashboard</button>
          {archiveForm && <><Alert tone="info">Dashboard sementara disembunyikan dari katalog dan pembaca. Rilis tersimpan di Studio.</Alert><button className="button" disabled={working} onClick={() => action(() => api(`${path}/archive`, 'POST', { expectedRevision: detail.draftRevision }), 'Dashboard diarsipkan.', () => setArchiveForm(false))}>Konfirmasi pengarsipan</button></>}</>}</div>
      </section>
      <section className="panel studio-panel"><div className="panel-heading"><span className="metric-icon blue-icon"><Link2 size={20} /></span><div><h2>Izin pembaca</h2><p>Kelola tautan berbagi dan undangan email.</p></div></div>
        {detail.visibility === 'link' && detail.activeRelease && <div className="form-stack"><button className="button" disabled={working} onClick={() => action(() => api<{ secret: string; slug: string }>(`${path}/grants`, 'POST', {}), 'Tautan berbagi baru dibuat.', result => setSecret(`${location.origin}/bagikan#${result.slug}.${result.secret}`))}><Link2 size={16} /> Buat atau rotasi tautan</button>
          {secret && <label>Salin tautan berbagi<input value={secret} readOnly onFocus={event => event.target.select()} /></label>}</div>}
        <form onSubmit={invite} className="form-stack"><label>Email undangan<input type="email" name="email" required maxLength={100} placeholder="pembaca@bps.go.id" /></label><button className="button" disabled={working}>Tambah undangan</button></form>
        <div className="job-list">{detail.grants.map(grant => <div className="grant-entry" key={grant.id}><span>{grant.email || 'Tautan berbagi aktif'}</span><button className="button subtle danger-text" disabled={working} onClick={() => action(() => api(`${path}/grants/${grant.id}`, 'DELETE'), 'Izin dicabut.', () => setSecret(''))}>Cabut</button></div>)}</div>
      </section>
      <section className="panel studio-panel"><div className="panel-heading"><span className="metric-icon blue-icon"><Users size={20} /></span><div><h2>Operator data</h2><p>Tugaskan operator satker pada dashboard ini.</p></div></div>
        {detail.operators.map(operator => <label className="check" key={operator.id}><input type="checkbox" disabled={working} checked={operator.assigned} onChange={event => action(() => api(`${path}/operators/${operator.id}`, 'PATCH', { enabled: event.target.checked }), 'Penugasan diperbarui.')} /> {operator.name} <small>{operator.email}</small></label>)}
        {!detail.operators.length && <p className="empty-inline">Belum ada akun operator pada satker ini.</p>}
      </section>
      <section className="panel studio-panel"><div className="panel-heading"><span className="metric-icon"><Settings size={20} /></span><div><h2>Pengaturan kegiatan</h2><p>Kelola status operasional dan rilis yang dibuka pembaca.</p></div></div>
        {detail.canClose && <div className="form-stack"><button className="button" disabled={working} onClick={() => setCloseForm(!closeForm)}>{closed ? 'Buka kembali' : 'Tandai selesai'}</button>
          {closeForm && <form className="form-stack" onSubmit={event => { event.preventDefault(); void action(() => api(`${path}/${closed ? 'reopen' : 'close'}`, 'POST', { expectedActivityRevision: detail.activityRevision, reason: closingReason.trim() || undefined }), closed ? 'Kegiatan dibuka kembali.' : 'Kegiatan ditandai selesai.', () => { setCloseForm(false); setClosingReason('') }) }}>
            {!closed && <Alert tone="info">{detail.preview ? `Kondisi terakhir ${conditionDate(detail.preview.condition.date)} · ${detail.preview.condition.time} WIB. ` : ''}{detail.jobs.filter(job => ['ready', 'uploaded', 'validating'].includes(job.status)).length} unggahan menunggu. Laporan terbit tetap dapat dibaca.</Alert>}
            <label>Alasan {closed ? 'pembukaan kembali' : 'penutupan (opsional)'}<input value={closingReason} onChange={event => setClosingReason(event.target.value)} required={closed} minLength={3} maxLength={300} /></label><button className="button primary" disabled={working}>Konfirmasi {closed ? 'buka kembali' : 'selesai'}</button>
          </form>}
        </div>}
        {!!(detail.preview?.history ?? history).length && <div className="form-stack"><label>Pulihkan rilis<Select value={release} options={[{ value: '', label: 'Pilih kondisi dan versi' }, ...(detail.preview?.history ?? history).map(item => ({ value: item.id, label: `${conditionDate(item.date)} · ${item.time} WIB · v${item.version}` }))]} onChange={setRelease} /></label><button className="button" disabled={working || !release} onClick={() => action(() => api(`${path}/rollback`, 'POST', { releaseId: release, expectedRevision: detail.draftRevision }), 'Rilis sebelumnya dipulihkan sebagai versi baru.')}>Pulihkan rilis pilihan</button></div>}
      </section>
    </div>
  </>
}
