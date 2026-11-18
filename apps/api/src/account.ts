import './config'
import { randomUUID } from 'node:crypto'
import { Algorithm, hash } from '@node-rs/argon2'
import { z } from 'zod'
import type { User } from './model'
import { openStore } from './store'

const input = z.object({
  tenant: z.string().regex(/^[a-z0-9_-]{2,40}$/),
  role: z.enum(['admin', 'operator', 'reader']),
  email: z.email().max(100).transform(email => email.toLowerCase()),
  name: z.string().trim().min(2).max(100),
  password: z.string().min(12).max(200),
}).safeParse({
  tenant: process.argv[2], role: process.argv[3], email: process.argv[4], name: process.argv[5], password: process.env.MONITORING_NEW_PASSWORD,
})
if (!input.success) {
  console.error('Pemakaian: npm run account -- <satker-id> <admin|operator|reader> <email> "<nama>". Atur MONITORING_NEW_PASSWORD (12–200 karakter).')
  process.exit(1)
}
const { password, ...member } = input.data
try {
  const db = await openStore()
  const passwordHash = await hash(password, { algorithm: Algorithm.Argon2id })
  await db.write(records => {
    if (records.list<User>('user:').some(user => user.email.toLowerCase() === member.email)) throw new Error('Email sudah terdaftar.')
    const id = randomUUID()
    records.put<User>('user:' + id, { ...member, id, hash: passwordHash })
  })
  console.log('Akun satker berhasil dibuat.')
  process.exit(0)
} catch (error) {
  console.error(error instanceof Error && error.message === 'Email sudah terdaftar.' ? error.message : 'Akun gagal dibuat. Periksa koneksi penyimpanan.')
  process.exit(1)
}
