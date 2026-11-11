/**
 * Rendering: aligned plain text for the terminal, Markdown for a document,
 * CSV for a spreadsheet, and JSON for another program.
 *
 * @module accountant/report
 */

import { MODEL_LABELS, PRICING_AS_OF } from './pricing.mjs'
import { zonedParts } from './calendar.mjs'

/** `YYYY-MM-DD HH:mm` in the report's timezone. */
function localMoment(ms, tz) {
  const parts = zonedParts(ms, tz)
  const hour = String(parts.hour).padStart(2, '0')
  const minute = String(parts.minute).padStart(2, '0')
  return `${parts.date} ${hour}:${minute}`
}

function keySourceLabel(source) {
  return source === 'env' ? 'launch environment' : 'DSH credential store'
}

/** Compact token count: `987`, `12.3K`, `1.24M`. */
export function fmtTokens(value) {
  const n = Number(value) || 0
  if (n < 1000) return String(Math.round(n))
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 2 : 1)}K`
  return `${(n / 1_000_000).toFixed(n < 10_000_000 ? 2 : 1)}M`
}

/** Dollars with enough decimals to keep sub-cent amounts meaningful. */
export function fmtUsd(value) {
  const n = Number(value) || 0
  if (n === 0) return '$0.00'
  if (n < 0.01) return `$${n.toFixed(5)}`
  if (n < 1) return `$${n.toFixed(4)}`
  if (n < 1000) return `$${n.toFixed(2)}`
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/** Pesos, always two decimals and grouped. */
export function fmtPhp(value) {
  const n = Number(value) || 0
  if (n === 0) return '₱0.00'
  if (n < 1) return `₱${n.toFixed(4)}`
  return `₱${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/** Plain integer with grouping. */
export function fmtInt(value) {
  return Math.round(Number(value) || 0).toLocaleString('en-US')
}

function labelOf(model) {
  return MODEL_LABELS[model] ?? model
}

function pad(text, width, align) {
  if (align === 'right') return String(text).padStart(width)
  return String(text).padEnd(width)
}

/** Render an aligned table with no ANSI escapes, safe for pipes and files. */
export function table(headers, rows, aligns = headers.map(() => 'right')) {
  const widths = headers.map((header, index) =>
    Math.max(String(header).length, ...rows.map((row) => String(row[index] ?? '').length)))
  const line = (cells) => cells.map((cell, index) => pad(cell ?? '', widths[index], aligns[index])).join('  ')
  return [line(headers), widths.map((width) => '─'.repeat(width)).join('  '), ...rows.map(line)].join('\n')
}

/** Newest `limit` rows, kept in chronological order. */
function tail(rows, limit) {
  if (limit === undefined || limit <= 0 || rows.length <= limit) return rows
  return rows.slice(-limit)
}

function dayRow(day) {
  return [day.date.slice(5), fmtTokens(day.tokens.total), fmtUsd(day.usd), fmtPhp(day.php), fmtInt(day.requests)]
}

function weekRow(week) {
  return [week.key, `${week.from.slice(5)} → ${week.to.slice(5)}`, fmtTokens(week.tokens.total), fmtUsd(week.usd), fmtPhp(week.php)]
}

function monthRow(month) {
  return [month.key, fmtInt(month.dayCount), fmtTokens(month.tokens.total), fmtUsd(month.usd), fmtPhp(month.php)]
}

/** Serialisable view of the active key and the keys seen before it. */
function plainKey(key) {
  const iso = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString() : null)
  return {
    fingerprint: key.fingerprint,
    source: key.source,
    since: iso(key.since),
    totals: key.totals,
    summary: key.summary
      ? {
          today: key.summary.today,
          week: key.summary.week,
          month: key.summary.month,
          forecast: key.summary.forecast,
          elapsedDays: key.summary.elapsedDays,
        }
      : null,
    keys: key.keys.map((entry) => ({
      fingerprint: entry.fingerprint,
      since: iso(entry.since),
      totals: entry.totals,
    })),
  }
}

/** Serialisable view of the report model: Sets and Maps become counts and arrays. */
export function toJson(model) {
  const plainDay = (day) => ({
    date: day.date,
    tokens: day.tokens,
    usd: day.usd,
    php: day.php,
    requests: day.requests,
    sessions: day.sessions.size,
    models: [...day.models.values()],
  })
  const plainBucket = (bucket) => ({
    key: bucket.key,
    from: bucket.from,
    to: bucket.to,
    tokens: bucket.tokens,
    usd: bucket.usd,
    php: bucket.php,
    requests: bucket.requests,
    dayCount: bucket.dayCount,
    sessions: bucket.sessions.size,
  })
  return {
    generatedAt: new Date(model.generatedAt).toISOString(),
    timezone: model.tz,
    fx: model.fx,
    pricingAsOf: PRICING_AS_OF,
    range: model.range,
    coverage: model.coverage,
    totals: model.totals,
    summary: model.summary,
    days: model.days.map(plainDay),
    weeks: model.weeks.map(plainBucket),
    months: model.months.map(plainBucket),
    models: model.models,
    unknownModels: model.unknownModels,
    key: model.key === null || model.key === undefined ? null : plainKey(model.key),
  }
}

/**
 * Plain-text report.
 *
 * @param {object} model      result of `summarize`
 * @param {object} meta       { group, limit, stats, byModel, pricingAsOf }
 */
export function renderText(model, meta = {}) {
  const { group = 'day', limit = 7, stats, byModel = false } = meta
  const { summary, fx, coverage } = model
  const lines = []

  lines.push(`Accountant · token spend`)
  lines.push('')
  if (stats?.sessionsDir) lines.push(`Source    ${stats.sessionsDir}`)
  const span = coverage.firstDate ? `${coverage.firstDate} → ${coverage.lastDate}` : 'no usage recorded'
  const sessionCount = `${fmtInt(coverage.sessions)} session${coverage.sessions === 1 ? '' : 's'}`
  lines.push(`Coverage  ${sessionCount} · ${span} · ${model.tz}`)
  lines.push(`Prices    pricing as of ${PRICING_AS_OF} · peak/off-peak by UTC hour · USD→PHP ${fx.rate.toFixed(2)} (${fx.asOf})`)
  if (stats && (stats.failed > 0 || stats.reused > 0)) {
    lines.push(`Scan      ${fmtInt(stats.scanned)} parsed, ${fmtInt(stats.reused)} cached, ${fmtInt(stats.failed)} unreadable, ${fmtInt(stats.ms)}ms`)
  }
  if (model.key) {
    const key = model.key
    lines.push(`Key       ${key.fingerprint} · ${keySourceLabel(key.source)} · counted since ${localMoment(key.since, model.tz)}`)
    lines.push(`Key spend ${fmtTokens(key.totals.tokens.total)} tokens · ${fmtUsd(key.totals.usd)} · ${fmtPhp(key.totals.php)} · ${fmtInt(key.totals.requests)} requests`)
  } else {
    lines.push('Key       not found — save DEEPSEEK_API_KEY in the DSH credential store')
  }
  lines.push('')

  lines.push('Now')
  lines.push(table(
    ['', 'period', 'tokens', 'USD', 'PHP', 'requests'],
    [
      ['Today', summary.today.date, fmtTokens(summary.today.tokens.total), fmtUsd(summary.today.usd), fmtPhp(summary.today.php), fmtInt(summary.today.requests)],
      ['Week', `${summary.week.key} (${summary.week.from.slice(5)} → ${summary.week.to.slice(5)})`, fmtTokens(summary.week.tokens.total), fmtUsd(summary.week.usd), fmtPhp(summary.week.php), fmtInt(summary.week.requests)],
      ['Month', summary.month.key, fmtTokens(summary.month.tokens.total), fmtUsd(summary.month.usd), fmtPhp(summary.month.php), fmtInt(summary.month.requests)],
    ],
    ['left', 'left', 'right', 'right', 'right', 'right'],
  ))
  lines.push('')

  lines.push('Predicted')
  lines.push(table(
    ['horizon', 'tokens', 'USD', 'PHP'],
    [
      ['week end', fmtTokens(summary.week.forecast.tokens.total), fmtUsd(summary.week.forecast.usd), fmtPhp(summary.week.forecast.php)],
      [`month end (${summary.month.daysInMonth} days)`, fmtTokens(summary.month.forecast.tokens.total), fmtUsd(summary.month.forecast.usd), fmtPhp(summary.month.forecast.php)],
      ['next 30 days', fmtTokens(summary.trailing.next30.tokens.total), fmtUsd(summary.trailing.next30.usd), fmtPhp(summary.trailing.next30.php)],
    ],
    ['left', 'right', 'right', 'right'],
  ))
  lines.push('')

  if (model.key && model.key.keys.length > 1) {
    lines.push('Per key')
    lines.push(table(
      ['key', 'since', 'tokens', 'USD', 'PHP'],
      model.key.keys.map((entry) => [
        entry.fingerprint,
        localMoment(entry.since, model.tz),
        fmtTokens(entry.totals.tokens.total),
        fmtUsd(entry.totals.usd),
        fmtPhp(entry.totals.php),
      ]),
      ['left', 'left', 'right', 'right', 'right'],
    ))
    lines.push('')
  }

  if (byModel && model.models.length > 0) {
    lines.push('By model')
    lines.push(table(
      ['model', 'tokens', 'USD', 'PHP'],
      model.models.map((entry) => [labelOf(entry.model), fmtTokens(entry.tokens.total), fmtUsd(entry.usd), fmtPhp(entry.php)]),
      ['left', 'right', 'right', 'right'],
    ))
    lines.push('')
  }

  const rows = group === 'week'
    ? tail(model.weeks, limit).map(weekRow)
    : group === 'month'
      ? tail(model.months, limit).map(monthRow)
      : group === 'all'
        ? []
        : tail(model.days, limit).map(dayRow)

  if (group === 'all') {
    for (const [title, bucketRows, headers] of [
      ['Per day', tail(model.days, limit).map(dayRow), ['day', 'tokens', 'USD', 'PHP', 'requests']],
      ['Per week', tail(model.weeks, limit).map(weekRow), ['week', 'range', 'tokens', 'USD', 'PHP']],
      ['Per month', tail(model.months, limit).map(monthRow), ['month', 'days', 'tokens', 'USD', 'PHP']],
    ]) {
      lines.push(title)
      lines.push(table(headers, bucketRows, headers.map((header) => (header === 'day' || header === 'week' || header === 'month' || header === 'range' ? 'left' : 'right'))))
      lines.push('')
    }
  } else if (rows.length > 0) {
    const title = group === 'week' ? 'Per week' : group === 'month' ? 'Per month' : 'Per day'
    const headers = group === 'week'
      ? ['week', 'range', 'tokens', 'USD', 'PHP']
      : group === 'month'
        ? ['month', 'days', 'tokens', 'USD', 'PHP']
        : ['day', 'tokens', 'USD', 'PHP', 'requests']
    lines.push(title)
    lines.push(table(headers, rows, headers.map((header) => (header === 'day' || header === 'week' || header === 'month' || header === 'range' ? 'left' : 'right'))))
    lines.push('')
  }

  if (model.unknownModels.length > 0) {
    lines.push(`! Unpriced model(s) billed at Flash rates: ${model.unknownModels.join(', ')}`)
  }
  lines.push('Estimates, not an invoice: auxiliary calls such as title generation and compaction summaries are not counted.')
  return `${lines.join('\n')}\n`
}

/** Markdown report, suitable for a document or a pull-request comment. */
export function renderMarkdown(model, meta = {}) {
  const { group = 'day', limit = 7, byModel = false } = meta
  const { summary, fx, coverage } = model
  const md = []
  const mdTable = (headers, rows) => [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map((header, index) => (index === 0 ? ':---' : '---:')).join(' | ')} |`,
    ...rows.map((row) => `| ${row.join(' | ')} |`),
  ].join('\n')

  md.push('# Token spend')
  md.push('')
  md.push(`- **Coverage:** ${fmtInt(coverage.sessions)} sessions, ${coverage.firstDate ?? '—'} → ${coverage.lastDate ?? '—'} (${model.tz})`)
  md.push(`- **USD→PHP:** ${fx.rate.toFixed(2)} as of ${fx.asOf}`)
  md.push(`- **Prices:** DeepSeek list prices as of ${PRICING_AS_OF}, peak and off-peak`)
  if (model.key) {
    md.push(`- **Key:** ${model.key.fingerprint} (${keySourceLabel(model.key.source)}), counted since ${localMoment(model.key.since, model.tz)}`)
    md.push(`- **Key spend:** ${fmtTokens(model.key.totals.tokens.total)} tokens, ${fmtUsd(model.key.totals.usd)}, ${fmtPhp(model.key.totals.php)}`)
  }
  md.push('')
  md.push('## Now')
  md.push(mdTable(['Period', 'Tokens', 'USD', 'PHP'], [
    ['Today', fmtTokens(summary.today.tokens.total), fmtUsd(summary.today.usd), fmtPhp(summary.today.php)],
    ['Week', fmtTokens(summary.week.tokens.total), fmtUsd(summary.week.usd), fmtPhp(summary.week.php)],
    ['Month', fmtTokens(summary.month.tokens.total), fmtUsd(summary.month.usd), fmtPhp(summary.month.php)],
  ]))
  md.push('')
  md.push('## Predicted')
  md.push(mdTable(['Horizon', 'Tokens', 'USD', 'PHP'], [
    ['Week end', fmtTokens(summary.week.forecast.tokens.total), fmtUsd(summary.week.forecast.usd), fmtPhp(summary.week.forecast.php)],
    ['Month end', fmtTokens(summary.month.forecast.tokens.total), fmtUsd(summary.month.forecast.usd), fmtPhp(summary.month.forecast.php)],
    ['Next 30 days', fmtTokens(summary.trailing.next30.tokens.total), fmtUsd(summary.trailing.next30.usd), fmtPhp(summary.trailing.next30.php)],
  ]))
  md.push('')

  if (model.key && model.key.keys.length > 1) {
    md.push('## Keys')
    md.push(mdTable(['Key', 'Since', 'Tokens', 'USD', 'PHP'], model.key.keys.map((entry) => [
      entry.fingerprint,
      localMoment(entry.since, model.tz),
      fmtTokens(entry.totals.tokens.total),
      fmtUsd(entry.totals.usd),
      fmtPhp(entry.totals.php),
    ])))
    md.push('')
  }

  if (byModel && model.models.length > 0) {
    md.push('## By model')
    md.push(mdTable(['Model', 'Tokens', 'USD', 'PHP'], model.models.map((entry) => [labelOf(entry.model), fmtTokens(entry.tokens.total), fmtUsd(entry.usd), fmtPhp(entry.php)])))
    md.push('')
  }

  const section = group === 'week' ? 'Per week' : group === 'month' ? 'Per month' : 'Per day'
  if (group === 'week') {
    md.push(`## ${section}`)
    md.push(mdTable(['Week', 'Range', 'Tokens', 'USD', 'PHP'], tail(model.weeks, limit).map((week) => [week.key, `${week.from} → ${week.to}`, fmtTokens(week.tokens.total), fmtUsd(week.usd), fmtPhp(week.php)])))
  } else if (group === 'month') {
    md.push(`## ${section}`)
    md.push(mdTable(['Month', 'Days', 'Tokens', 'USD', 'PHP'], tail(model.months, limit).map((month) => [month.key, month.dayCount, fmtTokens(month.tokens.total), fmtUsd(month.usd), fmtPhp(month.php)])))
  } else {
    md.push(`## ${section}`)
    md.push(mdTable(['Day', 'Tokens', 'USD', 'PHP', 'Requests'], tail(model.days, limit).map((day) => [day.date, fmtTokens(day.tokens.total), fmtUsd(day.usd), fmtPhp(day.php), fmtInt(day.requests)])))
  }
  md.push('')
  md.push('_Estimates from recorded usage, not an invoice._')
  return `${md.join('\n')}\n`
}

/** CSV of the requested group, header row included. */
export function renderCsv(model, meta = {}) {
  const group = meta.group ?? 'day'
  const header = ['period', 'from', 'to', 'tokens_input', 'tokens_cache_read', 'tokens_cache_write', 'tokens_output', 'tokens_total', 'usd', 'php', 'requests']
  const rows = group === 'month'
    ? model.months.map((month) => [month.key, month.from, month.to, month.tokens.input, month.tokens.cacheRead, month.tokens.cacheWrite, month.tokens.output, month.tokens.total, month.usd.toFixed(6), month.php.toFixed(4), month.requests])
    : group === 'week'
      ? model.weeks.map((week) => [week.key, week.from, week.to, week.tokens.input, week.tokens.cacheRead, week.tokens.cacheWrite, week.tokens.output, week.tokens.total, week.usd.toFixed(6), week.php.toFixed(4), week.requests])
      : model.days.map((day) => [day.date, day.date, day.date, day.tokens.input, day.tokens.cacheRead, day.tokens.cacheWrite, day.tokens.output, day.tokens.total, day.usd.toFixed(6), day.php.toFixed(4), day.requests])
  return `${[header, ...rows].map((row) => row.join(',')).join('\n')}\n`
}
