import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { Activity, ArrowLeft, BarChart3, BookOpen, ChevronRight, CircleAlert, LayoutGrid, LogIn, Menu, Moon, PanelTop, Sun, UsersRound, X } from 'lucide-react'
import { api, type Account } from './api'
import { Avatar } from './avatar'

export const AuthContext = createContext<{ user: Account | null | undefined; setUser: (user: Account | null) => void }>({ user: undefined, setUser: () => {} })
export const useAuth = () => useContext(AuthContext)

export function Shell({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const { pathname } = useLocation()
  const [open, setOpen] = useState(false)
  const [dark, setDark] = useState(() => document.documentElement.dataset.mode === 'dark')
  const menu = useRef<HTMLButtonElement>(null)
  useEffect(() => { setOpen(false) }, [pathname])
  useEffect(() => {
    if (!open) return
    const desktop = window.matchMedia('(width > 850px)')
    const closeOnDesktop = () => { if (desktop.matches) setOpen(false) }
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setOpen(false)
      menu.current?.focus()
    }
    desktop.addEventListener('change', closeOnDesktop)
    window.addEventListener('keydown', escape)
    return () => {
      desktop.removeEventListener('change', closeOnDesktop)
      window.removeEventListener('keydown', escape)
    }
  }, [open])

  function toggleMode() {
    const mode = dark ? 'light' : 'dark'
    document.documentElement.dataset.mode = mode
    try { localStorage.setItem('pansus-mode', mode) } catch { /* Private browsing can block storage. */ }
    setDark(!dark)
  }

  return <div className="shell">
    <header className="site-header">
      <button ref={menu} type="button" className="masthead-action mobile-menu" aria-label={open ? 'Tutup navigasi' : 'Buka navigasi'} aria-expanded={open} aria-controls="navigasi-utama" onClick={() => setOpen(!open)}>{open ? <X size={21} aria-hidden="true" /> : <Menu size={21} aria-hidden="true" />}</button>
      <Link to="/" className="brand" onClick={() => setOpen(false)}>
        <img src="/mark.svg" alt="" width="39" height="39" />
        <span><strong>Pansus</strong><small>Pantau Survei dan Sensus</small></span>
      </Link>
      <span className="masthead-office"><b>Badan Pusat Statistik</b><small>Provinsi Sumatera Barat</small></span>
      <nav className="masthead-tools" aria-label="Bantuan dan akun">
        <NavLink to="/panduan" className="masthead-action" aria-label="Panduan operator" onClick={() => setOpen(false)}><BookOpen size={18} aria-hidden="true" /><span>Panduan operator</span></NavLink>
        <button className="masthead-action mode-toggle" type="button" aria-label="Mode gelap" aria-pressed={dark} onClick={toggleMode}>{dark ? <Sun size={19} aria-hidden="true" /> : <Moon size={19} aria-hidden="true" />}</button>
        {user ? <NavLink className="masthead-action masthead-account" aria-label="Profil" to="/profil" onClick={() => setOpen(false)}><Avatar number={user.avatar} size={27} /><span>{user.name.split(' ')[0]}</span></NavLink>
          : <Link to="/masuk" className="masthead-action masthead-account" aria-label="Masuk" onClick={() => setOpen(false)}><LogIn size={18} aria-hidden="true" /><span>Masuk</span></Link>}
      </nav>
    </header>
    {open && <div className="sidebar-scrim" aria-hidden="true" onClick={() => { setOpen(false); menu.current?.focus() }} />}
    <aside className={'sidebar' + (open ? ' is-open' : '')}>
      <nav id="navigasi-utama" aria-label="Navigasi utama">
        <ul>
          <li><NavLink to="/" end onClick={() => setOpen(false)}><Activity aria-hidden="true" /> Ringkasan contoh</NavLink></li>
          <li><NavLink to="/katalog" onClick={() => setOpen(false)}><LayoutGrid aria-hidden="true" /> Katalog kegiatan</NavLink></li>
          <li><NavLink to="/template" onClick={() => setOpen(false)}><PanelTop aria-hidden="true" /> Galeri template</NavLink></li>
        </ul>
        <ul className="sidebar-workspace">
          <li><NavLink to="/studio" onClick={() => setOpen(false)}><BarChart3 aria-hidden="true" /> Studio pengelola</NavLink></li>
          {user?.permissions.users && <li><NavLink to="/pengguna" onClick={() => setOpen(false)}><UsersRound aria-hidden="true" /> Kelola pengguna</NavLink></li>}
        </ul>
      </nav>
      <small className="sidebar-footer">© {new Date().getFullYear()} BPS Sumatera Barat</small>
    </aside>
    <main className="main" id="isi-utama" inert={open}>{children}</main>
  </div>
}

export function Breadcrumb({ parts }: { parts: (string | { label: string; to: string })[] }) {
  return <nav className="breadcrumbs" aria-label="Lokasi halaman">{parts.map((part, index) => <span key={index}>{index > 0 && <ChevronRight size={13} aria-hidden />}{typeof part === 'string' ? <span aria-current="page">{part}</span> : <Link to={part.to}>{part.label}</Link>}</span>)}</nav>
}
export const Back = ({ to, children }: { to: string; children: ReactNode }) => <Link to={to} className="back"><ArrowLeft size={16} /> {children}</Link>
export function Alert({ children, tone = 'error' }: { children: ReactNode; tone?: 'error' | 'info' | 'success' }) {
  return <div className={'notice notice-' + tone} role={tone === 'error' ? 'alert' : 'status'}><CircleAlert size={18} /><div>{children}</div></div>
}
export const Loading = () => <div role="status" className="page-loader">
  <span className="loading-bars" aria-hidden="true"><i /><i /><i /><i /></span>
  <span>Memuat data…</span>
</div>
export function useData<T>(url: string, retainFor?: string) {
  const [version, setVersion] = useState(0)
  const [state, setState] = useState<{ url: string; version: number; retainFor?: string; data?: T; error?: string }>({ url, version })
  useEffect(() => {
    let current = true
    api<T>(url).then(data => { if (current) setState({ url, version, retainFor, data }) }, error => { if (current) setState({ url, version, retainFor, error: error.message }) })
    return () => { current = false }
  }, [url, version, retainFor])
  const keepData = state.url === url || (retainFor !== undefined && retainFor === state.retainFor)
  return { data: keepData ? state.data : undefined, error: state.url === url ? state.error : undefined, loading: state.url !== url || state.version !== version || (!state.data && !state.error), reload: () => setVersion(value => value + 1) }
}
