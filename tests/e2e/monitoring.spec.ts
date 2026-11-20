import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { unzipSync } from 'fflate'
import * as xlsx from 'xlsx'
import { csvAnalysisStream } from '../../packages/contracts/csv-analysis'
import { exampleFiles } from '../../fixtures/synthetic/index'

const secret = 'Monitoring!2026'
const headers = { 'X-Monitoring-Request': '1' }
const fixture = (day: 0 | 1) => {
  const files = exampleFiles('pes', day)
  for (const slot of ['sls', 'nonub', 'ub']) {
    const lines = new TextDecoder().decode(files[slot].bytes).trim().split('\n')
    const first = lines[1].split(',')
    first[1] = String(Number(first[1]) - 1)
    first[2] = String(Number(first[2]) + 1)
    lines[1] = first.join(',')
    if (day === 1 && slot === 'sls') {
      lines[0] = 'SLS sedang,SLS selesai,level_2_full_code,SLS belum'
      for (let index = 1; index < lines.length; index++) {
        const [code, a, b, c] = lines[index].split(',')
        lines[index] = [b, c, code, a].join(',')
      }
    }
    files[slot] = { ...files[slot], bytes: new TextEncoder().encode(lines.join('\n')) }
  }
  return files
}
async function login(request: APIRequestContext, role = 'admin') {
  const response = await request.post('/api/auth/login', { headers, data: { email: `${role}@example.test`, password: secret } })
  expect(response.ok()).toBeTruthy()
}
async function importReady(request: APIRequestContext, id: string) {
  let job
  await expect.poll(async () => { job = await (await request.get(`/api/admin/imports/${id}/preview`)).json(); return job.status }).toBe('ready')
  return job!
}

test('konfigurasi CSV tersimpan bersama draf dan menolak pemetaan dataset asing', async ({ request }) => {
  await login(request)
  const created = await request.post('/api/admin/dashboards', { headers, data: { template: 'custom' } })
  expect(created.ok()).toBeTruthy()
  const { id } = await created.json()
  const path = `/api/admin/dashboards/${id}`
  const draft = await (await request.get(path)).json()
  const mapping = { headerRow: 1, region: 'wilayah pelaksanaan', columns: { target: 'volume', selesai: 'realisasi' } }
  const payload = { definition: draft.draft, expectedRevision: draft.draftRevision }
  const invalid = await request.patch(`${path}/draft`, { headers, data: { ...payload, mappings: { unknown: mapping } } })
  expect(invalid.status()).toBe(422)
  const saved = await request.patch(`${path}/draft`, { headers, data: { ...payload, mappings: { wilayah: mapping } } })
  expect(saved.ok()).toBeTruthy()
  const reloaded = await (await request.get(path)).json()
  expect(reloaded.mappings.wilayah).toEqual(mapping)
})

test('unggahan Excel mengaktifkan tombol Gemini dan pop-up progres sampai hasil siap', async ({ page }) => {
  await login(page.request)
  const created = await page.request.post('/api/admin/dashboards', { headers, data: { template: 'custom' } })
  const { id } = await created.json()
  await page.route(`**/api/admin/dashboards/${id}`, async route => {
    const response = await route.fetch()
    await route.fulfill({ response, json: { ...await response.json(), aiAvailable: true } })
  })
  let finish!: () => void
  const ready = new Promise<void>(resolve => { finish = resolve })
  await page.route(`**/api/admin/dashboards/${id}/ai-drafts`, async route => {
    expect(route.request().postData()).toContain('filename="progres.xlsx"')
    await ready
    await route.fulfill({
      contentType: csvAnalysisStream,
      body: [
        { type: 'progress', stage: 'mapping' },
        { type: 'progress', stage: 'validating' },
        { type: 'result', data: { model: 'gemini-test', rows: 1, warnings: [], fields: [], mapping: { region: 'wilayah', headerRow: 1, sheet: 'Progres' } } },
      ].map(event => JSON.stringify(event) + '\n').join(''),
    })
  })
  await page.goto(`/studio/${id}?tab=data`)
  const book = xlsx.utils.book_new()
  xlsx.utils.book_append_sheet(book, xlsx.utils.aoa_to_sheet([['wilayah', 'target', 'selesai'], ['1303', 10, 5]]), 'Progres')
  await page.getByLabel('Wilayah', { exact: true }).setInputFiles({
    name: 'progres.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from(xlsx.write(book, { type: 'array', bookType: 'xlsx' })),
  })
  const analyze = page.getByRole('button', { name: 'Analisis Excel Wilayah' })
  await expect(analyze).toBeEnabled()
  await analyze.click()
  const dialog = page.getByRole('dialog', { name: 'Analisis Excel Wilayah' })
  await expect(dialog.getByRole('progressbar')).toHaveJSProperty('value', 0)
  await dialog.getByRole('button', { name: 'Sembunyikan' }).click()
  await expect(dialog).toBeHidden()
  await expect(analyze).toBeDisabled()
  await page.getByRole('button', { name: 'Lihat progres analisis' }).click()
  finish()
  await expect(dialog.getByRole('progressbar')).toHaveJSProperty('value', 100)
  await dialog.getByRole('button', { name: 'Lihat usulan' }).click()
  await expect(page.getByRole('region', { name: 'Usulan Gemini' }).getByText(/1 wilayah diperiksa · Lembar Progres/)).toBeVisible()
})

test('Bantuan Gemini terlihat pada profil bawaan dan memberi petunjuk sesuai ketersediaan', async ({ page }) => {
  await login(page.request)
  const created = await page.request.post('/api/admin/dashboards', { headers, data: { template: 'pes' } })
  const { id } = await created.json()
  let aiAvailable = false
  await page.route(`**/api/admin/dashboards/${id}`, async route => {
    const response = await route.fetch()
    await route.fulfill({ response, json: { ...await response.json(), aiAvailable } })
  })
  await page.goto(`/studio/${id}?tab=data`)
  const help = page.getByRole('region', { name: 'Bantuan Gemini' })
  await expect(help.getByText(/Gemini belum tersedia/)).toBeVisible()
  await expect(help.getByText('Belum dikonfigurasi')).toBeVisible()
  await expect(help.getByRole('button', { name: 'Analisis berkas', exact: true })).toBeDisabled()
  aiAvailable = true
  await page.route(`**/api/admin/dashboards/${id}/ai-status`, route => route.fulfill({ json: { status: 'ready' } }))
  await page.reload()
  await help.getByRole('button', { name: 'Cek koneksi Gemini' }).click()
  await expect(help.getByText('Terhubung')).toBeVisible()
  await help.getByRole('button', { name: 'Pilih berkas per dataset' }).click()
  await expect(page.getByLabel('Cara memilih berkas')).toHaveValue('manual')
  const source = page.getByLabel('Non-UB', { exact: true })
  await source.setInputFiles({
    name: 'nonub.csv', mimeType: 'text/csv', buffer: Buffer.from('wilayah,target,selesai\n1303,10,5'),
  })
  await expect(help.getByRole('button', { name: 'Analisis CSV Non-UB', exact: true })).toBeEnabled()
})

test('draf Gemini dapat ditambah kolom dan sumber CSV bertahap untuk kondisi yang sama', async ({ page }) => {
  await login(page.request)
  const created = await page.request.post('/api/admin/dashboards', { headers, data: { template: 'custom' } })
  const { id } = await created.json()
  const path = `/api/admin/dashboards/${id}`
  const draft = await (await page.request.get(path)).json()
  await page.route(`**${path}`, async route => {
    const response = await route.fetch()
    await route.fulfill({ response, json: { ...await response.json(), aiAvailable: true } })
  })
  await page.route(`**${path}/ai-drafts`, async route => {
    await route.fulfill({
      contentType: csvAnalysisStream,
      body: JSON.stringify({ type: 'result', data: {
        model: 'gemini-test', rows: 1, warnings: [], fields: draft.draft.datasets[0].fields,
        mapping: { region: 'wilayah', columns: { target: 'sasaran', selesai: 'realisasi' }, headerRow: 1 },
        definition: draft.draft, expectedRevision: draft.draftRevision,
      } }) + '\n',
    })
  })
  const csv = (name: string, contents: string) => ({ name, mimeType: 'text/csv', buffer: Buffer.from(contents) })
  await page.goto(`/studio/${id}?tab=data`)
  await page.getByLabel('Tanggal kondisi').fill('2026-11-14')
  await page.getByLabel('Jam kondisi (WIB)').fill('13:00')
  await page.getByLabel('Wilayah', { exact: true }).setInputFiles(csv('progres.csv', 'wilayah,sasaran,realisasi,catatan\n1303,10,5,Lengkap'))
  await page.getByRole('button', { name: 'Analisis CSV Wilayah' }).click()
  await page.getByRole('button', { name: 'Lihat usulan' }).click()
  await page.getByRole('button', { name: 'Terapkan ke draf' }).click()
  await page.getByRole('button', { name: 'Atur kolom sumber' }).click()
  const fields = page.getByRole('region', { name: 'Kolom data' })
  await expect(fields.getByText('Target', { exact: false }).first()).toBeVisible()
  await expect(page.getByLabel('Judul kegiatan')).toHaveCount(0)
  await fields.getByRole('button', { name: 'Tambah kolom' }).click()
  await expect(fields.getByRole('textbox', { name: 'Nama kolom' })).toBeFocused()
  await fields.getByRole('textbox', { name: 'Nama kolom' }).fill('Catatan')
  await fields.getByRole('combobox', { name: 'Satuan' }).selectOption('category')
  await page.getByRole('button', { name: 'Simpan draf' }).click()
  await expect(page.getByText('Semua perubahan tersimpan')).toBeVisible()
  await page.getByRole('button', { name: 'Keterangan umum' }).click()
  await expect(page.getByRole('region', { name: 'Keterangan umum' }).getByLabel('Judul kegiatan')).toBeVisible()
  await expect(fields).toHaveCount(0)
  await page.getByText('Sensus Ekonomi', { exact: true }).click()
  await expect(page.getByRole('radio', { name: 'Sensus Ekonomi' })).toBeChecked()
  await expect(page.locator('.design-preview .hero')).toHaveCSS('background-color', 'rgb(247, 144, 57)')
  await page.getByRole('button', { name: 'Simpan draf' }).click()
  await expect(page.getByText('Semua perubahan tersimpan')).toBeVisible()

  const check = page.getByRole('button', { name: 'Periksa unggahan' })
  const apply = async (message = /Data tersimpan pada draf/) => {
    await check.click()
    await page.getByLabel('Kata sandi konfirmasi').fill(secret)
    await page.getByRole('button', { name: 'Terapkan hasil unggahan' }).click()
    await expect(page.getByText(message)).toBeVisible()
  }
  await page.getByRole('button', { name: 'Perbarui data', exact: true }).click()
  await expect(page.getByLabel('Wilayah', { exact: true })).toHaveJSProperty('value', 'C:\\fakepath\\progres.csv')
  await apply()
  await page.getByRole('button', { name: 'Tambah sumber data' }).click()
  await page.getByLabel('Nama sumber baru').fill('Validasi')
  await page.getByRole('button', { name: 'Simpan sumber' }).click()
  await expect(page.getByRole('heading', { name: '2 sumber data' })).toBeVisible()
  await expect(page.getByText('Tersimpan · progres.csv')).toBeVisible()
  await page.getByLabel('Validasi', { exact: true }).setInputFiles(csv('validasi.csv', 'wilayah,nilai\n1303,2'))
  await page.getByLabel('Jam kondisi (WIB)').fill('14:00')
  await expect(check).toBeDisabled()
  await page.getByRole('button', { name: /Pakai kondisi terakhir/ }).click()
  await apply()
  const after = await (await page.request.get(path)).json()
  expect(Object.keys(after.savedInputs.files)).toEqual(expect.arrayContaining(['wilayah', after.draft.datasets[1].id]))
  expect(after.preview.data.wilayah.rows[0].values.selesai).toBe(5)
  expect(after.preview.data[after.draft.datasets[1].id].rows[0].values.nilai).toBe(2)

  const published = await page.request.post(`${path}/publish`, { headers, data: { visibility: 'public', expectedRevision: after.draftRevision } })
  expect(published.ok()).toBeTruthy()
  await page.reload()
  await expect(page.getByRole('heading', { name: '2 sumber data' })).toBeVisible()
  await page.getByLabel('Tanggal kondisi').fill('2026-11-15')
  await page.getByLabel('Jam kondisi (WIB)').fill('14:00')
  await page.getByLabel('Wilayah', { exact: true }).setInputFiles(csv('progres-baru.csv', 'wilayah,sasaran,realisasi,catatan\n1303,10,8,Lengkap'))
  await expect(check).toBeDisabled()
  await page.getByLabel('Validasi', { exact: true }).setInputFiles(csv('validasi-baru.csv', 'wilayah,nilai\n1303,3'))
  await apply(/Pembaruan tersimpan/)
  const report = await (await page.request.get(`/api/d/${after.slug}`)).json()
  expect(report.condition).toEqual({ date: '2026-11-15', time: '14:00' })
  expect(report.data.wilayah.rows[0].values.selesai).toBe(8)
  expect(report.definition.theme).toBe('economy')
})

test('gulir pratinjau, profil dan tampilan progres petugas dengan undangan', async ({ page, request }) => {
  await login(page.request)
  await page.setViewportSize({ width: 1280, height: 600 })
  await page.goto('/template')
  const template = page.getByRole('article').filter({ has: page.getByRole('heading', { name: 'Pengolahan Susenas–Seruti' }) })
  await template.getByRole('button', { name: 'Gunakan contoh' }).click()
  const preview = page.getByRole('region', { name: 'Isi pratinjau dashboard' })
  await expect(preview.getByRole('heading', { name: 'Pengolahan Susenas–Seruti', exact: true })).toBeVisible()
  expect(await preview.evaluate(panel => panel.scrollHeight > panel.clientHeight)).toBeTruthy()
  expect(await page.evaluate(() => {
    const main = document.querySelector('main')!
    return document.scrollingElement!.scrollHeight - (main.getBoundingClientRect().bottom + scrollY)
  })).toBeLessThanOrEqual(1)
  await preview.focus()
  await page.keyboard.press('End')
  await expect(preview.getByRole('link', { name: /Buka tautan/ })).toBeInViewport()
  await page.getByRole('link', { name: 'Profil', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Ubah kata sandi' })).toBeVisible()
  const avatar = page.getByRole('radio', { name: 'Avatar 20', exact: true })
  await expect(page.getByRole('radio', { name: /^Avatar \d+$/ })).toHaveCount(20)
  await page.locator('.avatar-option').filter({ has: avatar }).click()
  await page.getByRole('button', { name: 'Simpan profil' }).click()
  await expect(page.getByText('Profil disimpan.')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Profil', exact: true }).locator('img')).toHaveAttribute('src', '/avatars/20.webp')
  await page.getByRole('button', { name: 'Mode gelap' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-mode', 'dark')
  await page.reload()
  await expect(page.getByRole('button', { name: 'Mode gelap' })).toHaveAttribute('aria-pressed', 'true')
  await expect(avatar).toBeChecked()

  const created = await page.request.post('/api/admin/dashboards', { headers, data: { template: 'custom' } })
  const { id } = await created.json()
  const route = `/api/admin/dashboards/${id}`
  const { draft, draftRevision, slug } = await (await page.request.get(route)).json()
  draft.datasets = [{ id: 'wilayah', grain: 'person', label: 'Petugas', fields: [{ id: 'progres', label: 'Progres', unit: 'percent' }] }]
  draft.widgets = [{ id: 'orang', title: 'Progres petugas', type: 'table', width: 'full', dataset: 'wilayah', fields: ['progres'], progressGroup: { field: 'progres' } }]
  const saved = await page.request.patch(`${route}/draft`, { headers, data: { definition: draft, expectedRevision: draftRevision } })
  expect(saved.ok()).toBeTruthy()
  const { draftRevision: revision } = await saved.json()
  const buffer = Buffer.from(['nama petugas,progres', ...Array.from({ length: 100 }, (_, i) => `Petugas ${i + 1},${['100%', '50%', '49%', ''][i % 4]}`)].join('\n'))
  const upload = await page.request.post(`${route}/imports`, { headers, multipart: { date: '2026-11-20', time: '10:00', wilayah: { name: 'petugas.csv', mimeType: 'text/csv', buffer } } })
  expect(upload.ok()).toBeTruthy()
  const job = await importReady(page.request, (await upload.json()).id)
  const { proof } = await (await page.request.post('/api/auth/confirm', { headers, data: { jobId: job.id, password: secret } })).json()
  const committed = await page.request.post(`/api/admin/imports/${job.id}/commit`, { headers, data: { proof, hash: job.hash, idempotencyKey: 'fcf43427-42e9-4c5b-b15f-44559fbcafbe' } })
  expect(committed.ok()).toBeTruthy()
  const publish = (visibility: string) => page.request.post(`${route}/publish`, { headers, data: { visibility, expectedRevision: revision } })
  expect((await publish('public')).status()).toBe(422)
  expect((await publish('invite')).ok()).toBeTruthy()
  expect((await request.get(`/api/d/${slug}`)).status()).toBe(404)
  expect((await page.request.patch(`${route}/access`, { headers, data: { visibility: 'link' } })).status()).toBe(422)
  await page.goto(`/d/${slug}`)
  const people = page.getByRole('region', { name: 'Tabel Petugas' })
  await expect(people.getByRole('row')).toHaveCount(101)
  for (const group of ['100% atau lebih (25)', '50%–<100% (25)', 'Di bawah 50% (25)', 'Belum ada angka (25)']) {
    await page.getByRole('button', { name: group, exact: true }).click()
    await expect(people.getByRole('row')).toHaveCount(26)
  }
})

async function uploadFromStudio(page: Page, day: 0 | 1) {
  const files = fixture(day)
  await page.getByLabel('Tanggal kondisi').fill(day ? '2026-11-14' : '2026-11-13')
  await page.getByLabel('Jam kondisi (WIB)').fill('14:00')
  const payload = (slot: string) => ({ name: files[slot].name, mimeType: 'text/csv', buffer: Buffer.from(files[slot].bytes) })
  if (!day) {
    await page.getByLabel('Tiga ekspor progres PES').setInputFiles(['ub', 'sls', 'nonub'].map(payload))
  } else {
    await page.getByLabel('Cara memilih berkas').selectOption('manual')
    for (const [label, slot] of [['SLS', 'sls'], ['Non-UB', 'nonub'], ['UB', 'ub']] as const) {
      await page.getByLabel(label, { exact: true }).setInputFiles(payload(slot))
    }
  }
  await page.getByRole('button', { name: 'Periksa unggahan' }).click()
  await expect(page.getByRole('heading', { name: 'Hasil pemeriksaan' })).toBeVisible()
  await expect(page.getByText('37.470', { exact: true })).toBeVisible()
  await page.getByLabel('Kata sandi konfirmasi').fill(secret)
  await page.getByRole('button', { name: 'Terapkan hasil unggahan' }).click()
  await expect(page.getByText(/Data tersimpan pada draf|Pembaruan tersimpan/)).toBeVisible()
}

test('PES melalui Studio, perubahan alias, tautan yang sama dan dua pembaca', async ({ page, browser }) => {
  await page.goto('/masuk')
  await page.getByLabel('Email', { exact: true }).fill('admin@example.test')
  await page.getByLabel('Kata sandi', { exact: true }).fill(secret)
  await page.getByRole('button', { name: 'Masuk', exact: true }).click()
  await page.getByRole('link', { name: 'Buat dashboard' }).click()
  await page.getByRole('button', { name: 'Gunakan contoh' }).first().click()
  await expect(page.getByRole('heading', { name: 'Progres Lapangan PES SE2026', level: 1 })).toBeVisible()
  const editor = page.getByLabel('Judul kegiatan')
  const live = page.getByRole('region', { name: 'Isi pratinjau dashboard' })
  await expect(live).toBeVisible()
  await editor.fill('Progres PES untuk pemeriksaan')
  await expect(live.getByRole('heading', { name: 'Progres PES untuk pemeriksaan' })).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: 'Buka navigasi' }).click()
  const navigation = page.getByRole('navigation', { name: 'Navigasi utama' })
  await expect(navigation.getByRole('link', { name: 'Studio pengelola' })).toHaveAttribute('aria-current', 'page')
  await page.keyboard.press('Escape')
  await expect(navigation).toBeHidden()
  await expect(page.getByRole('button', { name: 'Buka navigasi' })).toBeFocused()
  await expect(live).toBeHidden()
  await page.getByRole('button', { name: 'Pratinjau langsung', exact: true }).click()
  await expect(live.getByRole('heading', { name: 'Progres PES untuk pemeriksaan' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy()
  await page.setViewportSize({ width: 1280, height: 800 })
  await editor.fill('Progres Lapangan PES SE2026')
  await expect(page.getByRole('status').filter({ hasText: 'Semua perubahan tersimpan' })).toBeVisible()
  await page.getByRole('button', { name: 'Terbitkan & akses' }).click()
  await expect(page.getByRole('button', { name: 'Terbitkan dashboard' })).toBeDisabled()
  await page.getByRole('button', { name: 'Perbarui data', exact: true }).click()
  await uploadFromStudio(page, 0)
  await page.getByRole('button', { name: 'Terbitkan & akses' }).click()
  await page.getByLabel('Hak baca').selectOption('public')
  await page.getByRole('button', { name: 'Terbitkan dashboard' }).click()
  await expect(page.getByText('Dashboard terbit.')).toBeVisible()
  const readerPath = await page.getByRole('link', { name: 'Buka tautan pembaca' }).getAttribute('href')
  const reader = await browser.newContext()
  const readerPage = await reader.newPage()
  await readerPage.goto(new URL(readerPath!, page.url()).href)
  await expect(readerPage.locator('.hero-meta')).toContainText('13 November 2026')
  await page.getByRole('button', { name: 'Perbarui data', exact: true }).click()
  await uploadFromStudio(page, 1)
  await expect(page.getByRole('link', { name: 'Buka tautan pembaca' })).toHaveAttribute('href', readerPath!)
  await readerPage.reload()
  await expect(readerPage.locator('.hero-meta')).toContainText('14 November 2026')
  await expect(readerPage.getByText('+7,38%', { exact: true })).toBeVisible()
  const second = await browser.newPage({ viewport: { width: 390, height: 844 } })
  await second.goto(readerPage.url())
  await expect(second.locator('.hero-meta')).toContainText('14 November 2026')
  expect(await second.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy()
  await reader.close()
  await second.close()
})

test('dashboard menata kartu dan grafik berdampingan serta membuka rincian', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/')
  await expect(page.locator('.hero')).toHaveCSS('border-bottom-width', '0px')
  const cells = page.locator('.metric-cell')
  await expect(cells).toHaveCount(3)
  expect(new Set(await cells.evaluateAll(cards => cards.map(card => card.getBoundingClientRect().y))).size).toBe(1)
  const charts = page.locator('.dashboard-cell > .chart')
  await expect(charts).toHaveCount(2)
  expect(new Set(await charts.evaluateAll(cards => cards.map(card => card.getBoundingClientRect().y))).size).toBe(1)
  const details = page.getByRole('button', { name: 'Lihat rincian SLS selesai', exact: true })
  await details.click()
  const dialog = page.getByRole('dialog', { name: 'SLS selesai' })
  await expect(dialog.getByText('Perubahan H−1', { exact: true })).toBeVisible()
  await expect(dialog.getByText('+7,38%', { exact: true })).toBeVisible()
  await expect(dialog.getByRole('row')).toHaveCount(10)
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(details).toBeFocused()
  const barDetails = page.getByRole('button', { name: 'Lihat rincian Penyelesaian SLS per wilayah' })
  await barDetails.click()
  await expect(page.getByRole('dialog').getByRole('row')).toHaveCount(10)
  await page.getByRole('button', { name: 'Tutup rincian' }).click()
  await page.getByRole('combobox', { name: 'Kondisi data' }).selectOption({ index: 1 })
  await expect(page.locator('.hero-meta')).toContainText('13 November 2026')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(page.locator('.chart-fill').first()).toHaveCSS('transition-property', 'none')
  await page.setViewportSize({ width: 390, height: 844 })
  expect(new Set(await charts.evaluateAll(cards => cards.map(card => card.getBoundingClientRect().y))).size).toBe(2)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy()
})

test('PNG mencakup semua tabel dan dapat diunduh melalui pekerjaan', async ({ page, request }, info) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Progres Lapangan PES SE2026' })).toBeVisible()
  await page.screenshot({ path: info.outputPath('portal-desktop.png'), fullPage: true })
  await page.getByRole('button', { name: 'Unduh PNG', exact: true }).click()
  const download = page.getByRole('link', { name: 'Unduh PNG', exact: true })
  await expect(download).toBeVisible({ timeout: 35_000 })
  const response = await request.get((await download.getAttribute('href'))!)
  expect(response.ok()).toBeTruthy()
  const png = await response.body()
  expect(png.subarray(1, 4).toString()).toBe('PNG')
  expect(png.readUInt32BE(20)).toBeGreaterThan(2200)
  const saved = await Promise.all([page.waitForEvent('download'), download.click()])
  expect((await readFile((await saved[0].path())!)).equals(png)).toBeTruthy()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: info.outputPath('portal-ponsel.png'), fullPage: true })
})

test('rincian berjenjang dan ZIP untuk semua SLS', async ({ page, request }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Buka rincian Kab. Solok', exact: true }).click()
  await page.getByRole('button', { name: 'Buka rincian Kecamatan 040', exact: true }).click()
  await page.getByRole('button', { name: 'Buka rincian Desa/kelurahan 001', exact: true }).click()
  await expect(page.getByText('1303/040/001/000102', { exact: true })).toBeVisible()
  const report = await (await request.get('/api/d/progres-lapangan-pes')).json()
  const created = await (await request.post(`/api/dashboards/${report.id}/exports`, { headers, data: { releaseId: report.currentRelease, includeDetail: true } })).json()
  let job
  await expect.poll(async () => { job = await (await request.get(`/api/jobs/${created.id}`)).json(); return job.status }, { timeout: 45_000 }).toBe('ready')
  const downloaded = await request.get(`/api/exports/${created.id}/download`)
  expect(downloaded.ok()).toBeTruthy()
  const pages = unzipSync(new Uint8Array(await downloaded.body()))
  expect(Object.keys(pages).length).toBe(job!.pages)
  expect(job!.pages).toBeGreaterThan(8)
})

test('impor idempoten, konflik penutupan, lalu cabut tautan dan periksa undangan', async ({ request, playwright, baseURL }) => {
  await login(request)
  const created = await request.post('/api/admin/dashboards', { headers, data: { template: 'custom', title: 'Pilot akses' } })
  expect(created.ok()).toBeTruthy()
  const { id } = await created.json()
  const route = `/api/admin/dashboards/${id}`
  const body = (day: string) => ({ date: day, time: '15:00', wilayah: { name: 'wilayah.csv', mimeType: 'text/csv', buffer: Buffer.from('kode wilayah,target,selesai\n1303,100,30\n1371,100,40') } })
  const prepared = await request.post(`${route}/imports`, { headers, multipart: body('2026-11-14') })
  const upload = await prepared.json()
  expect(upload.status).toBe('uploaded')
  const job = await importReady(request, upload.id)
  const duplicate = await request.post(`${route}/imports`, { headers, multipart: body('2026-11-14') })
  expect((await duplicate.json()).id).toBe(job.id)
  const proof = async (job: { id: string }) => (await (await request.post('/api/auth/confirm', { headers, data: { jobId: job.id, password: secret } })).json()).proof
  const key = { hash: job.hash, idempotencyKey: 'd1a71a92-804a-4e31-b95a-3f88e5b14995', proof: await proof(job) }
  const committed = await request.post(`/api/admin/imports/${job.id}/commit`, { headers, data: key })
  expect(committed.ok()).toBeTruthy()
  const retry = await request.post(`/api/admin/imports/${job.id}/commit`, { headers, data: key })
  expect((await retry.json()).snapshotId).toBe((await committed.json()).snapshotId)
  const state = await (await request.get(route)).json()
  const published = await request.post(`${route}/publish`, { headers, data: { visibility: 'link', expectedRevision: state.draftRevision } })
  expect(published.ok()).toBeTruthy()
  const future = await (await request.post(`${route}/imports`, { headers, multipart: body('2026-11-15') })).json()
  const pending = await importReady(request, future.id)
  const pendingProof = await proof(pending)
  const closed = await request.post(`${route}/close`, { headers, data: { expectedActivityRevision: state.activityRevision } })
  expect(closed.ok()).toBeTruthy()
  const denied = await request.post(`/api/admin/imports/${pending.id}/commit`, { headers, data: { hash: pending.hash, proof: pendingProof, idempotencyKey: '138af859-31c0-4090-9ea7-d57e5f34296b' } })
  expect(denied.status()).toBe(409)
  expect((await denied.json()).code).toBe('ACTIVITY_CLOSED')
  const blockedUpload = await request.post(`${route}/imports`, { headers, multipart: body('2026-11-15') })
  expect(blockedUpload.status()).toBe(409)
  const grant = await (await request.post(`${route}/grants`, { headers, data: {} })).json()
  const anon = await playwright.request.newContext({ baseURL })
  const readerPath = `/api/d/${state.slug}`
  expect((await anon.get(readerPath)).status()).toBe(404)
  expect((await (await anon.get('/api/catalog')).json()).some((item: { slug: string }) => item.slug === state.slug)).toBeFalsy()
  expect((await anon.post('/api/share/exchange', { headers, data: { slug: state.slug, secret: grant.secret } })).ok()).toBeTruthy()
  expect((await (await anon.get(readerPath)).json()).activityStatus).toBe('closed')
  const queued = await (await anon.post(`/api/dashboards/${id}/exports`, { headers, data: { releaseId: (await published.json()).releaseId } })).json()
  expect(queued.status).toBe('queued')
  await request.delete(`${route}/grants/${grant.id}`, { headers })
  expect((await anon.get(readerPath)).status()).toBe(404)
  expect((await anon.get(`/api/jobs/${queued.id}`)).status()).toBe(404)
  await request.patch(`${route}/access`, { headers, data: { visibility: 'invite' } })
  await request.post(`${route}/grants`, { headers, data: { email: 'reader@example.test' } })
  expect((await anon.get(readerPath)).status()).toBe(404)
  await login(anon, 'reader')
  expect((await anon.get(readerPath)).ok()).toBeTruthy()
  expect((await anon.get(`${route}/preview`)).status()).toBe(403)
  const afterClose = await (await request.get(route)).json()
  expect((await request.post(`${route}/reopen`, { headers, data: { expectedActivityRevision: afterClose.activityRevision, reason: 'Lanjutkan pilot' } })).ok()).toBeTruthy()
  const reopened = await (await request.get(route)).json()
  const next = await (await request.post(`${route}/imports`, { headers, multipart: body('2026-11-15') })).json()
  const candidate = await importReady(request, next.id)
  const nextProof = await proof(candidate)
  const [commitRace, closeRace] = await Promise.all([
    request.post(`/api/admin/imports/${candidate.id}/commit`, { headers, data: { hash: candidate.hash, proof: nextProof, idempotencyKey: '44be8199-41f6-4407-823c-ba39c93137be' } }),
    request.post(`${route}/close`, { headers, data: { expectedActivityRevision: reopened.activityRevision } }),
  ])
  expect([commitRace, closeRace].filter(response => response.ok())).toHaveLength(1)
  expect([commitRace, closeRace].filter(response => response.status() === 409)).toHaveLength(1)
  expect((await request.post(`${route}/archive`, { headers, data: { expectedRevision: reopened.draftRevision } })).ok()).toBeTruthy()
  expect((await anon.get(readerPath)).status()).toBe(404)
  expect((await request.get(route)).ok()).toBeTruthy()
  await anon.dispose()
})
