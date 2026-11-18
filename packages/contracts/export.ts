import { z } from 'zod'
import { definitionSchema } from './index'

const schema = z.toJSONSchema(definitionSchema, { target: 'draft-2020-12' })
process.stdout.write(JSON.stringify(schema, null, 2) + '\n')
