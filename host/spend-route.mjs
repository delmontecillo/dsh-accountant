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

import { summarize } from '../skills/accountant/scripts/lib/aggregate.mjs'
import { attachKeyUsage } from '../skills/accountant/scripts/lib/api-key.mjs'
import { loadConfig } from '../skills/accountant/scripts/lib/config.mjs'
import { DEFAULT_FX, DEFAULT_HOLIDAYS, PEAK_RATES } from '../skills/accountant/scripts/lib/pricing.mjs'
import { collectUsage, defaultCachePath, resolveDataDir } from '../skills/accountant/scripts/lib/session-store.mjs'

export const SPEND_PATH = '/accountant/spend'

const TTL_MS = 20_000

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
  }
}

async function compute() {
  const dataDir = resolveDataDir()
  const settings = await settingsFor(dataDir)
  const { files } = await collectUsage({ dataDir, cachePath: defaultCachePath(dataDir) })
  const model = summarize(files, {
    tz: settings.tz,
    fx: settings.fx,
    holidays: settings.holidays,
    rates: settings.rates,
  })
  await attachKeyUsage(model, files, { dataDir, ...settings })
  return snapshot(model)
}

/**
 * Register the spend route on the Web server.
 *
 * @returns {() => void} disposer that removes the route
 */
export function registerSpendRoute(ctx) {
  let cached = null
  let cachedAt = 0
  let pending = null

  const resource = async () => {
    try {
      const now = Date.now()
      if (cached !== null && now - cachedAt < TTL_MS) return json(cached)
      pending ??= compute().finally(() => { pending = null })
      cached = await pending
      cachedAt = Date.now()
      return json(cached)
    } catch (error) {
      return json({ error: String(error?.message ?? error) }, 503)
    }
  }

  return ctx.webServer.register({ kind: 'exact', path: SPEND_PATH, resource })
}
