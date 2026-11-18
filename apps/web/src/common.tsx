import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { Activity, ArrowLeft, ArrowUpRight, BarChart3, BookOpen, ChevronRight, CircleAlert, LayoutGrid, LogIn, Menu, PanelTop, X } from 'lucide-react'
import { api, type Account } from './api'

export const AuthContext = createContext<{ user: Account | null | undefined; setUser: (user: Account | null) => void }>({ user: undefined, setUser: () => {} })
export const useAuth = () => useContext(AuthContext)

export function Shell({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [open, setOpen] = useState(false)
  return <div className="shell">
    <header className="site-header">
      <button className="icon-button mobile-menu" aria-label={open ? 'Tutup navigasi' : 'Buka navigasi'} aria-expanded={open} onClick={() => setOpen(!open)}>{open ? <X size={21} /> : <Menu size={21} />}</button>
      <Link to="/" className="brand" onClick={() => setOpen(false)}>
        <img src="/mark.svg" alt="" width="39" height="39" />
        <span><strong>Pansus</strong><small>Pantau Survei dan Sensus</small></span>
      </Link>
      <div className="site-header-end">
        {user ? <Link className="button subtle top-action" aria-label="Buka studio pengelola" to="/studio"><span className="avatar">{user.name.slice(0, 1)}</span> <span>{user.name.split(' ')[0]}</span></Link> : <Link to="/masuk" className="button subtle top-action" aria-label="Masuk"><LogIn size={16} /> <span>Masuk</span></Link>}
      </div>
    </header>
    <aside className={'sidebar' + (open ? ' is-open' : '')}>
      <nav aria-label="Navigasi utama">
        <p className="sidebar-label">Portal pembaca</p>
        <NavLink to="/" end onClick={() => setOpen(false)}><Activity /> Ringkasan contoh</NavLink>
        <NavLink to="/katalog" onClick={() => setOpen(false)}><LayoutGrid /> Katalog kegiatan</NavLink>
        <NavLink to="/template" onClick={() => setOpen(false)}><PanelTop /> Galeri template</NavLink>
        <p className="sidebar-label workspace-label">Ruang kerja</p>
        <NavLink to="/studio" onClick={() => setOpen(false)}><BarChart3 /> Studio pengelola</NavLink>
      </nav>
      <div className="sidebar-bottom">
        <Link to="/panduan" className="help-link" onClick={() => setOpen(false)}><BookOpen size={18} /> Panduan operator <ArrowUpRight size={14} /></Link>
        <small>© {new Date().getFullYear()} BPS Sumatera Barat</small>
      </div>
    </aside>
    <main className="main" id="isi-utama">{children}</main>
  </div>
}

export function Breadcrumb({ parts }: { parts: (string | { label: string; to: string })[] }) {
  return <nav className="breadcrumbs" aria-label="Lokasi halaman">{parts.map((part, index) => <span key={index}>{index > 0 && <ChevronRight size={13} aria-hidden />}{typeof part === 'string' ? <span aria-current="page">{part}</span> : <Link to={part.to}>{part.label}</Link>}</span>)}</nav>
}
export const Back = ({ to, children }: { to: string; children: ReactNode }) => <Link to={to} className="back"><ArrowLeft size={16} /> {children}</Link>
export function Alert({ children, tone = 'error' }: { children: ReactNode; tone?: 'error' | 'info' | 'success' }) {
  return <div className={'notice notice-' + tone} role={tone === 'error' ? 'alert' : 'status'}><CircleAlert size={18} /><div>{children}</div></div>
}
export const Loading = () => <div role="status" className="panel state-panel"><span className="spinner" /> Memuat data…</div>
export function useData<T>(url: string) {
  const [version, setVersion] = useState(0)
  const [state, setState] = useState<{ url: string; version: number; data?: T; error?: string }>({ url, version })
  useEffect(() => {
    let current = true
    api<T>(url).then(data => { if (current) setState({ url, version, data }) }, error => { if (current) setState({ url, version, error: error.message }) })
    return () => { current = false }
  }, [url, version])
  return { data: state.url === url ? state.data : undefined, error: state.url === url ? state.error : undefined, loading: state.url !== url || state.version !== version || (!state.data && !state.error), reload: () => setVersion(value => value + 1) }
}
