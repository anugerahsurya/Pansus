import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as xlsx from 'xlsx'
import { definitionSchema, type Dataset, type DatasetData } from '../packages/contracts/index'
import { formatDateTime } from '../packages/contracts/datetime'
import { evaluate, compileFormulas, evaluateCardFormula, interpolateTemplate, parseFormula } from '../packages/metrics/formula'
import { aggregate, delta, indicator, previousDay, sortRows, targetRatio, weightedTarget } from '../packages/metrics/index'
import { ImportError, normalizeUpload, previewSource, profileAnalysisFile, readDataset } from '../packages/adapters/index'
import { exampleFiles } from '../fixtures/synthetic/index'
import { templateDefinition } from '../templates/index'

const encode = (name: string, content: string) => ({ name, bytes: new TextEncoder().encode(content) })
const row = (code: string, values: DatasetData['rows'][number]['values']) => ({ code, name: code, values })
test('tanggal dan jam Excel serta CSV terdeteksi dan tersimpan hingga detik', () => {
  const dataset: Dataset = {
    id: 'wilayah', label: 'Wilayah', grain: 'district',
    fields: [
      { id: 'waktu', label: 'Waktu', unit: 'datetime', aliases: [], public: false, nullable: true },
      { id: 'jumlah', label: 'Jumlah', unit: 'count', aliases: [], public: true, nullable: false },
    ],
  }
  const seconds = [1, 5, 9, 13]
  const regions = ['1303', '1306', '1307', '1309']
  const labels = seconds.map(second => '20/11/2026 12:00:' + String(second).padStart(2, '0'))
  const canonical = seconds.map(second => '2026-11-20T12:00:' + String(second).padStart(2, '0'))
  const makeWorkbook = (date1904: boolean, bookType: 'xlsx' | 'xls') => {
    const book = xlsx.utils.book_new()
    book.Workbook = { WBProps: { date1904 } }
    const sheet = xlsx.utils.aoa_to_sheet([
      ['Wilayah', 'Waktu', 'Jumlah'],
      ...seconds.map((second, index) => [regions[index], Date.UTC(2026, 10, 20, 12, 0, second) / 86_400_000 + (date1904 ? 24_107 : 25_569), 46_000]),
    ])
    for (const index of seconds.keys()) sheet['B' + (index + 2)].z = 'dd/mm/yyyy hh:mm:ss'
    xlsx.utils.book_append_sheet(book, sheet, 'Data')
    return { name: 'uji.' + bookType, bytes: new Uint8Array(xlsx.write(book, { type: 'array', bookType })) }
  }
  const csv = encode('uji.csv', 'wilayah,waktu,jumlah\n' + labels.map((label, index) => [regions[index], label.replace(' ', '   '), 46_000].join(',')).join('\n'))

  for (const file of [csv, makeWorkbook(false, 'xlsx'), makeWorkbook(true, 'xlsx'), makeWorkbook(false, 'xls')]) {
    assert.deepEqual(previewSource(file, dataset, {}).columns.map(column => column.unit), ['count', 'datetime', 'count'])
    assert.equal(profileAnalysisFile(file, {}).columns[1].kind, 'datetime')
    const data = readDataset(file, dataset, {}, false)
    assert.deepEqual(data.rows.map(row => row.values.waktu), canonical)
    assert.deepEqual(data.rows.map(row => formatDateTime(String(row.values.waktu))), labels)
    assert.ok(data.rows.every(row => row.values.jumlah === 46_000))
    assert.deepEqual(sortRows(data.rows, 'waktu', true).map(row => row.values.waktu), [...canonical].reverse())
  }

  const invalidDate = encode('salah.csv', 'wilayah,waktu,jumlah\n1303,31/11/2026 12:00:01,46000')
  assert.throws(() => readDataset(invalidDate, dataset, {}, false), (error: unknown) => error instanceof ImportError && error.notice.code === 'INVALID_DATETIME')
})

const sampleDataset: Dataset = { id: 'sample', label: 'Contoh', grain: 'district', fields: ['a', 'b', 'c', 'd'].map(id => ({ id, label: id.toUpperCase(), aliases: [], public: true, unit: 'count', nullable: true, formula: id === 'd' ? 'A * B + C' : undefined })) }

test('kontrak seluruh template dan referensi widget', () => {
  for (const name of ['custom', 'pes', 'susenas'] as const) assert.ok(definitionSchema.safeParse(templateDefinition(name)).success)
  const definition = templateDefinition('pes')
  definition.datasets[0].fields.find(field => field.id === 'selesai')!.public = false
  assert.equal(definitionSchema.safeParse(definition).success, false)
})

test('kontrol PES dan definisi PPL, PML, final, gap', () => {
  const { data } = normalizeUpload('pes', templateDefinition('pes').datasets, exampleFiles('pes', 1))
  assert.equal(aggregate(data.sls, 'target').value, 244)
  assert.equal(aggregate(data.nonub, 'target').value, 37470)
  assert.equal(aggregate(data.ub, 'target').value, 250)
  assert.equal(aggregate(data.ub, 'final').value, 49)
  assert.equal(data.sls.detail?.filter(row => row.level === 'sls').length, 244)
  assert.ok(data.sls.detail?.some(row => row.code === '1303/040/001/000102' && row.parent === '1303/040/001'))
  for (const { values: v } of data.nonub.rows) {
    const pml = Number(v.completed) + Number(v.rejected) + Number(v.revoked)
    assert.equal(v.pml, pml)
    assert.equal(v.ppl, pml + Number(v.submitted))
    assert.equal(v.final, v.completed)
    assert.equal(v.gap, v.submitted)
  }
  assert.equal(targetRatio('2026-11-14', '2026-11-27', '2026-11-01', 1), 13 / 27)
  assert.ok(Math.abs(weightedTarget([{ target: 30, deadline: '2026-11-23' }, { target: 50, deadline: '2026-11-27' }], '2026-11-14', '2026-11-01', 0)! - ((30 * 14 / 23 + 50 * 14 / 27) / 80)) < 1e-12)
})

test('PES mendeteksi batch lintas format dan membedakan UB dari target per wilayah', () => {
  const files = exampleFiles('pes', 1)
  const datasets = templateDefinition('pes').datasets
  const { data: expected } = normalizeUpload('pes', datasets, files)
  const grid = (file: typeof files.sls) => new TextDecoder().decode(file.bytes).trim().split(/\r?\n/).map(line => line.split(','))
  const [slsHeaders, ...slsRows] = grid(files.sls)
  const slsLong = encode('ringkasan.tsv', [
    'Ekspor progres dari aplikasi',
    'level_2_full_code\tstatus\tjumlah',
    ...slsRows.flatMap(([code, ...counts]) => counts.map((count, index) => `${code}.0\t${slsHeaders[index + 1]}\t${Number(count || 0)}`)),
  ].join('\n'))
  const book = xlsx.utils.book_new()
  xlsx.utils.book_append_sheet(book, xlsx.utils.aoa_to_sheet([['Laporan penugasan']]), 'Petunjuk')
  xlsx.utils.book_append_sheet(book, xlsx.utils.aoa_to_sheet([['Data assignment'], [], ...grid(files.ub)]), 'Ekspor')
  const ubWorkbook = { name: 'assignment.xlsx', bytes: new Uint8Array(xlsx.write(book, { type: 'array', bookType: 'xlsx' })) }
  const [headers, ...records] = grid(files.nonub)
  const nonubJson = encode('assignment.json', JSON.stringify({ data: { rows: records.map(record => Object.fromEntries(headers.map((header, index) => [header, record[index]]))) } }))
  const { data, sources } = normalizeUpload('pes', datasets, { auto_1: ubWorkbook, auto_2: nonubJson, auto_3: slsLong })
  assert.deepEqual(sources, { sls: slsLong.name, ub: ubWorkbook.name, nonub: nonubJson.name })
  for (const slot of ['ub', 'nonub', 'sls']) assert.deepEqual(data[slot].rows.map(row => row.values), expected[slot].rows.map(row => row.values))
  assert.throws(() => normalizeUpload('pes', datasets, { auto_1: ubWorkbook, auto_2: files.ub, auto_3: slsLong }),
    (error: unknown) => error instanceof ImportError && error.notice.code === 'PES_UB_UNCERTAIN')
})

test('rumus aman, presedensi, null, siklus, satuan dan izin', () => {
  const check = (formula: string) => evaluate(parseFormula(formula).expression, { a: 2, b: 5, c: 3 })
  assert.deepEqual(check('A * B + C'), { value: 13 })
  assert.deepEqual(check('2*(5+3)'), { value: 16 })
  assert.equal(check('2 / (c - 3)').reason, 'Pembagi bernilai nol.')
  assert.equal(check('2 * missing').value, null)
  assert.equal(check('-2 * -3').value, 6)
  assert.deepEqual(evaluate(parseFormula('<A> * 10 + <B>', sampleDataset).expression, { a: 2, b: 5, c: 3 }), { value: 25 })
  assert.deepEqual(evaluate(parseFormula('round(sqrt(<a> * 8))', sampleDataset).expression, { a: 2, b: 5, c: 3 }), { value: 4 })
  const statsData: DatasetData = {
    rows: [
      { code: 'p1', name: 'Petugas Satu', values: { nilai: 10, periode: 'Triwulan I 2026' } },
      { code: 'p2', name: 'Petugas Dua', values: { nilai: 20, periode: 'Triwulan I 2026' } },
      { code: 'p3', name: 'Petugas Tiga', values: { nilai: 30, periode: 'Triwulan I 2026' } },
    ],
  }
  const statsDataset: Dataset = {
    id: 'petugas', label: 'Petugas', grain: 'person',
    fields: [
      { id: 'nilai', label: 'Nilai Capaian', unit: 'number', aliases: [], public: true, nullable: true },
      { id: 'periode', label: 'Periode Data', unit: 'category', aliases: [], public: true, nullable: true },
    ],
  }
  assert.equal(aggregate(statsData, 'nilai', { op: 'sum' }).value, 60)
  assert.equal(aggregate(statsData, 'nilai', { op: 'median' }).value, 20)
  assert.equal(aggregate(statsData, 'nilai', { op: 'min' }).value, 10)
  assert.equal(aggregate(statsData, 'nilai', { op: 'max' }).value, 30)
  assert.equal(aggregate(statsData, 'nilai', { op: 'variance' }).value, 100)
  assert.equal(aggregate(statsData, 'nilai', { op: 'stdev' }).value, 10)
  assert.equal(indicator(statsData, statsDataset, 'nilai', undefined, 'stdev').value, 10)
  assert.equal(evaluateCardFormula('sum(<nilai>) * 2', statsDataset, statsData).value, 120)
  assert.equal(evaluateCardFormula('stdev(<Nilai Capaian>) + <nilai>[0]', statsDataset, statsData).value, 20)
  assert.equal(evaluateCardFormula('variance(<nilai>)', statsDataset, statsData).value, 100)
  assert.equal(
    interpolateTemplate('Update di periode <Periode Data>[0] oleh <identitas>[0], total <sum(nilai)>, sd <stdev(nilai)>', [statsDataset], { petugas: statsData }, statsDataset),
    'Update di periode Triwulan I 2026 oleh Petugas Satu, total 60, sd 10',
  )
  assert.throws(() => parseFormula('2; 1'))
  assert.throws(() => parseFormula('b = 1'))
  const cycle = structuredClone(sampleDataset)
  cycle.fields[0].formula = 'd + 1'
  assert.throws(() => compileFormulas(cycle), /a → d → a/)
  const privateDataset = structuredClone(sampleDataset)
  privateDataset.fields[0].public = false
  assert.throws(() => compileFormulas(privateDataset), /kolom terbatas/)
  const incompatible = structuredClone(sampleDataset)
  incompatible.fields[0].unit = 'percent'
  incompatible.fields[3].formula = 'a + b'
  assert.throws(() => compileFormulas(incompatible), /Satuan/)
})

test('agregasi, rekap terpisah, delta kalender dan sorting numerik', () => {
  const data = { rows: [row('1', { a: 2, b: 5, c: 3, d: 13, score: 20, category: 'A' }), row('2', { a: 1, b: 4, c: 0, d: 4, score: null, category: 'B' }), row('3', { score: 40 })], reported: { score: 5 } }
  assert.equal(aggregate(data, 'd').value, 17)
  assert.equal(aggregate(data, 'd', { op: 'formula' }, sampleDataset).value, 30)
  assert.deepEqual(aggregate(data, 'score', { op: 'mean' }), { value: 30, coverage: 2, reason: undefined })
  assert.equal(aggregate(data, 'score', { op: 'reportedValue' }).value, 5)
  assert.equal(aggregate(data, 'category', { op: 'mode' }).value, null)
  assert.equal(aggregate(data, 'category', { op: 'none' }).value, null)
  const report = (a: number, b: number) => ({ rows: [row('1', { a, b })] })
  assert.ok(Math.abs(delta(report(42, 120), report(30, 100), sampleDataset, 'a', 'b').value! - 0.05) < 1e-12)
  assert.equal(delta(report(42, 120), undefined, sampleDataset, 'a', 'b').value, null)
  assert.equal(indirectRatio(), 10 / 12)
  function indirectRatio() { return aggregate({ rows: [row('1', { a: 1, b: 2 }), row('2', { a: 9, b: 10 })] }, 'a', { op: 'ratioOfSums', numerator: 'a', denominator: 'b' }).value }
  assert.equal(previousDay('2026-01-01'), '2025-12-31')
  assert.equal(previousDay('2024-03-01'), '2024-02-29')
  const rows = [row('null', { x: null }), row('100', { x: 100 }), row('2', { x: 2 }), row('10', { x: 10 })]
  assert.deepEqual(sortRows(rows, 'x', false).map(row => row.code), ['2', '10', '100', 'null'])
  assert.deepEqual(sortRows(rows, 'x', true).map(row => row.code), ['100', '10', '2', 'null'])
})

test('CSV, XLSX, XLS dan JSON memberi nilai yang sama dan alias tidak tergantung posisi', () => {
  const csv = encode('data.csv', '\ufeffKode wilayah;C;A;B\r\n1303;3;2;5\r\n1371;0;1;4')
  const reordered = encode('berubah.csv', 'B,A versi kedua,Kode wilayah,C\n5,2,1303,3\n4,1,1371,0')
  const json = encode('data.json', JSON.stringify({ data: { wilayah: [{ code: '1303', a: { nilai: 2 }, b: 5, c: 3 }, { code: '1371', a: { nilai: 1 }, b: 4, c: 0 }] } }))
  const sheet = xlsx.utils.aoa_to_sheet([['Kode wilayah', 'A', 'B', 'C'], ['1303 Solok', 2, 5, 3], ['1371', 1, 4, 0]])
  const book = xlsx.utils.book_new()
  xlsx.utils.book_append_sheet(book, sheet, 'Data')
  const external = structuredClone(sampleDataset)
  external.fields[0].aliases = ['A versi kedua']
  const datasets = [external]
  const files = [csv, reordered, json, ...(['xlsx', 'xls'] as const).map(ext => ({ name: `data.${ext}`, bytes: new Uint8Array(xlsx.write(book, { type: 'array', bookType: ext === 'xls' ? 'biff8' : 'xlsx' })) }))]
  const data = files.map(file => normalizeUpload('custom', datasets, { sample: file }, file.name.endsWith('.json') ? { sample: { jsonPath: 'data.wilayah', columns: { a: 'a.nilai' } } } : {}).data.sample.rows.map(({ code, values }) => [code, values]))
  for (const item of data) assert.deepEqual(item, [['1303', { a: 2, b: 5, c: 3, d: 13 }], ['1371', { a: 1, b: 4, c: 0, d: 4 }]])
  assert.throws(() => normalizeUpload('custom', datasets, { sample: encode('salah.xls', 'Kode wilayah,A,B,C\n1303,2,5,3') }), (error: unknown) => error instanceof ImportError && error.notice.code === 'INVALID_WORKBOOK')
  assert.throws(() => normalizeUpload('custom', datasets, { sample: encode('duplikat.csv', 'Kode wilayah,A,B,C\n1303,2,5,3\n1303,4,3,0') }), (error: unknown) => error instanceof ImportError && error.notice.location?.includes('baris 3') === true)
})

test('blok workbook Susenas–Seruti, formula dan rekap provinsi', () => {
  const { data, warnings, collection } = normalizeUpload('susenas', templateDefinition('susenas').datasets, exampleFiles('susenas', 1))
  assert.equal(data.susenas.rows.length, 19)
  assert.equal(data.seruti.rows.length, 19)
  assert.equal(data.susenas.rows[0].values.target, 210)
  assert.equal(data.seruti.rows[0].values.target, 80)
  assert.ok(Math.abs(Number(data.susenas.rows[0].values.progress) - 0.535) < 1e-10)
  assert.ok(Math.abs(Number(data.susenas.reported?.progress) - 0.715) < 1e-10)
  assert.equal(data.seruti.reported?.inti, 0.69)
  assert.deepEqual(collection?.map(item => [item.date, item.time, item.rows.length]), [['2026-03-10', null, 19], ['2026-03-17', '09:10', 19]])
  assert.deepEqual(warnings, [])
})
