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
  const suggestion = await suggestCsv({
    file, definition, dataset: definition.datasets[0], template: 'pes', design: false, expectedRevision: 3,
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
})
