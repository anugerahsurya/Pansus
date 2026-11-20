import { parse } from 'csv-parse/sync'
import { unzipSync } from 'fflate'
import * as xlsx from 'xlsx'
import { activeFields, dateSchema, joinIdentity, timeSchema, type CollectionReport, type DataRow, type Dataset, type DatasetData, type Field, type Notice, type SnapshotData, type TemplateId, type UploadMapping, type Value, type Values } from '../contracts/index'
import { analysisFormat } from '../contracts/csv-analysis'
import { applyFormulas } from '../metrics/index'
import { findRegion, pesRegions, sumbar } from '../../templates/regions'

export type InputFile = { name: string; bytes: Uint8Array }
const MAX_ROWS = 10_000
const MAX_COLUMNS = 100
const regionHeaders = ['kode wilayah', 'kode_wilayah', 'wilayah', 'level_2_full_code', 'kode kab/kota', 'nama kab/kota', 'code', 'kode', 'kabupaten/kota']
const personHeaders = ['nama petugas', 'nama petugas lapangan', 'nama pencacah', 'nama pengawas', 'nama pegawai', 'nama peserta', 'nama operator', 'nama lengkap', 'nama', 'full name', 'name', 'id petugas', 'kode petugas', 'petugas id', 'petugas', 'enumerator']
const personHeader = (input: string) => input.replace(/[_-]/g, ' ').replace(/\s+/g, ' ').trim()
const statusHeaders = ['status', 'assignment_status', 'status assignment', 'status penugasan', 'status sls']
const countHeaders = ['jumlah', 'count', 'total', 'jumlah penugasan']
const headerScan = 25
const normalize = (value: unknown) => String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
const statusFields = ['open', 'draft', 'submitted', 'completed', 'rejected', 'revoked']
const num = (value: unknown) => typeof value === 'number' ? value : 0
const own = (object: object, key: string) => Object.hasOwn(object, key)
type Source = { headers: string[]; rows: { cells: unknown[]; location: string; percentColumns?: Set<number> }[]; headerRow?: number; sheet?: string }

export class ImportError extends Error {
  constructor(public readonly notice: Notice) { super(notice.message) }
}
function invalid(code: string, message: string, location?: string): never {
  throw new ImportError({ code, message, location })
}

function workbook(file: InputFile) {
  const [a, b, c, d] = file.bytes
  const extension = file.name.toLowerCase().split('.').at(-1)
  const zip = a === 0x50 && b === 0x4b && c === 3 && d === 4
  const biff = (a === 0xd0 && b === 0xcf && c === 0x11 && d === 0xe0) || (a === 0x09 && [0x00, 0x02, 0x04, 0x08].includes(b))
  if ((extension === 'xlsx' && !zip) || (extension === 'xls' && !biff)) invalid('INVALID_WORKBOOK', 'Isi berkas tidak sesuai dengan format Excel yang dipilih.', file.name)
  try {
    if (zip) {
      let expanded = 0
      unzipSync(file.bytes, { filter(entry) {
        expanded += entry.originalSize
        if (expanded > 48 * 1024 * 1024) invalid('WORKBOOK_TOO_LARGE', 'Isi workbook terlalu besar. Simpan lembar kegiatan sebagai berkas terpisah.', file.name)
        return false
      } })
    }
    return xlsx.read(file.bytes, { type: 'array', sheetRows: MAX_ROWS + 100, cellFormula: true, cellNF: true, cellStyles: false, cellHTML: false })
  } catch (error) {
    if (error instanceof ImportError) throw error
    invalid('INVALID_WORKBOOK', 'Berkas Excel tidak dapat dibaca. Jika terenkripsi, simpan salinan sebagai XLSX atau CSV.', file.name)
  }
}

function cell(sheet: xlsx.WorkSheet, row: number, column: number, formatted = false) {
  const item = sheet[xlsx.utils.encode_cell({ r: row, c: column })]
  return cellValue(item, formatted)
}

function cellValue(item: xlsx.CellObject | undefined, formatted: boolean) {
  if (!item) return null
  if (item.t === 'e' || (item.f && item.v === undefined)) return { excelError: true }
  if (formatted && typeof item.v === 'number' && /^0\d+$/.test(item.w ?? '')) return item.w
  return item.v ?? null
}

type HeaderMatch = (headers: string[]) => boolean

function readExcel(file: InputFile, mapping: UploadMapping, matches?: HeaderMatch): Source {
  const book = workbook(file)
  const candidates = (mapping.sheet ? [mapping.sheet] : book.SheetNames).flatMap(name => {
    const sheet = book.Sheets[name]
    if (!matches || !sheet?.['!ref']) return []
    const range = xlsx.utils.decode_range(sheet['!ref'])
    const first = mapping.headerRow ? mapping.headerRow - 1 : range.s.r
    const last = mapping.headerRow ? first : Math.min(range.e.r, first + headerScan - 1)
    for (let r = first; r <= last; r++) {
      const headers = Array.from({ length: Math.min(MAX_COLUMNS, range.e.c + 1) }, (_, c) => normalize(cell(sheet, r, c)))
      if (matches(headers)) return [{ name, row: r + 1 }]
    }
    return []
  })
  if (candidates.length > 1) invalid('AMBIGUOUS_SHEET', 'Beberapa lembar cocok. Isi Nama lembar di Pemetaan berkas.', file.name)
  const name = mapping.sheet || candidates[0]?.name || book.SheetNames[0]
  const sheet = book.Sheets[name]
  if (!sheet?.['!ref']) invalid('SHEET_MISSING', 'Lembar yang dipilih kosong atau tidak tersedia.', file.name)
  const range = xlsx.utils.decode_range(sheet['!ref'])
  const fullEnd = sheet['!fullref'] ? xlsx.utils.decode_range(sheet['!fullref']).e.r : range.e.r
  const header = (mapping.headerRow ?? candidates[0]?.row ?? range.s.r + 1) - 1
  const end = Math.min(range.e.r, (mapping.stopRow ?? range.e.r + 1) - 1)
  if (range.e.c >= MAX_COLUMNS || (mapping.stopRow ?? fullEnd + 1) - header > MAX_ROWS + 1 || header >= end) invalid('INVALID_RANGE', 'Pilih judul dan rentang hingga 10.000 baris dan 100 kolom.', name)
  const cols = Array.from({ length: range.e.c + 1 }, (_, i) => i)
  return {
    sheet: name, headerRow: header + 1,
    headers: cols.map(column => normalize(cell(sheet, header, column))),
    rows: Array.from({ length: end - header }, (_, i) => {
      const r = header + i + 1
      const percentColumns = new Set<number>()
      const cells = cols.map(column => {
        const item = sheet[xlsx.utils.encode_cell({ r, c: column })]
        if (item?.t === 'n' && /\d\s*%/.test(item.w ?? '') && /%/.test((item.z ?? '').replace(/"[^"]*"|\\./g, ''))) percentColumns.add(column)
        return cellValue(item, true)
      })
      return { cells, percentColumns, location: `${name}, baris ${r + 1}` }
    }),
  }
}

function nested(value: unknown, path: string) {
  return path.split('.').reduce<unknown>((item, key) => item !== null && typeof item === 'object' && !Array.isArray(item) && own(item, key) ? (item as Record<string, unknown>)[key] : undefined, value)
}

function jsonSource(text: string, file: InputFile, mapping: UploadMapping, matches?: HeaderMatch): Source {
  let parsed: unknown
  try { parsed = JSON.parse(text) } catch { invalid('INVALID_JSON', 'Periksa sintaks JSON.', file.name) }
  let path = mapping.jsonPath
  if (!path && !Array.isArray(parsed) && matches) {
    const candidates = ['data', 'rows', 'results', 'records', 'data.rows', 'data.records'].filter(key => {
      const list = nested(parsed, key)
      return Array.isArray(list) && list.slice(0, headerScan).some(row => row && typeof row === 'object' && !Array.isArray(row) && matches(Object.keys(row).map(normalize)))
    })
    if (candidates.length > 1) invalid('AMBIGUOUS_JSON', 'Ada beberapa daftar data yang cocok. Isi jalur daftar JSON pada pemetaan lanjutan.', file.name)
    path = candidates[0]
  }
  const root = path ? nested(parsed, path) : parsed
  if (!Array.isArray(root) || root.some(row => !row || typeof row !== 'object' || Array.isArray(row))) invalid('INVALID_JSON_ROWS', 'Pilih jalur yang menunjuk ke daftar objek data.', file.name)
  if (root.length > MAX_ROWS) invalid('TOO_MANY_ROWS', 'Maksimum 10.000 baris per dataset.', file.name)
  const headers = [...new Set([...root.flatMap(row => Object.keys(row)), mapping.region, ...Object.values(mapping.columns ?? {})].filter((key): key is string => Boolean(key)))].sort()
  if (headers.length > MAX_COLUMNS) invalid('TOO_MANY_COLUMNS', 'Maksimum 100 kolom.', file.name)
  return { headers: headers.map(normalize), rows: root.map((row, i) => ({ cells: headers.map(header => own(row, header) ? row[header] : nested(row, header)), location: `${path || '$'}[${i}]` })) }
}

function readCsv(text: string, file: InputFile, mapping: UploadMapping, matches?: HeaderMatch): Source {
  const candidates = [',', ';', '\t'].flatMap(delimiter => {
    try {
      const parsed = parse(text, { delimiter, bom: true, trim: true, skip_empty_lines: true, relax_column_count: true, info: true, max_record_size: 50_000 }) as unknown as { record: string[]; info: { lines: number } }[]
      const detected = matches ? parsed.slice(0, headerScan).findIndex(entry => matches(entry.record.map(normalize))) : -1
      const header = mapping.headerRow ? parsed.findIndex(entry => entry.info.lines === mapping.headerRow) : Math.max(0, detected)
      const length = parsed[header]?.record.length ?? 0
      return length > 1 && parsed.length > header + 1 && header >= 0 ? [{ parsed, header, length, matched: matches?.(parsed[header].record.map(normalize)) ?? false }] : []
    } catch { return [] }
  }).sort((a, b) => Number(b.matched) - Number(a.matched) || b.length - a.length)
  const source = candidates[0]
  if (!source || source.length > MAX_COLUMNS) invalid('INVALID_CSV', 'Periksa judul kolom, pemisah, dan tanda kutip CSV.', file.name)
  const entries = source.parsed.slice(source.header + 1).filter(row => !mapping.stopRow || row.info.lines <= mapping.stopRow)
  if (entries.length > MAX_ROWS) invalid('TOO_MANY_ROWS', 'Maksimum 10.000 baris per dataset.', file.name)
  return { headerRow: source.parsed[source.header].info.lines, headers: source.parsed[source.header].record.map(normalize), rows: entries.map(({ record, info }) => {
    const location = `${file.name}, baris ${info.lines}`
    if (record.length !== source.length) invalid('COLUMN_COUNT', 'Jumlah nilai berbeda dari jumlah kolom pada judul.', location)
    return { cells: record, location }
  }) }
}

function source(file: InputFile, mapping: UploadMapping, matches?: HeaderMatch) {
  const extension = file.name.split('.').at(-1)?.toLowerCase()
  if (extension === 'xlsx' || extension === 'xls') return readExcel(file, mapping, matches)
  if (extension !== 'csv' && extension !== 'tsv' && extension !== 'json') invalid('UNSUPPORTED_FILE', 'Pilih berkas CSV, TSV, XLSX, XLS, atau JSON.', file.name)
  let text: string
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(file.bytes) } catch { invalid('ENCODING', 'Simpan berkas teks dengan pengkodean UTF-8.', file.name) }
  return extension === 'json' ? jsonSource(text, file, mapping, matches) : readCsv(text, file, mapping, matches)
}

function numericInput(text: string) {
  const clean = text.includes(',') ? text.replace(/\./g, '').replace(',', '.') : text
  return /^-?\d+(?:\.\d+)?$/.test(clean) ? Number(clean) : NaN
}

function value(input: unknown, field: Field, location: string, blankZero: boolean, excelPercent = false) {
  if (input == null || input === '') {
    if (blankZero) return 0
    if (!field.nullable) invalid('VALUE_REQUIRED', `Isi kolom ${field.label}.`, location)
    return null
  }
  if (typeof input !== 'string' && typeof input !== 'number') invalid('INVALID_CELL', `Baca ulang kolom ${field.label}; sel harus berisi nilai atau rumus dengan hasil tersimpan.`, location)
  if (field.unit === 'category') return String(input).trim().slice(0, 250)
  const raw = String(input).trim()
  const percentText = field.unit === 'percent' && raw.endsWith('%')
  const text = percentText ? raw.replace(/\s*%$/, '') : raw
  const result = numericInput(text)
  if (Number.isNaN(result)) invalid('INVALID_NUMBER', `Kolom ${field.label} harus berisi angka.`, location)
  if (!Number.isFinite(result) || Math.abs(result) > 1e11 || (field.unit === 'count' && (!Number.isSafeInteger(result) || result < 0))) invalid('INVALID_NUMBER', `Nilai ${field.label} di luar rentang yang didukung.`, location)
  return field.unit === 'percent' && !excelPercent && (percentText || field.scale !== 'fraction') ? result / 100 : result
}

export function profileAnalysisFile(file: InputFile, mapping: Pick<UploadMapping, 'sheet' | 'headerRow' | 'stopRow'>, identity?: string) {
  if (!analysisFormat(file.name)) invalid('AI_FILE_FORMAT', 'Pilih berkas CSV atau Excel (XLSX/XLS) untuk bantuan Gemini.')
  const parsed = source(file, mapping, headers => headers.some(header => regionHeaders.includes(header) || personHeaders.includes(personHeader(header)) || Boolean(identity && header === normalize(identity))))
  const rows = parsed.rows.filter(row => row.cells.some(item => item != null && item !== '') && !row.cells.every((item, index) => normalize(item) === parsed.headers[index]))
  const columns = parsed.headers.map((header, index) => {
    const values = rows.map(row => row.cells[index]).filter(item => item != null && item !== '')
    const data = values.filter(item => !province(item))
    const matched = data.map(item => findRegion(regionText(item))?.code)
    const region = matched.length > 0 && values.length === rows.length && matched.every(Boolean)
    const uniqueRegions = region && new Set(matched).size === matched.length
    const person = (personHeaders.includes(personHeader(header)) || Boolean(identity && header === normalize(identity))) && (values.length === rows.length && values.length > 0)
    const numeric = values.map(item => numericInput(String(item).trim().replace(/\s*%$/, '')))
    const allNumbers = numeric.length > 0 && numeric.every(Number.isFinite)
    const percent = allNumbers && values.some(item => String(item).trim().endsWith('%'))
    const excelPercent = allNumbers && rows.filter(row => row.percentColumns?.has(index)).length === values.length
    const kind = !values.length ? 'empty' : !allNumbers ? 'category' : excelPercent ? 'fraction' : percent ? 'percentage' :
      numeric.every(item => Number.isSafeInteger(item) && item >= 0) ? 'count' : 'number'
    return { index, header, region, uniqueRegions, person, kind, explicitRegion: regionHeaders.includes(header), unitInterval: allNumbers && numeric.every(item => item >= 0 && item <= 1), nullable: values.length < rows.length } as const
  })
  return { headerRow: parsed.headerRow!, sheet: parsed.sheet, columns }
}

function match(headers: string[], aliases: string[], label: string, location: string, optional = false) {
  const wanted = aliases.map(normalize)
  const positions = headers.flatMap((header, index) => wanted.includes(header) ? [index] : [])
  if (!positions.length && optional) return -1
  if (positions.length !== 1) invalid(positions.length ? 'AMBIGUOUS_HEADER' : 'COLUMN_MISSING', `${label}: ${positions.length ? 'judul kolom ganda' : 'judul kolom belum ditemukan'}. Atur pemetaan kolom.`, location)
  return positions[0]
}
const province = (input: unknown) => /^(prov(?:insi)?[. ]+(sumbar|sumatera barat)|sumatera barat|jumlah|total)$/i.test(String(input ?? '').trim())

const fieldHeaders = (field: Field) => [field.id, field.label, ...field.aliases].map(normalize)
const slsFields = ['belum', 'sedang', 'selesai']
const regionText = (input: unknown) => String(input ?? '').trim().replace(/^(13\d{2})[.,]0+$/, '$1')

function readStatusRows(parsed: Source, key: number, statuses: Field[], file: InputFile): DataRow[] {
  const status = match(parsed.headers, statusHeaders, 'Status', file.name)
  const count = match(parsed.headers, countHeaders, 'Jumlah', file.name)
  const rows = new Map<string, DataRow>()
  const seen = new Set<string>()
  for (const { cells, location } of parsed.rows) {
    if (cells.every(item => item == null || item === '') || province(cells[key]) || normalize(cells[key]) === parsed.headers[key]) continue
    const region = findRegion(regionText(cells[key]))
    if (!region) invalid('UNKNOWN_REGION', 'Kode atau nama kabupaten/kota tidak ditemukan pada master Sumatera Barat.', location)
    const field = statuses.find(item => fieldHeaders(item).includes(normalize(cells[status])))
    if (!field) invalid('UNKNOWN_STATUS', 'Status pada baris ini tidak dikenali untuk dataset yang dipilih.', location)
    const pair = `${region.code}/${field.id}`
    if (seen.has(pair)) invalid('DUPLICATE_STATUS', 'Ada lebih dari satu rekap untuk wilayah dan status yang sama. Gunakan satu rekap per kombinasi.', location)
    seen.add(pair)
    if (!rows.has(region.code)) rows.set(region.code, { ...region, values: Object.fromEntries(statuses.map(item => [item.id, 0])), source: location })
    rows.get(region.code)!.values[field.id] = value(cells[count], { ...field, nullable: false }, `${location}, Jumlah`, false)
  }
  return [...rows.values()]
}

export function readDataset(file: InputFile, dataset: Dataset, mapping: UploadMapping, pes: boolean): DatasetData {
  const isPerson = dataset.grain === 'person'
  const keys = mapping.region ? [normalize(mapping.region)] : isPerson ? personHeaders : regionHeaders
  const inputFields = activeFields(dataset).filter(field => !field.formula && !field.derived)
  const statuses = inputFields.filter(field => (dataset.id === 'sls' ? slsFields : statusFields).includes(field.id))
  const canPivot = pes && statuses.length === inputFields.length && !Object.keys(mapping.columns ?? {}).length
  const isLong = (headers: string[]) => canPivot && headers.some(header => statusHeaders.includes(header)) && headers.some(header => countHeaders.includes(header))
  const aliases = inputFields.flatMap(field => mapping.columns?.[field.id] ? [normalize(mapping.columns[field.id])] : fieldHeaders(field))
  const headersForKey = (headers: string[]) => isPerson && !mapping.region ? headers.map(personHeader) : headers
  const parsed = source(file, mapping, headers => headersForKey(headers).some(header => keys.includes(header)) && (isLong(headers) || headers.some(header => aliases.includes(header))))
  const identityHeaders = headersForKey(parsed.headers)
  const namedKey = isPerson && !mapping.region ? keys.find(item => identityHeaders.includes(item)) : undefined
  const key = match(identityHeaders, namedKey ? [namedKey] : keys, isPerson ? 'Nama atau kode petugas' : 'Kode wilayah', file.name)
  if (isLong(parsed.headers) && !parsed.headers.some(header => aliases.includes(header))) {
    const rows = readStatusRows(parsed, key, statuses, file)
    if (!rows.length) invalid('EMPTY_DATA', 'Tidak ada baris kabupaten/kota yang dapat dibaca.', file.name)
    return { rows }
  }
  const fields = inputFields.map(field => {
    const column = mapping.columns?.[field.id]
    return { field, index: match(parsed.headers, column ? [column] : fieldHeaders(field), field.label, file.name, pes && !column && statuses.some(status => status.id === field.id)) }
  })
  const reportedFields = activeFields(dataset).filter(field => field.formula).map(field => ({
    field, index: match(parsed.headers, mapping.columns?.[field.id] ? [mapping.columns[field.id]] : [field.id, field.label, ...field.aliases], field.label, file.name, true),
  })).filter(field => field.index >= 0)
  if (fields.every(field => field.index === -1) || new Set([key, ...fields.map(field => field.index).filter(index => index >= 0)]).size !== fields.filter(field => field.index >= 0).length + 1) invalid('MAPPING_CONFLICT', 'Pilih kolom sumber yang berbeda untuk setiap indikator.', file.name)
  const rows: DataRow[] = []
  const seen = new Set<string>()
  let reported: Values | undefined
  for (const { cells, location, percentColumns } of parsed.rows) {
    if (cells.every(item => item == null || item === '')) continue
    const input = cells[key]
    if (normalize(input) === parsed.headers[key]) continue
    if (isPerson) {
      const name = typeof input === 'string' || typeof input === 'number' ? String(input).trim() : ''
      if (!name || name.length > 120) invalid('INVALID_PERSON', 'Isi nama atau kode petugas hingga 120 karakter.', location)
      const code = normalize(name)
      if (seen.has(code)) invalid('DUPLICATE_PERSON', 'Identitas petugas muncul lebih dari sekali. Gunakan satu baris per orang atau pilih kolom kode yang unik.', location)
      seen.add(code)
      const values = Object.fromEntries(fields.map(({ field, index }) => [field.id, value(cells[index], field, `${location}, ${field.label}`, false, percentColumns?.has(index))]))
      rows.push({ code, name, values, source: location })
      continue
    }
    const isProvince = province(input)
    const region = isProvince ? null : findRegion(regionText(input))
    if (pes && isProvince) continue
    if (!isProvince && !region) invalid('UNKNOWN_REGION', 'Kode atau nama kabupaten/kota tidak ditemukan pada master Sumatera Barat.', location)
    const values: Values = Object.fromEntries(fields.map(({ field, index }) => [field.id, value(cells[index], field, `${location}, ${field.label}`, pes, percentColumns?.has(index))]))
    if (isProvince) {
      if (reported) invalid('DUPLICATE_PROVINCE', 'Baris rekap provinsi muncul lebih dari sekali.', location)
      for (const { field, index } of reportedFields) values[field.id] = value(cells[index], field, `${location}, ${field.label}`, false, percentColumns?.has(index))
      reported = values
      continue
    }
    if (seen.has(region!.code)) invalid('DUPLICATE_REGION', `Wilayah ${region!.name} muncul lebih dari sekali.`, location)
    seen.add(region!.code)
    rows.push({ ...region!, values, source: location })
  }
  if (!rows.length) invalid('EMPTY_DATA', isPerson ? 'Tidak ada baris petugas yang dapat dibaca.' : 'Tidak ada baris kabupaten/kota yang dapat dibaca.', file.name)
  return applyFormulas(dataset, { rows, reported })
}

export function previewSource(file: InputFile, dataset: Dataset | undefined, mapping: UploadMapping) {
  const isIdentity = (header: string) => mapping.region ? header === normalize(mapping.region) :
    dataset?.grain === 'person' ? personHeaders.includes(personHeader(header)) :
      regionHeaders.includes(header) || personHeaders.includes(personHeader(header))
  const parsed = source(file, mapping, headers => headers.some(isIdentity))
  const rows = parsed.rows.filter(row => row.cells.some(cell => cell != null && cell !== ''))
  const columns = parsed.headers.map((label, index) => {
    const entries = rows.filter(row => row.cells[index] != null && row.cells[index] !== '')
    const values = entries.map(row => String(row.cells[index]).trim())
    const numbers = values.map(value => numericInput(value.replace(/\s*%$/, '')))
    const numeric = numbers.length > 0 && numbers.every(Number.isFinite)
    const fractions = numeric && entries.every(row => row.percentColumns?.has(index))
    const percentages = numeric && (fractions || /[%]|\bpersen\b/i.test(label) || values.every(value => value.endsWith('%')))
    const codes = values.some(value => /^0\d+$/.test(value)) || /\b(kode|id|nip|nik)\b/i.test(label.replace(/[_-]/g, ' '))
    const unit: Field['unit'] = percentages ? 'percent' : !numeric || codes ? 'category' :
      numbers.every(value => Number.isSafeInteger(value) && value >= 0) ? 'count' : 'number'
    return { label, unit, scale: percentages ? (fractions ? 'fraction' as const : 'percentage' as const) : undefined,
      selectable: Boolean(label) && parsed.headers.indexOf(label) === index && parsed.headers.lastIndexOf(label) === index }
  })
  return {
    columns, rows: rows.slice(0, 6).map(row => row.cells.map((cell, index): Value => row.percentColumns?.has(index) && typeof cell === 'number' ? `${Number((cell * 100).toFixed(2))}%` :
      typeof cell === 'string' ? cell.slice(0, 200) : typeof cell === 'number' && Number.isFinite(cell) ? cell : null)),
    count: rows.length, identity: parsed.headers.find(isIdentity), sheet: parsed.sheet, headerRow: parsed.headerRow,
  }
}

export function joinDataset(dataset: Dataset, input: SnapshotData): { data: DatasetData; matched: number; unmatched: number } {
  const join = dataset.join!
  const left = input[join.left.dataset], right = input[join.right.dataset]
  if (!left || !right) invalid('JOIN_SOURCE_REQUIRED', `Lengkapi kedua sumber untuk menggabungkan ${dataset.label}.`)
  const valueKey = (row: DataRow, field: string) => normalize(field === joinIdentity ? row.code : row.values[field])
  const lookup = new Map<string, DataRow>()
  for (const row of right.rows) {
    const key = valueKey(row, join.right.field)
    if (!key) continue
    if (lookup.has(key)) invalid('DUPLICATE_JOIN_KEY', `Kunci pada tabel pasangan untuk ${dataset.label} berulang. Pilih kolom lain yang unik.`, row.source)
    lookup.set(key, row)
  }
  const fields = activeFields(dataset)
  let matched = 0
  const rows = left.rows.map(row => {
    const other = lookup.get(valueKey(row, join.left.field))
    if (other) matched++
    const values = Object.fromEntries(fields.map(field => {
      const column = join.columns[field.id]
      return [field.id, (column.side === 'left' ? row : other)?.values[column.field] ?? null]
    }))
    return { code: row.code, name: row.name, values }
  })
  return { data: { rows }, matched, unmatched: rows.length - matched }
}

function susenasBlocks(file: InputFile, datasets: Dataset[], mapping: UploadMapping): SnapshotData {
  const book = workbook(file)
  const name = mapping.sheet || book.SheetNames.find(item => /^NEW /i.test(item)) || book.SheetNames[0]
  const sheet = book.Sheets[name]
  if (!sheet) invalid('SHEET_MISSING', 'Lembar yang dipilih tidak tersedia.', file.name)
  const title = (mapping.headerRow ?? 2) - 1
  if (!normalize(cell(sheet, title, 1) || cell(sheet, title - 1, 1)).includes('kab/kota') || normalize(cell(sheet, title, 2)) !== 'target' || normalize(cell(sheet, title, 14)) !== 'target' || !normalize(cell(sheet, title - 1, 2)).includes('susenas') || !normalize(cell(sheet, title - 1, 14)).includes('seruti')) invalid('BLOCK_HEADER', 'Pilih lembar yang memuat judul Susenas (C) dan Seruti (O) dengan judul Target pada baris berikutnya.', name)
  const columns: Record<string, Record<string, number>> = {
    susenas: { target: 2, pencacahan: 3, clean_k: 8, error_k: 9, olah_k: 10, clean_kp: 11, error_kp: 12, olah_kp: 13, progress: 19 },
    seruti: { target: 14, inti_clean: 15, inti: 16, mak_clean: 17, mak: 18 },
  }
  const result: SnapshotData = {}
  for (const dataset of datasets) {
    const selectedColumns = { ...columns[dataset.id] }
    for (const field of dataset.fields.filter(item => !own(selectedColumns, item.id) && !item.formula && !item.derived)) {
      const header = mapping.columns?.[field.id] ?? field.label
      const headers = Array.from({ length: MAX_COLUMNS }, (_, column) => normalize(cell(sheet, title, column)))
      selectedColumns[field.id] = match(headers, [header, ...field.aliases], field.label, name)
    }
    const rows: DataRow[] = []
    const seen = new Set<string>()
    let reported: Values | undefined
    for (let index = title + 1; index < (mapping.stopRow ?? title + 21); index++) {
      const raw = cell(sheet, index, 1, true)
      const location = `${name}, baris ${index + 1}`
      if (!raw) continue
      const official = province(raw)
      const fields = dataset.fields.filter(field => own(selectedColumns, field.id) && (official || !field.formula))
      const values = Object.fromEntries(fields.map(field => [field.id, value(cell(sheet, index, selectedColumns[field.id]), field, `${location}, ${field.label}`, false)]))
      if (official) { reported = values; break }
      const region = findRegion(String(raw))
      if (!region || seen.has(region.code)) invalid(region ? 'DUPLICATE_REGION' : 'UNKNOWN_REGION', 'Periksa nama atau duplikat kabupaten/kota.', location)
      seen.add(region.code)
      rows.push({ ...region, values, source: location })
    }
    if (rows.length !== sumbar.length) invalid('COVERAGE', 'Blok harus berisi 19 kabupaten/kota. Periksa baris akhir dan judul.', name)
    result[dataset.id] = applyFormulas(dataset, { rows, reported })
  }
  return result
}

const months = ['januari', 'februari', 'maret', 'april', 'mei', 'juni', 'juli', 'agustus', 'september', 'oktober', 'november', 'desember']
function collectionReports(file: InputFile): CollectionReport[] | undefined {
  const sheet = workbook(file).Sheets.KirimBackupSplit
  if (!sheet) return undefined
  const status = (input: unknown, location: string) => {
    if (input == null || input === '') return null
    if (typeof input === 'boolean') return input
    if (['true', '1', 'ya', 'sudah', 'v', '✓'].includes(normalize(input))) return true
    if (['false', '0', 'belum', 'tidak'].includes(normalize(input))) return false
    invalid('COLLECTION_STATUS', 'Status pengumpulan harus berisi Sudah, Belum, atau kosong.', location)
  }
  return [2, 5].map((start, index) => {
    const label = normalize(cell(sheet, 1, index ? 5 : 0))
    const match = label.match(/^kondisi (\d{1,2}) ([a-z]+) (\d{4})(?: pukul (\d{1,2})[.:](\d{2}) wib)?$/)
    const month = match ? months.indexOf(match[2]) + 1 : 0
    const parsedDate = match && dateSchema.safeParse(`${match[3]}-${String(month).padStart(2, '0')}-${match[1].padStart(2, '0')}`)
    const time = match?.[4] ? `${match[4].padStart(2, '0')}:${match[5]}` : null
    if (!parsedDate || !parsedDate.success || (time && !timeSchema.safeParse(time).success) || normalize(cell(sheet, 4, start)) !== 'backup' || normalize(cell(sheet, 4, start + 1)) !== 'split') invalid('COLLECTION_HEADER', 'Periksa tanggal kondisi dan judul Backup/Split.', 'KirimBackupSplit, baris 2–5')
    const seen = new Set<string>()
    const rows = []
    for (let i = 5; i < 24; i++) {
      const location = `KirimBackupSplit, baris ${i + 1}`
      const region = findRegion(String(cell(sheet, i, 1) ?? ''))
      if (!region || seen.has(region.code)) invalid('COLLECTION_REGION', 'Periksa kode wilayah atau duplikat pada blok pengumpulan.', location)
      seen.add(region.code)
      const received = cell(sheet, i, start + 2)
      rows.push({ ...region, backup: status(cell(sheet, i, start), location), split: status(cell(sheet, i, start + 1), location), received: typeof received === 'string' && /^\d{1,2} [a-z]+(?: \d{1,2}:\d{2})?$/i.test(received.trim()) ? received.trim() : null })
    }
    return { date: parsedDate.data, time, rows }
  })
}

function readSlsDetail(file: InputFile, reference: DatasetData, mapping: UploadMapping): DataRow[] {
  const parsed = source(file, /\.xlsx?$/i.test(file.name) ? { ...mapping, sheet: mapping.sheet || 'Sheet9' } : mapping)
  const matchColumn = (aliases: string[], label: string) => match(parsed.headers, aliases, label, file.name)
  const key = matchColumn(['ssls', 'kode sls lengkap', 'sls'], 'Kode SSLS')
  const countFields = ['target', 'belum', 'sedang', 'selesai'].map(id => ({ id, column: matchColumn([id], id), field: { label: id, unit: 'count', nullable: true } as Field }))
  const parents = new Map<string, DataRow>()
  const facts = new Map<string, DataRow>()
  const totals = new Map<string, Values>()
  for (const { cells, location } of parsed.rows) {
    if (cells.every(item => item == null || item === '')) continue
    const code = String(cells[key] ?? '').trim().match(/^(13\d{2})[\s/]+(\d{3})[\s/]+(\d{3})[\s/]+(\d{4})[\s/]*(\d{2})$/)
    if (!code) invalid('INVALID_SSLS', 'Isi SSLS dalam bentuk 1303 040 001 0009 02.', location)
    const [, district, subdistrict, village, block, suffix] = code
    const counts = Object.fromEntries(countFields.map(({ id, column, field }) => [id, value(cells[column], field, location, true)]))
    if (counts.target !== 1 || num(counts.belum) + num(counts.sedang) + num(counts.selesai) !== counts.target) invalid('INVALID_SLS_STATUS', 'Setiap baris SSLS harus memiliki target 1 dan tepat satu status.', location)
    const subdistrictKey = `${district}/${subdistrict}`
    const villageKey = `${subdistrictKey}/${village}`
    const blockKey = `${villageKey}/${block}${suffix}`
    if (facts.has(blockKey)) invalid('DUPLICATE_SSLS', `Kode SSLS ${blockKey} muncul lebih dari sekali.`, location)
    facts.set(blockKey, { code: blockKey, parent: villageKey, name: `SLS ${block}${suffix}`, level: 'sls', values: counts, source: location })
    const accumulate = (values: Values) => countFields.forEach(({ id }) => { values[id] = num(values[id]) + num(counts[id]) })
    for (const region of [
      { code: subdistrictKey, parent: district, name: `Kecamatan ${subdistrict}`, level: 'subdistrict' as const },
      { code: villageKey, parent: subdistrictKey, name: `Desa/kelurahan ${village}`, level: 'village' as const },
    ]) {
      if (!parents.has(region.code)) parents.set(region.code, { ...region, values: {} })
      accumulate(parents.get(region.code)!.values)
    }
    if (!totals.has(district)) totals.set(district, {})
    accumulate(totals.get(district)!)
  }
  if (totals.size !== reference.rows.length || reference.rows.some(row => !totals.has(row.code) || countFields.some(({ id }) => totals.get(row.code)![id] !== row.values[id]))) invalid('SSLS_RECONCILIATION', 'Rincian SSLS harus cocok dengan target dan semua status pada berkas ringkasan SLS.', file.name)
  return [...parents.values(), ...facts.values()].sort((a, b) => a.code.localeCompare(b.code))
}

function resolvePesBatch(datasets: Dataset[], files: Record<string, InputFile>): Record<string, InputFile> {
  const batch = [files.auto_1, files.auto_2, files.auto_3]
  if (batch.some(file => !file) || Object.keys(files).some(slot => !['auto_1', 'auto_2', 'auto_3', 'sls_detail'].includes(slot))) {
    invalid('FILE_SLOTS', 'Pilih tiga berkas ringkasan dalam deteksi otomatis. Rincian SSLS dapat ditambahkan secara terpisah.')
  }
  const sls = datasets.find(dataset => dataset.id === 'sls')!
  const ub = datasets.find(dataset => dataset.id === 'ub')!
  const probe = (file: InputFile, dataset: Dataset) => {
    try { return readDataset(file, dataset, {}, true) }
    catch (error) { if (!(error instanceof ImportError)) throw error; return undefined }
  }
  const slsCandidates = batch.filter(file => probe(file, sls))
  if (slsCandidates.length !== 1) invalid('PES_SLS_UNCERTAIN', 'Tidak ditemukan tepat satu ekspor ringkasan SLS. Gunakan Pilih per dataset untuk memeriksa berkas atau memilih lembar dan judul.')
  const assignments = batch.filter(file => file !== slsCandidates[0])
  const parsed = assignments.map(file => probe(file, ub))
  if (parsed.some(data => !data)) invalid('PES_ASSIGNMENT_UNKNOWN', 'Salah satu ekspor assignment belum dapat dibaca. Gunakan Pilih per dataset untuk melihat letak kesalahannya.')
  const ubCandidates = parsed.flatMap((data, index) => data!.rows.length === pesRegions.length && pesRegions.every(([code, , , expected]) =>
    data!.rows.some(row => row.code === code && statusFields.reduce((sum, field) => sum + num(row.values[field]), 0) === expected)) ? [index] : [])
  if (ubCandidates.length !== 1) invalid('PES_UB_UNCERTAIN', 'Belum dapat membedakan UB dari Non-UB berdasarkan target UB per wilayah. Gunakan Pilih per dataset untuk mengoreksi berkas.')
  const [index] = ubCandidates
  return { sls: slsCandidates[0], ub: assignments[index], nonub: assignments[1 - index], ...(files.sls_detail ? { sls_detail: files.sls_detail } : {}) }
}

export function calculatePesDataset(slot: string, data: DatasetData) {
  for (const [code, name, slsTarget, ubTarget] of pesRegions) {
    const row = data.rows.find(row => row.code === code)
    if (!row) invalid('COVERAGE', `Data wilayah ${name} belum tersedia pada slot ${slot.toUpperCase()}.`)
    const v = row.values
    if (slot === 'sls') {
      v.target = slsFields.reduce((sum, field) => sum + num(v[field]), 0)
      if (v.target !== slsTarget) invalid('SLS_TARGET', `Jumlah status SLS ${name} harus sesuai target ${slsTarget}.`, row.source)
    } else {
      v.target = statusFields.reduce((sum, field) => sum + num(v[field]), 0)
      v.pml = num(v.completed) + num(v.rejected) + num(v.revoked)
      v.ppl = v.pml + num(v.submitted)
      v.final = v.completed
      v.gap = num(v.ppl) - num(v.pml)
      if (slot === 'ub' && v.target !== ubTarget) invalid('UB_TARGET', `Jumlah status UB ${name} harus sesuai target ${ubTarget}.`, row.source)
    }
  }
  if (data.rows.length !== pesRegions.length) invalid('COVERAGE', `Terdapat wilayah di luar sembilan satker sampel pada slot ${slot.toUpperCase()}.`)
}

export function normalizeUpload(template: TemplateId, datasets: Dataset[], files: Record<string, InputFile>, mappings: Record<string, UploadMapping> = {}) {
  if (template === 'pes' && ['auto_1', 'auto_2', 'auto_3'].some(slot => own(files, slot))) {
    files = resolvePesBatch(datasets, files)
    mappings = {}
  }
  const sources = Object.fromEntries(Object.entries(files).map(([slot, file]) => [slot, file.name]))
  const warnings: Notice[] = []
  const data: SnapshotData = {}
  let collection: CollectionReport[] | undefined
  if (template === 'susenas' && files.workbook) {
    if (Object.keys(files).length !== 1 || !/\.xlsx?$/i.test(files.workbook.name)) invalid('FILE_SLOTS', 'Pakai satu workbook Excel atau isi slot Susenas dan Seruti secara terpisah.')
    Object.assign(data, susenasBlocks(files.workbook, datasets, mappings.workbook ?? {}))
    collection = collectionReports(files.workbook)
  } else {
    const inputs = datasets.filter(dataset => !dataset.join)
    const expected = new Set(inputs.map(dataset => dataset.id))
    if (template === 'pes') expected.add('sls_detail')
    if (Object.keys(files).some(key => !expected.has(key))) invalid('FILE_SLOTS', 'Terdapat slot berkas yang tidak diperlukan.')
    for (const dataset of inputs) {
      const file = files[dataset.id]
      if (!file) invalid('FILE_REQUIRED', `Pilih berkas ${dataset.label}.`)
      data[dataset.id] = readDataset(file, dataset, mappings[dataset.id] ?? {}, template === 'pes')
    }
  }
  if (template === 'pes') {
    for (const slot of ['sls', 'nonub', 'ub']) {
      calculatePesDataset(slot, data[slot])
      const dataset = datasets.find(dataset => dataset.id === slot)!
      data[slot] = applyFormulas(dataset, data[slot])
    }
    const same = data.nonub.rows.every(row => {
      const ub = data.ub.rows.find(item => item.code === row.code)!
      return statusFields.every(field => row.values[field] === ub.values[field])
    })
    if (same) invalid('DUPLICATE_INPUT', 'Berkas Non-UB dan UB berisi nilai yang sama. Periksa pilihan berkas.')
    if (files.sls_detail) data.sls.detail = readSlsDetail(files.sls_detail, data.sls, mappings.sls_detail ?? {})
  }
  for (const dataset of datasets.filter(item => item.join)) {
    const joined = joinDataset(dataset, data)
    data[dataset.id] = joined.data
    if (joined.unmatched) warnings.push({ code: 'UNMATCHED_JOIN_ROWS', message: `${dataset.label}: ${joined.unmatched} baris dari tabel utama tidak punya pasangan. Kolom pasangannya dikosongkan.` })
  }
  for (const [id, dataset] of Object.entries(data)) {
    if (template === 'susenas' && !dataset.reported) warnings.push({ code: 'NO_PROVINCE', message: `Rekap provinsi resmi ${id} belum tersedia.` })
    const definition = datasets.find(item => item.id === id)
    const fields = definition ? activeFields(definition) : []
    for (const field of fields.filter(field => field.formula)) {
      const missing = dataset.rows.filter(row => row.values[field.id] == null).length
      if (missing) warnings.push({ code: 'FORMULA_EMPTY', message: `${field.label} kosong pada ${missing} wilayah. Periksa komponen rumus.` })
    }
  }
  return { data, warnings, collection, sources }
}
