/**
 * Command line parsing and layered settings.
 *
 * Precedence, lowest to highest: built-in defaults, then
 * `<dataDir>/accountant.config.json`, then `DSH_ACCOUNTANT_*` environment
 * variables, then explicit flags.
 *
 * @module accountant/config
 */

import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_FX, PRICING_AS_OF } from './pricing.mjs'
import { resolveDataDir } from './session-store.mjs'

export const GROUPS = ['day', 'week', 'month', 'all', 'session']
export const FORMATS = ['text', 'json', 'markdown', 'csv']

export const USAGE = `Accountant — token spend per day, week, and month, priced in USD and PHP.

Usage
  node accountant.mjs [options]

Options
  --group <day|week|month|all|session>  table to print (default: day)
  --limit <n>                   rows per table (default: 7 day, 6 week, 6 month)
  --range <from..to>            restrict totals and tables to a local date range
  --since <YYYY-MM-DD>          start of the range
  --until <YYYY-MM-DD>          end of the range
  --tz <IANA zone>              calendar timezone (default: Asia/Manila)
  --rate <n>                    USD→PHP rate (default: ${DEFAULT_FX.rate.toFixed(2)})
  --by-model                    add a per-model breakdown
  --json | --markdown | --csv   machine or document output
  --no-cache                    re-parse every session log
  --clear-cache                 delete the incremental cache, then report
  --data-dir <path>             DSH state directory (default: $DSH_HOME or ~/.dsh)
  --now <ISO timestamp>         evaluate "today" at this instant
  --version                     print the version
  -h, --help                    print this help

Environment
  DSH_HOME, DSH_ACCOUNTANT_TZ, DSH_ACCOUNTANT_RATE

Key tracking
  The report names the DeepSeek key DSH is spending on: the launch
  environment's DEEPSEEK_API_KEY, else the credential store. Only a
  12-character fingerprint is kept, in <dataDir>/accountant.keys.json.
  A key's window opens at the whole UTC hour after it is first seen.

Config file
  <dataDir>/accountant.config.json
  { "tz": "Asia/Manila", "rate": 62.0, "fxAsOf": "2026-11-11",
    "holidays": ["2026-11-30"],
    "tags": { "work": ["~/acme"], "personal": ["~/Documents/projects"] },
    "models": { "deepseek-flash": { "cacheHit": 0.006, "cacheMiss": 0.3, "output": 1.2 } } }

Tags map a folder prefix (or a list of them) to a label. A session with no
matching prefix is shown under its folder name.

Prices are DeepSeek list prices as of ${PRICING_AS_OF}; off-peak is always half of peak.
`

const FLAGS = new Set(['--json', '--markdown', '--csv', '--no-cache', '--clear-cache', '--by-model', '--version', '-h', '--help'])
const VALUES = new Set(['--group', '--limit', '--range', '--since', '--until', '--tz', '--rate', '--data-dir', '--now'])

const DATE = /^\d{4}-\d{2}-\d{2}$/

/** Parse argv into options. Throws a usage error for unknown or malformed input. */
export function parseArgs(argv) {
  const options = {}
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (token === '-h' || token === '--help') { options.help = true; continue }
    if (!FLAGS.has(token) && !VALUES.has(token)) throw new UsageError(`unknown option: ${token}`)
    if (FLAGS.has(token)) {
      const key = token.replace(/^--?/, '').replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())
      options[key] = true
      continue
    }
    const value = argv[index + 1]
    if (value === undefined || value.startsWith('--')) throw new UsageError(`missing value for ${token}`)
    index += 1

    switch (token) {
      case '--group':
        if (!GROUPS.includes(value)) throw new UsageError(`--group must be one of ${GROUPS.join(', ')}`)
        options.group = value
        break
      case '--limit': {
        const limit = Number(value)
        if (!Number.isInteger(limit) || limit < 1) throw new UsageError('--limit must be a positive integer')
        options.limit = limit
        break
      }
      case '--range': {
        const [from, to] = value.split('..')
        if (from === undefined || to === undefined || !DATE.test(from) || !DATE.test(to)) {
          throw new UsageError('--range must look like 2026-11-01..2026-11-11')
        }
        if (from > to) throw new UsageError('--range start is after its end')
        options.since = from
        options.until = to
        break
      }
      case '--since':
      case '--until':
        if (!DATE.test(value)) throw new UsageError(`${token} must be YYYY-MM-DD`)
        options[token.slice(2)] = value
        break
      case '--tz':
        assertZone(value)
        options.tz = value
        break
      case '--rate': {
        const rate = Number(value)
        if (!Number.isFinite(rate) || rate <= 0) throw new UsageError('--rate must be a positive number')
        options.rate = rate
        break
      }
      case '--data-dir':
        options.dataDir = value
        break
      case '--now': {
        const parsed = Date.parse(value)
        if (Number.isNaN(parsed)) throw new UsageError('--now must be an ISO timestamp')
        options.now = parsed
        break
      }
      default:
        throw new UsageError(`unknown option: ${token}`)
    }
  }
  if (options.json) options.format = 'json'
  else if (options.markdown) options.format = 'markdown'
  else if (options.csv) options.format = 'csv'
  else options.format = 'text'
  return options
}

class UsageError extends Error {}

function assertZone(tz) {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: tz })
  } catch {
    throw new UsageError(`unknown timezone: ${tz}`)
  }
}

/** Read `<dataDir>/accountant.config.json`; a missing file is an empty config. */
export async function loadConfig(dataDir) {
  const path = join(dataDir, 'accountant.config.json')
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8'))
    return parsed && typeof parsed === 'object' ? { path, ...parsed } : { path }
  } catch (error) {
    if (error.code === 'ENOENT') return { path, missing: true }
    throw new UsageError(`cannot read ${path}: ${error.message}`)
  }
}

/**
 * Validate the `tags` folder map: `{ label: [prefix, ...] }`, with `~` expanded
 * and trailing slashes removed so prefix matching stays exact.
 */
export function normalizeTags(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const tags = {}
  for (const [label, prefixes] of Object.entries(raw)) {
    if (label === '' || !Array.isArray(prefixes)) continue
    const cleaned = prefixes
      .filter((prefix) => typeof prefix === 'string' && prefix !== '')
      .map((prefix) => (prefix === '~' ? homedir() : prefix.startsWith('~/') ? join(homedir(), prefix.slice(2)) : prefix))
      .map((prefix) => prefix.replace(/\/+$/, ''))
    if (cleaned.length > 0) tags[label] = cleaned
  }
  return tags
}

/**
 * Merge defaults, config file, environment, and flags into one settings object.
 */
export function resolveSettings(options, config) {
  const dataDir = resolveDataDir(options.dataDir)
  const tz = options.tz
    ?? process.env.DSH_ACCOUNTANT_TZ
    ?? config.tz
    ?? 'Asia/Manila'
  assertZone(tz)

  const envRate = process.env.DSH_ACCOUNTANT_RATE === undefined ? undefined : Number(process.env.DSH_ACCOUNTANT_RATE)
  if (envRate !== undefined && (!Number.isFinite(envRate) || envRate <= 0)) {
    throw new UsageError('DSH_ACCOUNTANT_RATE must be a positive number')
  }

  const rate = options.rate ?? envRate ?? config.rate ?? DEFAULT_FX.rate
  const group = options.group ?? config.group ?? 'day'
  const defaultLimit = group === 'day' ? 7 : group === 'session' ? 10 : 6
  const holidays = Array.isArray(config.holidays)
    ? new Set(config.holidays.filter((day) => typeof day === 'string' && DATE.test(day)))
    : undefined

  return {
    dataDir,
    cachePath: config.cacheFile,
    tz,
    rate,
    fx: { ...DEFAULT_FX, rate, asOf: config.fxAsOf ?? DEFAULT_FX.asOf },
    group,
    limit: options.limit ?? config.limit ?? defaultLimit,
    since: options.since,
    until: options.until,
    nowMs: options.now ?? Date.now(),
    format: options.format,
    byModel: Boolean(options.byModel ?? config.byModel),
    useCache: options.noCache !== true,
    clearCache: options.clearCache === true,
    rates: config.models,
    tags: normalizeTags(config.tags),
    holidays,
    configPath: config.path,
  }
}

export { UsageError }
