/**
 * A read-only HTTP endpoint for the header readout.
 *
 * The Web client cannot read the session store, and DSH's typed remote surface
 * needs generated codecs that a hand-written package cannot produce. A plain
 * webserver route is the supported alternative: the web carrier answers only
 * `GET` and `HEAD`, so the route is read-only by construction, and the page
 * fetches it same-origin.
 *
 * All the arithmetic is the skill's own library, so the widget and the CLI can
 * never disagree. The snapshot is held for `TTL_MS` because several browser
 * tabs may poll at once.
 *
 * @module dsh-accountant/spend-route
 */

import { sessionTotals, summarize } from '../skills/accountant/scripts/lib/aggregate.mjs'
import { attachKeyUsage, resolveActiveKey } from '../skills/accountant/scripts/lib/api-key.mjs'
import { loadConfig, normalizeTags } from '../skills/accountant/scripts/lib/config.mjs'
import { DEFAULT_FX, DEFAULT_HOLIDAYS, PEAK_RATES, tariffAt } from '../skills/accountant/scripts/lib/pricing.mjs'
import { collectUsage, defaultCachePath, resolveDataDir } from '../skills/accountant/scripts/lib/session-store.mjs'
import { loadSessionTags, loadTagAliases, moveSessionTag, normalizeTag, resolveTag, saveSessionTag } from '../skills/accountant/scripts/lib/session-tags.mjs'

export const SPEND_PATH = '/accountant/spend'
export const TAG_PATH = '/accountant/tag'
export const MOVE_PATH = '/accountant/tag/move'
export const BALANCE_URL = 'https://api.deepseek.com/user/balance'

const TTL_MS = 20_000
const BALANCE_TTL_MS = 60_000
const MAX_BODY_BYTES = 4_096

function totals(bucket) {
  return {
    tokens: Math.round(bucket.tokens.total),
    usd: bucket.usd,
    php: bucket.php,
    requests: bucket.requests,
  }
}

/** Reduce the full report to what a compact widget needs. */
function snapshot(model) {
  const { summary } = model
  return {
    generatedAt: new Date(model.generatedAt).toISOString(),
    timezone: model.tz,
    fx: { pair: model.fx.pair, rate: model.fx.rate, asOf: model.fx.asOf },
    coverage: { sessions: model.coverage.sessions, firstDate: model.coverage.firstDate },
    today: { date: summary.today.date, ...totals(summary.today) },
    week: { key: summary.week.key, ...totals(summary.week), forecast: totals(summary.week.forecast) },
    month: {
      key: summary.month.key,
      daysInMonth: summary.month.daysInMonth,
      ...totals(summary.month),
      forecast: totals(summary.month.forecast),
    },
    next30: totals(summary.trailing.next30),
    balance: model.balance,
    tariff: model.tariff,
    key: model.key === null
      ? null
      : {
          fingerprint: model.key.fingerprint,
          source: model.key.source,
          since: new Date(model.key.since).toISOString(),
          totals: totals(model.key.totals),
          summary: model.key.summary
            ? {
                today: totals(model.key.summary.today),
                week: totals(model.key.summary.week),
                month: totals(model.key.summary.month),
                forecast: totals(model.key.summary.forecast),
                daysInMonth: model.summary.month.daysInMonth,
              }
            : null,
        },
  }
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  })
}

/** Settings follow the CLI: config file first, then environment, then defaults. */
async function settingsFor(dataDir) {
  const config = await loadConfig(dataDir)
  const envRate = Number(process.env.DSH_ACCOUNTANT_RATE)
  const rate = Number.isFinite(envRate) && envRate > 0
    ? envRate
    : typeof config.rate === 'number' && config.rate > 0 ? config.rate : DEFAULT_FX.rate
  return {
    tz: process.env.DSH_ACCOUNTANT_TZ ?? config.tz ?? 'Asia/Manila',
    fx: { ...DEFAULT_FX, rate, asOf: config.fxAsOf ?? DEFAULT_FX.asOf },
    holidays: Array.isArray(config.holidays) ? new Set(config.holidays) : DEFAULT_HOLIDAYS,
    rates: config.models ?? PEAK_RATES,
    tags: normalizeTags(config.tags),
  }
}

/** All-time spend grouped by tag; untagged sessions still get a row. */
export function tagRollup(sessions) {
  const rows = new Map()
  for (const session of sessions) {
    const tag = session.tag ?? 'untagged'
    const row = rows.get(tag) ?? { tag, sessions: 0, tokens: 0, usd: 0, php: 0, requests: 0 }
    row.sessions += 1
    row.tokens += session.tokens.total
    row.usd += session.usd
    row.php += session.php
    row.requests += session.requests
    rows.set(tag, row)
  }
  return [...rows.values()].sort((a, b) => b.usd - a.usd)
}

/** One session's row, or null when no log carries that id. */
function sessionRow(files, sessionId, settings, sessionTags, tagAliases) {
  const file = files.find((entry) => entry.sessionId === sessionId)
  if (file === undefined) return null
  const [row] = sessionTotals([file], {
    tz: settings.tz,
    fxRate: settings.fx.rate,
    holidays: settings.holidays,
    rates: settings.rates,
    tags: settings.tags,
    sessionTags,
    tagAliases,
  })
  return row ?? null
}

async function compute(sessionId) {
  const dataDir = resolveDataDir()
  const settings = await settingsFor(dataDir)
  const sessionTags = await loadSessionTags(dataDir)
  const tagAliases = await loadTagAliases(dataDir)
  const { files } = await collectUsage({ dataDir, cachePath: defaultCachePath(dataDir) })
  const model = summarize(files, {
    tz: settings.tz,
    fx: settings.fx,
    holidays: settings.holidays,
    rates: settings.rates,
    tags: settings.tags,
    sessionTags,
    tagAliases,
  })
  await attachKeyUsage(model, files, { dataDir, ...settings })
  model.balance = await fetchBalance(dataDir)
  model.tariff = tariffSnapshot(settings.holidays)
  const body = snapshot(model)
  body.session = sessionId === null ? null : sessionRow(files, sessionId, settings, sessionTags, tagAliases)
  body.tagOptions = [...new Set(
    [...Object.keys(settings.tags), ...Object.values(sessionTags)].map((tag) => resolveTag(tag, tagAliases)),
  )].sort()
  body.byTag = tagRollup(model.sessions)
  return body
}

/**
 * Normalize the balance endpoint's payload to the one account row the panel
 * shows: the USD entry when the account reports several currencies.
 */
export function parseBalance(body) {
  const rows = Array.isArray(body?.balance_infos) ? body.balance_infos : []
  const row = rows.find((entry) => entry?.currency === 'USD') ?? rows[0]
  const total = Number(row?.total_balance)
  if (!Number.isFinite(total)) return null
  return { currency: String(row.currency ?? ''), total }
}

let balanceCache = { at: 0, value: null }

/**
 * The account balance behind the active key, cached and optional: a failed
 * probe leaves the spend readout intact and simply omits the row.
 */
async function fetchBalance(dataDir) {
  if (Date.now() - balanceCache.at < BALANCE_TTL_MS) return balanceCache.value
  const { key } = await resolveActiveKey({ dataDir })
  let value = null
  if (key !== null) {
    try {
      const response = await fetch(BALANCE_URL, {
        headers: { authorization: `Bearer ${key}`, accept: 'application/json' },
        signal: AbortSignal.timeout(3_000),
      })
      if (response.ok) value = parseBalance(await response.json())
    } catch {
      // Unreachable is not an error: the chip reports spend without a balance.
    }
  }
  balanceCache = { at: Date.now(), value }
  return value
}

function tariffSnapshot(holidays) {
  const { peak, changesAt } = tariffAt(Date.now(), holidays)
  return { peak, changesAt: changesAt === null ? null : new Date(changesAt).toISOString() }
}

/**
 * Register the spend route on the Web server.
 *
 * @returns {() => void} disposer that removes the route
 */
const spendCache = new Map()
const spendPending = new Map()

export function registerSpendRoute(ctx) {
  const resource = async (request) => {
    try {
      const raw = new URL(request.url).searchParams.get('session')
      const sessionId = typeof raw === 'string' && raw.length > 0 && raw.length <= 128 ? raw : null
      const key = sessionId ?? ''
      const hit = spendCache.get(key)
      if (hit !== undefined && Date.now() - hit.at < TTL_MS) return json(hit.body)
      let job = spendPending.get(key)
      if (job === undefined) {
        job = compute(sessionId).finally(() => { spendPending.delete(key) })
        spendPending.set(key, job)
      }
      const body = await job
      if (spendCache.size > 20) spendCache.clear()
      spendCache.set(key, { at: Date.now(), body })
      return json(body)
    } catch (error) {
      return json({ error: String(error?.message ?? error) }, 503)
    }
  }

  return ctx.webServer.register({ kind: 'exact', path: SPEND_PATH, resource })
}

function sendJson(res, status, body, headers = {}) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...headers,
  })
  res.end(JSON.stringify(body))
}

/** Read a small JSON body; a larger one is refused rather than buffered. */
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        req.destroy()
        reject(new Error('body too large'))
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/** Same-origin only: a cross-site POST carries a different Origin host. */
function sameOrigin(req) {
  const origin = req.headers.origin
  if (origin === undefined) return true
  try {
    return new URL(origin).host === req.headers.host
  } catch {
    return false
  }
}

/**
 * Register the tag write route. A per-session tag set here outranks the
 * folder tag and survives restarts in `accountant.session-tags.json`.
 *
 * @returns {() => void} disposer that removes the route
 */
export function registerTagRoute(ctx) {
  const handler = async (req, res) => {
    if (!sameOrigin(req)) return sendJson(res, 403, { error: 'origin not allowed' })
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' }, { allow: 'POST' })
    if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) {
      return sendJson(res, 415, { error: 'application/json required' })
    }
    try {
      const parsed = JSON.parse(await readBody(req))
      const sessionId = typeof parsed?.session === 'string' ? parsed.session : ''
      if (sessionId === '' || sessionId.length > 128) return sendJson(res, 400, { error: 'invalid session' })
      if (parsed.tag !== null && parsed.tag !== undefined && typeof parsed.tag !== 'string') {
        return sendJson(res, 400, { error: 'invalid tag' })
      }
      const raw = typeof parsed.tag === 'string' ? parsed.tag : null
      if (raw !== null && raw.trim() !== '' && normalizeTag(raw) === null) {
        return sendJson(res, 400, { error: 'tag must be 1-40 printable characters' })
      }
      const tag = await saveSessionTag(resolveDataDir(), sessionId, raw)
      spendCache.clear()
      return sendJson(res, 200, { ok: true, tag })
    } catch {
      return sendJson(res, 400, { error: 'bad request' })
    }
  }
  return ctx.webServer.register({ kind: 'exact', path: TAG_PATH, handler })
}

/**
 * Register the tag-move route: retire `from` by moving its sessions to `to`.
 * Folder-derived tags move through the alias recorded by `moveSessionTag`.
 *
 * @returns {() => void} disposer that removes the route
 */
export function registerMoveRoute(ctx) {
  const handler = async (req, res) => {
    if (!sameOrigin(req)) return sendJson(res, 403, { error: 'origin not allowed' })
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' }, { allow: 'POST' })
    if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) {
      return sendJson(res, 415, { error: 'application/json required' })
    }
    try {
      const parsed = JSON.parse(await readBody(req))
      const from = normalizeTag(parsed?.from)
      const to = normalizeTag(parsed?.to)
      if (from === null || to === null) return sendJson(res, 400, { error: 'from and to must be tags' })
      if (from === to) return sendJson(res, 400, { error: 'from and to must differ' })
      const result = await moveSessionTag(resolveDataDir(), from, to)
      spendCache.clear()
      return sendJson(res, 200, { ok: true, ...result })
    } catch {
      return sendJson(res, 500, { error: 'cannot update the tags file' })
    }
  }
  return ctx.webServer.register({ kind: 'exact', path: MOVE_PATH, handler })
}
