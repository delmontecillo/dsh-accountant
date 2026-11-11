---
description: "Counts your token use per day, week and month, and prices it as a predicted amount in US dollars and Philippine pesos."
kind: "package-bundle"
---

# dsh-accountant

A DeepSeek Harness bundle that adds **Accountant**, a skill that reads the
recorded usage in your session store and answers the question you actually
have: *what is this costing me, in pesos?*

```
Accountant · token spend

Coverage  339 sessions · 2026-09-10 → 2026-11-11 · Asia/Manila
Prices    pricing as of 2026-11-11 · peak/off-peak by UTC hour · USD→PHP 62.00 (2026-11-11)
Key       2c900c644833 · DSH credential store · counted since 2026-11-11 15:00
Key spend 1.4M tokens · $0.63 · ₱39.06 · 22 requests

Now
       period                     tokens     USD        PHP  requests
─────  ────────────────────────  ───────  ──────  ─────────  ────────
Today  2026-11-11                 203.4M   $1.83    ₱113.22       972
Week   2026-W46 (11-09 → 11-15)  1758.1M  $17.18  ₱1,064.94     6,555
Month  2026-11                   2523.0M  $24.59  ₱1,524.41     9,442

Predicted
horizon               tokens     USD        PHP
───────────────────  ───────  ──────  ─────────
week end             4102.2M  $40.08  ₱2,484.86
month end (30 days)  6880.8M  $67.06  ₱4,157.49
next 30 days         6757.9M  $64.73  ₱4,013.54
```

Nothing is estimated from file size or character count. The numbers come from
the provider's own `usage` payload on every recorded model call, priced at the
tariff that applied at that call's hour.

## In the app

The Session header carries a live readout in its right-hand utilities seat —
the same row as the mode switch, above the Chat/Trajectory tabs:

```
  Accountant token usage plugin        $1.99 · ₱123.56   ⬤ Standard mode
  Chat   Trajectory   ⋯
```

The chip reads the tracked key's spend — the active DeepSeek key's total since
its window opened — and falls back to today's overall spend when no key is
configured. Its tooltip carries the fingerprint, the window start, and today's
overall figures for comparison.

Click it for this key's today, week, and month figures in both currencies, plus
its predicted month end:

```
┌───────────────────────────────────┐
│ Token spend          Asia/Manila  │
│ Today · 11-11             ₱27.90  │
│ $0.45 · 1.5M tokens               │
│ Week · 2026-W46           ₱33.48  │
│ $0.54 · 1.8M tokens               │
│ Month · 2026-11           ₱35.34  │
│ $0.57 · 1.9M tokens               │
│ Predicted month end · 30 days     │
│                          ₱558.00  │
│ $9.00 · 30.0M tokens              │
│ Estimate · ₱62.00 per USD · 339 sessions · key 2c900c64… │
└───────────────────────────────────┘
```

Those rows are the key's, not the machine's: Today, Week, Month, and the
predicted month end are all scoped to the active key's window. With no key
configured, the panel falls back to all recorded usage.

It polls once a minute, refreshes when opened, and shows `—` rather than a
guess when the host is not answering. It reads a read-only, loopback-only
`GET /accountant/spend` route, so the browser can never write anything through
it. The route uses the same library as the CLI, so the widget and the command
line cannot drift apart.

## Which key it tracks

The numbers are DSH's usage, and DSH spends on one DeepSeek key at a time. The
report says which one. The key is resolved the way DSH resolves it — the launch
environment first, then `<DSH_HOME>/.credentials.yaml` — and only a 12-character
SHA-256 fingerprint of it is kept, never the key.

The first sighting of a fingerprint opens a usage window; rotating the key
freezes that window and starts another. Usage from before a key existed is never
claimed as that key's, so the day/week/month tables keep the full history while
the key line starts where the key did. Cached usage is hourly, so a key set at
14:51 counts from 15:00.

The timeline lives in `<DSH_HOME>/accountant.keys.json` — fingerprints and
first-seen times only. Delete it to restart attribution from the next run.

The header panel's today, week, month, and predicted month end are scoped to
this window too; its prediction projects the key's own daily rate from the days
it has existed. The CLI keeps the overall tables and adds the key lines, so it
is still the place to ask what the whole machine spent.

## Install

### From GitHub

In the Harness Web UI, open **Plugins**, choose **Install bundle**, and paste:

```
github:delmontecillo/dsh-accountant
```

Or, for an agent driving `plugin_manager`:

```
action: install_bundle
target: github:delmontecillo/dsh-accountant
```

No build step and no dependencies: the repository root is the package.

### From a checkout

Install the absolute path of this directory with `install_bundle`; the profile
links the checkout, so edits take effect on the next lookup.

### As a plain skill

The skill is self-contained in `skills/accountant/`. Copy that directory into
any scanned skill root, for example `%USERPROFILE%\.dsh\skills\` on Windows or
`~/.dsh/skills/` elsewhere, and it appears in the session catalog without the
bundle.

## Toggle it

Accountant is a normal bundle, so it appears in **Plugins** next to your other
installs with an on/off switch. Toggling it removes the skill from the catalog;
the collected data stays untouched and returns when you switch it back on.

## Use it

Ask in plain language — "how many tokens did I use today", "magkano nagastos
this month", "what's my projected bill" — and the skill runs the counter.

Or run it yourself:

```bash
node skills/accountant/scripts/accountant.mjs
```

| Flag | Purpose |
|---|---|
| `--group day\|week\|month\|all` | which table to print |
| `--limit <n>` | rows per table |
| `--range 2026-11-01..2026-11-11` | restrict to a window |
| `--tz <zone>` | calendar timezone, default `Asia/Manila` |
| `--rate <n>` | USD→PHP rate, default 62.00 |
| `--by-model` | split by model |
| `--json`, `--markdown`, `--csv` | machine, document, spreadsheet |
| `--no-cache`, `--clear-cache` | ignore or delete the incremental cache |

Exit codes: `0` success, `1` runtime failure, `2` bad usage.

## How the money is computed

DeepSeek list prices as of 2026-11-11, dollars per million tokens:

| Model | Cache hit | Cache miss | Output |
|---|---|---|---|
| `deepseek-flash` peak | $0.006 | $0.30 | $1.20 |
| `deepseek-flash` off-peak | $0.003 | $0.15 | $0.60 |
| `deepseek-v4-pro` peak | $0.044 | $1.32 | $3.96 |
| `deepseek-v4-pro` off-peak | $0.022 | $0.66 | $1.98 |

Off-peak is half rate: Monday–Friday outside 01:00–04:00 and 06:00–10:00 UTC,
all weekend, and every Chinese public holiday. Each call is priced at its own
hour, so a session that crosses a tariff boundary is split correctly.

Cache hits are twenty times cheaper than misses on Flash, and the counter keeps
them separate rather than blending them into one prompt count. That is why two
days with the same token total can differ by an order of magnitude in pesos.

## What it cannot see

Stated plainly, because a spend report that overclaims is worse than no report:

- Session-title and compaction calls record no usage, so they are not counted.
- Search and Fetch are billed per request, not per token, and are excluded.
- Usage on the same API key outside DSH is invisible. With a key dedicated to
  DSH, the key line is that key's entire spend; with a shared key, it is DSH's
  share only.
- A session still being written is picked up on the next run.

The total is a floor, not an invoice.

## Design notes

- **Frames, not a stream.** Session logs are concatenated zstd frames, one per
  write. Node's decoder stops after the first frame, so the store is read frame
  by frame via its magic number. See `references/data-sources.md`.
- **Tokens cached, money computed.** The cache holds only token buckets keyed
  by UTC day, hour, and model — no prices, no timezone. Changing the rate,
  timezone, or holiday list re-prices instantly without rescanning.
- **Verified two ways.** Cached totals were compared with a direct parse across
  338 session files (exact match), and one day was recomputed with hand-written
  tariff logic ($4.257755898 either way).

## Layout

```
index.js                       skill provider registered on ctx.skills
client.js                      the Session-header readout (browser bundle)
host/spend-route.mjs           the read-only GET /accountant/spend route
cordis.patch.yml               inserts the provider row into the profile
skills/accountant/
  SKILL.md                     the skill body
  references/
    pricing.md                 tariffs, peak windows, holidays, aliases
    data-sources.md            log format, what is counted, the cache
    report-format.md           output shapes and forecast arithmetic
  scripts/accountant.mjs       CLI entry point
  scripts/lib/
    pricing.mjs                rate table, peak logic, USD→PHP
    session-store.mjs          zstd frame decoding, scanning, cache
    api-key.mjs                key fingerprint, timeline, per-key windows
    aggregate.mjs              day/week/month rollups and forecasts
    calendar.mjs               timezone-aware date arithmetic
    report.mjs                 text, Markdown, CSV, JSON
    config.mjs                 flags, config file, precedence
tests/                         node:test suite, including a client harness
locale/en.json                 plugin title and description
icon.svg                       plugin icon
```

## Development

```bash
npm test          # node --test tests/
```

## License

MIT. See [LICENSE](LICENSE).
