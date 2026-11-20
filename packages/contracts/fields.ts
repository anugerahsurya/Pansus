import type { Dataset, Field } from './index'

export const activeFields = (dataset: Dataset) => dataset.fields.filter(field => field.enabled !== false)
export const isNumericUnit = (unit: Field['unit'] | undefined) => unit === 'count' || unit === 'number' || unit === 'percent'
