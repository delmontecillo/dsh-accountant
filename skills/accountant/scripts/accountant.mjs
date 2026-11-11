#!/usr/bin/env node
/**
 * Accountant — what the token spend was, and what it is heading for.
 *
 * Reads the DSH session store, prices every recorded model call at the
 * DeepSeek list rate that applied at that hour, converts to Philippine pesos,
 * and projects the rest of the week and month.
 *
 *   node accountant.mjs                 today, this week, this month
 *   node accountant.mjs --group month   one row per calendar month
 *   node accountant.mjs --json          machine-readable report
 *
 * @module accountant/cli
 */

import { readFile } from 'node:fs/promises'
import { UsageError, USAGE, loadConfig, parseArgs, resolveSettings } from './lib/config.mjs'
import { DEFAULT_HOLIDAYS, PEAK_RATES } from './lib/pricing.mjs'
import { clearCache, collectUsage, defaultCachePath, resolveDataDir } from './lib/session-store.mjs'
import { summarize } from './lib/aggregate.mjs'
import { attachKeyUsage } from './lib/api-key.mjs'
import { renderCsv, renderMarkdown, renderText, toJson } from './lib/report.mjs'

async function packageVersion() {
  try {
    const raw = await readFile(new URL('../../../package.json', import.meta.url), 'utf8')
    return JSON.parse(raw).version ?? '0.0.0'
  } catch {
    return '0.0.0'
  }
}

/** Merge a config `models` block over the built-in peak rates. */
function mergeRates(override) {
  if (override === undefined) return PEAK_RATES
  const merged = { ...PEAK_RATES }
  for (const [model, row] of Object.entries(override)) {
    if (row && ['cacheHit', 'cacheMiss', 'output'].every((field) => Number.isFinite(Number(row[field])))) {
      merged[model] = { cacheHit: Number(row.cacheHit), cacheMiss: Number(row.cacheMiss), output: Number(row.output) }
    }
  }
  return merged
}

async function main(argv) {
  let options
  try {
    options = parseArgs(argv)
  } catch (error) {
    if (error instanceof UsageError) {
      process.stderr.write(`accountant: ${error.message}\nTry --help.\n`)
      return 2
    }
    throw error
  }

  if (options.help) {
    process.stdout.write(USAGE)
    return 0
  }
  if (options.version) {
    process.stdout.write(`${await packageVersion()}\n`)
    return 0
  }

  const config = await loadConfig(resolveDataDir(options.dataDir))
  const settings = resolveSettings(options, config)
  const cachePath = settings.cachePath ?? defaultCachePath(settings.dataDir)

  if (settings.clearCache) await clearCache(cachePath)

  const { files, stats } = await collectUsage({
    dataDir: settings.dataDir,
    cachePath,
    useCache: settings.useCache,
  })

  const rates = mergeRates(settings.rates)
  const model = summarize(files, {
    tz: settings.tz,
    nowMs: settings.nowMs,
    since: settings.since,
    until: settings.until,
    fx: settings.fx,
    rates,
    holidays: settings.holidays ?? DEFAULT_HOLIDAYS,
  })

  await attachKeyUsage(model, files, {
    dataDir: settings.dataDir,
    nowMs: settings.nowMs,
    tz: settings.tz,
    rates,
    holidays: settings.holidays ?? DEFAULT_HOLIDAYS,
    fx: settings.fx,
  })

  const meta = {
    group: settings.group,
    limit: settings.limit,
    byModel: settings.byModel,
    stats,
  }

  if (settings.format === 'json') {
    process.stdout.write(`${JSON.stringify(toJson(model), null, 2)}\n`)
  } else if (settings.format === 'markdown') {
    process.stdout.write(renderMarkdown(model, meta))
  } else if (settings.format === 'csv') {
    process.stdout.write(renderCsv(model, meta))
  } else {
    process.stdout.write(renderText(model, meta))
  }
  return 0
}

try {
  process.exitCode = await main(process.argv.slice(2))
} catch (error) {
  if (error instanceof UsageError) {
    process.stderr.write(`accountant: ${error.message}\n`)
    process.exitCode = 2
  } else {
    process.stderr.write(`accountant: ${error?.stack ?? error}\n`)
    process.exitCode = 1
  }
}
