import type { Dataset, Values } from '../contracts/index'

type Op = '+' | '-' | '*' | '/'
type Expression = { type: 'number'; value: number } | { type: 'field'; id: string } | { type: 'negative'; node: Expression } | { type: 'binary'; op: Op; left: Expression; right: Expression }
type Formula = { expression: Expression; fields: Set<string> }

export function parseFormula(input: string): Formula {
  const scanner = /\s*([0-9]+(?:\.[0-9]+)?|[A-Za-z][A-Za-z0-9_]*|[()+*/-])/y
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
    if (/^\d/.test(token) && Number.isFinite(Number(token))) return { type: 'number', value: Number(token) }
    if (/^[A-Za-z]/.test(token)) { const id = token.toLowerCase(); fields.add(id); return { type: 'field', id } }
    throw fail()
  }
  function expression(min: number): Expression {
    let left = atom()
    const priorities = { '+': 1, '-': 1, '*': 2, '/': 2 }
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
  const left = evaluate(expression.left, values)
  const right = evaluate(expression.right, values)
  if (left.value === null) return left
  if (right.value === null) return right
  if (expression.op === '/' && right.value === 0) return { value: null, reason: 'Pembagi bernilai nol.' }
  const value = { '+': () => left.value! + right.value!, '-': () => left.value! - right.value!, '*': () => left.value! * right.value!, '/': () => left.value! / right.value! }[expression.op]()
  return Number.isFinite(value) ? { value } : { value: null, reason: 'Hasil di luar batas angka.' }
}

export function compileFormulas(dataset: Dataset) {
  const fields = new Map(dataset.fields.map(field => [field.id, field]))
  const sorted = new Map<string, Expression>()
  function verifyUnits(node: Expression): string | undefined {
    if (node.type === 'number') return undefined
    if (node.type === 'field') return fields.get(node.id)?.unit
    if (node.type === 'negative') return verifyUnits(node.node)
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
    if (field.unit === 'category' || field.derived) throw new Error(`Kolom ${id} tidak dapat memakai rumus.`)
    const tree = parseFormula(field.formula)
    for (const dependency of tree.fields) {
      const source = fields.get(dependency)
      if (!source || source.unit === 'category') throw new Error(`Kolom numerik ${dependency} tidak tersedia untuk rumus ${id}.`)
      if (field.public && !source.public) throw new Error(`Rumus publik ${id} memakai kolom terbatas ${dependency}.`)
      visit(dependency, [...path, id])
    }
    verifyUnits(tree.expression)
    sorted.set(id, tree.expression)
  }
  dataset.fields.forEach(field => visit(field.id, []))
  return sorted
}
