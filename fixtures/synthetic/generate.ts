import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { exampleDates, exampleFiles } from './index'

for (const template of ['pes', 'susenas'] as const) for (const day of [0, 1] as const) {
  const target = resolve('fixtures/synthetic/generated', template, exampleDates[template][day])
  await mkdir(target, { recursive: true })
  await Promise.all(Object.values(exampleFiles(template, day)).map(file => writeFile(resolve(target, file.name), file.bytes)))
}
