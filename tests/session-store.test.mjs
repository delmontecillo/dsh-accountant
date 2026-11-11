import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zstdCompressSync } from 'node:zlib'

import {
  collectUsage,
  decodeZstdFrames,
  parseSessionText,
} from '../skills/accountant/scripts/lib/session-store.mjs'

function frame(record) {
  return zstdCompressSync(Buffer.from(`${JSON.stringify(record)}\n`))
}

function logOf(records) {
  return Buffer.concat(records.map(frame))
}

const header = {
  type: 'session',
  version: 4,
  id: 'session-abc',
  createdAt: 1_790_000_000_000,
  cwd: 'C:\\work',
  isSeeded: false,
  delegationDepth: 0,
  agentPreset: 'standard',
}

function usageRecord(time, { input = 0, cacheRead = 0, cacheWrite = 0, output = 0, model = 'deepseek-flash' } = {}) {
  return {
    type: 'assistant/message',
    seq: 1,
    time,
    data: {
      turn: 1,
      step: 1,
      message: { role: 'assistant', content: [], source: { kind: 'model', provider: 'deepseek-official', model } },
      usage: {
        inputTokens: input,
        outputTokens: output,
        cacheReadTokens: cacheRead,
        cacheWriteTokens: cacheWrite,
        totalTokens: input + cacheRead + cacheWrite + output,
      },
    },
  }
}

test('concatenated zstd frames are all decoded, not just the first', () => {
  const text = decodeZstdFrames(logOf([header, usageRecord(1_790_000_000_000, { input: 5 })]))
  assert.equal(text.trim().split('\n').length, 2)
  assert.match(text, /assistant\/message/)
})

test('a truncated trailing frame is skipped without losing earlier ones', () => {
  const full = logOf([header, usageRecord(1_790_000_000_000, { input: 5 })])
  const truncated = Buffer.concat([full, Buffer.from([0x28, 0xb5, 0x2f, 0xfd, 0x00, 0x01])])
  const text = decodeZstdFrames(truncated)
  assert.match(text, /"type":"session"/)
  assert.match(text, /assistant\/message/)
})

test('usage is bucketed by UTC day, hour, and model', () => {
  const time = Date.parse('2026-11-10T16:05:00Z')
  const { header: parsed, buckets } = parseSessionText(
    decodeZstdFrames(logOf([
      header,
      usageRecord(time, { input: 10, cacheRead: 20, cacheWrite: 0, output: 30 }),
      usageRecord(time + 60_000, { input: 1, output: 2 }),
    ])),
  )

  assert.equal(parsed.sessionId, 'session-abc')
  assert.equal(parsed.cwd, 'C:\\work')

  const bucket = buckets['2026-11-10']['16']['deepseek-official/deepseek-flash']
  assert.equal(bucket.input, 11)
  assert.equal(bucket.cacheRead, 20)
  assert.equal(bucket.cacheWrite, 0)
  assert.equal(bucket.output, 32)
  assert.equal(bucket.requests, 2)
})

test('records without usage are ignored', () => {
  const text = logOf([
    header,
    { type: 'user/message', seq: 2, time: 1_790_000_000_001, data: { content: [] } },
    { type: 'assistant/message', seq: 3, time: 1_790_000_000_002, data: { turn: 1 } },
  ])
  const { buckets } = parseSessionText(decodeZstdFrames(text))
  assert.deepEqual(buckets, {})
})

test('the cache is reused and invalidated by a changed file', async () => {
  const root = await mkdtemp(join(tmpdir(), 'accountant-store-'))
  const folder = join(root, 'sessions', '--work--', 'session-abc')
  await mkdir(folder, { recursive: true })
  const file = join(folder, 'session.v4.jsonl.zstd')

  await writeFile(file, logOf([header, usageRecord(Date.parse('2026-11-10T16:05:00Z'), { input: 10 })]))
  const first = await collectUsage({ dataDir: root })
  assert.equal(first.stats.scanned, 1)
  assert.equal(first.stats.reused, 0)
  assert.equal(first.files.length, 1)
  assert.equal(first.files[0].sessionId, 'session-abc')

  const second = await collectUsage({ dataDir: root })
  assert.equal(second.stats.scanned, 0)
  assert.equal(second.stats.reused, 1)

  await writeFile(file, logOf([
    header,
    usageRecord(Date.parse('2026-11-10T16:05:00Z'), { input: 10 }),
    usageRecord(Date.parse('2026-11-10T17:05:00Z'), { input: 7 }),
  ]))
  const third = await collectUsage({ dataDir: root })
  assert.equal(third.stats.scanned, 1)
  assert.equal(third.files[0].buckets['2026-11-10']['17']['deepseek-official/deepseek-flash'].input, 7)
})

test('a missing sessions directory yields an empty scan, not an error', async () => {
  const root = await mkdtemp(join(tmpdir(), 'accountant-empty-'))
  const result = await collectUsage({ dataDir: root })
  assert.deepEqual(result.files, [])
  assert.equal(result.stats.files, 0)
})
