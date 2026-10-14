/**
 * test/level-alerts.test.js
 *
 * Test suite covering Cases 16–22 of the Price Alert Tool specification:
 *   Level-crossing rule logic.
 *
 * Crossing conventions (documented in README and reproduced here for clarity):
 *   "above": prev_close <= level  AND  curr_close >  level  → FIRES
 *   "below": prev_close >= level  AND  curr_close <  level  → FIRES
 *
 * No alert fires on the first observation (no previous close exists).
 * Touching the level without crossing does NOT fire.
 *
 * All test cases use hand-constructed price arrays with known expected outcomes.
 * Expected outcomes are calculated independently and documented in comments.
 */

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// ── Will fail with "Cannot find module" until Phase 3 is implemented. ──
const { evaluateLevelRule, generateAlerts } = require('../lib/alerts.js');

// ─────────────────────────────────────────────────────────────────────────────
// Helper: build a sorted price array for a single instrument.
// Each entry: { date: string, instrument: string, close: number }
// ─────────────────────────────────────────────────────────────────────────────
function prices(instrument, entries) {
  return entries.map(([date, close]) => ({ date, instrument, close }))
    .sort((a, b) => a.date.localeCompare(b.date));  // chronological
}

// ─────────────────────────────────────────────────────────────────────────────
// CASE 16 — Crossing BELOW the configured level
// ─────────────────────────────────────────────────────────────────────────────
describe('Case 16: level crossing below configured level', () => {
  it('fires "level below 1500" when price drops below the threshold', () => {
    /*
     * Price series for INFY (chronological):
     *   2026-09-01: 1520.50  →  first observation, no alert possible
     *   2026-09-02: 1534.10  →  prev=1520.50 >= 1500, curr=1534.10 >= 1500 → NO (not below)
     *   2026-09-03: 1498.00  →  prev=1534.10 >= 1500, curr=1498.00 < 1500  → FIRES ✓
     *
     * Rule: direction="below", level=1500
     */
    const rule = { id: 'r1', instrument: 'INFY', type: 'level', direction: 'below', level: 1500 };
    const series = prices('INFY', [
      ['2026-09-01', 1520.50],
      ['2026-09-02', 1534.10],
      ['2026-09-03', 1498.00],
    ]);

    const alerts = evaluateLevelRule(series, rule);

    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].date,        '2026-09-03');
    assert.equal(alerts[0].ruleId,      'r1');
    assert.equal(alerts[0].instrument,  'INFY');
    assert.equal(alerts[0].description, 'level below 1500');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CASE 17 — Crossing ABOVE the configured level
// ─────────────────────────────────────────────────────────────────────────────
describe('Case 17: level crossing above configured level', () => {
  it('fires "level above 1500" when price rises above the threshold', () => {
    /*
     * Price series for INFY:
     *   2026-09-01: 1480.00  →  first observation, no alert
     *   2026-09-02: 1495.00  →  prev=1480 <= 1500, curr=1495 <= 1500 → NO
     *   2026-09-03: 1510.00  →  prev=1495 <= 1500, curr=1510 > 1500  → FIRES ✓
     *
     * Rule: direction="above", level=1500
     */
    const rule = { id: 'r2', instrument: 'INFY', type: 'level', direction: 'above', level: 1500 };
    const series = prices('INFY', [
      ['2026-09-01', 1480.00],
      ['2026-09-02', 1495.00],
      ['2026-09-03', 1510.00],
    ]);

    const alerts = evaluateLevelRule(series, rule);

    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].date,        '2026-09-03');
    assert.equal(alerts[0].ruleId,      'r2');
    assert.equal(alerts[0].instrument,  'INFY');
    assert.equal(alerts[0].description, 'level above 1500');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CASE 18 — No alert when price stays on the same side
// ─────────────────────────────────────────────────────────────────────────────
describe('Case 18: no alert when price remains on same side of level', () => {
  it('fires no alert when price stays consistently above the level', () => {
    /*
     * All prices > 1500 — never crosses from below to above.
     *   Rule direction="above", level=1500
     *   prev=1510 <= 1500 is never true, so no crossing fires.
     */
    const rule = { id: 'r1', instrument: 'INFY', type: 'level', direction: 'above', level: 1500 };
    const series = prices('INFY', [
      ['2026-09-01', 1510.00],
      ['2026-09-02', 1520.00],
      ['2026-09-03', 1515.00],
    ]);

    const alerts = evaluateLevelRule(series, rule);
    assert.equal(alerts.length, 0);
  });

  it('fires no alert when price stays consistently below the level', () => {
    /*
     * All prices < 1500 — never crosses from above to below.
     *   Rule direction="below", level=1500
     *   prev >= 1500 is never true, so no crossing fires.
     */
    const rule = { id: 'r1', instrument: 'INFY', type: 'level', direction: 'below', level: 1500 };
    const series = prices('INFY', [
      ['2026-09-01', 1480.00],
      ['2026-09-02', 1490.00],
      ['2026-09-03', 1470.00],
    ]);

    const alerts = evaluateLevelRule(series, rule);
    assert.equal(alerts.length, 0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CASE 19 — No alert when the first observation is already beyond the level
// ─────────────────────────────────────────────────────────────────────────────
describe('Case 19: no alert when first observation is already beyond the level', () => {
  it('does not fire when the very first price is already below the level (no previous close)', () => {
    /*
     * Only one observation at 1490, which is below 1500.
     * There is no previous observation so the crossing convention cannot be
     * evaluated — no alert fires.
     *
     * Rule: direction="below", level=1500
     */
    const rule = { id: 'r1', instrument: 'INFY', type: 'level', direction: 'below', level: 1500 };
    const series = prices('INFY', [
      ['2026-09-01', 1490.00],
    ]);

    const alerts = evaluateLevelRule(series, rule);
    assert.equal(alerts.length, 0);
  });

  it('does not fire when the very first price is already above the level', () => {
    /*
     * Only one observation at 1510, which is above 1500.
     * Rule: direction="above", level=1500
     */
    const rule = { id: 'r1', instrument: 'INFY', type: 'level', direction: 'above', level: 1500 };
    const series = prices('INFY', [
      ['2026-09-01', 1510.00],
    ]);

    const alerts = evaluateLevelRule(series, rule);
    assert.equal(alerts.length, 0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CASE 20 — Exact boundary / threshold behavior
//
// Convention (from brief, reproduced):
//   above: prev <= level AND curr > level  (strict >)
//   below: prev >= level AND curr < level  (strict <)
//
// Boundary cases:
//   A) 1490 → 1500:  curr == level → NOT above 1500  (does not fire "above")
//   B) 1500 → 1510:  prev == level → prev <= level satisfied, curr > level → FIRES "above"
//   C) 1510 → 1500:  curr == level → NOT below 1500  (does not fire "below")
//   D) 1500 → 1490:  prev == level → prev >= level satisfied, curr < level → FIRES "below"
// ─────────────────────────────────────────────────────────────────────────────
describe('Case 20: exact threshold boundary behavior', () => {
  it('A) touching level from below (1490→1500) does NOT fire "above"', () => {
    const rule = { id: 'r1', instrument: 'INFY', type: 'level', direction: 'above', level: 1500 };
    const series = prices('INFY', [
      ['2026-09-01', 1490.00],
      ['2026-09-02', 1500.00], // curr == level, NOT > level → no alert
    ]);

    const alerts = evaluateLevelRule(series, rule);
    assert.equal(alerts.length, 0);
  });

  it('B) leaving level upward (1500→1510) FIRES "above" (prev equals level)', () => {
    /*
     * prev=1500 <= 1500 ✓  AND  curr=1510 > 1500 ✓  → FIRES
     */
    const rule = { id: 'r1', instrument: 'INFY', type: 'level', direction: 'above', level: 1500 };
    const series = prices('INFY', [
      ['2026-09-01', 1500.00], // prev == level
      ['2026-09-02', 1510.00], // curr > level → FIRES
    ]);

    const alerts = evaluateLevelRule(series, rule);
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].date, '2026-09-02');
    assert.equal(alerts[0].description, 'level above 1500');
  });

  it('C) touching level from above (1510→1500) does NOT fire "below"', () => {
    const rule = { id: 'r1', instrument: 'INFY', type: 'level', direction: 'below', level: 1500 };
    const series = prices('INFY', [
      ['2026-09-01', 1510.00],
      ['2026-09-02', 1500.00], // curr == level, NOT < level → no alert
    ]);

    const alerts = evaluateLevelRule(series, rule);
    assert.equal(alerts.length, 0);
  });

  it('D) leaving level downward (1500→1490) FIRES "below" (prev equals level)', () => {
    /*
     * prev=1500 >= 1500 ✓  AND  curr=1490 < 1500 ✓  → FIRES
     */
    const rule = { id: 'r1', instrument: 'INFY', type: 'level', direction: 'below', level: 1500 };
    const series = prices('INFY', [
      ['2026-09-01', 1500.00], // prev == level
      ['2026-09-02', 1490.00], // curr < level → FIRES
    ]);

    const alerts = evaluateLevelRule(series, rule);
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].date, '2026-09-02');
    assert.equal(alerts[0].description, 'level below 1500');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CASE 21 — Multiple alerts from different rules on the same day
// ─────────────────────────────────────────────────────────────────────────────
describe('Case 21: multiple alerts from different rules on the same day', () => {
  it('fires both rules when two rules trigger on the same date', () => {
    /*
     * Price series for INFY (same instrument, two separate rules):
     *   2026-09-01: 1520.00  →  first day, no alert
     *   2026-09-02: 1498.00  →  crosses below 1500 (r1) AND is below 1510 (r3)
     *
     * r1: direction="below", level=1500  → prev=1520>=1500, curr=1498<1500 → FIRES
     * r3: direction="below", level=1510  → prev=1520>=1510, curr=1498<1510 → FIRES
     */
    const pricesByInstrument = {
      INFY: prices('INFY', [
        ['2026-09-01', 1520.00],
        ['2026-09-02', 1498.00],
      ])
    };

    const rules = [
      { id: 'r1', instrument: 'INFY', type: 'level', direction: 'below', level: 1500 },
      { id: 'r3', instrument: 'INFY', type: 'level', direction: 'below', level: 1510 },
    ];

    const alerts = generateAlerts(pricesByInstrument, rules);

    assert.equal(alerts.length, 2);

    // Both should be on 2026-09-02
    assert.ok(alerts.every(a => a.date === '2026-09-02'));

    // Verify both rule IDs are present
    const ids = alerts.map(a => a.ruleId).sort();
    assert.deepEqual(ids, ['r1', 'r3']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CASE 22 — Rules for different instruments remain independent
// ─────────────────────────────────────────────────────────────────────────────
describe('Case 22: rules for different instruments are independent', () => {
  it('INFY price movement does not trigger TCS rule', () => {
    /*
     * INFY crosses below 1500 on 2026-09-03.
     * TCS rule also watches for a crossing below 3900, but TCS price stays above.
     * → Only r1 (INFY) fires; r2 (TCS) does not.
     */
    const pricesByInstrument = {
      INFY: prices('INFY', [
        ['2026-09-01', 1520.50],
        ['2026-09-02', 1534.10],
        ['2026-09-03', 1498.00],
      ]),
      TCS: prices('TCS', [
        ['2026-09-01', 3890.00],
        ['2026-09-02', 3902.25],
        ['2026-09-03', 3915.00], // stays above 3900, no crossing
      ]),
    };

    const rules = [
      { id: 'r1', instrument: 'INFY', type: 'level', direction: 'below', level: 1500 },
      { id: 'r2', instrument: 'TCS',  type: 'level', direction: 'below', level: 3900 },
    ];

    const alerts = generateAlerts(pricesByInstrument, rules);

    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].ruleId,     'r1');
    assert.equal(alerts[0].instrument, 'INFY');
    assert.equal(alerts[0].date,       '2026-09-03');
  });

  it('fires TCS rule independently when TCS crosses below 3900', () => {
    const pricesByInstrument = {
      INFY: prices('INFY', [
        ['2026-09-01', 1480.00],
        ['2026-09-02', 1470.00],  // stays below 1500, but that's INFY's rule
      ]),
      TCS: prices('TCS', [
        ['2026-09-01', 3910.00],
        ['2026-09-02', 3880.00],  // crosses below 3900 → r2 fires
      ]),
    };

    const rules = [
      { id: 'r1', instrument: 'INFY', type: 'level', direction: 'below', level: 1500 },
      { id: 'r2', instrument: 'TCS',  type: 'level', direction: 'below', level: 3900 },
    ];

    const alerts = generateAlerts(pricesByInstrument, rules);

    // r1 (INFY): prev=1480 >= 1500? NO (1480 < 1500) → does not fire
    // r2 (TCS):  prev=3910 >= 3900 ✓ AND curr=3880 < 3900 ✓ → FIRES
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].ruleId,     'r2');
    assert.equal(alerts[0].instrument, 'TCS');
  });
});
