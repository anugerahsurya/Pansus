export const csvAnalysisStream = 'application/x-ndjson'
export function analysisFormat(name: string) {
  if (/\.csv$/i.test(name)) return 'CSV'
  if (/\.xlsx?$/i.test(name)) return 'Excel'
}
export type CsvAnalysisStage = 'reading' | 'mapping' | 'validating'
export type GeminiStatus = 'unconfigured' | 'configured' | 'ready' | 'unavailable'
export type CsvAnalysisEvent<T> =
  | { type: 'progress'; stage: CsvAnalysisStage }
  | { type: 'result'; data: T }
  | { type: 'error'; status: number; message: string; code?: string }
