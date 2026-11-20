const localDate = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/
const isoDate = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/
const pad = (value: string | number) => String(value).padStart(2, '0')

export function parseDateTime(value: unknown): string | undefined {
  if (typeof value !== 'string') return
  const text = value.trim()
  const match = isoDate.exec(text) ?? localDate.exec(text)
  if (!match) return
  const [first, month, last, hour = '00', minute = '00', second = '00'] = match.slice(1)
  const [year, day] = first.length === 4 ? [first, last] : [last, first]
  const leap = +year % 4 === 0 && (+year % 100 !== 0 || +year % 400 === 0)
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  if (+year < 1 || +month < 1 || +month > 12 || +day < 1 || +day > days[+month - 1] || +hour > 23 || +minute > 59 || +second > 59) return
  return [year, pad(month), pad(day)].join('-') + 'T' + [pad(hour), minute, second].join(':')
}

export function formatDateTime(value: string): string {
  const dateTime = parseDateTime(value)
  return dateTime ? [dateTime.slice(8, 10), dateTime.slice(5, 7), dateTime.slice(0, 4)].join('/') + ' ' + dateTime.slice(11) : value
}
