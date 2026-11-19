import test from 'node:test'
import assert from 'node:assert/strict'

import { parseBalance, tagRollup } from '../host/spend-route.mjs'

test('balance parsing picks the USD row when the account reports several', () => {
  assert.deepEqual(
    parseBalance({
      is_available: true,
      balance_infos: [
        { currency: 'CNY', total_balance: '100.00' },
        { currency: 'USD', total_balance: '21.11' },
      ],
    }),
    { currency: 'USD', total: 21.11 },
  )
})

test('a single-currency account is shown as the endpoint reports it', () => {
  assert.deepEqual(
    parseBalance({ balance_infos: [{ currency: 'CNY', total_balance: '7.50' }] }),
    { currency: 'CNY', total: 7.5 },
  )
})

test('a malformed or empty payload yields no balance rather than a number', () => {
  assert.equal(parseBalance({}), null)
  assert.equal(parseBalance(null), null)
  assert.equal(parseBalance({ balance_infos: [{ currency: 'USD', total_balance: 'n/a' }] }), null)
})

test('tag rollup sums sessions per tag and keeps untagged sessions visible', () => {
  const rows = tagRollup([
    { tag: 'work', tokens: { total: 1_000_000 }, usd: 0.5, php: 31, requests: 2 },
    { tag: 'work', tokens: { total: 2_000_000 }, usd: 1, php: 62, requests: 3 },
    { tag: null, tokens: { total: 500 }, usd: 0.01, php: 0.62, requests: 1 },
  ])
  assert.deepEqual(rows.map((row) => row.tag), ['work', 'untagged'])
  assert.equal(rows[0].sessions, 2)
  assert.equal(rows[0].usd, 1.5)
  assert.equal(rows[0].php, 93)
  assert.equal(rows[1].tokens, 500)
})
