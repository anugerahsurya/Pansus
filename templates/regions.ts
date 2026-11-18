export const pesRegions = [
  ['1303', 'Kab. Solok', 27, 23, 27], ['1306', 'Kab. Padang Pariaman', 29, 29, 25],
  ['1307', 'Kab. Agam', 28, 28, 23], ['1309', 'Kab. Pasaman', 23, 26, 23],
  ['1312', 'Kab. Pasaman Barat', 29, 27, 25], ['1371', 'Kota Padang', 34, 44, 27],
  ['1372', 'Kota Solok', 23, 25, 27], ['1375', 'Kota Bukittinggi', 26, 24, 27],
  ['1376', 'Kota Payakumbuh', 25, 24, 25],
] as const

export const sumbar = [
  ['1301', 'Kab. Kepulauan Mentawai'], ['1302', 'Kab. Pesisir Selatan'], ['1303', 'Kab. Solok'],
  ['1304', 'Kab. Sijunjung'], ['1305', 'Kab. Tanah Datar'], ['1306', 'Kab. Padang Pariaman'],
  ['1307', 'Kab. Agam'], ['1308', 'Kab. Lima Puluh Kota'], ['1309', 'Kab. Pasaman'],
  ['1310', 'Kab. Solok Selatan'], ['1311', 'Kab. Dharmasraya'], ['1312', 'Kab. Pasaman Barat'],
  ['1371', 'Kota Padang'], ['1372', 'Kota Solok'], ['1373', 'Kota Sawahlunto'],
  ['1374', 'Kota Padang Panjang'], ['1375', 'Kota Bukittinggi'], ['1376', 'Kota Payakumbuh'],
  ['1377', 'Kota Pariaman'],
] as const

const normalizeName = (text: string) => text.toLowerCase().normalize('NFKD').replace(/[^a-z0-9 ]/g, '').replace(/^(kabupaten|kab|kota)\s+/, prefix => prefix.startsWith('kota') ? 'kota ' : 'kab ').replace(/\s+/g, ' ').trim()
const byCode = new Map<string, string>(sumbar)
const byName = new Map(sumbar.flatMap(([code, name]) => [[normalizeName(name), code], [normalizeName(name).split(' ').slice(1).join(' '), code]] as [string, string][]))
// Bare “Solok” is ambiguous between the city and the regency.
byName.delete('solok')
export function findRegion(input: string) {
  const text = input.trim()
  const prefixed = text.match(/^(\d{4})(?:\s|$)/)?.[1]
  const code = prefixed ?? byName.get(normalizeName(text)) ?? ''
  const name = byCode.get(code)
  return name ? { code, name } : null
}

export const pesPace = { start: '2026-11-01', offsets: { ppl: 0, pml: 1, final: 1 } }
