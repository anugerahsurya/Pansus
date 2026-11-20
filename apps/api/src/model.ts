import { createHash, randomBytes } from 'node:crypto'
import { HttpException } from '@nestjs/common'
import type { CollectionReport, Condition, Dataset, Definition, Notice, SnapshotData, TemplateId, UploadMapping, Visibility } from '../../../packages/contracts/index'
import type { Records } from './store'
import { defaultSuperadminPolicy, type Account, type AccountPermissions, type Role, type SuperadminPolicy } from '../../../packages/contracts/accounts'

export type User = { id: string; tenant: string; email: string; name: string; role: Role; hash: string; avatar?: number; passwordVersion?: number }
export type Session = { userId: string; expires: number; passwordVersion?: number }
export type AccessSession = { dashboardId: string; grantId: string; expires: number }
export type Grant = { id: string; mode: 'link' | 'invite'; hash?: string; email?: string; expires?: number }
export type Dashboard = {
  id: string; slug: string; tenant: string; owner: string; template: TemplateId; draft: Definition; demo: boolean;
  draftRevision: number; activityRevision: number; accessRevision: number; activityStatus: 'active' | 'closed';
  closedAt: string | null; visibility: Visibility; activeRelease: string | null; snapshotIds: string[]; releaseIds: string[];
  mappings: Record<string, UploadMapping>; operators: string[]; grants: Grant[];
  demoVersion?: number;
  archivedAt?: string | null;
}
export type Snapshot = Condition & { id: string; data: SnapshotData; collection?: CollectionReport[]; hash: string; demo: boolean; createdAt: string; revision: number; signature: string; grains?: Record<string, Dataset['grain']> }
export type Release = Condition & { id: string; snapshotId: string; definition: Definition; createdAt: string; version: number }
export type ImportJob = Condition & {
  id: string; dashboardId: string; owner: string; hash: string; status: 'uploaded' | 'validating' | 'ready' | 'invalid' | 'published' | 'failed';
  draftRevision: number; activityRevision: number; warnings: Notice[]; errors: Notice[]; createdAt: string;
  files: Record<string, string>; sources?: Record<string, string>; mappings: Record<string, UploadMapping>; data?: SnapshotData; collection?: CollectionReport[];
  reusedFiles?: Record<string, string>; baseSnapshotId?: string;
  commitKey?: string; snapshotId?: string; appliedRelease?: string | null; claim?: string; lease?: number;
}
export type Proof = { jobId: string; userId: string; dashboardId: string; hash: string; expires: number; passwordVersion?: number }
export const token = () => randomBytes(32).toString('base64url')
export const hash = (input: string | Uint8Array) => createHash('sha256').update(input).digest('hex')
export const now = () => new Date().toISOString()
export const superadminPolicyKey = (tenant: string) => 'role-policy:' + tenant
export const superadminPolicy = (db: Records, tenant: string) => db.get<SuperadminPolicy>(superadminPolicyKey(tenant)) ?? defaultSuperadminPolicy
export function permissions(db: Records, user: User): AccountPermissions {
  if (user.role === 'developer') return { dashboards: true, users: true, roles: true }
  if (user.role === 'superadmin') return { ...superadminPolicy(db, user.tenant), roles: false }
  return { dashboards: user.role === 'admin', users: false, roles: false }
}
export function account(db: Records, user: User): Account {
  const { id, tenant, email, name, role, avatar } = user
  return { id, tenant, email, name, role, avatar, permissions: permissions(db, user) }
}
export function fail(status: number, code: string, message: string, location?: string): never {
  throw new HttpException({ code, message, location, retryable: status === 409 || status === 429 || status >= 500 }, status)
}
export function audit(records: Records, user: string, action: string, dashboard: Dashboard, details: object = {}) {
  records.put('audit:' + token(), { user, action, dashboardId: dashboard.id, tenant: dashboard.tenant, at: now(), ...details })
}
export function datasetSignature(definition: Definition) {
  return hash(JSON.stringify(definition.datasets.map(dataset => [dataset.id, dataset.grain, dataset.fields.map(({ id, unit, scale, formula, derived }) => [id, unit, scale, formula, derived]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))) ]).sort((a, b) => String(a[0]).localeCompare(String(b[0])))))
}
