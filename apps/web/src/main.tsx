import { lazy, Suspense, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Link, Route, Routes, useLocation } from 'react-router-dom'
import '@fontsource-variable/plus-jakarta-sans'
import { api, type Account } from './api'
import { AuthContext, Loading, Shell } from './common'
import { Catalog, Guide, Login, PrintReport, Reader, ShareExchange, Templates } from './portal'
import './styles.css'

const Studio = lazy(() => import('./studio'))

function App() {
  const [user, setUser] = useState<Account | null>()
  const location = useLocation()
  useEffect(() => { api<Account | null>('/auth/me').then(setUser, () => setUser(null)) }, [])
  useEffect(() => { window.scrollTo(0, 0) }, [location.pathname])
  if (location.pathname.startsWith('/render/')) return <Routes><Route path="/render/:ticket" element={<PrintReport />} /></Routes>
  return <AuthContext.Provider value={{ user, setUser }}><a className="skip-link" href="#isi-utama">Ke isi utama</a><Shell><Suspense fallback={<Loading />}><Routes>
    <Route path="/" element={<Reader demo />} />
    <Route path="/katalog" element={<Catalog />} />
    <Route path="/template" element={<Templates />} />
    <Route path="/panduan" element={<Guide />} />
    <Route path="/masuk" element={<Login />} />
    <Route path="/bagikan" element={<ShareExchange />} />
    <Route path="/d/:slug" element={<Reader />} />
    <Route path="/studio" element={<Studio />} />
    <Route path="/studio/:id" element={<Studio />} />
    <Route path="*" element={<div className="panel state-panel"><h1>Halaman tidak ditemukan</h1><Link className="button primary" to="/">Kembali ke ringkasan</Link></div>} />
  </Routes></Suspense></Shell></AuthContext.Provider>
}

createRoot(document.getElementById('root')!).render(<BrowserRouter><App /></BrowserRouter>)
