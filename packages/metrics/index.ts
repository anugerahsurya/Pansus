import type { DataRow, Dataset, DatasetData, Rule, Value, Values, Widget } from '../contracts/index'
import { compileFormulas, evaluate } from './formula'

const number = (value: Value | undefined): value is number => typeof value === 'number' && Number.isFinite(value)
const sum = (values: number[]) => values.reduce((total, value) => total + value, 0)
export const progressBands = { complete: '100% atau lebih', medium: '50%–<100%', low: 'Di bawah 50%', unknown: 'Belum ada angka' } as const
export type ProgressBand = keyof typeof progressBands
export function progressBand(values: Values, group: NonNullable<Widget['progressGroup']>): ProgressBand {
  const actual = values[group.field]
  const target = group.target ? values[group.target] : 1
  if (!number(actual) || !number(target) || target <= 0 || actual < 0) return 'unknown'
  const rate = actual / target
  return rate >= 1 ? 'complete' : rate >= .5 ? 'medium' : 'low'
}
export function applyFormulas(dataset: Dataset, data: DatasetData): DatasetData {
  const formulas = compileFormulas(dataset)
  return { ...data, rows: data.rows.map(row => {
    const values = { ...row.values }
    for (const [id, formula] of formulas) values[id] = evaluate(formula, values).value
    return { ...row, values }
  }) }
}

export function aggregate(data: DatasetData, field: string, rule: Rule = { op: 'sum' }, dataset?: Dataset): { value: Value; coverage: number; reason?: string } {
  const valid = data.rows.map(row => row.values[field]).filter(value => value !== null && value !== undefined)
  const numbers = valid.filter(number)
  const result = (value: Value, coverage = valid.length, reason?: string) => ({ value, coverage, reason })
  if (rule.op === 'none') return result(null, 0, 'Tidak diringkas')
  if (rule.op === 'reportedValue') return result(data.reported?.[field] ?? null, 0, data.reported?.[field] == null ? 'Rekap resmi belum tersedia' : 'Rekap resmi dari sumber')
  if (rule.op === 'formula' && dataset) {
    const formulas = compileFormulas(dataset)
    const values: Values = Object.fromEntries(dataset.fields.filter(item => !item.formula).map(item => [item.id, aggregate(data, item.id).value]))
    for (const [id, formula] of formulas) {
      const calculated = evaluate(formula, values)
      if (id === field) return result(calculated.value, valid.length, calculated.reason ?? 'Rumus dari angka provinsi')
      values[id] = calculated.value
    }
  }
  if (rule.op === 'count') return result(valid.length)
  if (rule.op === 'mode') {
    const counts = new Map<Value, number>()
    for (const value of valid) counts.set(value, (counts.get(value) ?? 0) + 1)
    if (!counts.size) return result(null, 0, 'Data belum tersedia')
    const max = Math.max(...counts.values())
    const candidates = [...counts].filter(([, count]) => count === max).map(([value]) => value)
    return candidates.length === 1 ? result(candidates[0]) : result(null, valid.length, `Tidak ada modus tunggal (${candidates.join(', ')})`)
  }
  if (rule.numerator && rule.denominator && ['ratioOfSums', 'weightedMean', 'difference'].includes(rule.op)) {
    const left = rule.numerator
    const right = rule.denominator
    const pairs = data.rows.map(row => [row.values[left], row.values[right]]).filter((pair): pair is [number, number] => number(pair[0]) && number(pair[1]))
    if (rule.op === 'difference') return pairs.length ? result(sum(pairs.map(([a, b]) => a - b)), pairs.length) : result(null, 0, 'Data belum tersedia')
    const denominator = sum(pairs.map(([, value]) => value))
    if (denominator === 0) return result(null, pairs.length, 'Target belum tersedia')
    return result(sum(pairs.map(([a, b]) => rule.op === 'weightedMean' ? a * b : a)) / denominator, pairs.length)
  }
  if (!numbers.length) return result(null, 0, 'Data belum tersedia')
  const total = sum(numbers)
  return result(rule.op === 'mean' ? total / numbers.length : total)
}

export function indicator(data: DatasetData, dataset: Dataset, field: string, target?: string) {
  const unit = dataset.fields.find(item => item.id === field)?.unit
  if (target) {
    const ratio = aggregate(data, field, { op: 'ratioOfSums', numerator: field, denominator: target })
    return { ...ratio, actual: aggregate(data, field).value, target: aggregate(data, target).value, percent: true }
  }
  const rule: Rule = unit === 'percent' ? (dataset.grain === 'person' ? { op: 'mean' } : { op: 'reportedValue' }) : { op: 'sum' }
  const metric = aggregate(data, field, rule)
  return { ...metric, actual: null, target: null, percent: unit === 'percent' }
}

export function delta(current: DatasetData, previous: DatasetData | undefined, dataset: Dataset, field: string, target?: string) {
  if (!previous) return { value: null, reason: 'Kondisi H−1 belum tersedia.' }
  const covered = (data: DatasetData) => new Set(data.rows.filter(row => number(row.values[field]) && (!target || number(row.values[target]))).map(row => row.code))
  const a = covered(current), b = covered(previous)
  if (a.size !== b.size || [...a].some(code => !b.has(code))) return { value: null, reason: 'Cakupan wilayah berubah.' }
  const now = indicator(current, dataset, field, target).value
  const before = indicator(previous, dataset, field, target).value
  return number(now) && number(before) ? { value: now - before, reason: null } : { value: null, reason: 'Angka pembanding belum tersedia.' }
}

export function previousDay(date: string) {
  return new Date(Date.parse(date + 'T00:00:00Z') - 86_400_000).toISOString().slice(0, 10)
}

export function targetRatio(date: string, deadline: string, start: string, offset: number) {
  const day = (value: string) => (Date.parse(value + 'T00:00:00Z') - Date.parse(start + 'T00:00:00Z')) / 86_400_000 + 1
  return day(deadline) > 0 ? (day(date) - offset) / day(deadline) : null
}

export function weightedTarget(rows: { target: number; deadline: string }[], date: string, start: string, offset: number) {
  let total = 0, weighted = 0
  for (const row of rows) {
    const ratio = targetRatio(date, row.deadline, start, offset)
    if (ratio === null) continue
    total += row.target
    weighted += row.target * ratio
  }
  return total ? weighted / total : null
}

const collator = new Intl.Collator('id-ID')
export function sortRows(rows: DataRow[], field: string, reverse: boolean) {
  const value = (row: DataRow) => field === 'name' ? row.name : field === 'code' ? row.code : row.values[field]
  return [...rows].sort((left, right) => {
    const a = value(left), b = value(right)
    if (a == null) return b == null ? collator.compare(left.code, right.code) : 1
    if (b == null) return -1
    const result = number(a) && number(b) ? a - b : collator.compare(String(a), String(b))
    return (reverse ? -result : result) || collator.compare(left.code, right.code)
  })
}
