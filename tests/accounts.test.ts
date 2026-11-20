import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { Algorithm, hash } from '@node-rs/argon2'
import { Monitoring } from '../apps/api/src/monitoring'
import { Records, type Store } from '../apps/api/src/store'
import type { User } from '../apps/api/src/model'

test('izin Superadmin mengikuti kebijakan satker dan perubahan kata sandi mengakhiri sesi lain', async () => {
  const records = new Records(new Map())
  const store: Store = { read: async action => action(records), write: async action => action(records) }
  const firstPassword = 'AkunAwal!2026'
  const secondPassword = 'KataSandiBaru!2026'
  const passwordHash = await hash(firstPassword, { algorithm: Algorithm.Argon2id })
  records.put<User>('user:developer', { id: 'developer', tenant: 'sumbar', email: 'dev@demo.test', name: 'Dev', role: 'developer', hash: passwordHash })
  records.put<User>('user:other', { id: 'other', tenant: 'other', email: 'outside@demo.test', name: 'Satker Lain', role: 'admin', hash: passwordHash })
  const monitoring = new Monitoring(store)
  const dev = await monitoring.login('dev@demo.test', firstPassword, 'test')
  const developer = { session: dev.session }
  const member = await monitoring.createMember(developer, { email: 'super@demo.test', name: 'Superadmin Uji', role: 'superadmin', password: firstPassword })
  const first = await monitoring.login(member.email, firstPassword, 'test')
  const second = await monitoring.login(member.email, firstPassword, 'test')
  const superadmin = { session: first.session }
  const anotherSession = { session: second.session }

  assert.equal(Object.hasOwn(member, 'hash'), false)
  assert.equal(dev.user.permissions.roles, true)
  assert.equal((await monitoring.members(developer)).members.length, 2)
  await assert.rejects(monitoring.changeRole(developer, 'other', 'operator', 'admin'), { status: 404 })
  await assert.rejects(monitoring.changeRole(developer, 'developer', 'reader', 'reader'), { status: 403 })
  const { id } = await monitoring.create(superadmin, 'custom')
  await assert.rejects(monitoring.members(superadmin), { status: 403 })
  const expected = { dashboards: true, users: false }
  const policy = { dashboards: false, users: true }
  await assert.rejects(monitoring.updateSuperadminPolicy(superadmin, policy, expected), { status: 403 })
  await monitoring.updateSuperadminPolicy(developer, policy, expected)
  await assert.rejects(monitoring.updateSuperadminPolicy(developer, policy, expected), { status: 409 })
  await assert.rejects(monitoring.detail(superadmin, id), { status: 403 })
  await assert.rejects(monitoring.create(superadmin, 'custom'), { status: 403 })
  const reader = await monitoring.createMember(superadmin, { email: 'reader@demo.test', name: 'Pembaca Uji', role: 'reader', password: firstPassword })
  await assert.rejects(monitoring.createMember(superadmin, { email: 'admin@demo.test', name: 'Admin Uji', role: 'admin', password: firstPassword }), { status: 403 })
  await assert.rejects(monitoring.changeRole(superadmin, reader.id, 'admin', 'reader'), { status: 403 })
  await monitoring.changeRole(developer, reader.id, 'operator', 'reader')
  assert.equal((await monitoring.members(superadmin)).members[0].role, 'operator')

  await assert.rejects(monitoring.changePassword(superadmin, 'salah', secondPassword, 'test'), { status: 401 })
  await monitoring.updateProfile(superadmin, { name: 'Nama baru', avatar: 8 })
  await monitoring.changePassword(superadmin, firstPassword, secondPassword, 'test')
  assert.equal(await monitoring.me(anotherSession), null)
  assert.equal((await monitoring.me(superadmin))?.avatar, 8)
  await assert.rejects(monitoring.login(member.email, firstPassword, 'test'), { status: 401 })
  const signedIn = await monitoring.login(member.email, secondPassword, 'test')
  assert.equal(signedIn.user.name, 'Nama baru')
})
