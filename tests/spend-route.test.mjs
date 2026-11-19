import test from 'node:test'
import assert from 'node:assert/strict'

import { parseBalance } from '../host/spend-route.mjs'

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
