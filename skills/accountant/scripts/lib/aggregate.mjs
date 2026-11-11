/**
 * Turns cached UTC buckets into local-day, ISO-week, and calendar-month spend,
 * then projects the rest of the week, the month, and the next 30 days.
 *
 * Cost is resolved here rather than at scan time so that a changed tariff,
 * holiday list, or exchange rate re-prices the same cached tokens instantly.
 *
 * @module accountant/aggregate
 */

import { DAY_MS, HOUR_MS, addDays, daysInMonth, isoWeek, isoWeekday, localDate, zonedParts } from './calendar.mjs'
import { DEFAULT_FX, DEFAULT_HOLIDAYS, PEAK_RATES, costOf, isPeakUtc, toPhp } from './pricing.mjs'

function emptyDay(date) {
  return {
    date,
    tokens: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, total: 0 },
    usd: 0,
    php: 0,
    requests: 0,
    sessions: new Set(),
    models: new Map(),
  }
}

function addTokens(target, source) {
  target.input += source.input
  target.cacheRead += source.cacheRead
  target.cacheWrite += source.cacheWrite
  target.output += source.output
  target.total += source.input + source.cacheRead + source.cacheWrite + source.output
}

/**
 * Price every cached bucket into local days.
 *
 * @returns {{days: object[], unknownModels: string[]}}
 */
export function buildDays(files, options = {}) {
  const {
    tz = 'Asia/Manila',
    rates = PEAK_RATES,
    holidays = DEFAULT_HOLIDAYS,
    fxRate = DEFAULT_FX.rate,
  } = options

  const days = new Map()
  const unknownModels = new Set()

  for (const file of files) {
    for (const [utcDay, hours] of Object.entries(file.buckets ?? {})) {
      const dayStart = Date.parse(`${utcDay}T00:00:00Z`)
      for (const [hourText, models] of Object.entries(hours)) {
        const hour = Number(hourText)
        const ms = dayStart + hour * HOUR_MS
        const date = localDate(ms, tz)
        const peak = isPeakUtc(utcDay, hour, holidays)

        let day = days.get(date)
        if (day === undefined) {
          day = emptyDay(date)
          days.set(date, day)
        }
        if (file.sessionId) day.sessions.add(file.sessionId)

        for (const [modelKey, tokens] of Object.entries(models)) {
          const model = modelKey.slice(modelKey.indexOf('/') + 1)
          const priced = costOf(tokens, model, peak, rates)
          if (!priced.known) unknownModels.add(model)

          addTokens(day.tokens, tokens)
          day.usd += priced.usd
          day.php = toPhp(day.usd, fxRate)
          day.requests += tokens.requests

          const entry = day.models.get(priced.priced) ?? {
            model: priced.priced,
            tokens: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, total: 0 },
            usd: 0,
            requests: 0,
          }
          addTokens(entry.tokens, tokens)
          entry.usd += priced.usd
          entry.requests += tokens.requests
          day.models.set(priced.priced, entry)
        }
      }
    }
  }

  return { days: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)), unknownModels: [...unknownModels] }
}

/** Sum days into buckets keyed by `keyOf(date)`. */
export function rollup(days, keyOf) {
  const buckets = new Map()
  for (const day of days) {
    const key = keyOf(day.date)
    let bucket = buckets.get(key)
    if (bucket === undefined) {
      bucket = {
        key,
        from: day.date,
        to: day.date,
        tokens: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, total: 0 },
        usd: 0,
        php: 0,
        requests: 0,
        dayCount: 0,
        sessions: new Set(),
      }
      buckets.set(key, bucket)
    }
    addTokens(bucket.tokens, day.tokens)
    bucket.usd += day.usd
    bucket.php += day.php
    bucket.requests += day.requests
    bucket.dayCount += 1
    if (day.date < bucket.from) bucket.from = day.date
    if (day.date > bucket.to) bucket.to = day.date
    for (const session of day.sessions) bucket.sessions.add(session)
  }
  return buckets
}

function emptyTotal() {
  return { tokens: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, total: 0 }, usd: 0, php: 0, requests: 0 }
}

function totalOf(days) {
  const total = emptyTotal()
  for (const day of days) {
    addTokens(total.tokens, day.tokens)
    total.usd += day.usd
    total.php += day.php
    total.requests += day.requests
  }
  return total
}

function project(total, elapsed, span) {
  if (elapsed <= 0) return emptyTotal()
  const factor = span / elapsed
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

/** Keep only days inside the inclusive range. */
export function filterRange(days, { since, until } = {}) {
  return days.filter((day) => (since === undefined || day.date >= since) && (until === undefined || day.date <= until))
}

/**
 * Build the whole report model: days, rollups, totals, and forecasts.
 */
export function summarize(files, options = {}) {
  const {
    tz = 'Asia/Manila',
    nowMs = Date.now(),
    since,
    until,
    rates = PEAK_RATES,
    holidays = DEFAULT_HOLIDAYS,
    fx = DEFAULT_FX,
  } = options

  const { days: allDays, unknownModels } = buildDays(files, { tz, rates, holidays, fxRate: fx.rate })
  const now = zonedParts(nowMs, tz)
  const days = filterRange(allDays, { since, until })

  const monthCount = daysInMonth(now.year, now.month)
  const weekKey = isoWeek(now.date)
  const weekElapsed = isoWeekday(now.date)

  const today = allDays.find((day) => day.date === now.date) ?? emptyDay(now.date)
  const weekDays = allDays.filter((day) => isoWeek(day.date) === weekKey)
  const monthDays = allDays.filter((day) => day.date.slice(0, 7) === now.date.slice(0, 7))
  const trailingFrom = addDays(now.date, -29)
  const trailingDays = allDays.filter((day) => day.date >= trailingFrom && day.date <= now.date)

  const weekTotal = totalOf(weekDays)
  const monthTotal = totalOf(monthDays)
  const trailingTotal = totalOf(trailingDays)

  // Project the next 30 days from the run rate of the observed window: the
  // last 30 calendar days, or fewer when history is shorter than that.
  const firstDate = allDays[0]?.date
  const observedDays = firstDate === undefined
    ? 0
    : Math.min(30, Math.round((Date.parse(`${now.date}T00:00:00Z`) - Date.parse(`${firstDate}T00:00:00Z`)) / DAY_MS) + 1)

  const monthForecast = project(monthTotal, now.day, monthCount)
  const weekForecast = project(weekTotal, weekElapsed, 7)
  const next30 = project(trailingTotal, observedDays, 30)

  const modelTotals = new Map()
  for (const day of days) {
    for (const [model, entry] of day.models) {
      const current = modelTotals.get(model) ?? {
        model,
        tokens: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, total: 0 },
        usd: 0,
        php: 0,
        requests: 0,
      }
      addTokens(current.tokens, entry.tokens)
      current.usd += entry.usd
      current.php = toPhp(current.usd, fx.rate)
      current.requests += entry.requests
      modelTotals.set(model, current)
    }
  }

  const sessions = new Set()
  for (const file of files) if (file.sessionId) sessions.add(file.sessionId)

  return {
    generatedAt: nowMs,
    tz,
    fx,
    range: { since: since ?? days[0]?.date ?? null, until: until ?? days.at(-1)?.date ?? null },
    coverage: {
      sessions: sessions.size,
      firstDate: allDays[0]?.date ?? null,
      lastDate: allDays.at(-1)?.date ?? null,
    },
    days,
    weeks: [...rollup(days, isoWeek).values()],
    months: [...rollup(days, (date) => date.slice(0, 7)).values()],
    totals: totalOf(days),
    models: [...modelTotals.values()].sort((a, b) => b.usd - a.usd),
    unknownModels,
    summary: {
      today: { date: now.date, ...totalOf([today]) },
      week: {
        key: weekKey,
        from: addDays(now.date, 1 - weekElapsed),
        to: addDays(now.date, 7 - weekElapsed),
        elapsedDays: weekElapsed,
        ...weekTotal,
        forecast: weekForecast,
      },
      month: {
        key: now.date.slice(0, 7),
        daysInMonth: monthCount,
        elapsedDays: now.day,
        ...monthTotal,
        forecast: monthForecast,
      },
      trailing: {
        days: trailingDays.length,
        observedDays,
        averageDaily: project(trailingTotal, observedDays, 1),
        next30,
      },
    },
  }
}
