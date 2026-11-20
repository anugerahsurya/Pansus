import assert from 'node:assert/strict'
import { test } from 'node:test'
import { suggestCsv } from '../apps/api/src/gemini'
import { exampleFiles } from '../fixtures/synthetic/index'
import { templateDefinition } from '../templates/index'

function response(output: object) {
  return Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(output) }] } }] })
}

test('Gemini melewati kuota dan menolak usulan yang menukar status BPS', async () => {
  process.env.GEMINI_API_KEY = 'uji-unit'
  const definition = templateDefinition('pes')
  const file = exampleFiles('pes', 0).sls
  const attempted: string[] = []
  const stages: string[] = []
  const suggestion = await suggestCsv({
    file, definition, dataset: definition.datasets[0], template: 'pes', design: false, expectedRevision: 3,
    onProgress: stage => stages.push(stage),
  }, async (url, request) => {
    attempted.push(String(url).split('/').at(-1)!.split(':')[0])
    const body = JSON.parse(String(request?.body))
    const profile = JSON.parse(body.contents[0].parts[0].text)
    assert.ok(profile.columns.every((column: object) => !Object.hasOwn(column, 'values')))
    assert.doesNotMatch(String(request?.body), /uji-unit|1303/)
    if (attempted.length === 1) return Response.json({ error: { status: 'RESOURCE_EXHAUSTED' } }, { status: 429 })
    return response({ region: 0, fields: [
      { field: 'belum', column: attempted.length === 2 ? 2 : 1 },
      { field: 'sedang', column: attempted.length === 2 ? 1 : 2 },
      { field: 'selesai', column: 3 },
    ] })
  })
  assert.deepEqual(attempted, ['gemini-4-carbon', 'gemini-4-argon', 'gemini-4-hydrogen'])
  assert.deepEqual(stages, ['reading', 'mapping', 'mapping', 'validating', 'mapping', 'validating'])
  assert.deepEqual({ ...suggestion.mapping.columns }, { belum: 'belum', sedang: 'sedang', selesai: 'selesai' })
  assert.equal(suggestion.model, 'gemini-4-hydrogen')
  assert.equal(suggestion.rows, 9)
  assert.equal(suggestion.expectedRevision, 3)
})

test('draf CSV membatasi data yang dikirim dan menjaga unit serta akses kolom', async () => {
  process.env.GEMINI_API_KEY = 'uji-unit'
  const definition = templateDefinition('custom')
  const file = { name: 'unggahan.csv', bytes: new TextEncoder().encode('kode wilayah,target,realisasi,persentase,nama,catatan\n1303,50,25,50%,Identitas Rahasia,Isi Privat') }
  const suggestion = await suggestCsv({
    file, definition, dataset: definition.datasets[0], template: 'custom', design: true, expectedRevision: 0,
  }, async (_url, request) => {
    const body = JSON.parse(String(request?.body))
    const profile = JSON.parse(body.contents[0].parts[0].text)
    assert.deepEqual(profile.columns.map((column: { header?: string }) => column.header), ['kode wilayah', 'target', 'realisasi', 'persentase', undefined])
    assert.doesNotMatch(String(request?.body), /Identitas Rahasia|Isi Privat|1303|50%|unggahan\.csv/)
    return response({ region: 0, fields: [{ column: 1, unit: 'count' }, { column: 2, unit: 'count' }, { column: 3, unit: 'percentage' }, { column: 5, unit: 'category' }], progress: [{ actual: 2, target: 1 }] })
  })
  const output = suggestion.definition!
  assert.deepEqual(output.datasets[0].fields.map(({ label, unit, public: visible }) => [label, unit, visible]), [
    ['target', 'count', true], ['realisasi', 'count', true], ['persentase', 'percent', true], ['catatan', 'category', false],
  ])
  assert.deepEqual(output.widgets.map(widget => widget.type), ['progress', 'table'])
  assert.equal(output.datasets[0].fields[2].scale, 'percentage')
  assert.equal(suggestion.mapping.columns?.kolom_6, 'catatan')

  const nextDataset = { ...definition.datasets[0], id: 'validasi', label: 'Validasi' }
  const nextDefinition = { ...output, datasets: [...output.datasets, nextDataset] }
  const second = await suggestCsv({
    file: { name: 'validasi.csv', bytes: new TextEncoder().encode('wilayah,target,terverifikasi\n1303,12,20') },
    definition: nextDefinition, dataset: nextDataset, template: 'custom', design: true, expectedRevision: 1,
  }, async () => response({ region: 0, fields: [{ column: 1, unit: 'count' }, { column: 2, unit: 'count' }], progress: [{ actual: 2, target: 1 }] }))
  assert.deepEqual(second.definition?.datasets[0], output.datasets[0])
  assert.deepEqual(second.definition?.datasets[1].fields.map(field => field.label), ['target', 'terverifikasi'])
  assert.deepEqual(second.definition?.widgets.slice(0, 2), output.widgets)
  assert.deepEqual(second.definition?.widgets[2], {
    id: 'tabel_2', type: 'table', version: 1, width: 'full', title: 'Rincian Validasi', dataset: 'validasi', fields: ['kolom_2', 'kolom_3'],
  })
})

test('rekomendasi mempertimbangkan banyak wilayah, banyak kategori, dan 100 petugas', async () => {
  process.env.GEMINI_API_KEY = 'uji-unit'
  const definition = templateDefinition('custom')
  const base = { definition, dataset: definition.datasets[0], template: 'custom' as const, design: true, expectedRevision: 1 }
  const file = (content: string) => ({ name: 'fixture.csv', bytes: new TextEncoder().encode(content) })
  const regions = ['1303', '1304', '1305', '1306', '1307', '1308', '1371']
  const run = (count: number, parts: number[]) => suggestCsv({
    ...base, file: file(['wilayah,total,a,b,c,d,e,f', ...regions.slice(0, count).map((code, i) => `${code},${22 + i},${1 + i},1,2,3,5,10`)].join('\n')),
  }, async () => response({ region: 0, fields: [], progress: [], composition: { total: 1, parts } }))

  const crowded = await run(7, [2, 3, 4, 5, 6, 7])
  assert.deepEqual(crowded.definition?.widgets.map(widget => widget.type), ['table'])
  assert.ok(crowded.recommendations?.some(note => note.includes('7 wilayah')))
  assert.deepEqual((await run(3, [2, 3, 4, 5, 6, 7])).definition?.widgets.map(widget => widget.type), ['bars', 'table'])
  const composition = await suggestCsv({
    ...base, file: file('wilayah,total,belum,sedang,selesai\n1303,10,1,2,7\n1371,20,2,6,12'),
  }, async () => response({ region: 0, fields: [], progress: [], composition: { total: 1, parts: [2, 3, 4] } }))
  assert.deepEqual(composition.definition?.widgets.map(widget => widget.type), ['donut', 'table'])

  const people = ['nama petugas,progres (%)', ...Array.from({ length: 100 }, (_, i) => `Petugas Uji ${i + 1},${['100%', '50%', '49%', ''][i % 4]}`)].join('\n')
  const suggested = await suggestCsv({ ...base, file: file(people) }, async (_url, request) => {
    assert.doesNotMatch(String(request?.body), /Petugas Uji|nama petugas|49%/)
    return response({ region: 0, fields: [{ column: 1, unit: 'percentage' }], progress: [] })
  })
  assert.equal(suggested.grain, 'person')
  assert.equal(suggested.rows, 100)
  assert.deepEqual(suggested.definition?.widgets.map(widget => widget.type), ['table'])
  assert.deepEqual(suggested.definition?.widgets[0].progressGroup, { field: 'kolom_2' })
})
