import type { Dataset, DatasetData, Field, SnapshotData, Value, Values } from '../contracts/index'
import { formatDateTime } from '../contracts/datetime'
import { activeFields, isNumericUnit } from '../contracts/fields'

type Op = '+' | '-' | '*' | '/'
type MathFn = 'abs' | 'round' | 'floor' | 'ceil' | 'sqrt' | 'min' | 'max'
type AggFn = 'sum' | 'mean' | 'avg' | 'median' | 'min' | 'max' | 'variance' | 'var' | 'stdev' | 'std' | 'count'
type Expression =
  | { type: 'number'; value: number }
  | { type: 'field'; id: string }
  | { type: 'negative'; node: Expression }
  | { type: 'binary'; op: Op; left: Expression; right: Expression }
  | { type: 'call'; fn: MathFn; args: Expression[] }
type Formula = { expression: Expression; fields: Set<string> }

const mathFns = new Set<string>(['abs', 'round', 'floor', 'ceil', 'sqrt', 'min', 'max'])
const aggFns = new Set<string>(['sum', 'mean', 'avg', 'median', 'min', 'max', 'variance', 'var', 'stdev', 'std', 'count'])
const normKey = (text: string) => text.trim().toLowerCase().replace(/[\s_-]+/g, ' ')

export function resolveField(ref: string, dataset?: Dataset): Field | undefined {
  if (!dataset) return undefined
  const fields = activeFields(dataset)
  const lower = ref.trim().toLowerCase()
  const normalized = normKey(ref)
  return fields.find(field => field.id.toLowerCase() === lower)
    ?? fields.find(field => normKey(field.id) === normalized || normKey(field.label) === normalized)
    ?? fields.find(field => field.aliases.some(alias => normKey(alias) === normalized))
}

export function parseFormula(input: string, dataset?: Dataset): Formula {
  const scanner = /\s*(<[^<>\r\n]+>|[0-9]+(?:\.[0-9]+)?|[A-Za-z][A-Za-z0-9_]*|[()+*/,-])/y
  const tokens: { text: string; position: number }[] = []
  let offset = 0
  while (offset < input.trimEnd().length) {
    scanner.lastIndex = offset
    const match = scanner.exec(input)
    if (!match) throw new Error(`Simbol tidak dikenal pada posisi ${offset + 1}.`)
    tokens.push({ text: match[1], position: offset + match[0].length - match[1].length + 1 })
    offset = scanner.lastIndex
  }
  let index = 0
  const fields = new Set<string>()
  const peek = () => tokens[index]?.text
  const fail = () => new Error(`Rumus belum lengkap pada posisi ${tokens[index]?.position ?? input.length + 1}.`)
  function atom(): Expression {
    const token = peek()
    if (!token) throw fail()
    index++
    if (token === '-') return { type: 'negative', node: atom() }
    if (token === '(') {
      const node = expression(0)
      if (peek() !== ')') throw fail()
      index++
      return node
    }
    if (token.startsWith('<') && token.endsWith('>')) {
      const inner = token.slice(1, -1).trim()
      if (!inner) throw fail()
      const resolved = resolveField(inner, dataset)
      const id = resolved?.id ?? inner.toLowerCase().replace(/\s+/g, '_')
      fields.add(id)
      return { type: 'field', id }
    }
    if (/^\d/.test(token) && Number.isFinite(Number(token))) return { type: 'number', value: Number(token) }
    if (/^[A-Za-z]/.test(token)) {
      const lower = token.toLowerCase()
      if (peek() === '(' && mathFns.has(lower)) {
        index++
        const args: Expression[] = []
        if (peek() !== ')') {
          args.push(expression(0))
          while (peek() === ',') { index++; args.push(expression(0)) }
        }
        if (peek() !== ')' || !args.length) throw fail()
        index++
        return { type: 'call', fn: lower as MathFn, args }
      }
      const resolved = resolveField(token, dataset)
      const id = resolved?.id ?? lower
      fields.add(id)
      return { type: 'field', id }
    }
    throw fail()
  }
  function expression(min: number): Expression {
    let left = atom()
    const priorities: Record<string, number> = { '+': 1, '-': 1, '*': 2, '/': 2 }
    for (let operator = peek() as Op; priorities[operator] >= min; operator = peek() as Op) {
      index++
      const right = expression(priorities[operator] + 1)
      left = { type: 'binary', op: operator, left, right }
    }
    return left
  }
  const root = expression(1)
  if (peek()) throw fail()
  return { expression: root, fields }
}

function evalMath(fn: MathFn, nums: number[]): { value: number | null; reason?: string } {
  if (fn === 'sqrt' && nums[0] < 0) return { value: null, reason: 'Akar bilangan negatif tidak valid.' }
  const value = fn === 'abs' ? Math.abs(nums[0]) : fn === 'round' ? Math.round(nums[0]) : fn === 'floor' ? Math.floor(nums[0]) :
    fn === 'ceil' ? Math.ceil(nums[0]) : fn === 'sqrt' ? Math.sqrt(nums[0]) : fn === 'min' ? Math.min(...nums) : Math.max(...nums)
  return Number.isFinite(value) ? { value } : { value: null, reason: 'Hasil di luar batas angka.' }
}

export function evaluate(expression: Expression, values: Values): { value: number | null; reason?: string } {
  if (expression.type === 'field') {
    const value = values[expression.id]
    return typeof value === 'number' ? { value } : { value: null, reason: `Nilai ${expression.id} kosong.` }
  }
  if (expression.type === 'number') return { value: expression.value }
  if (expression.type === 'negative') {
    const result = evaluate(expression.node, values)
    return result.value === null ? result : { value: -result.value }
  }
  if (expression.type === 'call') {
    const args: number[] = []
    for (const arg of expression.args) {
      const evaluated = evaluate(arg, values)
      if (evaluated.value === null) return evaluated
      args.push(evaluated.value)
    }
    return evalMath(expression.fn, args)
  }
  const left = evaluate(expression.left, values)
  const right = evaluate(expression.right, values)
  if (left.value === null) return left
  if (right.value === null) return right
  if (expression.op === '/' && right.value === 0) return { value: null, reason: 'Pembagi bernilai nol.' }
  const value = { '+': () => left.value! + right.value!, '-': () => left.value! - right.value!, '*': () => left.value! * right.value!, '/': () => left.value! / right.value! }[expression.op]()
  return Number.isFinite(value) ? { value } : { value: null, reason: 'Hasil di luar batas angka.' }
}

export function compileFormulas(dataset: Dataset) {
  const fields = new Map(activeFields(dataset).map(field => [field.id, field]))
  const sorted = new Map<string, Expression>()
  function verifyUnits(node: Expression): string | undefined {
    if (node.type === 'number') return undefined
    if (node.type === 'field') return fields.get(node.id)?.unit
    if (node.type === 'negative') return verifyUnits(node.node)
    if (node.type === 'call') return node.fn === 'sqrt' ? undefined : verifyUnits(node.args[0])
    const left = verifyUnits(node.left)
    const right = verifyUnits(node.right)
    if (node.op === '+' || node.op === '-') {
      if (left && right && left !== right && !(left === 'count' && right === 'number') && !(left === 'number' && right === 'count')) throw new Error('Satuan penjumlahan dan pengurangan harus sesuai.')
      return left ?? right
    }
    if (!right) return left
    return undefined
  }
  function visit(id: string, path: string[]) {
    if (path.includes(id)) throw new Error(`Rumus berputar: ${[...path, id].join(' → ')}.`)
    if (sorted.has(id)) return
    const field = fields.get(id)
    if (!field?.formula) return
    if (!isNumericUnit(field.unit) || field.derived) throw new Error(`Kolom ${id} tidak dapat memakai rumus.`)
    const tree = parseFormula(field.formula, dataset)
    for (const dependency of tree.fields) {
      const source = fields.get(dependency)
      if (!source || !isNumericUnit(source.unit)) throw new Error(`Kolom numerik ${dependency} tidak tersedia untuk rumus ${id}.`)
      if (field.public && !source.public) throw new Error(`Rumus publik ${id} memakai kolom terbatas ${dependency}.`)
      visit(dependency, [...path, id])
    }
    verifyUnits(tree.expression)
    sorted.set(id, tree.expression)
  }
  fields.forEach(field => visit(field.id, []))
  return sorted
}

export function computeStat(op: AggFn, numbers: number[], allValidCount: number): number | null {
  if (op === 'count') return allValidCount
  if (!numbers.length) return null
  if (op === 'sum') return numbers.reduce((a, b) => a + b, 0)
  if (op === 'min') return Math.min(...numbers)
  if (op === 'max') return Math.max(...numbers)
  if (op === 'median') {
    const sorted = [...numbers].sort((a, b) => a - b)
    const mid = Math.floor(sorted.length / 2)
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
  }
  const mean = numbers.reduce((a, b) => a + b, 0) / numbers.length
  if (op === 'mean' || op === 'avg') return mean
  const variance = numbers.length > 1 ? numbers.reduce((acc, value) => acc + (value - mean) ** 2, 0) / (numbers.length - 1) : 0
  return op === 'variance' || op === 'var' ? variance : Math.sqrt(variance)
}

export function evaluateCardFormula(input: string, dataset: Dataset, data: DatasetData): { value: number | null; coverage: number; percent: boolean; reason?: string } {
  const scanner = /\s*(<[^<>\r\n]+>(?:\s*\[\s*-?\d+\s*\])?|[0-9]+(?:\.[0-9]+)?|[A-Za-z][A-Za-z0-9_]*|[()+*/,-])/y
  const tokens: { text: string; position: number }[] = []
  let offset = 0
  while (offset < input.trimEnd().length) {
    scanner.lastIndex = offset
    const match = scanner.exec(input)
    if (!match) return { value: null, coverage: 0, percent: false, reason: `Simbol tidak dikenal pada posisi ${offset + 1}.` }
    tokens.push({ text: match[1], position: offset + match[0].length - match[1].length + 1 })
    offset = scanner.lastIndex
  }
  if (!tokens.length) return { value: null, coverage: 0, percent: false, reason: 'Rumus kosong.' }
  let index = 0
  let percent = false
  let coverage = data.rows.length
  const peek = () => tokens[index]?.text
  function extractRef(raw: string): { ref: string; rowIndex?: number } {
    const bracket = raw.match(/^<([^<>\r\n]+)>(?:\s*\[\s*(-?\d+)\s*\])?$/)
    if (bracket) return { ref: bracket[1].trim(), rowIndex: bracket[2] != null ? Number(bracket[2]) : undefined }
    return { ref: raw }
  }
  function fieldNumbers(ref: string): { field?: Field; numbers: number[]; validCount: number; error?: string } {
    const field = resolveField(ref, dataset)
    if (!field || !field.public) return { numbers: [], validCount: 0, error: `Kolom publik "${ref}" tidak ditemukan.` }
    const valid = data.rows.map(row => row.values[field.id]).filter(value => value !== null && value !== undefined)
    const numbers = valid.filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
    return { field, numbers, validCount: valid.length }
  }
  function parseAtom(): { value: number | null; reason?: string } {
    const token = peek()
    if (!token) return { value: null, reason: 'Rumus belum lengkap.' }
    index++
    if (token === '-') {
      const inner = parseAtom()
      return inner.value == null ? inner : { value: -inner.value }
    }
    if (token === '(') {
      const inner = parseExpr(0)
      if (peek() !== ')') return { value: null, reason: 'Tanda kurung tutup belum lengkap.' }
      index++
      return inner
    }
    if (/^\d/.test(token) && Number.isFinite(Number(token))) return { value: Number(token) }
    if (token.startsWith('<')) {
      const { ref, rowIndex } = extractRef(token)
      const field = resolveField(ref, dataset)
      if (!field || !field.public) return { value: null, reason: `Kolom publik "${ref}" tidak ditemukan.` }
      if (rowIndex != null) {
        const at = rowIndex < 0 ? data.rows.length + rowIndex : rowIndex
        const val = data.rows[at]?.values[field.id]
        if (field.unit === 'percent') percent = true
        return typeof val === 'number' ? { value: val } : { value: null, reason: `Baris [${rowIndex}] pada ${field.label} bukan angka.` }
      }
      const { numbers, validCount } = fieldNumbers(ref)
      coverage = Math.min(coverage, validCount)
      if (field.unit === 'percent') percent = true
      const op: AggFn = field.unit === 'percent' ? 'mean' : 'sum'
      const val = computeStat(op, numbers, validCount)
      return val == null ? { value: null, reason: `Data ${field.label} belum tersedia.` } : { value: val }
    }
    if (/^[A-Za-z]/.test(token)) {
      const lower = token.toLowerCase()
      if (peek() === '(' && aggFns.has(lower)) {
        index++
        const arg = peek()
        if (!arg) return { value: null, reason: `Isi kolom untuk fungsi ${lower}(...).` }
        index++
        if (peek() !== ')') return { value: null, reason: `Fungsi ${lower}(...) menerima satu kolom.` }
        index++
        const { ref } = extractRef(arg)
        const { field, numbers, validCount, error } = fieldNumbers(ref)
        if (error) return { value: null, reason: error }
        coverage = Math.min(coverage, validCount)
        if (field?.unit === 'percent' && ['mean', 'avg', 'median', 'min', 'max', 'stdev'].includes(lower)) percent = true
        const val = computeStat(lower as AggFn, numbers, validCount)
        return val == null ? { value: null, reason: `Data ${field?.label ?? ref} belum tersedia.` } : { value: val }
      }
      if (peek() === '(' && mathFns.has(lower)) {
        index++
        const args: number[] = []
        if (peek() !== ')') {
          const first = parseExpr(0)
          if (first.value == null) return first
          args.push(first.value)
          while (peek() === ',') {
            index++
            const next = parseExpr(0)
            if (next.value == null) return next
            args.push(next.value)
          }
        }
        if (peek() !== ')' || !args.length) return { value: null, reason: `Argumen fungsi ${lower}(...) belum lengkap.` }
        index++
        return evalMath(lower as MathFn, args)
      }
      const { field, numbers, validCount, error } = fieldNumbers(token)
      if (error) return { value: null, reason: error }
      coverage = Math.min(coverage, validCount)
      if (field?.unit === 'percent') percent = true
      const val = computeStat(field?.unit === 'percent' ? 'mean' : 'sum', numbers, validCount)
      return val == null ? { value: null, reason: `Data ${field?.label ?? token} belum tersedia.` } : { value: val }
    }
    return { value: null, reason: 'Rumus tidak valid.' }
  }
  function parseExpr(min: number): { value: number | null; reason?: string } {
    let left = parseAtom()
    const priorities: Record<string, number> = { '+': 1, '-': 1, '*': 2, '/': 2 }
    for (let operator = peek() as Op; priorities[operator] >= min; operator = peek() as Op) {
      index++
      const right = parseExpr(priorities[operator] + 1)
      if (left.value == null) return left
      if (right.value == null) return right
      if (operator === '/' && right.value === 0) return { value: null, reason: 'Pembagi bernilai nol.' }
      const value = { '+': () => left.value! + right.value!, '-': () => left.value! - right.value!, '*': () => left.value! * right.value!, '/': () => left.value! / right.value! }[operator]()
      left = Number.isFinite(value) ? { value } : { value: null, reason: 'Hasil di luar batas angka.' }
    }
    return left
  }
  const result = parseExpr(1)
  if (peek()) return { value: null, coverage: 0, percent: false, reason: 'Terdapat simbol berlebih di akhir rumus.' }
  return { value: result.value, coverage, percent, reason: result.reason }
}

const fmtNum = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 })
const fmtPct = new Intl.NumberFormat('id-ID', { style: 'percent', maximumFractionDigits: 1 })
function formatValue(value: Value | undefined, unit?: Field['unit']): string {
  if (value == null || value === '') return '—'
  if (unit === 'datetime' && typeof value === 'string') return formatDateTime(value)
  if (typeof value === 'number') return unit === 'percent' ? fmtPct.format(value) : fmtNum.format(value)
  return String(value)
}

export function interpolateTemplate(text: string, datasets: Dataset[], snapshotData: SnapshotData, primary?: Dataset): string {
  if (!text || !text.includes('<')) return text
  const ordered = primary ? [primary, ...datasets.filter(item => item.id !== primary.id)] : datasets
  return text.replace(/<([^<>\r\n]+)>(?:\[\s*(-?\d+)\s*\])?/g, (full, rawExpr: string, rawIndex?: string) => {
    const expr = rawExpr.trim()
    const fnMatch = expr.match(/^([a-zA-Z]+)\(\s*([^()]+)\s*\)$/)
    if (fnMatch && aggFns.has(fnMatch[1].toLowerCase())) {
      const op = fnMatch[1].toLowerCase() as AggFn
      const colRef = fnMatch[2].trim().replace(/^<|>$/g, '').trim()
      for (const dataset of ordered) {
        const field = resolveField(colRef, dataset)
        if (!field || !field.public) continue
        const data = snapshotData[dataset.id]
        if (!data) continue
        const valid = data.rows.map(row => row.values[field.id]).filter(value => value !== null && value !== undefined)
        const numbers = valid.filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
        const val = computeStat(op, numbers, valid.length)
        const unit = field.unit === 'percent' && ['mean', 'avg', 'median', 'min', 'max', 'stdev'].includes(op) ? 'percent' : 'number'
        return formatValue(val, unit)
      }
      return full
    }
    const rowIndex = rawIndex != null ? Number(rawIndex) : undefined
    const isIdentity = ['identitas', 'nama', 'wilayah', 'petugas', 'name'].includes(normKey(expr))
    for (const dataset of ordered) {
      const data = snapshotData[dataset.id]
      if (!data?.rows.length) continue
      if (isIdentity) {
        const idx = rowIndex != null ? (rowIndex < 0 ? data.rows.length + rowIndex : rowIndex) : 0
        return data.rows[idx]?.name ?? '—'
      }
      const field = resolveField(expr, dataset)
      if (!field || !field.public) continue
      if (rowIndex != null) {
        const idx = rowIndex < 0 ? data.rows.length + rowIndex : rowIndex
        return formatValue(data.rows[idx]?.values[field.id], field.unit)
      }
      const nonEmpty = data.rows.map(row => row.values[field.id]).filter(value => value !== null && value !== undefined && value !== '')
      return formatValue(nonEmpty[0], field.unit)
    }
    return full
  })
}
