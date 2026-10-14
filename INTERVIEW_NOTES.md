# INTERVIEW NOTES — Price Alert Tool

## Architecture

```
alerts.js          CLI: reads args, reads files, calls lib modules, prints output
lib/csv.js         Pure parsing: CSV text → { headers, rows }
lib/validation.js  Pure validation: raw rows → typed records; raw rules → validated rules
lib/alerts.js      Pure domain logic: SMA, crossing detection, sorting, formatting
test/              Four test suites, one per concern — written BEFORE implementation
fixtures/          Sample CSV and rules for integration testing
```

**Why this separation?** Keeping I/O (file reads, process.argv) in `alerts.js` and pure calculations in `lib/alerts.js` means every mathematical function can be unit-tested with plain arrays — no temp files, no child processes needed.

---

## How CSV and JSON inputs are parsed and validated

**CSV** — `parseCsv(text)` in `lib/csv.js`:
1. Normalises line endings (CRLF → LF).
2. Splits by `\n`, trims each line, discards blank lines.
3. Parses the first line as column headers.
4. Parses remaining lines into `string[][]` arrays.
5. Handles double-quoted fields and escaped `""` quotes.

**Validation** — `validatePrices({ headers, rows })` in `lib/validation.js`:
- Checks headers exist and include all required columns (`date`, `instrument`, `close`).
- For each row: checks field count, date format (regex + calendar rollover trick), positive finite price, and uniqueness of `(instrument, date)` using a Set.

**Rules JSON** — `JSON.parse()` in `alerts.js`, then `validateRules(rules, instruments)`:
- Checks: non-null array, non-empty, unique IDs, valid type/direction, instrument in prices Set.
- Level rule: requires finite `level`.
- MA cross rule: requires positive integer `short` and `long` with `short < long` strictly.

---

## How dates are sorted

ISO 8601 `YYYY-MM-DD` strings sort correctly with standard string comparison because digits are in most-significant-first order. `groupAndSortPrices()` calls `Array.sort()` with `a.date.localeCompare(b.date)`. This is O(N log N) and requires no Date object conversion.

---

## Level crossing vs Moving-average crossing

| Aspect | Level rule | MA cross rule |
|--------|-----------|---------------|
| Input | One threshold number | Two window sizes |
| What's compared | Closing price vs fixed level | Two moving averages vs each other |
| First alert possible | Day 2 (need one previous close) | Day `long + 1` (need previous of long SMA) |
| Partial data | N/A | Rejected — full window required |

---

## How rolling SMAs are calculated

```js
function sma(closes, endIndex, window) {
  if (endIndex < window - 1) return null;   // incomplete window → undefined
  let sum = 0;
  for (let i = endIndex - window + 1; i <= endIndex; i++) sum += closes[i];
  return sum / window;
}
```

For a price array `[100, 110, 120, 130]` with window=2:
- `sma(arr, 0, 2)` → null (only 1 price available)
- `sma(arr, 1, 2)` → (100+110)/2 = 105
- `sma(arr, 2, 2)` → (110+120)/2 = 115
- `sma(arr, 3, 2)` → (120+130)/2 = 125

---

## Why a full window is necessary

A partial-window average (e.g. a "3-day SMA" computed from only 2 days) is mathematically different from the intended SMA. It would produce misleading crossings on the first few observations that don't reflect a real trend change. The specification explicitly requires complete windows only.

---

## Why previous AND current SMAs are both required

A crossing is a *change in relationship* — the short was on one side and is now on the other. Without the *previous* SMA value, you can only know the current position, not whether a crossing occurred. Using only the current SMA would re-fire on every day where the relationship holds, not just the day it changed.

---

## How rule evaluation is kept independent per instrument

`groupAndSortPrices()` creates a separate `Array` for each instrument key. `evaluateLevelRule()` and `evaluateMaCrossRule()` each receive exactly one instrument's array. No function reads across instruments. There is no global state.

---

## Time and Space Complexity

| Operation | Time | Space |
|-----------|------|-------|
| `parseCsv` | O(C) where C = characters in file | O(R) rows |
| `validatePrices` | O(R) where R = rows | O(R) for duplicate Set |
| `groupAndSortPrices` | O(N log N) per instrument | O(N) total |
| `sma(closes, i, w)` | O(w) per call | O(1) |
| `evaluateLevelRule` | O(N) for N prices | O(A) alerts |
| `evaluateMaCrossRule` | O(N × (short + long)) | O(A) alerts |
| `generateAlerts` | O(R × N) + O(A log A) sort | O(A) |
| **Total** | **O(N log N + R × N)** | **O(N)** |

For typical assessment input (hundreds of rows, small windows) this is instantaneous.

---

## Why tests should be written before implementation

1. **Forces clarity** — writing test cases forces you to specify exactly what each function should do before writing the code. Ambiguities surface as unanswerable test questions.
2. **Evaluator reads tests first** — the brief states this explicitly. Tests serve as executable documentation of intent.
3. **Prevents confirmation bias** — tests written after implementation unconsciously avoid the cases that would break the code you just wrote.
4. **Catches regressions** — when a fix in Phase 5 breaks something in Phase 3, the tests catch it immediately.

---

## Important Edge Cases

| Case | Behaviour |
|------|-----------|
| First observation | Never fires a level alert — no previous close exists |
| Price touches level exactly | Does not fire (crossing requires strict inequality on current price) |
| Price departs from exact level | **Does** fire (previous == level satisfies `prev <= level`) |
| Fewer than `long + 1` observations | No MA cross alert possible |
| Flat price series | No crossings — SMAs are always equal |
| Out-of-order CSV rows | Sorted chronologically before any computation |
| Duplicate `(instrument, date)` | Hard error — ambiguous which price to use |
| MA `short = 1` | `SMA_1(t) = close(t)` — valid and tested |
| String rule ID ordering | `'r10'` sorts before `'r9'` (lexicographic, not numeric) |

---

## Why Node.js built-in modules only

- **Zero installation** — the evaluator can run the tool from a clean download with just `node alerts.js`.
- **No version conflicts** — `node:test`, `node:fs`, `node:assert`, `node:child_process` are stable and version-locked to Node itself.
- **Transparency** — every import can be traced to the Node.js official documentation.

---

## Limitations and Design Trade-offs

| Decision | Alternative | Reason chosen |
|----------|------------|---------------|
| Fail-fast validation | Skip invalid rows | Brief requires no silent discarding |
| Four-space column separator | Tab character (`\t`) | Consistent rendering in any terminal |
| String locale compare for rule IDs | Numeric parse | Spec says "ascending" without defining numeric; Unicode code-point is deterministic |
| No partial CSV windows | Fill missing days | Would require assumptions about market calendar |
| `Number(closeStr) <= 0` rejects 0 | Allow 0 as valid | A zero stock price is economically meaningless and likely a data error |

---

## 6-Minute Presentation Outline

1. **(0:00–0:30) What it does** — reads a prices CSV and a rules JSON, prints every alert that fires, sorted.
2. **(0:30–1:30) Architecture** — three-layer design: CSV parser → validator → domain logic → CLI wrapper. Each layer is a pure function, easy to test.
3. **(1:30–2:30) Level rules** — show the crossing convention with the boundary example (1500→1510 fires; 1490→1500 does not).
4. **(2:30–3:30) MA cross rules** — show the SMA formula, explain why `long + 1` observations are needed, show Case 25 hand calculation.
5. **(3:30–4:30) Tests-first evidence** — show that tests were written before implementation, and that the test runner output shows 94/94 pass.
6. **(4:30–5:30) Edge cases handled** — out-of-order dates, duplicate records, boundary thresholds, instrument isolation.
7. **(5:30–6:00) Limitations and trade-offs** — mention fail-fast, lexicographic rule ID sort, zero-price rejection.

---

## Likely Viva Questions & Concise Answers

**Q: Why doesn't the first observation trigger a level alert?**
A: There is no "previous close" to compare against. A crossing requires two consecutive observations — the price before and after the crossing event.

**Q: What happens if the price exactly equals the configured level?**
A: Touching the level doesn't fire. The condition requires the current price to be *strictly* greater or *strictly* less than the level. However, if the *previous* price equals the level, the next bar can still trigger a crossing if it moves strictly past the level.

**Q: How many observations are needed before an MA cross alert can fire?**
A: At least `long + 1`. The long SMA first exists at index `long - 1`. For a crossing we need the *previous* long SMA, which first exists at index `long - 1 - 1`, evaluated at index `long`. So we need indices 0 through `long`, which is `long + 1` data points.

**Q: Why use `localeCompare` to sort dates?**
A: The ISO 8601 format `YYYY-MM-DD` is designed to be lexicographically sortable. `localeCompare` on two valid date strings in this format gives the correct chronological order without converting to Date objects.

**Q: How do you prevent one instrument's prices from affecting another's SMA?**
A: `groupAndSortPrices()` creates a separate array for each instrument. Every evaluation function receives exactly one instrument's array. There is no shared mutable state.

**Q: What is the time complexity of the MA cross evaluation?**
A: O(N × (short + long)) because for each of the N price points we compute up to two SMA calls each costing O(short) and O(long). For typical window sizes this is effectively O(N).

**Q: Why reject zero or negative prices?**
A: A zero stock price is economically invalid and almost certainly a data entry error. Accepting it silently could produce misleading alerts. The brief requires rejecting malformed rows and says closing prices must be valid numbers; zero and negatives fall outside the expected domain.

**Q: What happens if two rules fire on the same day?**
A: Both alerts are included. They are sorted by rule ID ascending (lexicographic string comparison) as the tiebreaker. For example, `r1` before `r2`, and `r10` before `r9`.

**Q: Why do you complete all validation before printing any output?**
A: The brief explicitly requires this. If validation happens interleaved with output, a late error would leave partial alert lines on stdout, which could mislead any downstream tool that reads stdout. All-or-nothing is safer and more predictable.

**Q: Could you handle out-of-order CSV rows without sorting?**
A: No. SMA and crossing detection depend on chronological order. An unsorted array would produce incorrect SMA windows and potentially fire alerts on the wrong days or miss them entirely. Sorting is mandatory.
