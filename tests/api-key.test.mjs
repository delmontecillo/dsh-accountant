import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  attachKeyUsage,
  fingerprintOf,
  keyWindows,
  loadKeyState,
  observeActiveKey,
  parseCredentialRefs,
  resolveActiveKey,
} from '../skills/accountant/scripts/lib/api-key.mjs'

const CREDENTIALS = `version: 1
refs:
  DEEPSEEK_API_KEY: sk-test-key-123
records:
  client-connection/browser-session:
    kind: api-key
    payload:
      secret: not-the-key
`

async function tempStore(contents = CREDENTIALS) {
  const dir = await mkdtemp(join(tmpdir(), 'accountant-key-'))
  await writeFile(join(dir, '.credentials.yaml'), contents, 'utf8')
  return dir
}

test('the refs mapping is parsed and the records mapping is ignored', () => {
  assert.deepEqual(parseCredentialRefs(CREDENTIALS), { DEEPSEEK_API_KEY: 'sk-test-key-123' })
})

test('quoted values are unquoted and comments are skipped', () => {
  const refs = parseCredentialRefs([
    'refs:',
    '  # a comment',
    '  DEEPSEEK_API_KEY: "sk-quoted"',
    "  OTHER_KEY: 'sk-single'",
    'records:',
    '  x:',
    '    secret: hidden',
  ].join('\n'))
  assert.deepEqual(refs, { DEEPSEEK_API_KEY: 'sk-quoted', OTHER_KEY: 'sk-single' })
})

test('a fingerprint is stable, short, and does not contain the key', () => {
  const one = fingerprintOf('sk-test-key-123')
  assert.equal(one, fingerprintOf('sk-test-key-123'))
  assert.notEqual(one, fingerprintOf('sk-test-key-124'))
  assert.match(one, /^[0-9a-f]{12}$/)
  assert.equal(one.includes('sk-test'), false)
})

test('the launch environment outranks the credential store', async () => {
  const dir = await tempStore()
  try {
    const fromStore = await resolveActiveKey({ dataDir: dir, env: {} })
    assert.equal(fromStore.source, 'store')
    const fromEnv = await resolveActiveKey({ dataDir: dir, env: { DEEPSEEK_API_KEY: 'sk-env' } })
    assert.equal(fromEnv.source, 'env')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('the first sighting records the key and its store timestamp', async () => {
  const dir = await tempStore()
  try {
    const storeTime = new Date('2026-11-11T06:51:46Z')
    await utimes(join(dir, '.credentials.yaml'), storeTime, storeTime)

    const first = await observeActiveKey({ dataDir: dir, nowMs: Date.parse('2026-11-11T07:05:00Z'), env: {} })
    assert.equal(first.fingerprint, fingerprintOf('sk-test-key-123'))
    assert.equal(first.source, 'store')
    assert.equal(first.since, storeTime.getTime())

    const state = JSON.parse(await readFile(join(dir, 'accountant.keys.json'), 'utf8'))
    assert.equal(state.keys.length, 1)
    assert.equal(state.active, first.fingerprint)
    assert.equal(JSON.stringify(state).includes('sk-test-key-123'), false)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('seeing the same key again adds no entry', async () => {
  const dir = await tempStore()
  try {
    const now = Date.parse('2026-11-11T07:05:00Z')
    await observeActiveKey({ dataDir: dir, nowMs: now, env: {} })
    await observeActiveKey({ dataDir: dir, nowMs: now + 60_000, env: {} })
    const state = await loadKeyState(join(dir, 'accountant.keys.json'))
    assert.equal(state.keys.length, 1)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a rotated key starts a second window and freezes the first', async () => {
  const dir = await tempStore()
  try {
    const firstSeen = new Date('2026-11-10T00:00:00Z')
    await utimes(join(dir, '.credentials.yaml'), firstSeen, firstSeen)
    await observeActiveKey({ dataDir: dir, nowMs: Date.parse('2026-11-10T01:00:00Z'), env: {} })

    await writeFile(join(dir, '.credentials.yaml'), CREDENTIALS.replace('sk-test-key-123', 'sk-second-key'), 'utf8')
    const rotated = new Date('2026-11-11T06:51:46Z')
    await utimes(join(dir, '.credentials.yaml'), rotated, rotated)
    const second = await observeActiveKey({ dataDir: dir, nowMs: Date.parse('2026-11-11T07:05:00Z'), env: {} })

    const state = await loadKeyState(join(dir, 'accountant.keys.json'))
    assert.equal(state.keys.length, 2)
    assert.equal(second.fingerprint, fingerprintOf('sk-second-key'))

    const windows = keyWindows(state.keys)
    assert.equal(windows[0].fromMs, Date.parse('2026-11-10T00:00:00Z'))
    assert.equal(windows[0].toMs, Date.parse('2026-11-11T07:00:00Z'))
    assert.equal(windows[1].fromMs, Date.parse('2026-11-11T07:00:00Z'))
    assert.equal(windows[1].toMs, Infinity)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a missing store reports no key instead of throwing', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'accountant-empty-'))
  try {
    const result = await observeActiveKey({ dataDir: dir, nowMs: Date.now(), env: {} })
    assert.equal(result.fingerprint, null)
    assert.deepEqual(result.keys, [])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('the active key gets a scoped today/week/month summary and forecast', async () => {
  const dir = await tempStore()
  try {
    const storeTime = new Date('2026-11-11T06:51:46Z')
    await utimes(join(dir, '.credentials.yaml'), storeTime, storeTime)

    const files = [{
      path: 'a.zstd',
      size: 1,
      mtimeMs: 0,
      sessionId: 'session-1',
      buckets: {
        '2026-11-11': {
          6: { 'deepseek-official/deepseek-flash': { input: 1_000_000, cacheRead: 0, cacheWrite: 0, output: 0, requests: 1 } },
          7: { 'deepseek-official/deepseek-flash': { input: 2_000_000, cacheRead: 0, cacheWrite: 0, output: 0, requests: 1 } },
        },
      },
    }]

    const model = {}
    await attachKeyUsage(model, files, {
      dataDir: dir,
      nowMs: Date.parse('2026-11-11T08:00:00Z'),
      tz: 'UTC',
      fx: { rate: 62, asOf: '2026-11-11' },
    })

    // The 06:00Z bucket predates the key's 07:00Z window and is excluded.
    assert.equal(model.key.summary.today.tokens.total, 2_000_000)
    assert.equal(model.key.summary.month.tokens.total, 2_000_000)
    assert.equal(model.key.totals.tokens.total, 2_000_000)

    // A one-day-old key projects its own daily rate across the 30-day month.
    assert.equal(model.key.summary.elapsedDays, 1)
    assert.equal(model.key.summary.forecast.tokens.total, 60_000_000)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
