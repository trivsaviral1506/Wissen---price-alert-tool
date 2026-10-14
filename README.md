# Price Alert Tool

A command-line tool that reads daily closing prices and alert rules, then prints all alerts that fired, sorted by date and rule ID.

## Prerequisites

- **Node.js v20 or later** (uses built-in `node:test`, `node:fs`, `node:assert`)
- No `npm install` required — zero third-party dependencies

## Installation

```bash
git clone <repo-url>
cd price-alert-tool
```

## Running the tool

```bash
node alerts.js prices.csv rules.json
```

- **stdout** — one alert line per firing rule, sorted by date then rule ID
- **stderr** — error messages for bad inputs; stdout stays empty on errors
- **Exit 0** — success (no alerts fired = empty stdout, still exit 0)
- **Exit 1** — any validation or filesystem error

## Running tests

```bash
node --test
```

All 94 tests use Node.js built-in `node:test` and `node:assert` — no framework needed.

## Input formats

### prices.csv — columns: `date,instrument,close`

```csv
date,instrument,close
2026-09-01,INFY,1520.50
2026-09-02,TCS,3902.25
```

- Date format: `YYYY-MM-DD` exactly; calendar-invalid dates are rejected
- Close price: positive finite number; NaN, Infinity, 0, and negatives are rejected
- Rows may be out of order; the tool sorts chronologically per instrument
- Duplicate `(instrument, date)` pairs are an error

### rules.json — JSON array of rule objects

**Level rule** — fires when price crosses a fixed threshold:

```json
{ "id": "r1", "instrument": "INFY", "type": "level", "direction": "below", "level": 1500 }
```

**MA cross rule** — fires when the short simple moving average crosses the long SMA:

```json
{ "id": "r2", "instrument": "TCS", "type": "ma_cross", "direction": "above", "short": 5, "long": 20 }
```

## Crossing conventions

### Level rules
| Direction | Condition (fires when…) |
|-----------|------------------------|
| `above`   | `prev_close <= level` **AND** `curr_close > level` |
| `below`   | `prev_close >= level` **AND** `curr_close < level` |

- First observation cannot fire (no previous close exists).
- Touching the level without crossing does **not** fire.
- Departing from the exact level value **does** fire.

### MA cross rules — SMA_N(t) = mean of last N closing prices up to day t
| Direction | Condition (fires when…) |
|-----------|------------------------|
| `above`   | `SMA_short(t-1) <= SMA_long(t-1)` **AND** `SMA_short(t) > SMA_long(t)` |
| `below`   | `SMA_short(t-1) >= SMA_long(t-1)` **AND** `SMA_short(t) < SMA_long(t)` |

- **No partial windows** — SMA_N is undefined until N observations exist.
- Both current **and** previous SMA pairs must be defined before any crossing is evaluated; this requires at least `long + 1` total observations.
- `short` must be a positive integer strictly less than `long`.

## Output format

```
date    ruleId    instrument    description
```

Fields separated by four spaces. Descriptions: `level below 1500` or `ma_cross 5/20 above`.

## Error behaviour

All validation completes before any output is written. A bad input file never produces partial stdout output. Error messages go to stderr with exit code 1.

## How I used AI assistance

I used Antigravity (Google DeepMind's AI coding assistant) to scaffold this project under my direction. I provided the complete specification as a prompt, reviewed every generated file, and verified all outputs manually.

**What the assistant did:** Generated the full test suite before implementation (tests-first), implemented all modules, wrote documentation.

**What I reviewed and confirmed:** The crossing conventions match the brief exactly; boundary cases (touching-not-crossing, departing from level, short=1 windows) were hand-verified with manual calculations shown in test comments.

**Observed issue and correction:** Initial fixture data was designed to trigger only level alerts. I confirmed the fixture produces the expected three alerts through manual arithmetic before accepting the output.

See `DEV_NOTES.md` for the full development log.
