import { useState, type FormEvent } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { KeyRound, LogOut, UsersRound } from 'lucide-react'
import { avatarCount, memberRoles, roleLabels, type Account, type MemberRole, type SuperadminPolicy } from '../../../packages/contracts/accounts'
import { api } from './api'
import { Avatar } from './avatar'
import { Alert, Breadcrumb, Loading, useAuth, useData } from './common'

export function Profile() {
  const { user } = useAuth()
  if (user === undefined) return <Loading />
  return user ? <ProfileForm key={user.id} user={user} /> : <Navigate to="/masuk?lanjut=/profil" replace />
}

function ProfileForm({ user }: { user: Account }) {
  const { setUser } = useAuth()
  const [name, setName] = useState(user.name)
  const [avatar, setAvatar] = useState(user.avatar ?? null)
  const [working, setWorking] = useState('')
  const [feedback, setFeedback] = useState<{ panel: string; message: string; error?: boolean }>()
  async function run(panel: string, work: () => Promise<void>, success?: string) {
    setWorking(panel)
    setFeedback(undefined)
    try { await work(); if (success) setFeedback({ panel, message: success }) }
    catch (failure) { setFeedback({ panel, error: true, message: (failure as Error).message }) }
    finally { setWorking('') }
  }
  const notice = (panel: string) => feedback?.panel === panel && <Alert tone={feedback.error ? 'error' : 'success'}>{feedback.message}</Alert>
  function password(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    const newPassword = data.get('newPassword')
    if (newPassword !== data.get('confirmation')) {
      setFeedback({ panel: 'password', error: true, message: 'Konfirmasi kata sandi baru belum cocok.' })
      return
    }
    void run('password', async () => {
      await api('/auth/password', 'PATCH', { currentPassword: data.get('currentPassword'), newPassword })
      form.reset()
    }, 'Kata sandi diperbarui. Sesi di perangkat lain telah berakhir.')
  }
  return <>
    <Breadcrumb parts={['Profil']} />
    <div className="page-heading"><div><h1>Profil</h1><p>Kelola identitas dan keamanan akun Pansus.</p></div>
      <div className="actions">{user.permissions.users && <Link className="button" to="/pengguna"><UsersRound size={16} /> Kelola pengguna</Link>}
        <button className="button" disabled={Boolean(working)} onClick={() => void run('session', async () => { await api('/auth/logout', 'POST'); setUser(null) })}><LogOut size={16} /> Keluar</button>
      </div></div>
    {notice('session')}
    <div className="studio-grid profile-grid">
      <section className="panel studio-panel">
        <div className="profile-heading"><Avatar number={user.avatar} size={54} /><div><h2>{user.name}</h2><p>{roleLabels[user.role]} · {user.email}</p></div></div>
        <form className="form-stack" onSubmit={event => {
          event.preventDefault()
          void run('profile', async () => { const next = await api<Account>('/auth/profile', 'PATCH', { name, avatar }); setUser(next); setName(next.name) }, 'Profil disimpan.')
        }}>
          {notice('profile')}
          <label>Nama tampilan<input value={name} required minLength={2} maxLength={100} onChange={event => setName(event.target.value)} /></label>
          <fieldset className="avatar-picker">
            <legend>Foto profil</legend>
            <div className="avatar-options">
              {[null, ...Array.from({ length: avatarCount }, (_, i) => i + 1)].map(number => <label className="avatar-option" key={number ?? 0}>
                <input className="sr-only" type="radio" name="avatar" aria-label={number ? `Avatar ${number}` : 'Avatar bawaan'} checked={avatar === number} onChange={() => setAvatar(number)} />
                <Avatar number={number} />
              </label>)}
            </div>
            <small>Ilustrasi avatar dari <a href="https://visualskills.dev/ip-as-logo" target="_blank" rel="noreferrer">IP as Logo</a>.</small>
          </fieldset>
          <button className="button primary" disabled={Boolean(working) || (name.trim() === user.name && avatar === (user.avatar ?? null))}>Simpan profil</button>
        </form>
      </section>
      <section className="panel studio-panel">
        <div className="panel-heading"><KeyRound size={19} aria-hidden="true" /><div><h2>Ubah kata sandi</h2><p>Gunakan sedikitnya 12 karakter.</p></div></div>
        <form className="form-stack" onSubmit={password}>
          {notice('password')}
          <label>Kata sandi saat ini<input type="password" name="currentPassword" autoComplete="current-password" maxLength={200} required /></label>
          <label>Kata sandi baru<input type="password" name="newPassword" autoComplete="new-password" minLength={12} maxLength={200} required /></label>
          <label>Ulangi kata sandi baru<input type="password" name="confirmation" autoComplete="new-password" minLength={12} maxLength={200} required /></label>
          <button className="button primary" disabled={Boolean(working)}>Perbarui kata sandi</button>
        </form>
      </section>
    </div>
  </>
}

export function Members() {
  const { user } = useAuth()
  if (user === undefined) return <Loading />
  if (!user) return <Navigate to="/masuk?lanjut=/pengguna" replace />
  if (!user.permissions.users) return <Alert>Anda tidak punya izin mengelola pengguna.</Alert>
  return <MemberDirectory user={user} />
}

function MemberDirectory({ user }: { user: Account }) {
  const { data, error, loading, reload } = useData<{ members: Account[]; policy?: SuperadminPolicy }>('/admin/members')
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<{ error?: boolean; message: string }>()
  const roles = memberRoles.filter(role => user.permissions.roles || role === 'reader' || role === 'operator')
  async function submit(action: () => Promise<unknown>, message: string) {
    setSaving(true)
    setNotice(undefined)
    try { await action(); setNotice({ message }); reload() }
    catch (error) { setNotice({ error: true, message: (error as Error).message }) }
    finally { setSaving(false) }
  }
  return <>
    <Breadcrumb parts={[{ label: 'Profil', to: '/profil' }, 'Kelola pengguna']} />
    <div className="page-heading"><div><h1>Kelola pengguna</h1><p>Atur akun dan akses untuk satker Anda.</p></div></div>
    {error && <Alert>{error} <button className="text-button" onClick={reload}>Muat ulang</button></Alert>}
    {notice && <Alert tone={notice.error ? 'error' : 'success'}>{notice.message}</Alert>}
    {loading && !data && <Loading />}
    {data && <div className="studio-grid profile-grid">
      <section className="panel studio-panel">
        <div className="panel-heading"><h2>Tambah pengguna</h2></div>
        <form className="form-stack" onSubmit={event => {
          event.preventDefault()
          const form = event.currentTarget
          const fields = Object.fromEntries(new FormData(form))
          void submit(async () => { await api('/admin/members', 'POST', fields); form.reset() }, 'Akun pengguna dibuat.')
        }}>
          <label>Nama<input name="name" required minLength={2} maxLength={100} /></label>
          <label>Email<input name="email" type="email" required maxLength={100} /></label>
          <label>Role<select name="role" defaultValue="reader">{roles.map(role => <option value={role} key={role}>{roleLabels[role]}</option>)}</select></label>
          <label>Kata sandi awal<input name="password" type="password" autoComplete="new-password" minLength={12} maxLength={200} required /></label>
          <button className="button primary" disabled={saving || loading}>Tambah pengguna</button>
        </form>
      </section>
      {data.policy && <section className="panel studio-panel">
        <div className="panel-heading"><div><h2>Izin Superadmin</h2><p>Berlaku untuk semua akun Superadmin di satker ini.</p></div></div>
        <form className="form-stack" key={JSON.stringify(data.policy)} onSubmit={event => {
          event.preventDefault()
          const fields = new FormData(event.currentTarget)
          void submit(() => api('/admin/roles/superadmin', 'PATCH', { expected: data.policy, policy: { dashboards: fields.has('dashboards'), users: fields.has('users') } }), 'Izin Superadmin diperbarui.')
        }}>
          <label className="check"><input name="dashboards" type="checkbox" defaultChecked={data.policy.dashboards} /> Kelola dan terbitkan dashboard satker</label>
          <label className="check"><input name="users" type="checkbox" defaultChecked={data.policy.users} /> Tambah akun Operator dan Pembaca</label>
          <button className="button primary" disabled={saving || loading}>Simpan izin</button>
        </form>
      </section>}
      <section className="panel studio-panel wide">
        <div className="panel-heading"><h2>Daftar pengguna</h2></div>
        <div className="member-list">{[...data.members].sort((a, b) => a.name.localeCompare(b.name, 'id')).map(member => <div className="member-row" key={member.id}>
          <Avatar number={member.avatar} size={36} />
          <div><b>{member.name}</b><small>{member.email}</small></div>
          {user.permissions.roles && member.role !== 'developer' ?
            <form className="member-role" key={member.role} onSubmit={event => {
              event.preventDefault()
              const role = new FormData(event.currentTarget).get('role') as MemberRole
              if (role !== member.role) void submit(() => api(`/admin/members/${member.id}/role`, 'PATCH', { role, expectedRole: member.role }), 'Role pengguna diperbarui.')
            }}>
              <select name="role" aria-label={`Role ${member.name}`} defaultValue={member.role}>{roles.map(role => <option value={role} key={role}>{roleLabels[role]}</option>)}</select>
              <button className="button" disabled={saving || loading}>Simpan role</button>
            </form> : <span>{roleLabels[member.role]}</span>}
        </div>)}</div>
      </section>
    </div>}
  </>
}
