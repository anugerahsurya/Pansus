import { csvAnalysisStream, type CsvAnalysisEvent, type CsvAnalysisStage, type GeminiStatus } from '../../../packages/contracts/csv-analysis'
import type { Condition, Definition, Field, Notice, Report, TemplateId, UploadMapping, Values, Visibility } from '../../../packages/contracts/index'
export type { Account } from '../../../packages/contracts/accounts'

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

export async function requestCsvAnalysis(dashboard: string, body: FormData, onProgress: (stage: CsvAnalysisStage) => void): Promise<CsvSuggestion> {
  const response = await fetch(`/api/admin/dashboards/${dashboard}/ai-drafts`, {
    method: 'POST', credentials: 'same-origin', body, signal: AbortSignal.timeout(100_000),
    headers: { 'X-Monitoring-Request': '1', Accept: csvAnalysisStream },
  })
  if (!response.ok || !response.headers.get('content-type')?.includes(csvAnalysisStream)) {
    const data = await response.json().catch(() => null)
    if (!response.ok || !data) throw new ApiError(data?.message ?? 'Analisis CSV belum dapat dimulai.', response.status, data?.code)
    return data as CsvSuggestion
  }

  const reader = response.body?.pipeThrough(new TextDecoderStream()).getReader()
  if (!reader) throw new Error('Status analisis CSV tidak dapat dibaca.')
  let pending = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const lines = (pending + value).split('\n')
      pending = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.trim()) continue
        const event = JSON.parse(line) as CsvAnalysisEvent<CsvSuggestion>
        if (event.type === 'progress') onProgress(event.stage)
        if (event.type === 'error') throw new ApiError(event.message, event.status, event.code)
        if (event.type === 'result') return event.data
      }
    }
    throw new Error('Koneksi terputus sebelum analisis CSV selesai. Coba lagi.')
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}
export type CatalogItem = Condition & { slug: string; title: string; description: string; satker: string; period: string; theme: string; demo: boolean; activityStatus: 'active' | 'closed'; template: TemplateId }
export type TemplateInfo = { id: TemplateId; name: string; description: string; definition: Definition }
export type DashboardItem = { id: string; slug: string; title: string; template: TemplateId; activityStatus: 'active' | 'closed'; visibility: Visibility; activeRelease: string | null; archivedAt?: string | null }
export type ImportJob = Condition & { id: string; hash: string; status: 'uploaded' | 'validating' | 'ready' | 'invalid' | 'published' | 'failed'; warnings: Notice[]; errors: Notice[]; files: Record<string, string>; createdAt: string;
  differences: { id: string; source?: string; rows: number; detailed?: number; target: number | null; before: number | null; newCodes: string[]; gone: string[]; samples: { code: string; name: string; values: Values }[]; reported?: Values }[];
  collection?: { date: string; time: string | null; count: number }[];
}
export type DashboardDetail = Omit<DashboardItem, 'title'> & {
  draft: Definition; draftRevision: number; activityRevision: number; closedAt: string | null; canManage: boolean; canClose: boolean; aiAvailable: boolean;
  aiHealth?: GeminiStatus;
  activePersonal?: boolean;
  operators: { id: string; name: string; email: string; assigned: boolean }[]; grants: { id: string; mode: 'link' | 'invite'; email?: string; expires?: number }[];
  mappings: Record<string, UploadMapping>; preview: Report | null; jobs: Pick<ImportJob, 'id' | 'status' | 'date' | 'time' | 'files' | 'createdAt'>[];
  savedInputs?: Condition & { snapshotId: string; files: Record<string, string> };
}
export type CsvSuggestion = {
  model: string; mapping: UploadMapping; definition?: Definition; expectedRevision: number;
  fields: Pick<Field, 'id' | 'label' | 'unit' | 'scale' | 'public'>[]; rows: number; warnings: string[];
  grain?: Definition['datasets'][number]['grain']; recommendations?: string[];
}
export type Sorts = Record<string, { field: string; reverse: boolean }>
export const fmt = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 })
export const pct = new Intl.NumberFormat('id-ID', { style: 'percent', maximumFractionDigits: 1 })
export const conditionDate = (date: string) => new Intl.DateTimeFormat('id-ID', { dateStyle: 'long', timeZone: 'Asia/Jakarta' }).format(new Date(`${date}T00:00:00+07:00`))
export const displayDate = (date: string) => new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeZone: 'Asia/Jakarta' }).format(new Date(date))
export const currentWib = () => new Intl.DateTimeFormat('sv-SE', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Jakarta' }).format(new Date()).split(' ')
