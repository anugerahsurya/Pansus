import type { Dataset, Definition, Field, Rule, TemplateId, Widget } from '../packages/contracts/index'

const field = (id: string, label: string, aliases: string[] = [], unit: Field['unit'] = 'count'): Field =>
  ({ id, label, aliases, unit, nullable: true, public: true })
const derived = (id: string, label: string) => ({ ...field(id, label), derived: true })
const assignment = [
  field('open', 'Open'), field('draft', 'Draft'),
  field('submitted', 'Submitted by Pencacah'), field('completed', 'Completed by Pengawas'),
  field('rejected', 'Rejected by Pengawas'), field('revoked', 'Revoked by Pengawas'),
  derived('target', 'Target'), derived('ppl', 'Progres PPL'), derived('pml', 'Progres PML'),
  derived('final', 'Selesai final'), derived('gap', 'Selisih PPL–PML'),
]
const pesDatasets: Dataset[] = [
  { id: 'sls', label: 'SLS', grain: 'district', fields: [
    field('belum', 'Belum', ['SLS belum']), field('sedang', 'Sedang', ['SLS sedang']),
    field('selesai', 'Selesai', ['SLS selesai']), derived('target', 'Target'),
  ] },
  { id: 'nonub', label: 'Non-UB', grain: 'district', fields: assignment },
  { id: 'ub', label: 'UB', grain: 'district', fields: assignment },
]
const sumRules = (fields: string[]): Record<string, Rule> => Object.fromEntries(fields.map(id => [id, { op: 'sum' }]))
const version = { version: 1 } as const
const progress = (id: string, title: string, dataset: string, field: string, target?: string): Widget =>
  ({ ...version, id, title, type: 'progress', width: 'third', dataset, field, target })
const table = (id: string, title: string, dataset: string, fields: string[], rules = sumRules(fields)): Widget =>
  ({ ...version, id, title, type: 'table', width: 'full', dataset, fields, provinceFooter: { enabled: true, rules } })
const bars = (id: string, title: string, dataset: string, field: string, target?: string): Widget =>
  ({ ...version, id, title, type: 'bars', width: 'half', dataset, field, target })
const base = { schemaVersion: 1, timezone: 'Asia/Jakarta', satker: 'BPS Provinsi Sumatera Barat', theme: 'teal' } as const
const pes: Definition = {
  ...base, title: 'Progres Lapangan PES SE2026',
  description: 'Pantau penyelesaian SLS dan penugasan Non-UB serta UB pada wilayah sampel Sumatera Barat.',
  period: 'November 2026', datasets: pesDatasets,
  widgets: [
    progress('sls_done', 'SLS selesai', 'sls', 'selesai', 'target'),
    progress('nonub_done', 'Non-UB selesai final', 'nonub', 'final', 'target'),
    progress('ub_done', 'UB selesai final', 'ub', 'final', 'target'),
    { ...bars('sls_region', 'Penyelesaian SLS per wilayah', 'sls', 'selesai', 'target'), width: 'two-thirds' },
    { ...version, id: 'sls_status', title: 'Distribusi status SLS', type: 'donut', width: 'third', dataset: 'sls', fields: ['belum', 'sedang', 'selesai'] },
    table('sls_table', 'Rincian SLS', 'sls', ['target', 'belum', 'sedang', 'selesai']),
    table('nonub_table', 'Rincian penugasan Non-UB', 'nonub', ['target', 'ppl', 'pml', 'final', 'gap']),
    table('ub_table', 'Rincian penugasan UB', 'ub', ['target', 'ppl', 'pml', 'final', 'gap']),
  ],
}
const percent = (id: string, label: string, aliases: string[] = []) => ({ ...field(id, label, aliases, 'percent'), scale: 'percentage' as const })
const susenas: Definition = {
  ...base, title: 'Pengolahan Susenas–Seruti', theme: 'blue',
  description: 'Pantau target dan persentase pengolahan Susenas Maret dan Seruti Triwulan I di 19 kabupaten/kota.',
  period: 'Maret 2026', datasets: [
    { id: 'susenas', label: 'Susenas', grain: 'district', fields: [
      field('target', 'Target'), percent('pencacahan', 'Pencacahan', ['Pencacahan (%)']),
      percent('clean_k', 'Olah K bersih'), percent('error_k', 'Olah K error'),
      { ...percent('olah_k', 'Total olah K'), formula: 'clean_k + error_k' },
      percent('clean_kp', 'Olah KP bersih'), percent('error_kp', 'Olah KP error'),
      { ...percent('olah_kp', 'Total olah KP'), formula: 'clean_kp + error_kp' },
      { ...percent('progress', 'Progres pengolahan'), formula: '(olah_k + olah_kp) / 2' },
    ] },
    { id: 'seruti', label: 'Seruti', grain: 'district', fields: [
      field('target', 'Target'), percent('inti_clean', 'INTI bersih'), percent('inti', 'INTI total'),
      percent('mak_clean', 'MAK bersih'), percent('mak', 'MAK total'),
    ] },
  ],
  widgets: [
    progress('sus_progress', 'Progres pengolahan Susenas', 'susenas', 'progress'),
    progress('ser_progress', 'Progres INTI Seruti', 'seruti', 'inti'),
    bars('sus_region', 'Pengolahan Susenas per wilayah', 'susenas', 'progress'),
    bars('ser_region', 'Pengolahan Seruti per wilayah', 'seruti', 'inti'),
    table('sus_table', 'Rincian Susenas', 'susenas', ['target', 'pencacahan', 'olah_k', 'olah_kp', 'progress'],
      { target: { op: 'sum' }, pencacahan: { op: 'reportedValue' }, olah_k: { op: 'reportedValue' }, olah_kp: { op: 'reportedValue' }, progress: { op: 'reportedValue' } }),
    table('ser_table', 'Rincian Seruti', 'seruti', ['target', 'inti_clean', 'inti', 'mak_clean', 'mak'],
      { target: { op: 'sum' }, inti_clean: { op: 'reportedValue' }, inti: { op: 'reportedValue' }, mak_clean: { op: 'reportedValue' }, mak: { op: 'reportedValue' } }),
    { ...version, id: 'schedule', title: 'Jadwal dan status pengumpulan', type: 'schedule', width: 'full', description: 'Status pengiriman Backup dan Split per kabupaten/kota.' },
    { ...version, id: 'link_backup', title: 'Informasi pengiriman backup', type: 'link', width: 'half', url: 'https://www.bps.go.id/', description: 'Informasi kegiatan melalui portal BPS.' },
  ],
}
const custom: Definition = {
  ...base, title: 'Dashboard baru', description: '', period: '2026', datasets: [{
    id: 'wilayah', label: 'Wilayah', grain: 'district', fields: [field('target', 'Target'), field('selesai', 'Selesai')],
  }],
  widgets: [progress('progress_main', 'Progres kegiatan', 'wilayah', 'selesai', 'target'),
    table('detail', 'Rincian wilayah', 'wilayah', ['target', 'selesai'])],
}
export const templates = {
  pes: { name: 'Progres lapangan PES', description: 'Pantau progres SLS serta penugasan Non-UB dan UB dari tiga ekspor data lapangan.', definition: pes },
  susenas: { name: 'Pengolahan Susenas–Seruti', description: 'Ringkas target dan capaian pengolahan dua kegiatan dari satu workbook atau dua berkas.', definition: susenas },
  custom: { name: 'Susun sendiri', description: 'Mulai dari satu dataset wilayah dan atur kolom serta komponen sesuai kegiatan.', definition: custom },
}
export const templateDefinition = (id: TemplateId) => structuredClone(templates[id].definition)
