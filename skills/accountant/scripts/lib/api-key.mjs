/**
 * Which DeepSeek key DSH is spending on, and the usage that belongs to it.
 *
 * The session store records usage, not the credential that paid for it. This
 * module bridges that gap: it resolves the key DSH is configured with, keeps a
 * fingerprint of it (never the key itself), and records when this tool first
 * saw that fingerprint. Every key therefore gets a window — from the first hour
 * after it was first seen until the next key takes over — and usage inside that
 * window is what the key has cost.
 *
 * Key resolution mirrors DSH: the launch environment wins, then the credential
 * store at `<dataDir>/.credentials.yaml`. A project `.env` is deliberately not
 * consulted, because running the counter from another repository would then
 * pick up that repository's key.
 *
 * @module accountant/api-key
 */

import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { daysInMonth, HOUR_MS, isoWeek, localDate, zonedParts } from './calendar.mjs'
import { buildDays, totalOf, windowTotals } from './aggregate.mjs'

export const KEY_ENV = 'DEEPSEEK_API_KEY'

const STATE_VERSION = 1
const FINGERPRINT_HEX = 12

/** Parse the `refs:` mapping out of the credential store's YAML. */
export function parseCredentialRefs(text) {
  const refs = {}
  let inside = false
  for (const raw of text.split(/\r?\n/)) {
    const trimmed = raw.trim()
    if (trimmed === '' || trimmed.startsWith('#')) continue
    if (/^refs:\s*(?:#.*)?$/.test(raw)) {
      inside = true
      continue
    }
    if (!inside) continue
    if (!/^\s/.test(raw)) {
      inside = false
      continue
    }
    const match = /^\s+([A-Za-z_][A-Za-z0-9_]*):\s*(.*?)\s*$/.exec(raw)
    if (match === null) continue
    let value = match[2]
    if (value.length > 1 && value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1)
    else if (value.length > 1 && value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1)
    if (value !== '') refs[match[1]] = value
  }
  return refs
}

/** The stored key, if the credential store has one. */
export async function readStoreKey(dataDir) {
  const path = join(dataDir, '.credentials.yaml')
  try {
    const info = await stat(path)
    const refs = parseCredentialRefs(await readFile(path, 'utf8'))
    const key = refs[KEY_ENV]
    return typeof key === 'string' && key.trim() !== ''
      ? { key: key.trim(), path, mtimeMs: info.mtimeMs }
      : { key: null, path, mtimeMs: info.mtimeMs }
  } catch (error) {
    return { key: null, path, missing: error.code === 'ENOENT' }
  }
}

/** Resolve the key DSH spends on: the launch environment first, then the store. */
export async function resolveActiveKey({ dataDir, env = process.env } = {}) {
  const fromEnv = typeof env?.[KEY_ENV] === 'string' ? env[KEY_ENV].trim() : ''
  if (fromEnv !== '') return { key: fromEnv, source: 'env' }
  const stored = await readStoreKey(dataDir)
  return stored.key
    ? { key: stored.key, source: 'store', path: stored.path, mtimeMs: stored.mtimeMs }
    : { key: null, source: null, path: stored.path }
}

/** Stable short fingerprint; the key itself is never persisted. */
export function fingerprintOf(key) {
  return createHash('sha256').update(key, 'utf8').digest('hex').slice(0, FINGERPRINT_HEX)
}

/** Where the key timeline lives: beside the config, not in the usage cache. */
export function keyStatePath(dataDir) {
  return join(dataDir, 'accountant.keys.json')
}

/** Load the key timeline, tolerating absence or corruption. */
export async function loadKeyState(path) {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8'))
    if (parsed?.version === STATE_VERSION && Array.isArray(parsed.keys)) {
      return {
        version: STATE_VERSION,
        active: typeof parsed.active === 'string' ? parsed.active : null,
        keys: parsed.keys.filter((entry) =>
          entry && typeof entry.fingerprint === 'string' && Number.isFinite(entry.firstSeen)),
      }
    }
  } catch {
    // Missing or unreadable state is not an error: start a fresh timeline.
  }
  return { version: STATE_VERSION, active: null, keys: [] }
}

/** Write the timeline atomically. */
export async function saveKeyState(path, state) {
  await mkdir(dirname(path), { recursive: true })
  const temp = `${path}.${process.pid}.tmp`
  await writeFile(temp, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
  await rename(temp, path)
}

/**
 * Record the active key, creating its timeline entry the first time it is seen.
 *
 * @returns {{fingerprint: string|null, source: string|null, since: number|null,
 *            path: string, keys: object[]}}
 */
export async function observeActiveKey({ dataDir, nowMs = Date.now(), env = process.env } = {}) {
  const resolved = await resolveActiveKey({ dataDir, env })
  const path = keyStatePath(dataDir)
  if (resolved.key === null) return { fingerprint: null, source: null, since: null, path, keys: [] }

  const fingerprint = fingerprintOf(resolved.key)
  const state = await loadKeyState(path)
  let entry = state.keys.find((candidate) => candidate.fingerprint === fingerprint)
  let changed = false

  if (entry === undefined) {
    // The store's last write is the latest moment this key can have been set,
    // so seeding from it can undercount but never claims usage from before the
    // key existed. An environment-provided key has no such timestamp.
    const mtimeMs = resolved.mtimeMs
    const firstSeen = Number.isFinite(mtimeMs) && mtimeMs <= nowMs ? Math.floor(mtimeMs) : nowMs
    entry = { fingerprint, firstSeen }
    state.keys.push(entry)
    state.keys.sort((a, b) => a.firstSeen - b.firstSeen)
    state.active = fingerprint
    changed = true
  } else if (state.active !== fingerprint) {
    state.active = fingerprint
    changed = true
  }

  if (changed) await saveKeyState(path, state)
  return { fingerprint, source: resolved.source, since: entry.firstSeen, path, keys: state.keys }
}

/**
 * Turn timeline entries into non-overlapping usage windows.
 *
 * Windows start on a whole UTC hour, because that is the resolution of the
 * cached usage buckets. A key first seen at 14:55 counts from 15:00.
 */
export function keyWindows(keys) {
  const sorted = [...keys].sort((a, b) => a.firstSeen - b.firstSeen)
  const ceilHour = (ms) => Math.ceil(ms / HOUR_MS) * HOUR_MS
  return sorted.map((entry, index) => {
    const next = sorted[index + 1]
    const fromMs = ceilHour(entry.firstSeen)
    const toMs = next === undefined ? Infinity : Math.max(fromMs, ceilHour(next.firstSeen))
    return { fingerprint: entry.fingerprint, firstSeen: entry.firstSeen, fromMs, toMs }
  })
}

/** Scale a totals object by a run-rate factor. */
function scale(total, factor) {
  return {
    tokens: {
      input: total.tokens.input * factor,
      cacheRead: total.tokens.cacheRead * factor,
      cacheWrite: total.tokens.cacheWrite * factor,
      output: total.tokens.output * factor,
      total: total.tokens.total * factor,
    },
    usd: total.usd * factor,
    php: total.php * factor,
    requests: total.requests * factor,
  }
}

/** This key's today, week, month, and a month-end projection at its own rate. */
function keySummary(files, { nowMs, tz, rates, holidays, fx, since }) {
  const { days } = buildDays(files, { tz, rates, holidays, fxRate: fx.rate, fromMs: since })
  const now = zonedParts(nowMs, tz)
  const weekKey = isoWeek(now.date)
  const monthKey = now.date.slice(0, 7)

  const today = totalOf(days.filter((day) => day.date === now.date))
  const week = totalOf(days.filter((day) => isoWeek(day.date) === weekKey))
  const month = totalOf(days.filter((day) => day.date.slice(0, 7) === monthKey))

  // Project from the days this key has actually existed, not from the days of
  // the month it was created in: a one-day-old key gets a one-day rate however
  // late in the month it started.
  const startDate = localDate(since, tz)
  const startDay = startDate.slice(0, 7) === monthKey ? Number(startDate.slice(8, 10)) : 1
  const elapsedDays = Math.max(1, now.day - startDay + 1)
  const forecast = scale(month, daysInMonth(now.year, now.month) / elapsedDays)

  return { today, week, month, forecast, elapsedDays }
}

/**
 * Attach key usage to a report model.
 *
 * `model.key` carries the active fingerprint, its totals, a key-scoped
 * today/week/month summary, and every key this tool has observed; callers that
 * never touch credentials (tests, plain skill use) simply leave it null.
 */
export async function attachKeyUsage(model, files, options) {
  const { dataDir, nowMs = Date.now(), tz, rates, holidays, fx } = options
  const observed = await observeActiveKey({ dataDir, nowMs })
  if (observed.fingerprint === null) {
    model.key = null
    return model
  }

  const keys = keyWindows(observed.keys).map((window) => ({
    fingerprint: window.fingerprint,
    since: window.fromMs,
    totals: windowTotals(files, {
      tz,
      rates,
      holidays,
      fxRate: fx.rate,
      fromMs: window.fromMs,
      toMs: window.toMs,
    }),
  }))
  const current = keys.find((entry) => entry.fingerprint === observed.fingerprint) ?? keys.at(-1)
  model.key = {
    fingerprint: observed.fingerprint,
    source: observed.source,
    since: current.since,
    totals: current.totals,
    summary: keySummary(files, { nowMs, tz, rates, holidays, fx, since: current.since }),
    keys,
  }
  return model
}
