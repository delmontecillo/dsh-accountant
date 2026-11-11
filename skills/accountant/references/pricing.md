# Pricing

Where the numbers come from, and how to keep them honest when DeepSeek changes
its list prices.

## Tariffs

Prices are US dollars per 1,000,000 tokens, from the DeepSeek pricing page
(<https://api-docs.deepseek.com/quick_start/pricing>) read on 2026-11-11.

| Model | Version | Cache hit | Cache miss | Output |
|---|---|---|---|---|
| `deepseek-flash` | DeepSeek-V4.1-Flash-1017 | $0.006 | $0.30 | $1.20 |
| `deepseek-v4-pro` | DeepSeek-V4-Pro-0813 | $0.044 | $1.32 | $3.96 |

Those are peak prices. **Off-peak is exactly half**, on every model and every
column, so the code stores only peak and derives the rest.

## What counts as peak

- Days: Monday through Friday, UTC.
- Hours: 01:00–04:00 and 06:00–10:00 UTC.
- Every Chinese public holiday is off-peak for the whole day.
- Weekends are off-peak.

The tariff is chosen per recorded call from the timestamp on that call, not
from when the report runs. A session that spans 03:50–06:10 UTC is billed at
peak, then off-peak, then peak again, and this counter gets that right.

DeepSeek's peak windows are anchored to UTC and do not move with daylight
saving, because China has a single clock. Converting them to Manila time gives
09:00–12:00 and 14:00–18:00 PHT, which is a useful sanity check when a user
expects a morning session to be cheap.

## Holidays

The 2026 dates come from the State Council notice (Guo Ban Fa Ming Dian [2025]
No. 7):

| Holiday | Dates |
|---|---|
| New Year | 2026-01-01 → 2026-01-03 |
| Spring Festival | 2026-02-15 → 2026-02-23 |
| Qingming | 2026-04-04 → 2026-04-06 |
| Labor Day | 2026-05-01 → 2026-05-05 |
| Dragon Boat | 2026-06-19 → 2026-06-21 |
| Mid-Autumn | 2026-09-25 → 2026-09-27 |
| National Day | 2026-10-01 → 2026-10-07 |

The notice also designates some weekend days as working days (2026-02-14,
2026-02-28, 2026-05-09, 2026-09-20, 2026-10-10). Those are not treated as peak,
because DeepSeek bills by its own calendar and the conservative reading —
fewer peak hours — avoids overstating cost. Override with `holidays` in the
config file if that ever stops being true.

## Model aliases

DeepSeek retired several model names but still serves them, billed at Flash
prices. All of these resolve to `deepseek-flash`:

`deepseek-chat`, `deepseek-v4-flash`, `deepseek-v4-flash-vision-exp`,
`deepseek-reasoner`, `deepseek-v3`, `deepseek-v3.1`

An unknown model is priced at Flash rates and named in the report under
`! Unpriced model(s)`, so a silently wrong price is visible rather than hidden.

## The cost formula

```
usd = input       / 1e6 * cacheMiss
    + cacheWrite  / 1e6 * cacheMiss
    + cacheRead   / 1e6 * cacheHit
    + output      / 1e6 * outputRate
```

`cacheWrite` is charged at the miss rate because a cache write is a miss that
also populates the cache; DeepSeek's own usage payload currently reports zero
cache-write tokens, so this term is normally absent.

## Keeping it current

Prices change without notice. To update them, edit `PEAK_RATES` in
`scripts/lib/pricing.mjs`, bump `PRICING_AS_OF`, and adjust the table in
`SKILL.md` to match. To change them for one machine only, without touching the
plugin, put a `models` block in `<DSH_HOME>/accountant.config.json`; it is
merged over the built-in table, so a single model can be overridden alone.

A partial `models` entry is ignored unless it has all three of `cacheHit`,
`cacheMiss`, and `output` as finite numbers. That is deliberate: a half-applied
price table is worse than an obvious missing one.

## The peso rate

The default is ₱62.00 per dollar, observed 2026-11-11
([Manila Times](https://beta.manilatimes.net/2026/11/11/business/top-business/peso-rebounds-to-p621-level/2466761)).
It is a snapshot, not a live feed: this plugin never makes a network call. Pass
`--rate`, set `DSH_ACCOUNTANT_RATE`, or set `rate` in the config file, and quote
the rate you used alongside the peso figure.
