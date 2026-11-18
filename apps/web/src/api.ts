import type { Condition, Definition, Field, Notice, Report, TemplateId, UploadMapping, Values, Visibility } from '../../../packages/contracts/index'

export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string) { super(message) }
}
export async function api<T>(url: string, method = 'GET', body?: unknown): Promise<T> {
  const multipart = body instanceof FormData
  const headers: Record<string, string> = { 'X-Monitoring-Request': '1' }
  if (body !== undefined && !multipart) headers['Content-Type'] = 'application/json'
  const response = await fetch('/api' + url, { method, credentials: 'same-origin', headers, body: body === undefined ? undefined : multipart ? body : JSON.stringify(body) })
  const data = await response.json().catch(() => null)
  if (!response.ok || data == null && url !== '/auth/me') throw new ApiError(data?.message ?? 'Layanan belum dapat dihubungi.', response.status, data?.code)
  return data as T
}
export type Account = { id: string; tenant: string; email: string; name: string; role: 'admin' | 'reader' | 'operator' }
export type CatalogItem = Condition & { slug: string; title: string; description: string; satker: string; period: string; theme: string; demo: boolean; activityStatus: 'active' | 'closed'; template: TemplateId }
export type TemplateInfo = { id: TemplateId; name: string; description: string; definition: Definition }
export type DashboardItem = { id: string; slug: string; title: string; template: TemplateId; activityStatus: 'active' | 'closed'; visibility: Visibility; activeRelease: string | null; archivedAt?: string | null }
export type ImportJob = Condition & { id: string; hash: string; status: 'uploaded' | 'validating' | 'ready' | 'invalid' | 'published' | 'failed'; warnings: Notice[]; errors: Notice[]; files: Record<string, string>; createdAt: string;
  differences: { id: string; source?: string; rows: number; detailed?: number; target: number | null; before: number | null; newCodes: string[]; gone: string[]; samples: { code: string; name: string; values: Values }[]; reported?: Values }[];
  collection?: { date: string; time: string | null; count: number }[];
}
export type DashboardDetail = Omit<DashboardItem, 'title'> & {
  draft: Definition; draftRevision: number; activityRevision: number; closedAt: string | null; canManage: boolean; canClose: boolean; aiAvailable: boolean;
  operators: { id: string; name: string; email: string; assigned: boolean }[]; grants: { id: string; mode: 'link' | 'invite'; email?: string; expires?: number }[];
  mappings: Record<string, UploadMapping>; preview: Report | null; jobs: Pick<ImportJob, 'id' | 'status' | 'date' | 'time' | 'files' | 'createdAt'>[];
}
export type CsvSuggestion = {
  model: string; mapping: UploadMapping; definition?: Definition; expectedRevision: number;
  fields: Pick<Field, 'id' | 'label' | 'unit' | 'scale' | 'public'>[]; rows: number; warnings: string[];
}
export type Sorts = Record<string, { field: string; reverse: boolean }>
export const fmt = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 })
export const pct = new Intl.NumberFormat('id-ID', { style: 'percent', maximumFractionDigits: 1 })
export const conditionDate = (date: string) => new Intl.DateTimeFormat('id-ID', { dateStyle: 'long', timeZone: 'Asia/Jakarta' }).format(new Date(`${date}T00:00:00+07:00`))
export const displayDate = (date: string) => new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeZone: 'Asia/Jakarta' }).format(new Date(date))
export const currentWib = () => new Intl.DateTimeFormat('sv-SE', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Jakarta' }).format(new Date()).split(' ')
