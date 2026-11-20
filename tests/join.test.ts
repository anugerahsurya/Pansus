import assert from 'node:assert/strict'
import { test } from 'node:test'
import { normalizeUpload, type InputFile } from '../packages/adapters/index'
import { definitionSchema, type Dataset, type Field } from '../packages/contracts/index'
import { templateDefinition } from '../templates/index'

const text = (name: string, rows: string): InputFile => ({ name, bytes: new TextEncoder().encode(rows) })
const field = (id: string, label: string, unit: Field['unit'] = 'count'): Field => ({ id, label, unit, aliases: [], nullable: true, public: true })

test('kolom dengan judul berbeda dapat dijoin tanpa menambah baris utama atau membaca kolom nonaktif', () => {
  const left: Dataset = { id: 'utama', label: 'Utama', grain: 'district', fields: [field('kode', 'Kode Tim', 'category'), field('target', 'Target'), { ...field('skip', 'Tidak ada di berkas'), enabled: false }] }
  const right: Dataset = { id: 'validasi', label: 'Validasi', grain: 'district', fields: [field('team_id', 'ID Tim', 'category'), field('valid', 'Valid')] }
  const joined: Dataset = {
    id: 'gabungan', label: 'Gabungan', grain: 'district',
    fields: [{ ...field('total', 'Jumlah valid'), derived: true }],
    join: { left: { dataset: 'utama', field: 'kode' }, right: { dataset: 'validasi', field: 'team_id' }, columns: { total: { side: 'right', field: 'valid' } } },
  }
  const draft = { ...templateDefinition('custom'), datasets: [left, right, joined], widgets: [] }
  assert.ok(definitionSchema.safeParse(draft).success)
  const files = {
    utama: text('utama.csv', 'wilayah,kode tim,target\n1303,ABC,10\n1371,xyz,20'),
    validasi: text('validasi.csv', 'wilayah,id tim,valid\n1303,abc,4\n1371,bbb,7'),
  }
  const { data, warnings } = normalizeUpload('custom', draft.datasets, files)
  assert.deepEqual(data.gabungan.rows.map(row => row.values.total), [4, null])
  assert.equal(Object.hasOwn(data.utama.rows[0].values, 'skip'), false)
  assert.equal(warnings[0].code, 'UNMATCHED_JOIN_ROWS')
  assert.throws(() => normalizeUpload('custom', draft.datasets, {
    ...files, validasi: text('ganda.csv', 'wilayah,id tim,valid\n1303,abc,4\n1371,ABC,7'),
  }), /berulang/)
})
