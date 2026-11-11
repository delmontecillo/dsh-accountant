import test from 'node:test'
import assert from 'node:assert/strict'

import {
  DEFAULT_HOLIDAYS,
  PEAK_RATES,
  costOf,
  isPeakUtc,
  rateFor,
  resolveModel,
  toPhp,
} from '../skills/accountant/scripts/lib/pricing.mjs'

test('peak windows are half-open on a weekday', () => {
  const none = new Set()
  assert.equal(isPeakUtc('2026-11-11', 0, none), false)
  assert.equal(isPeakUtc('2026-11-11', 1, none), true)
  assert.equal(isPeakUtc('2026-11-11', 3, none), true)
  assert.equal(isPeakUtc('2026-11-11', 4, none), false)
  assert.equal(isPeakUtc('2026-11-11', 5, none), false)
  assert.equal(isPeakUtc('2026-11-11', 6, none), true)
  assert.equal(isPeakUtc('2026-11-11', 9, none), true)
  assert.equal(isPeakUtc('2026-11-11', 10, none), false)
  assert.equal(isPeakUtc('2026-11-11', 12, none), false)
})

test('weekends are off-peak', () => {
  const none = new Set()
  assert.equal(isPeakUtc('2026-11-14', 2, none), false)
  assert.equal(isPeakUtc('2026-11-15', 7, none), false)
  assert.equal(isPeakUtc('2026-11-16', 2, none), true)
})

test('a Chinese public holiday is off-peak all day', () => {
  assert.equal(isPeakUtc('2026-10-01', 2, DEFAULT_HOLIDAYS), false)
  assert.equal(isPeakUtc('2026-10-01', 2, new Set()), true)
  assert.equal(isPeakUtc('2026-02-16', 7, DEFAULT_HOLIDAYS), false)
})

test('off-peak costs exactly half of peak', () => {
  const tokens = { input: 1_000_000, cacheRead: 0, cacheWrite: 0, output: 0 }
  assert.equal(costOf(tokens, 'deepseek-flash', true).usd, 0.3)
  assert.equal(costOf(tokens, 'deepseek-flash', false).usd, 0.15)
})

test('the four token classes are priced at their own rate', () => {
  const tokens = { input: 0, cacheRead: 1_000_000, cacheWrite: 0, output: 0 }
  assert.equal(costOf(tokens, 'deepseek-flash', true).usd, 0.006)
  const output = { input: 0, cacheRead: 0, cacheWrite: 0, output: 1_000_000 }
  assert.equal(costOf(output, 'deepseek-flash', true).usd, 1.2)
  const write = { input: 0, cacheRead: 0, cacheWrite: 1_000_000, output: 0 }
  assert.equal(costOf(write, 'deepseek-flash', true).usd, 0.3)
})

test('retired model names are billed at Flash rates', () => {
  for (const alias of ['deepseek-chat', 'deepseek-v4-flash', 'deepseek-v4-flash-vision-exp']) {
    const resolved = resolveModel(alias)
    assert.equal(resolved.priced, 'deepseek-flash')
    assert.equal(resolved.known, true)
  }
})

test('an unknown model is priced at Flash rates but reported as unknown', () => {
  const priced = costOf({ input: 1_000_000, cacheRead: 0, cacheWrite: 0, output: 0 }, 'mystery-1', true)
  assert.equal(priced.known, false)
  assert.equal(priced.priced, 'deepseek-flash')
  assert.equal(priced.usd, 0.3)
})

test('rateFor halves every column off-peak', () => {
  const peak = rateFor('deepseek-v4-pro', true)
  const off = rateFor('deepseek-v4-pro', false)
  assert.equal(peak.cacheHit, PEAK_RATES['deepseek-v4-pro'].cacheHit)
  assert.equal(off.cacheHit, peak.cacheHit / 2)
  assert.equal(off.cacheMiss, peak.cacheMiss / 2)
  assert.equal(off.output, peak.output / 2)
})

test('peso conversion multiplies by the rate', () => {
  assert.equal(toPhp(1, 62), 62)
  assert.equal(toPhp(0, 62), 0)
  assert.equal(toPhp(4.257755898, 62), 263.980865676)
})
