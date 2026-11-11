# Report formats

Four renderings of one model. Pick by destination, never by taste: the numbers
are identical in all of them.

## Text (default)

For the terminal and for pasting into a chat.

```
Accountant · token spend

Source    C:\Users\admin\.dsh\sessions
Coverage  339 sessions · 2026-09-10 → 2026-11-11 · Asia/Manila
Prices    pricing as of 2026-11-11 · peak/off-peak by UTC hour · USD→PHP 62.00 (2026-11-11)
Scan      1 parsed, 338 cached, 0 unreadable, 80ms
Key       2c900c644833 · DSH credential store · counted since 2026-11-11 15:00
Key spend 1.4M tokens · $0.63 · ₱39.06 · 22 requests

Now
       period                     tokens     USD        PHP  requests
─────  ────────────────────────  ───────  ──────  ─────────  ────────
Today  2026-11-11                 203.4M   $1.83    ₱113.22       972
Week   2026-W46 (11-09 → 11-15)  1758.1M  $17.18  ₱1,064.94     6,555
Month  2026-11                   2523.0M  $24.59  ₱1,524.41     9,442
```

Three sections, in this order: **Now** (actual), **Predicted** (run rate), then
the per-period table. The optional `Scan` line appears only when a run reused
or failed to read something.

`Key` names the DeepSeek key the usage is billed to — its fingerprint, where the
key was read from, and the hour attribution started. `Key spend` is the usage
inside that key's window, which is not the same as `Today`: the window starts at
a whole UTC hour and does not claim earlier usage. When more than one key has
been seen, a `Per key` table follows `Predicted`. With no key configured the
line says so instead.

`Coverage` is the count of sessions that contributed, not a date range of
interest. A session with no recorded usage still appears here.

## Markdown

`--markdown`, for a report, a pull-request comment, or a chat client that
renders tables. Same sections as headings, currency symbols kept, date range
inlined. Ends with a one-line disclaimer so a pasted table cannot be mistaken
for an invoice.

## CSV

`--csv`, one row per period, for a spreadsheet:

```
period,from,to,tokens_input,tokens_cache_read,tokens_cache_write,tokens_output,tokens_total,usd,php,requests
2026-11-10,2026-11-10,2026-11-10,44788,2067328,0,45616,2157732,0.023456,1.454272,42
```

`usd` keeps six decimals and `php` four, because a single day's spend can sit
below one cent and rounding it to two decimals destroys the row. The group
follows `--group`: `day` by default, `week` or `month` on request. `--group all`
falls back to day rows in CSV; a single file cannot hold three shapes.

## JSON

`--json`, everything the renderer knows, for another program:

```json
{
  "generatedAt": "2026-11-11T05:02:11.000Z",
  "timezone": "Asia/Manila",
  "fx": { "pair": "USD/PHP", "rate": 62, "asOf": "2026-11-11" },
  "pricingAsOf": "2026-11-11",
  "range": { "since": "2026-09-10", "until": "2026-11-11" },
  "coverage": { "sessions": 339, "firstDate": "2026-09-10", "lastDate": "2026-11-11" },
  "totals": { "tokens": { "...": 0 }, "usd": 0, "php": 0, "requests": 0 },
  "summary": {
    "today":      { "date": "2026-11-11", "tokens": {}, "usd": 0, "php": 0, "requests": 0 },
    "week":       { "key": "2026-W46", "from": "", "to": "", "elapsedDays": 3, "forecast": {} },
    "month":      { "key": "2026-11", "daysInMonth": 30, "elapsedDays": 11, "forecast": {} },
    "trailing":   { "days": 30, "observedDays": 30, "averageDaily": {}, "next30": {} }
  },
  "days":   [ { "date": "", "tokens": {}, "usd": 0, "php": 0, "requests": 0, "sessions": 0, "models": [] } ],
  "weeks":  [ { "key": "", "from": "", "to": "", "tokens": {}, "usd": 0, "php": 0, "dayCount": 0 } ],
  "months": [ { "key": "", "from": "", "to": "", "tokens": {}, "usd": 0, "php": 0, "dayCount": 0 } ],
  "models": [ { "model": "deepseek-flash", "tokens": {}, "usd": 0, "php": 0, "requests": 0 } ],
  "unknownModels": [],
  "key": {
    "fingerprint": "2c900c644833",
    "source": "store",
    "since": "2026-11-11T07:00:00.000Z",
    "totals": { "tokens": {}, "usd": 0.63, "php": 39.06, "requests": 22 },
    "summary": {
      "today": {}, "week": {}, "month": {},
      "forecast": {}, "elapsedDays": 1
    },
    "keys": [ { "fingerprint": "2c900c644833", "since": "2026-11-11T07:00:00.000Z", "totals": {} } ]
  }
}
```

Every `tokens` object has `input`, `cacheRead`, `cacheWrite`, `output`,
`total`. `days` holds only days with recorded usage — absent days are absent,
not zero rows. `weeks` uses ISO weeks, so a week that straddles a year boundary
belongs to the year of its Thursday.

`key` is `null` when no DeepSeek key is configured. `since` is when the current
key's window opens, `totals` covers only that window, and `keys` lists every
fingerprint seen so far in order. `summary` repeats that window as today, week,
and month with a month-end forecast at the key's own daily rate; it is what the
header panel renders. `elapsedDays` is the number of days the key has existed
for that projection, not the days of the month.

`models` inside a day is a list of per-model entries for that day; top-level
`models` is the range-wide version, sorted by cost.

## Forecast arithmetic

| Field | Formula |
|---|---|
| `week.forecast` | week actual × 7 ÷ ISO weekday of today (1–7) |
| `month.forecast` | month actual × days in month ÷ day of month |
| `trailing.averageDaily` | last-30-day actual ÷ observed days |
| `trailing.next30` | trailing actual × 30 ÷ observed days |

`observedDays` is the days from the first recorded usage to today, capped at 30.
A user with four days of history gets a projection scaled up from four days,
not from thirty — which is loud, and deliberately so: it is the honest error
bar on a very young dataset.

All forecasts use calendar days, including days with no usage. A user who works
three days a week gets a monthly forecast that includes the four days off, which
is the right shape for a bill.

## Number formatting

| Kind | Rule | Example |
|---|---|---|
| Tokens | raw below 1,000, then `K` and `M` with 1–2 decimals | `987`, `12.3K`, `1.24M` |
| Dollars | 5 decimals below a cent, 4 below a dollar, then 2 | `$0.00341`, `$0.4231`, `$17.18` |
| Pesos | 4 decimals below one peso, then 2 with grouping | `₱0.6035`, `₱1,064.94` |
| Counts | grouped integers | `6,555` |

Text output carries no ANSI colour, so it survives a pipe, a redirect, and a
Windows console that does not parse escapes.
