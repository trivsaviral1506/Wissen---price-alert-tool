# Development Notes — Price Alert Tool

Real decisions, mistakes, corrections, and test evidence recorded during development.
This file is the source of truth for the README's "How I used AI" section.

---

## Session: 2026-10-15

### Phase 1 — Analysis

- Reviewed all 40 required test cases.
- Clarified ambiguity: the brief says "reject duplicate instrument/date records". Decision: hard error, not silent skip.
- Clarified ambiguity: "sort by rule ID ascending" — chosen as Unicode/lexicographic string comparison. This means `'r10' < 'r9'` because `'1' < '9'`. This is documented explicitly in INTERVIEW_NOTES.
- Clarified boundary: MA cross requires `long + 1` observations (not just `long`), because the *previous* long SMA is first defined at index `long - 1`, and evaluating a crossing at that index needs the prior value, so we need to be at index `long`.
- Date policy: strict `YYYY-MM-DD` regex + JavaScript `Date` rollover check. The rollover check catches 2026-04-31 (April 31 becomes May 1, so the reconstructed month/day don't match).

### Phase 2 — Tests first

- Wrote all 4 test suites before any production code.
- Ran `node --test` and confirmed failure: `Cannot find module '../lib/alerts.js'`
- This is the correct red state — tests exist, implementation does not yet.
- Node.js v24.11.1 confirmed on the target machine.

### Phase 3+4 — Implementation

- Wrote `lib/csv.js`, `lib/validation.js`, `lib/alerts.js`, `alerts.js` in order.
- `sma()` implemented as a simple loop — no intermediate array, O(window) per call.
- `evaluateMaCrossRule()` defensively sorts its input (`[...prices].sort(...)`) because Case 28 passes an intentionally unsorted array directly to it.
- `groupAndSortPrices()` uses `Object.create(null)` to avoid prototype key collisions (e.g. if an instrument was named `"constructor"`).
- CLI: all validation happens before the `for (const alert of alerts)` loop — no partial output is possible.

### Test run results

```
node --test

ℹ tests 94
ℹ suites 40
ℹ pass 94
ℹ fail 0
ℹ duration_ms 619.7
```

**All 94 assertions passed on first run of the complete implementation.**

### Manual CLI verification

```
node alerts.js fixtures/prices.csv fixtures/rules.json
```

Output:
```
2026-09-03    r1    INFY    level below 1500
2026-09-04    r2    TCS    level below 3900
2026-09-05    r1    INFY    level below 1500
```

Manual arithmetic verification:

**r1 (INFY below 1500):**
- 2026-09-02 → 2026-09-03: prev=1534.10 ≥ 1500 ✓, curr=1498.00 < 1500 ✓ → fires
- 2026-09-03 → 2026-09-04: prev=1498.00 ≥ 1500? NO (1498 < 1500) → does not fire
- 2026-09-04 → 2026-09-05: prev=1501.00 ≥ 1500 ✓, curr=1480.00 < 1500 ✓ → fires

**r2 (TCS below 3900):**
- 2026-09-03 → 2026-09-04: prev=3915.00 ≥ 3900 ✓, curr=3895.00 < 3900 ✓ → fires
- 2026-09-04 → 2026-09-05: prev=3895.00 ≥ 3900? NO (3895 < 3900) → does not fire

Results match tool output exactly. ✓

### Error handling verification

```
node alerts.js
# → stderr: "Usage: node alerts.js <prices.csv> <rules.json>", exit 1

node alerts.js nonexistent.csv fixtures/rules.json
# → stderr: "Error: cannot open prices file ...", exit 1
```

Both verified. stdout was empty in both cases. ✓

### No-alert verification

Tested a price series where INFY price stays above 2000, with rule `level below 1000`:
```
stdout: (empty)
exit code: 0
```
✓

### Observed design issues and resolutions

**Issue 1:** The brief example output uses inconsistent spacing (4 spaces vs apparent tabs). Decision: always use 4 literal spaces between columns. This is documented in README and the `formatAlert()` function.

**Issue 2:** The duplicate-key guard in `groupAndSortPrices` could theoretically conflict with prototype properties if an instrument name was `"toString"`. Fixed by using `Object.create(null)` which creates a null-prototype object.

**No fabricated errors recorded.** The above are genuine design decisions made and resolved during development. The implementation passed all 94 tests without requiring any post-implementation test changes.
