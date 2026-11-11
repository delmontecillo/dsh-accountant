/**
 * Prices, peak windows, and the USD→PHP rate.
 *
 * Everything here is a default. `accountant.mjs` lets a caller override the
 * rate, the timezone, the model table, and the holiday list from a config file.
 *
 * Rates are US dollars per 1,000,000 tokens, taken from the DeepSeek pricing
 * page on 2026-11-11. DeepSeek bills off-peak at exactly half the peak rate,
 * so only the peak numbers are stored and the rest is derived.
 *
 * @module accountant/pricing
 */

export const PRICING_AS_OF = '2026-11-11'
export const PRICING_SOURCE = 'https://api-docs.deepseek.com/quick_start/pricing'

/** Peak windows are UTC hour ranges, `[start, end)`, Monday through Friday. */
export const PEAK_HOURS_UTC = [[1, 4], [6, 10]]

/** Peak-rate dollars per 1M tokens. Off-peak is half of every number below. */
export const PEAK_RATES = {
  'deepseek-flash': { cacheHit: 0.006, cacheMiss: 0.3, output: 1.2 },
  'deepseek-v4-pro': { cacheHit: 0.044, cacheMiss: 1.32, output: 3.96 },
}

/** Human names used in reports. */
export const MODEL_LABELS = {
  'deepseek-flash': 'DeepSeek V4.1 Flash',
  'deepseek-v4-pro': 'DeepSeek V4 Pro',
}

/**
 * Retired names that DeepSeek still serves. The pricing page states these are
 * served by DeepSeek-V4.1-Flash-1017 and billed at the Flash price.
 */
export const MODEL_ALIASES = {
  'deepseek-v4-flash': 'deepseek-flash',
  'deepseek-v4-flash-vision-exp': 'deepseek-flash',
  'deepseek-chat': 'deepseek-flash',
  'deepseek-reasoner': 'deepseek-flash',
  'deepseek-v3': 'deepseek-flash',
  'deepseek-v3.1': 'deepseek-flash',
}

/**
 * Chinese public holidays for 2026, from the State Council notice
 * (Guo Ban Fa Ming Dian [2025] No. 7). DeepSeek bills every hour of these days
 * at the off-peak rate.
 */
const HOLIDAY_RANGES_2026 = [
  ['2026-01-01', '2026-01-03'],
  ['2026-02-15', '2026-02-23'],
  ['2026-04-04', '2026-04-06'],
  ['2026-05-01', '2026-05-05'],
  ['2026-06-19', '2026-06-21'],
  ['2026-09-25', '2026-09-27'],
  ['2026-10-01', '2026-10-07'],
]

/** Default dollar-to-peso conversion, with the date it was observed. */
export const DEFAULT_FX = {
  pair: 'USD/PHP',
  rate: 62.0,
  asOf: '2026-11-11',
  source: 'https://beta.manilatimes.net/2026/11/11/business/top-business/peso-rebounds-to-p621-level/2466761',
}

const DAY_MS = 86_400_000

/** Expand `YYYY-MM-DD` inclusive ranges into every date they cover. */
function expandRanges(ranges) {
  const days = []
  for (const [start, end] of ranges) {
    let cursor = Date.parse(`${start}T00:00:00Z`)
    const stop = Date.parse(`${end}T00:00:00Z`)
    for (; cursor <= stop; cursor += DAY_MS) days.push(new Date(cursor).toISOString().slice(0, 10))
  }
  return days
}

/** Default holiday set: every 2026 public holiday date. */
export const DEFAULT_HOLIDAYS = new Set(expandRanges(HOLIDAY_RANGES_2026))

/**
 * Map a model id onto a priced model, honouring aliases.
 *
 * @returns {{priced: string|null, known: boolean}}
 */
export function resolveModel(modelId, rates = PEAK_RATES) {
  const key = String(modelId ?? '').trim()
  if (key === '') return { priced: null, known: false }
  const direct = key in rates ? key : MODEL_ALIASES[key]
  if (direct !== undefined && direct in rates) return { priced: direct, known: true }
  return { priced: null, known: false }
}

/** True when the agent is billed at peak rates for this UTC day and hour. */
export function isPeakUtc(day, hour, holidays = DEFAULT_HOLIDAYS) {
  if (holidays.has(day)) return false
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay()
  if (weekday === 0 || weekday === 6) return false
  return PEAK_HOURS_UTC.some(([from, to]) => hour >= from && hour < to)
}

/** Rate row in dollars per 1M tokens for one model at one tariff. */
export function rateFor(modelId, peak, rates = PEAK_RATES) {
  const { priced, known } = resolveModel(modelId, rates)
  const table = rates[(priced ?? 'deepseek-flash')]
  const multiplier = peak ? 1 : 0.5
  return {
    known,
    priced: priced ?? 'deepseek-flash',
    cacheHit: table.cacheHit * multiplier,
    cacheMiss: table.cacheMiss * multiplier,
    output: table.output * multiplier,
  }
}

/**
 * Price one usage bucket.
 *
 * `input` counts prompt tokens that missed the cache, `cacheRead` counts prompt
 * tokens that hit it, `cacheWrite` counts tokens written into it (billed as a
 * miss), and `output` counts generated tokens.
 *
 * @returns {{usd: number, priced: string|null, known: boolean}}
 */
export function costOf(tokens, modelId, peak, rates = PEAK_RATES) {
  const rate = rateFor(modelId, peak, rates)
  const perMillion = (count, price) => (Number(count) || 0) / 1_000_000 * price
  const usd =
    perMillion(tokens.input, rate.cacheMiss) +
    perMillion(tokens.cacheWrite, rate.cacheMiss) +
    perMillion(tokens.cacheRead, rate.cacheHit) +
    perMillion(tokens.output, rate.output)
  return { usd, priced: rate.priced, known: rate.known }
}

/** Convert dollars to pesos at the configured rate. */
export function toPhp(usd, rate = DEFAULT_FX.rate) {
  return (Number(usd) || 0) * (Number(rate) || 0)
}
