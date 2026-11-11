/**
 * Calendar arithmetic in a chosen timezone.
 *
 * Everything is done through `Intl` so that a day boundary is the user's local
 * midnight rather than the host's, and no date library is needed.
 *
 * @module accountant/calendar
 */

export const HOUR_MS = 3_600_000
export const DAY_MS = 86_400_000

const formatters = new Map()

function formatterFor(tz, withTime) {
  const key = `${tz}|${withTime}`
  let formatter = formatters.get(key)
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      ...(withTime ? { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' } : {}),
    })
    formatters.set(key, formatter)
  }
  return formatter
}

/** Local calendar parts for an instant: date, year, month, day, and clock. */
export function zonedParts(ms, tz) {
  const parts = formatterFor(tz, true).formatToParts(new Date(ms))
  const value = (type) => Number(parts.find((part) => part.type === type)?.value)
  const year = value('year')
  const month = value('month')
  const day = value('day')
  return {
    year,
    month,
    day,
    hour: value('hour'),
    minute: value('minute'),
    second: value('second'),
    date: `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
  }
}

/** Local calendar date, `YYYY-MM-DD`, for an instant in `tz`. */
export function localDate(ms, tz) {
  const parts = formatterFor(tz, false).formatToParts(new Date(ms))
  const value = (type) => parts.find((part) => part.type === type)?.value
  return `${value('year')}-${value('month')}-${value('day')}`
}

/** Alias kept for readability at call sites that want "now". */
export const zonedNow = zonedParts

/** Days in a calendar month. */
export function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/** ISO weekday: Monday is 1, Sunday is 7. */
export function isoWeekday(date) {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay()
  return day === 0 ? 7 : day
}

/** ISO week label, `YYYY-Www`, using the year of the week's Thursday. */
export function isoWeek(date) {
  const [year, month, day] = date.split('-').map(Number)
  const cursor = new Date(Date.UTC(year, month - 1, day))
  const offsetToMonday = (cursor.getUTCDay() + 6) % 7
  cursor.setUTCDate(cursor.getUTCDate() - offsetToMonday + 3)
  const weekYear = cursor.getUTCFullYear()
  const firstThursday = new Date(Date.UTC(weekYear, 0, 4))
  const firstOffset = (firstThursday.getUTCDay() + 6) % 7
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstOffset + 3)
  const week = 1 + Math.round((cursor.getTime() - firstThursday.getTime()) / (7 * DAY_MS))
  return `${weekYear}-W${String(week).padStart(2, '0')}`
}

/** Shift a `YYYY-MM-DD` string by whole days. */
export function addDays(date, delta) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + delta * DAY_MS).toISOString().slice(0, 10)
}
