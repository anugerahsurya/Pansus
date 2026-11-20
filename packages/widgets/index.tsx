import { useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { useReactTable, getCoreRowModel, flexRender, type ColumnDef } from '@tanstack/react-table'
import { ArrowDown, ArrowUp, ArrowUpRight, CalendarDays, Check, ChevronDown, ChevronRight, ChevronsUpDown, ExternalLink, Maximize2, Search, X } from 'lucide-react'
import type { CollectionReport, DataRow, Dataset, Field, Report, Value, Widget } from '../contracts/index'
import { formatDateTime } from '../contracts/datetime'
import { groupedBarLimit, singleBarLimit } from '../contracts/visualization'
import { aggregate, delta, indicator, previousDay, progressBand, progressBands, sortRows, weightedTarget, type ProgressBand } from '../metrics/index'
import { pesPace, pesRegions } from '../../templates/regions'
import { api, conditionDate, fmt, pct, type Sorts } from '../../apps/web/src/api'

const stateColors = ['var(--report-series-3, var(--bps-orange))', 'var(--report-series-4, var(--bps-sky))', 'var(--report-series-2, var(--bps-green))', 'var(--report-accent, var(--brand))', 'var(--report-deep, var(--brand-dark))']
const barColors = ['var(--report-accent, var(--brand))', 'var(--report-series-2, var(--bps-green))', 'var(--report-series-3, var(--bps-orange))', 'var(--report-series-4, var(--bps-sky))']
const empty = { rows: [] }
function shown(value: Value | undefined, unit?: Field['unit']) {
  if (unit === 'datetime' && typeof value === 'string') return formatDateTime(value)
  return value == null ? '—' : typeof value === 'number' ? unit === 'percent' ? pct.format(value) : fmt.format(value) : value
}
const metricTypes = new Set(['progress', 'kpi'])
const fieldLabel = (dataset: Dataset, id: string) => dataset.fields.find(field => field.id === id)?.label ?? id

export const widgetLabels: Record<Widget['type'], string> = {
  progress: 'Kartu progres', kpi: 'Kartu angka', bars: 'Grafik batang', donut: 'Diagram donat', table: 'Tabel wilayah', schedule: 'Kartu jadwal', link: 'Kartu tautan',
}

export function Hero({ report, heading: Heading = 'h1', showCondition = true }: { report: Report; heading?: 'h1' | 'h2' | 'h3'; showCondition?: boolean }) {
  const { definition, condition } = report
  return <section className={'hero theme-' + definition.theme}>
    <div className="hero-copy">
      <span className="hero-satker">{definition.satker}</span>
      <Heading className="hero-title">{definition.title}</Heading>
      {definition.description && <p>{definition.description}</p>}
      {(showCondition || report.activityStatus === 'closed') && <div className="hero-meta">
        {showCondition && <span><CalendarDays size={15} aria-hidden="true" /> {conditionDate(condition.date)} · {condition.time} WIB</span>}
        {report.activityStatus === 'closed' && <span className="hero-closed"><Check size={15} aria-hidden="true" /> Selesai{report.closedAt && ' · ' + conditionDate(new Intl.DateTimeFormat('sv-SE', { dateStyle: 'short', timeZone: 'Asia/Jakarta' }).format(new Date(report.closedAt)))}</span>}
      </div>}
    </div>
  </section>
}

function CardDetails({ title, dataset, report, children }: { title: string; dataset: Dataset; report: Report; children: () => ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const heading = useId()
  const [open, setOpen] = useState(false)
  return <>
    <button type="button" className="card-detail-trigger" aria-label={`Lihat rincian ${title}`} title="Lihat rincian" onClick={() => {
      dialog.current?.showModal()
      setOpen(true)
    }}><Maximize2 size={15} aria-hidden="true" /></button>
    <dialog ref={dialog} className="card-detail-dialog" aria-labelledby={heading} onClose={() => setOpen(false)}>
      <header><div><h2 id={heading}>{title}</h2><p>{dataset.label} · {conditionDate(report.condition.date)} · {report.condition.time} WIB{report.demo ? ' · Data sintetis' : ''}</p></div>
        <button className="icon-button" type="button" aria-label="Tutup rincian" onClick={() => dialog.current?.close()}><X size={18} aria-hidden="true" /></button>
      </header>
      {open && <div className="card-detail-body">{children()}</div>}
    </dialog>
  </>
}

function DetailTable({ columns, rows }: { columns: string[]; rows: { code: string; name: string; values: string[] }[] }) {
  if (!rows.length) return <p className="empty-inline">Data wilayah belum tersedia.</p>
  return <div className="table-scroll" tabIndex={0} role="region" aria-label="Angka per kabupaten atau kota">
    <table><thead><tr><th scope="col">Kabupaten / Kota</th>{columns.map((label, index) => <th scope="col" key={index}>{label}</th>)}</tr></thead>
      <tbody>{rows.map(row => <tr key={row.code}><th scope="row">{row.name}</th>{row.values.map((value, index) => <td key={index}>{value}</td>)}</tr>)}</tbody>
    </table>
  </div>
}

function Metric({ widget, dataset, report, print }: { widget: Widget; dataset: Dataset; report: Report; print: boolean }) {
  const data = report.data[dataset.id] ?? empty
  const previous = report.baseline?.[dataset.id]
  const field = dataset.fields.find(item => item.id === widget.field)
  const result = indicator(data, dataset, widget.field!, widget.target)
  const change = delta(data, previous, dataset, widget.field!, widget.target)
  const value = result.value
  const ratio = typeof value === 'number' && result.percent ? value : null
  const metricColor = dataset.id === 'nonub' ? ' metric-green' : dataset.id === 'ub' ? ' metric-orange' : ''
  const sign = change.value != null && change.value > 0 ? '+' : ''
  const deltaLabel = change.value == null ? '—' : sign + (result.percent ? fmt.format(change.value * 100) + '%' : fmt.format(change.value))
  const stage = widget.field as keyof typeof pesPace.offsets
  const pace = report.template === 'pes' && widget.target === 'target' && (dataset.id === 'nonub' || dataset.id === 'ub') && Object.hasOwn(pesPace.offsets, stage)
    ? weightedTarget(data.rows.flatMap(row => {
      const day = pesRegions.find(entry => entry[0] === row.code)?.[4]
      return day ? [{ target: Number(row.values.target ?? 0), deadline: `2026-11-${day}` }] : []
    }), report.condition.date, pesPace.start, pesPace.offsets[stage]) : null
  return <article className={'panel metric' + metricColor}>
    <div className="metric-head"><div><span className="metric-label">{dataset.label}</span><h3>{widget.title}</h3></div>
      {!print && <CardDetails title={widget.title} dataset={dataset} report={report}>{() => {
        const h1 = previous && indicator(previous, dataset, widget.field!, widget.target).value
        const label = field?.label ?? widget.title
        const target = widget.target
        return <>
          <dl className="detail-facts">
            <div><dt>Nilai saat ini</dt><dd>{shown(value, result.percent ? 'percent' : 'number')}</dd></div>
            <div><dt>H−1{previous && ` · ${conditionDate(previousDay(report.condition.date))}`}</dt><dd>{shown(h1, result.percent ? 'percent' : 'number')}</dd></div>
            <div><dt>Perubahan H−1</dt><dd>{deltaLabel}</dd></div>
          </dl>
          <p>{target ? `Cara hitung: jumlah ${label} dibagi jumlah ${fieldLabel(dataset, target)} pada wilayah dengan kedua angka tersedia.` :
            result.percent ? 'Angka provinsi memakai rekap resmi dari sumber. Tabel menampilkan angka tiap wilayah.' : `Cara hitung: jumlah ${label} dari wilayah yang memiliki nilai.`}</p>
          {change.value == null && <p>{change.reason === 'Kondisi H−1 belum tersedia.' ? report.baselineReason ?? change.reason : change.reason}</p>}
          {pace !== null && <p>Target waktu {pct.format(pace)} dihitung dari tenggat masing-masing wilayah, dengan bobot sesuai target penugasan.</p>}
          <DetailTable columns={target ? [label, fieldLabel(dataset, target), 'Capaian'] : [label]} rows={data.rows.map(row => {
            const actual = row.values[widget.field!]
            const goal = target ? row.values[target] : null
            const values = [shown(actual, field?.unit)]
            if (target) values.push(shown(goal), shown(typeof actual === 'number' && typeof goal === 'number' && goal > 0 ? actual / goal : null, 'percent'))
            return { ...row, values }
          })} />
        </>
      }}</CardDetails>}
    </div>
    <div className="metric-amount"><strong>{shown(value, result.percent ? 'percent' : 'number')}</strong><span className={'delta ' + (change.value == null ? 'delta-none' : change.value < 0 ? 'delta-down' : 'delta-up')} title={change.value == null ? report.baselineReason ?? change.reason ?? '' : 'Perubahan sejak kondisi H−1'}>{change.value != null && (change.value < 0 ? <ArrowDown size={12} /> : <ArrowUp size={12} />)} {deltaLabel}</span></div>
    {widget.type === 'progress' && <div className="progress-track" aria-hidden="true"><span className="chart-fill" style={{ transform: `scaleX(${Math.max(0, Math.min(1, ratio ?? 0))})` }} /></div>}
    <div className="metric-foot">{widget.target ? <span><b>{shown(result.actual)}</b> dari {shown(result.target)} target</span> : <span>{result.reason ?? `${result.coverage} wilayah tercatat`}</span>}<span>vs. H−1</span></div>
    {pace !== null && <div className="metric-foot pace" title={ratio != null && ratio >= pace ? 'Mencapai target waktu' : 'Di bawah target waktu'}><span>Target waktu</span><b>{pct.format(pace)}</b></div>}
  </article>
}

function Bars({ widget, dataset, report, print }: { widget: Widget; dataset: Dataset; report: Report; print: boolean }) {
  const data = report.data[dataset.id] ?? empty
  const unit = widget.target ? 'percent' : dataset.fields.find(field => field.id === widget.field)?.unit
  const series = [...new Set([widget.field!, ...(widget.fields ?? [])])].map((id, index) => ({ id, label: fieldLabel(dataset, id), color: barColors[index] }))
  const rows = data.rows.map(row => {
    const target = row.values[widget.target ?? '']
    const bars = series.map(item => {
      const raw = row.values[item.id]
      return typeof raw !== 'number' ? null : widget.target ? typeof target === 'number' && target > 0 ? raw / target : null : raw
    })
    return { ...row, bars }
  })
  const sorted = rows.toSorted((a, b) => (b.bars[0] ?? -Infinity) - (a.bars[0] ?? -Infinity))
  const visible = print ? sorted : sorted.slice(0, series.length > 1 ? groupedBarLimit : singleBarLimit)
  const high = rows.reduce((value, row) => Math.max(value, ...row.bars.map(bar => bar ?? 0)), unit === 'percent' ? 1 : 0)
  const low = rows.reduce((value, row) => Math.min(value, ...row.bars.map(bar => bar ?? 0)), 0)
  const range = high - low || 1
  const zero = (0 - low) / range * 100
  return <article className="panel chart bars-panel">
    <div className="chart-title"><div><h3>{widget.title}</h3>{widget.description && <p>{widget.description}</p>}</div>
      {!print && <CardDetails title={widget.title} dataset={dataset} report={report}>{() => <>
        <p>{widget.target ? `Angka tiap wilayah dihitung dengan membagi indikator dengan ${fieldLabel(dataset, widget.target)}. Wilayah tanpa target positif ditandai kosong.` : 'Batang membandingkan nilai yang tercatat di setiap wilayah.'}</p>
        <DetailTable columns={series.map(item => item.label)} rows={sorted.map(row => ({ ...row, values: row.bars.map(value => shown(value, unit)) }))} />
      </>}</CardDetails>}
    </div>
    {series.length > 1 && <div className="series-legend">{series.map(item => <span key={item.id}><i style={{ background: item.color }} />{item.label}</span>)}</div>}
    {rows.length ? <div className="bar-list" aria-label={widget.title}>{visible.map(row => <div key={row.code} className={series.length > 1 ? 'bar-group' : undefined}>
      {row.bars.map((bar, index) => {
        const offset = (Math.min(0, bar ?? 0) - low) / range * 100
        const size = Math.abs(bar ?? 0) / range
        return <div className="bar-row" key={series[index].id}><span title={row.name}>{index === 0 ? row.name : <span aria-hidden="true">&nbsp;</span>}</span>
          {series.length > 1 && <span className="sr-only">{series[index].label}</span>}
          <span aria-hidden="true" className="bar-track">{low < 0 && <span className="bar-zero" style={{ left: `${zero}%` }} />}
            <i className="chart-fill" style={{ transform: `translateX(${offset}%) scaleX(${size})`, background: series[index].color }} />
          </span><b>{shown(bar, unit)}</b></div>
      })}
    </div>)}</div> : <p className="empty-inline">Data wilayah belum tersedia.</p>}
    {visible.length < sorted.length && <p className="chart-caption">{visible.length} dari {sorted.length} wilayah, diurutkan menurut {series[0].label}.</p>}
  </article>
}

function Donut({ widget, dataset, report, print }: { widget: Widget; dataset: Dataset; report: Report; print: boolean }) {
  const data = report.data[dataset.id] ?? empty
  const stats = (widget.fields ?? []).map((id, index) => ({ id, label: fieldLabel(dataset, id), amount: Number(aggregate(data, id).value ?? 0), color: stateColors[index % stateColors.length] }))
  const total = stats.reduce((sum, item) => sum + item.amount, 0)
  let position = 0
  return <article className="panel chart donut-panel">
    <div className="chart-title"><div><h3>{widget.title}</h3><p>{widget.description || `Komposisi ${dataset.label}`}</p></div>
      {!print && <CardDetails title={widget.title} dataset={dataset} report={report}>{() => <>
        <p>Persentase membagi jumlah tiap status dengan total seluruh status yang ditampilkan.</p>
        <DetailTable columns={stats.map(item => item.label)} rows={data.rows.map(row => ({ ...row, values: stats.map(item => shown(row.values[item.id])) }))} />
      </>}</CardDetails>}
    </div>
    <div className="donut-body">
      <div className="donut">
        <svg viewBox="0 0 100 100" aria-hidden="true">
          <circle cx="50" cy="50" r="42" fill="none" stroke="var(--wash)" strokeWidth="12" />
          {stats.map(item => {
            const size = total ? item.amount / total * 100 : 0
            const offset = position
            position += size
            return <circle key={item.id} className="donut-segment" cx="50" cy="50" r="42" pathLength="100" fill="none" stroke={item.color} strokeWidth="12"
              style={{ strokeDasharray: `${size} 100`, strokeDashoffset: -offset }} />
          })}
        </svg>
        <span><strong>{total ? fmt.format(total) : '—'}</strong><small>{total ? `Total ${dataset.label}` : 'Data kosong'}</small></span>
      </div>
      <div className="legend">{stats.map(item => <div className="legend-row" key={item.id}><span><i style={{ background: item.color }} /> {item.label}</span><b>{fmt.format(item.amount)}</b><small>{total ? pct.format(item.amount / total) : '—'}</small></div>)}</div>
    </div>
  </article>
}

function Collection({ reports, print }: { reports: CollectionReport[]; print: boolean }) {
  const [selected, setSelected] = useState(reports.length - 1)
  const status = (value: boolean | null) => value == null ? '—' : value ? 'Sudah' : 'Belum'
  return <div className="collections">
    {!print && <label className="check">Kondisi pengumpulan <select value={selected} onChange={event => setSelected(Number(event.target.value))}>{reports.map((report, index) => <option value={index} key={index}>{conditionDate(report.date)}{report.time && ` · ${report.time} WIB`}</option>)}</select></label>}
    {(print ? reports : reports.slice(selected, selected + 1)).map(report => <div className="table-scroll" key={`${report.date}-${report.time}`}>
      {print && <p className="collection-label">{conditionDate(report.date)}{report.time && ` · ${report.time} WIB`}</p>}
      <table><thead><tr><th scope="col">Kabupaten / Kota</th><th scope="col">Backup</th><th scope="col">Split</th><th scope="col">Diterima</th></tr></thead>
      <tbody>{report.rows.map(row => <tr key={row.code}><th scope="row">{row.name}</th><td>{status(row.backup)}</td><td>{status(row.split)}</td><td>{row.received ?? '—'}</td></tr>)}</tbody></table>
    </div>)}
  </div>
}

function AreaTable({ widget, dataset, report, print, sort, onSort, page }: { widget: Widget; dataset: Dataset; report: Report; print: boolean; sort?: Sorts[string]; onSort?: (sort: Sorts[string] | undefined) => void; page?: number }) {
  const [query, setQuery] = useState('')
  const [band, setBand] = useState<ProgressBand | 'all'>('all')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [fetched, setFetched] = useState<Record<string, DataRow[]>>({})
  const [loading, setLoading] = useState<Set<string>>(new Set())
  const [error, setError] = useState('')
  const data = report.data[dataset.id] ?? empty
  const people = dataset.grain === 'person'
  const rowLabel = people ? 'petugas' : 'kabupaten/kota'
  const group = widget.progressGroup
  const grouped = useMemo(() => {
    const counts: Record<ProgressBand, number> = { complete: 0, medium: 0, low: 0, unknown: 0 }
    const bands = new Map<string, ProgressBand>()
    if (group) for (const row of data.rows) {
      const value = progressBand(row.values, group)
      counts[value]++
      bands.set(row.code, value)
    }
    return { counts, bands }
  }, [data.rows, group])
  const children = useMemo(() => {
    const result = new Map<string, DataRow[]>()
    for (const row of data.detail ?? []) if (row.parent) result.set(row.parent, [...(result.get(row.parent) ?? []), row])
    return result
  }, [data.detail])
  async function expand(parent: string) {
    if (expanded.has(parent)) { setExpanded(current => new Set([...current].filter(code => code !== parent))); return }
    setError('')
    setLoading(current => new Set(current).add(parent))
    try {
      if (report.currentRelease && !Object.hasOwn(fetched, parent)) {
        const rows: DataRow[] = []
        let cursor: number | null = 0
        while (cursor !== null) {
          const params = new URLSearchParams({ release: report.currentRelease, dataset: dataset.id, parent, cursor: String(cursor) })
          const batch: { rows: DataRow[]; nextCursor: number | null } = await api(`/dashboards/${report.id}/children?${params}`)
          rows.push(...batch.rows)
          cursor = batch.nextCursor
        }
        setFetched(current => ({ ...current, [parent]: rows }))
      }
      setExpanded(current => new Set(current).add(parent))
    } catch (failure) { setError((failure as Error).message) }
    finally { setLoading(current => new Set([...current].filter(code => code !== parent))) }
  }
  const columns = useMemo<ColumnDef<DataRow>[]>(() => [
    { id: 'name', header: people ? 'Nama atau kode petugas' : 'Kabupaten / Kota', accessorFn: row => row.name },
    ...(widget.fields ?? []).map(id => ({ id, header: dataset.fields.find(field => field.id === id)?.label ?? id, accessorFn: (row: DataRow) => row.values[id], cell: (context: { getValue: () => unknown }) => shown(context.getValue() as Value, dataset.fields.find(field => field.id === id)?.unit) })),
    ...(print && group ? [{ id: 'progress_band', header: 'Kelompok progres', accessorFn: (row: DataRow) => progressBands[grouped.bands.get(row.code) ?? 'unknown'] }] : []),
  ], [widget.fields, dataset.fields, grouped, group, people, print])
  const rows = useMemo(() => {
    const term = query.toLocaleLowerCase('id-ID').trim()
    const matches = (row: DataRow) => `${row.name} ${row.code}`.toLocaleLowerCase('id-ID').includes(term)
    const selected = term ? data.rows.filter(row => matches(row) || data.detail?.some(child => child.code.startsWith(`${row.code}/`) && matches(child))) : data.rows
    const visit = (list: DataRow[]): DataRow[] => (sort ? sortRows(list, sort.field, sort.reverse) : list).flatMap(row => {
      const descendants = fetched[row.code] ?? children.get(row.code) ?? []
      if (!print && !expanded.has(row.code) && !term) return [row]
      const filtered = term && !matches(row) ? descendants.filter(child => matches(child) || data.detail?.some(other => other.code.startsWith(`${child.code}/`) && matches(other))) : descendants
      return [row, ...visit(filtered)]
    })
    return visit(band === 'all' || !group || print ? selected : selected.filter(row => grouped.bands.get(row.code) === band))
  }, [data, query, sort, print, children, fetched, expanded, band, group, grouped])
  const chunk = 40
  const displayRows = page == null ? rows : rows.slice(page * chunk, (page + 1) * chunk)
  const table = useReactTable({ data: displayRows, columns, getCoreRowModel: getCoreRowModel(), getRowId: row => row.code })
  const showFooter = widget.provinceFooter?.enabled && (page == null || (page + 1) * chunk >= rows.length)
  function toggle(field: string) {
    const next = sort?.field !== field ? { field, reverse: false } : sort.reverse ? undefined : { field, reverse: true }
    onSort?.(next)
  }
  return <article className="panel area-panel" data-widget-id={widget.id}>
    <div className="area-title"><div><h3>{widget.title}</h3><p>{rows.filter(row => !row.parent).length} {rowLabel}{query && ' sesuai pencarian'}</p></div>{!print && <label className="search compact-search"><Search size={16} /><input aria-label={`Cari ${people ? 'petugas' : 'wilayah'} pada ${dataset.label}`} value={query} onChange={event => setQuery(event.target.value)} placeholder={people ? 'Cari petugas…' : 'Cari wilayah…'} /></label>}</div>
    {!print && group && <div className="segmented progress-groups" aria-label="Kelompok progres petugas">
      <button type="button" className={band === 'all' ? 'selected' : ''} aria-pressed={band === 'all'} onClick={() => setBand('all')}>Semua ({data.rows.length})</button>
      {(Object.keys(progressBands) as ProgressBand[]).map(key => <button type="button" key={key} className={band === key ? 'selected' : ''} aria-pressed={band === key} onClick={() => setBand(key)}>{progressBands[key]} ({grouped.counts[key]})</button>)}
    </div>}
    {error && <p className="empty-inline" role="alert">{error}</p>}
    <div className={people && !print ? 'table-scroll person-table-scroll' : 'table-scroll'} tabIndex={print ? undefined : 0} aria-label={`Tabel ${dataset.label}`} role={print ? undefined : 'region'}><table>
      <thead>{table.getHeaderGroups().map(group => <tr key={group.id}>{group.headers.map(header => <th key={header.id} scope="col" aria-sort={sort?.field === header.id ? sort.reverse ? 'descending' : 'ascending' : undefined}>
        {print ? flexRender(header.column.columnDef.header, header.getContext()) : <button onClick={() => toggle(header.id)}>{flexRender(header.column.columnDef.header, header.getContext())} {sort?.field === header.id ? sort.reverse ? <ArrowDown size={13} /> : <ArrowUp size={13} /> : <ChevronsUpDown size={13} />}</button>}
      </th>)}</tr>)}</thead>
      <tbody>{table.getRowModel().rows.map(row => <tr key={row.id} className={row.original.parent ? 'child-row' : undefined}>{row.getVisibleCells().map((cell, index) => index === 0 ? <th scope="row" key={cell.id}><span className="region-name" style={{ paddingInlineStart: people ? undefined : `${(row.id.split('/').length - 1) * 11}px` }}>
        {!print && !query && children.has(row.id) && <button type="button" className="expand-button" aria-expanded={expanded.has(row.id)} aria-label={`${expanded.has(row.id) ? 'Ciutkan' : 'Buka rincian'} ${row.original.name}`} disabled={loading.has(row.id)} onClick={() => void expand(row.id)}>{expanded.has(row.id) ? <ChevronDown size={15} aria-hidden="true" /> : <ChevronRight size={15} aria-hidden="true" />}</button>}
        <span>{row.original.name}</span>{!people && <small>{row.original.code}</small>}</span></th> : <td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>)}</tr>)}</tbody>
      {showFooter && !people && <tfoot><tr><th scope="row">Provinsi Sumatera Barat{query && <small>Seluruh provinsi</small>}</th>{(widget.fields ?? []).map(id => {
        const field = dataset.fields.find(field => field.id === id)
        const result = aggregate(data, id, widget.provinceFooter?.rules[id] ?? { op: field?.unit === 'count' ? 'sum' : 'none' }, dataset)
        return <td key={id} title={result.reason ?? `${result.coverage} dari ${data.rows.length} wilayah`}>
          {shown(result.value, widget.provinceFooter?.rules[id]?.op === 'ratioOfSums' ? 'percent' : field?.unit)}
          {print && result.reason && <small>{result.reason}</small>}
        </td>
      })}</tr></tfoot>}
    </table></div>
    {!rows.length && <p className="empty-inline">{people ? 'Tidak ada petugas yang cocok.' : 'Tidak ada wilayah yang cocok.'}</p>}
  </article>
}

export function DashboardWidgets({ report, sorts = {}, onSort, print = false }: { report: Report; sorts?: Sorts; onSort?: (id: string, sort: Sorts[string] | undefined) => void; print?: boolean }) {
  const [active, setActive] = useState<Record<string, string>>({})
  const [wideTable, setWideTable] = useState<string>()
  const { definition } = report
  const widget = (item: Widget, page?: number) => {
    const dataset = definition.datasets.find(dataset => dataset.id === item.dataset)
    if (item.type === 'schedule') return <article className="panel resource"><span className="metric-icon"><CalendarDays size={19} /></span><h3>{item.title}</h3><p>{item.description || definition.period}</p>{report.collection?.length ? <Collection reports={report.collection} print={print} /> : null}</article>
    if (item.type === 'link' && item.url) return <article className="panel resource"><span className="metric-icon"><ExternalLink size={19} /></span><h3>{item.title}</h3><p>{item.description}</p>{print ? <p>{item.url}</p> : <a href={item.url} target="_blank" rel="noopener noreferrer">Buka tautan <ArrowUpRight size={15} /><span className="sr-only"> (tab baru)</span></a>}</article>
    if (!dataset) return null
    if (item.type === 'progress' || item.type === 'kpi') return <Metric widget={item} dataset={dataset} report={report} print={print} />
    if (item.type === 'bars') return <Bars widget={item} dataset={dataset} report={report} print={print} />
    if (item.type === 'donut') return <Donut widget={item} dataset={dataset} report={report} print={print} />
    if (item.type === 'table') return <AreaTable key={item.id + report.currentRelease} widget={item} dataset={dataset} report={report} print={print} sort={sorts[item.id]} onSort={sort => onSort?.(item.id, sort)} page={page} />
    return null
  }
  const grouped = (items: Widget[]) => <div className="dashboard-grid">{items.map(item => {
    const metric = metricTypes.has(item.type)
    const expandable = !print && item.type === 'table' && item.width !== 'full'
    const expanded = expandable && wideTable === item.id
    const width = expanded ? 'full' : metric && item.width === 'half' ? 'third' : item.width
    return <div className={`dashboard-cell widget-size-${width}${metric ? ' metric-cell' : ''}${expandable && !expanded ? ' compact-table-cell' : ''}`} key={item.id}>
      {expandable && <button className="button table-width-control" type="button" aria-pressed={expanded} onClick={() => setWideTable(expanded ? undefined : item.id)}><Maximize2 size={14} aria-hidden="true" /> {expanded ? 'Kembalikan lebar tabel' : 'Perlebar tabel'}</button>}
      {widget(item)}
    </div>
  })}</div>
  const groups: { kind: 'metric' | 'table' | 'other'; items: Widget[] }[] = []
  for (const item of definition.widgets) {
    const kind = item.type === 'table' && (print || item.width === 'full') ? 'table' :
      metricTypes.has(item.type) && groups.every(group => group.kind === 'metric') ? 'metric' : 'other'
    const last = groups.at(-1)
    if (last?.kind === kind) last.items.push(item)
    else groups.push({ kind, items: [item] })
  }
  const printHeading = <div className="print-heading"><b>{definition.title}</b><span>{conditionDate(report.condition.date)} · {report.condition.time} WIB{report.demo ? ' · Data sintetis' : ''}</span></div>
  return <div className={`dashboard-content theme-${definition.theme}`}>{print && <div className="report-export-part"><Hero report={report} /></div>}
    {groups.map((group, index) => {
      const key = group.items[0].id
      if (group.kind === 'table' && print) return group.items.flatMap(item => {
        const data = report.data[item.dataset ?? '']
        const length = (data?.rows.length ?? 0) + (data?.detail?.length ?? 0)
        return Array.from({ length: Math.max(1, Math.ceil(length / 40)) }, (_, page) => <div className="report-export-part export-table-part" key={`${item.id}-${page}`}>{printHeading}{widget(item, page)}</div>)
      })
      if (group.kind === 'table') {
        const selected = group.items.find(item => item.id === active[key]) ?? group.items[0]
        return <section className="section" key={key}><div className="section-heading"><h2>{definition.datasets.find(dataset => dataset.id === selected.dataset)?.grain === 'person' ? 'Rincian petugas' : 'Rincian wilayah'}</h2></div>
          {group.items.length > 1 && <div className="segmented" aria-label="Pilih tabel">{group.items.map(item => <button key={item.id} aria-pressed={selected.id === item.id} className={selected.id === item.id ? 'selected' : ''} onClick={() => setActive(current => ({ ...current, [key]: item.id }))}>{group.items.filter(other => other.dataset === item.dataset).length > 1 ? item.title : definition.datasets.find(dataset => dataset.id === item.dataset)?.label ?? item.title}</button>)}</div>}
          {widget(selected)}
        </section>
      }
      const section = <section className="section" key={key}>
        {group.kind === 'metric' && groups.findIndex(item => item.kind === 'metric') === index && <div className="section-heading"><h2>Ringkasan capaian</h2></div>}
        {grouped(group.items)}
      </section>
      return print ? <div className="report-export-part" key={key}>{printHeading}{section}</div> : section
    })}
  </div>
}
