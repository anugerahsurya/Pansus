import type { Dataset } from './index'

export const activeFields = (dataset: Dataset) => dataset.fields.filter(field => field.enabled !== false)
