---
name: accountant
description: Count token use per day, week, and month, price it in US dollars and Philippine pesos, and forecast the rest of the week or month. Use when asked what token spend was, what it cost, what the running bill is, or what the projected bill will be.
whenToUse: The user asks about token usage, token spend, cost, budget, burn rate, or a projected bill — "how many tokens did I use", "what did today cost", "magkano nagastos", "what's my month looking like", "will I blow my budget".
---

# Accountant

Turn recorded usage into money. Every number comes from the DSH session store,
priced at DeepSeek list rates, so the answer is reproducible and auditable
rather than guessed.

## Run the counter, do not estimate

Never eyeball a total or multiply tokens in your head. Run the script:

```bash
node scripts/accountant.mjs
```

It prints today, this week, and this month, each with a projected amount.

Resolve `scripts/accountant.mjs` against this skill's resource directory — it
is inside the skill, not the user's workspace. Do not copy it into the
workspace to run it.

## The one command you usually need

| Question | Command |
|---|---|
| What is the running total? | `node scripts/accountant.mjs` |
| Break it down per day | `node scripts/accountant.mjs --group day --limit 14` |
| Per week | `node scripts/accountant.mjs --group week` |
| Per month | `node scripts/accountant.mjs --group month` |
| Everything, all three groupings | `node scripts/accountant.mjs --group all` |
| A specific window | `node scripts/accountant.mjs --range 2026-11-01..2026-11-11` |
| Split by model | `node scripts/accountant.mjs --by-model` |
| For a document | `node scripts/accountant.mjs --markdown` |
| For a spreadsheet | `node scripts/accountant.mjs --csv > spend.csv` |
| For another program | `node scripts/accountant.mjs --json` |
| A different peso rate | `node scripts/accountant.mjs --rate 62.35` |
| A different calendar | `node scripts/accountant.mjs --tz Asia/Manila` |

Add `--limit <n>` to change how many rows print. Defaults are 7 days, 6 weeks,
6 months.

## It also runs in the header

The Session header shows the same numbers without a command: a chip in the
right-hand utilities seat (the row with the mode switch, above the Chat and
Trajectory tabs), reading the tracked key's spend today as **$ · ₱** — today's
overall spend only when no key is configured. Clicking it opens that key's
today, week, and month figures in both currencies, plus its predicted month end.
It refreshes every minute.

The panel is key-scoped: its rows and prediction cover the active key's window,
not the machine's whole history. The CLI keeps the overall tables and adds the
key lines, so use the CLI when the question is about total spend and the panel
when it is about this key.

So when the user asks "where do I see this", point at that chip. The chip reads
a read-only `GET /accountant/spend` route served by this plugin and priced with
the same library the CLI uses — if the two ever disagreed, that would be a bug,
not a rounding difference.

## Which key it tracks

The usage is DSH's, and DSH spends on one DeepSeek key at a time. The counter
resolves that key the way DSH does — the launch environment first, then
`<DSH_HOME>/.credentials.yaml` — and keeps only a 12-character SHA-256
fingerprint of it, never the key itself.

The first time a fingerprint is seen, it opens a usage window for that key; when
the key is rotated, the old window freezes and a new one starts. Every run
prints the active key and what that key has spent:

```
Key       2c900c644833 · DSH credential store · counted since 2026-11-11 15:00
Key spend 1.4M tokens · $0.63 · ₱39.06 · 22 requests
```

Windows begin on a whole UTC hour because the cached usage buckets are hourly: a
key first seen at 14:51 counts from 15:00, and nothing from before the key
existed is attributed to it. Older usage stays in the normal day/week/month
tables; it is simply not claimed as this key's. Once more than one key has been
seen, a `Per key` table lists every window.

The timeline is `<DSH_HOME>/accountant.keys.json` — fingerprints and first-seen
times only. Delete it to restart attribution from the next run.

The header panel is scoped the same way: its today, week, month, and predicted
month-end rows cover this key's window, and the prediction projects the key's
own daily rate from the days it has existed — noisy while the key is young. The
CLI keeps the overall tables and adds the key lines, so it remains the place to
ask what the whole machine spent.

## Read the output correctly

- **tokens** is input plus cache-read plus cache-write plus output tokens.
- **USD** and **PHP** are the priced total for that row.
- **Predicted** rows are run-rate projections, not committed charges:
  - *week end* — this week's spend divided by days elapsed, times seven.
  - *month end* — this month's spend divided by days elapsed, times the
    calendar length.
  - *next 30 days* — the observed daily rate, projected across a month.
- A forecast made early in a period is noisy. Say so when the period is less
  than three days old, and prefer the *next 30 days* figure for a steady-state
  estimate.

Report the numbers with the currency symbol and two decimals. Quote the peso
figure alongside the dollar figure; the user asked for both.

## Prices it uses

DeepSeek list prices as of **2026-11-11**, in dollars per million tokens:

| Model | Cache hit | Cache miss | Output |
|---|---|---|---|
| `deepseek-flash` peak | $0.006 | $0.30 | $1.20 |
| `deepseek-flash` off-peak | $0.003 | $0.15 | $0.60 |
| `deepseek-v4-pro` peak | $0.044 | $1.32 | $3.96 |
| `deepseek-v4-pro` off-peak | $0.022 | $0.66 | $1.98 |

Each recorded call is priced at the tariff that applied at its own hour: peak
is Monday–Friday, 01:00–04:00 and 06:00–10:00 UTC, and every Chinese public
holiday is off-peak. `deepseek-chat`, `deepseek-v4-flash`, and
`deepseek-v4-flash-vision-exp` are billed at Flash rates because DeepSeek
serves them with the Flash model.

The peso rate defaults to **₱62.00 per US dollar**, observed 2026-11-11. If the
user gives a newer rate, pass it with `--rate` and say which rate you used.

## What it cannot see

Say this plainly when precision matters, and never quietly present an estimate
as an invoice:

- Auxiliary model calls that record no usage — session-title generation,
  compaction summaries, some retries — are not counted. The total is a floor,
  not a ceiling.
- Search and Fetch API calls are metered per request by DeepSeek, not per
  token, and are outside this count entirely.
- Anything done outside DSH on the same API key is invisible. When the key is
  dedicated to DSH, the key line is the whole spend on that key; when it is
  shared with another app, it is only DSH's share.
- A session log still being written is picked up on the next run. The live
  session is always slightly behind.

## Interpret, then advise

The user asked for a number; give the number first, then what it implies.

- Compare the *next 30 days* projection with what the user says their budget
  is, and name the gap in both currencies.
- When one day dwarfs the others, check `--group day --limit 14`: a single
  long session or a large refactor usually explains it, and saying so is more
  useful than the total alone.
- When cache-hit tokens dominate, that is healthy: cache hits cost twenty times
  less than misses on Flash. Flag it as good news, not as waste.
- Large input counts in a short window usually mean re-reading whole files
  instead of targeted reads.

## Changing the defaults

A config file at `<DSH_HOME>/accountant.config.json` overrides the peso rate,
the calendar timezone, the holiday list, and the model price table, so a user
can keep a house rate without passing flags:

```json
{
  "tz": "Asia/Manila",
  "rate": 62.0,
  "fxAsOf": "2026-11-11",
  "holidays": ["2026-11-30"],
  "models": {
    "deepseek-flash": { "cacheHit": 0.006, "cacheMiss": 0.3, "output": 1.2 }
  }
}
```

Environment variables `DSH_ACCOUNTANT_TZ` and `DSH_ACCOUNTANT_RATE` work too.
Flags win over everything.

## Failure modes

| Symptom | Meaning | Move |
|---|---|---|
| `Coverage 0 sessions` | No logs found where it looked | Check `--data-dir`; DSH stores sessions under `<DSH_HOME>/sessions` |
| Numbers much lower than expected | Unpriced model billed at Flash rates | The report prints `! Unpriced model(s)`; add it to `models` in the config |
| A day missing from the table | That day has no recorded usage, not a zero-price day | Confirm with `--range` |
| Slow first run | Every log is being parsed | Later runs are cached; `--no-cache` forces a re-parse |

Exit codes: `0` success, `1` runtime failure, `2` bad usage.
