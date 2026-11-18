import * as xlsx from 'xlsx'
import type { TemplateId } from '../../packages/contracts/index'
import type { InputFile } from '../../packages/adapters/index'
import { pesRegions, sumbar } from '../../templates/regions'

const encode = (name: string, content: string): InputFile => ({ name, bytes: new TextEncoder().encode(content) })
const csv = (name: string, rows: (string | number)[][]) => encode(name, rows.map(row => row.join(',')).join('\n') + '\n')
export const exampleDates = { pes: ['2026-11-13', '2026-11-14'], susenas: ['2026-03-10', '2026-03-11'] } as const
export function exampleFiles(template: Exclude<TemplateId, 'custom'>, day: 0 | 1): Record<string, InputFile> {
  if (template === 'pes') {
    const headers = ['wilayah', 'open', 'draft', 'submitted by pencacah', 'completed by pengawas', 'rejected by pengawas', 'revoked by pengawas']
    const sls: (string | number)[][] = [['level_2_full_code', 'belum', 'sedang', 'selesai']]
    const nonub: (string | number)[][] = [headers]
    const ub: (string | number)[][] = [headers]
    const slsDetail: (string | number)[][] = [['ssls', 'target', 'belum', 'sedang', 'selesai']]
    const done = [18, 21, 22, 15, 19, 28, 13, 19, 20]
    pesRegions.forEach(([code, , total, ubTarget], index) => {
      const finished = done[index] - (day ? 0 : 2)
      const notStarted = index % 3 + 1
      sls.push([code, notStarted, total - finished - notStarted, finished])
      for (let order = 0; order < total; order++) {
        const open = order < notStarted
        const done = order >= total - finished
        const subdistrict = order < 15 ? '040' : '050'
        const village = order % 2 ? '001' : '002'
        const block = String(Math.floor(order / 2) + 1).padStart(4, '0')
        slsDetail.push([`${code} ${subdistrict} ${village} ${block} 02`, 1, Number(open), Number(!open && !done), Number(done)])
      }
      const nonTarget = index === 8 ? 5470 : 4000
      const completed = 750 + index * 57 + day * (57 + index)
      const submitted = 450 + index * 8
      const draft = 550, rejected = 24 + index, revoked = 3
      nonub.push([code, nonTarget - completed - submitted - draft - rejected - revoked, draft, submitted, completed, rejected, revoked])
      const ubCompleted = (index === 8 ? 9 : 5) - (day ? 0 : 1)
      ub.push([code, ubTarget - ubCompleted - 10, 5, 3, ubCompleted, 1, 1])
    })
    return { sls: csv('sls.csv', sls), nonub: csv('non-ub.csv', nonub), ub: csv('ub.csv', ub), sls_detail: csv('rincian-ssls.csv', slsDetail) }
  }
  const title = ['', 'Nama Kab/Kota', 'Susenas Maret 2026', ...Array(11).fill(''), 'Seruti Triwulan I 2026']
  const headers = ['', '', 'Target', 'Pencacahan (%)', '', '', '', '', 'Clean K', 'Error K', 'Total K', 'Clean KP', 'Error KP', 'Total KP', 'Target', 'INTI bersih', 'INTI total', 'MAK bersih', 'MAK total', 'Progres']
  const districts = sumbar.map(([code, name], index) => {
    const k = 46 + index * 2 + day * 8, kp = 38 + index * 2 + day * 8
    const inti = 43 + index * 2 + day * 8, mak = 35 + index * 2 + day * 8
    return [code, name, 210 + index * 7, 100, null, null, null, null, k, 3, k + 3, kp, 4, kp + 4, 80 + index * 3, inti - 4, inti, mak - 2, mak, (k + 3 + kp + 4) / 2]
  })
  const sourceTotal = ['', 'PROV SUMBAR', 5187, 100, '', '', '', '', '', '', 67 + day * 8, '', '', 60 + day * 8, 2033, 57 + day * 8, 61 + day * 8, 51 + day * 8, 53 + day * 8, 63.5 + day * 8]
  const sheet = xlsx.utils.aoa_to_sheet([title, headers, ...districts, sourceTotal])
  const workbook = xlsx.utils.book_new()
  xlsx.utils.book_append_sheet(workbook, sheet, 'NEW Contoh')
  const collections = xlsx.utils.aoa_to_sheet([
    ['Monitoring pengumpulan'], ['Kondisi 10 Maret 2026', '', '', '', '', 'Kondisi 17 Maret 2026 pukul 09.10 WIB'], [],
    ['No', 'Nama Kab/Kota', 'Upload', '', 'Tanggal Pengumpulan', 'Upload', '', 'Tanggal Pengumpulan'],
    ['', '', 'Backup', 'Split', '', 'Backup', 'Split'],
    ...sumbar.map(([code, name], index) => [index + 1, `${code} ${name}`, index > 5, index > 8, index > 5 ? '9 Maret' : null, true, index > 2, '16 Maret']),
  ])
  xlsx.utils.book_append_sheet(workbook, collections, 'KirimBackupSplit')
  return { workbook: { name: 'susenas-seruti.xlsx', bytes: new Uint8Array(xlsx.write(workbook, { type: 'array', bookType: 'xlsx' })) } }
}
