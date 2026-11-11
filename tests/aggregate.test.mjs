import test from 'node:test'
import assert from 'node:assert/strict'

import {
  addDays,
  daysInMonth,
  isoWeek,
  isoWeekday,
  localDate,
} from '../skills/accountant/scripts/lib/calendar.mjs'
import { buildDays, filterRange, summarize } from '../skills/accountant/scripts/lib/aggregate.mjs'

function bucket({ input = 0, cacheRead = 0, cacheWrite = 0, output = 0, requests = 1 } = {}) {
  return { input, cacheRead, cacheWrite, output, requests }
}

function sessionFile(buckets, sessionId = 'session-1') {
  return {
    path: `${sessionId}.zstd`,
    size: 1,
    mtimeMs: 0,
    sessionId,
    cwd: 'C:\\work',
    agentPreset: 'standard',
    delegationDepth: 0,
    createdAt: 0,
    buckets,
  }
}

test('ISO weeks follow the Thursday rule', () => {
  assert.equal(isoWeek('2026-11-11'), '2026-W46')
  assert.equal(isoWeek('2026-11-09'), '2026-W46')
  assert.equal(isoWeek('2026-11-15'), '2026-W46')
  assert.equal(isoWeek('2026-01-01'), '2026-W01')
  assert.equal(isoWeek('2027-01-01'), '2026-W53')
})

test('ISO weekday counts Monday as one and Sunday as seven', () => {
  assert.equal(isoWeekday('2026-11-09'), 1)
  assert.equal(isoWeekday('2026-11-11'), 3)
  assert.equal(isoWeekday('2026-11-15'), 7)
})

test('calendar helpers agree with real month lengths', () => {
  assert.equal(daysInMonth(2026, 2), 28)
  assert.equal(daysInMonth(2024, 2), 29)
  assert.equal(daysInMonth(2026, 11), 30)
  assert.equal(addDays('2026-11-30', 1), '2026-12-01')
  assert.equal(addDays('2026-01-01', -1), '2025-12-31')
})

test('a UTC bucket lands on the local day it belongs to', () => {
  assert.equal(localDate(Date.parse('2026-11-10T16:00:00Z'), 'Asia/Manila'), '2026-11-11')
  assert.equal(localDate(Date.parse('2026-11-10T15:59:00Z'), 'Asia/Manila'), '2026-11-10')
  assert.equal(localDate(Date.parse('2026-11-10T16:00:00Z'), 'UTC'), '2026-11-10')
})

test('buildDays prices a bucket at its own hour and tariff', () => {
  const files = [sessionFile({
    '2026-11-10': {
      16: { 'deepseek-official/deepseek-flash': bucket({ input: 1_000_000 }) },
    },
  })]

  const { days } = buildDays(files, { tz: 'Asia/Manila', fxRate: 62 })
  assert.equal(days.length, 1)
  assert.equal(days[0].date, '2026-11-11')
  assert.equal(days[0].tokens.total, 1_000_000)
  assert.equal(days[0].usd, 0.15)
  assert.equal(days[0].php, 0.15 * 62)
  assert.equal(days[0].sessions.size, 1)
})

test('buildDays applies the peak rate at a peak hour', () => {
  const files = [sessionFile({
    '2026-11-10': {
      2: { 'deepseek-official/deepseek-flash': bucket({ input: 1_000_000 }) },
    },
  })]
  const { days } = buildDays(files, { tz: 'UTC', fxRate: 62 })
  assert.equal(days[0].date, '2026-11-10')
  assert.equal(days[0].usd, 0.3)
})

test('buildDays reports unpriced models', () => {
  const files = [sessionFile({
    '2026-11-10': { 2: { 'deepseek-official/mystery-9': bucket({ input: 1_000_000 }) } },
  })]
  const { unknownModels } = buildDays(files, { tz: 'UTC' })
  assert.deepEqual(unknownModels, ['mystery-9'])
})

test('summarize rolls up days, weeks, and months and projects them', () => {
  const files = [sessionFile({
    '2026-11-09': { 2: { 'deepseek-official/deepseek-flash': bucket({ input: 1_000_000 }) } },
    '2026-11-10': { 2: { 'deepseek-official/deepseek-flash': bucket({ input: 1_000_000 }) } },
    '2026-11-11': { 2: { 'deepseek-official/deepseek-flash': bucket({ input: 1_000_000 }) } },
  })]

  const model = summarize(files, {
    tz: 'UTC',
    nowMs: Date.parse('2026-11-11T04:00:00Z'),
    fx: { rate: 62, asOf: '2026-11-11', pair: 'USD/PHP' },
  })

  assert.equal(model.days.length, 3)
  assert.equal(model.weeks.length, 1)
  assert.equal(model.weeks[0].key, '2026-W46')
  assert.equal(model.months.length, 1)
  assert.equal(model.months[0].key, '2026-11')

  // Three peak-hour days of 1M input tokens: $0.30 each, $0.90 total.
  assert.equal(model.months[0].tokens.total, 3_000_000)
  assert.equal(model.months[0].usd.toFixed(6), '0.900000')
  assert.equal(model.summary.month.tokens.total, 3_000_000)

  assert.equal(model.summary.today.date, '2026-11-11')
  assert.equal(model.summary.week.elapsedDays, 3)
  assert.equal(model.summary.month.elapsedDays, 11)
  assert.equal(model.summary.month.daysInMonth, 30)

  // Week forecast: 0.90 / 3 * 7. Month forecast: 0.90 / 11 * 30.
  assert.equal(model.summary.week.forecast.usd.toFixed(6), '2.100000')
  assert.equal(model.summary.month.forecast.usd.toFixed(6), '2.454545')
  assert.equal(model.summary.month.forecast.php.toFixed(4), '152.1818')
})

test('a day with no usage is absent rather than a zero row', () => {
  const files = [sessionFile({
    '2026-11-09': { 2: { 'deepseek-official/deepseek-flash': bucket({ input: 10 }) } },
    '2026-11-11': { 2: { 'deepseek-official/deepseek-flash': bucket({ input: 10 }) } },
  })]
  const { days } = buildDays(files, { tz: 'UTC' })
  assert.deepEqual(days.map((day) => day.date), ['2026-11-09', '2026-11-11'])
})

test('filterRange keeps only the requested window', () => {
  const days = [{ date: '2026-11-01' }, { date: '2026-11-05' }, { date: '2026-11-10' }]
  assert.deepEqual(
    filterRange(days, { since: '2026-11-02', until: '2026-11-09' }).map((day) => day.date),
    ['2026-11-05'],
  )
})

test('an empty store reports zeros instead of throwing', () => {
  const model = summarize([], { tz: 'Asia/Manila', nowMs: Date.parse('2026-11-11T04:00:00Z') })
  assert.equal(model.days.length, 0)
  assert.equal(model.totals.usd, 0)
  assert.equal(model.summary.month.forecast.usd, 0)
  assert.equal(model.coverage.firstDate, null)
})
