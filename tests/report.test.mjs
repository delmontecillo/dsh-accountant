import test from 'node:test'
import assert from 'node:assert/strict'

import { summarize } from '../skills/accountant/scripts/lib/aggregate.mjs'
import { fmtInt, fmtPhp, fmtTokens, fmtUsd, renderCsv, renderMarkdown, renderText, toJson } from '../skills/accountant/scripts/lib/report.mjs'

function bucket(tokens) {
  return { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, requests: 1, ...tokens }
}

function modelFixture() {
  const files = [{
    path: 'a.zstd',
    size: 1,
    mtimeMs: 0,
    sessionId: 'session-1',
    cwd: 'C:\\work',
    agentPreset: 'standard',
    delegationDepth: 0,
    createdAt: 0,
    buckets: {
      '2026-11-09': { 2: { 'deepseek-official/deepseek-flash': bucket({ input: 2_000_000, output: 500_000 }) } },
      '2026-11-10': { 2: { 'deepseek-official/deepseek-flash': bucket({ input: 1_000_000 }) } },
    },
  }]
  return summarize(files, {
    tz: 'Asia/Manila',
    nowMs: Date.parse('2026-11-11T04:00:00Z'),
    fx: { rate: 62, asOf: '2026-11-11', pair: 'USD/PHP' },
  })
}

test('token formatting compacts K and M', () => {
  assert.equal(fmtTokens(0), '0')
  assert.equal(fmtTokens(987), '987')
  assert.equal(fmtTokens(12_345), '12.3K')
  assert.equal(fmtTokens(1_240_000), '1.24M')
  assert.equal(fmtTokens(45_600_000), '45.6M')
})

test('dollar formatting keeps sub-cent precision', () => {
  assert.equal(fmtUsd(0), '$0.00')
  assert.equal(fmtUsd(0.00341), '$0.00341')
  assert.equal(fmtUsd(0.4231), '$0.4231')
  assert.equal(fmtUsd(17.18), '$17.18')
  assert.equal(fmtUsd(1234.5), '$1,234.50')
})

test('peso formatting groups thousands and keeps four decimals under one', () => {
  assert.equal(fmtPhp(0), '₱0.00')
  assert.equal(fmtPhp(0.6035), '₱0.6035')
  assert.equal(fmtPhp(1064.94), '₱1,064.94')
  assert.equal(fmtInt(6555), '6,555')
})

test('text report has the three sections and no NaN', () => {
  const text = renderText(modelFixture(), { group: 'day', limit: 7, stats: { scanned: 1, reused: 0, failed: 0, ms: 5 } })
  assert.match(text, /Now/)
  assert.match(text, /Predicted/)
  assert.match(text, /Per day/)
  assert.match(text, /USD→PHP 62\.00/)
  assert.doesNotMatch(text, /NaN|undefined|Infinity/)
})

test('markdown report renders tables', () => {
  const md = renderMarkdown(modelFixture(), { group: 'month', limit: 6 })
  assert.match(md, /^# Token spend/m)
  assert.match(md, /\| Period \| Tokens \| USD \| PHP \|/)
  assert.match(md, /_Estimates from recorded usage, not an invoice\._/)
})

test('csv exposes the requested group with a header row', () => {
  const csv = renderCsv(modelFixture(), { group: 'day' })
  const lines = csv.trim().split('\n')
  assert.equal(lines[0], 'period,from,to,tokens_input,tokens_cache_read,tokens_cache_write,tokens_output,tokens_total,usd,php,requests')
  assert.equal(lines.length, 3)
  assert.match(lines[1], /^2026-11-09,/)

  const monthly = renderCsv(modelFixture(), { group: 'month' }).trim().split('\n')
  assert.equal(monthly.length, 2)
  assert.match(monthly[1], /^2026-11,/)
})

test('json output serialises sets and maps to plain values', () => {
  const json = toJson(modelFixture())
  const text = JSON.stringify(json)
  assert.doesNotThrow(() => JSON.parse(text))
  assert.equal(json.days.length, 2)
  assert.equal(typeof json.days[0].sessions, 'number')
  assert.ok(Array.isArray(json.days[0].models))
  assert.equal(json.summary.month.daysInMonth, 30)
  assert.equal(json.pricingAsOf, '2026-11-11')
  assert.equal(json.coverage.sessions, 1)
})
