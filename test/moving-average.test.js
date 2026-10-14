/**
 * test/moving-average.test.js
 *
 * Test suite covering Cases 23–32 of the Price Alert Tool specification:
 *   Moving-average crossing (ma_cross) rule logic.
 *
 * SMA definition:
 *   SMA_N(t) = average of the last N closing prices up to and including index t.
 *   Defined only when t >= N-1 (a complete window of N observations exists).
 *   No partial windows.
 *
 * MA crossing conventions (from brief):
 *   "above": prevShort <= prevLong  AND  currShort >  currLong  → FIRES
 *   "below": prevShort >= prevLong  AND  currShort <  currLong  → FIRES
 *
 * Earliest crossing evaluation point:
 *   Since short < long, both SMA_short(t) and SMA_long(t) are first defined at
 *   t = long-1. A crossing needs prevLong, which is first defined at t = long-1,
 *   so the prev value of that is at t = long. Therefore, the first possible
 *   crossing evaluation is at index t = long  (the (long+1)-th observation).
 *
 * All test price series in this file are small and hand-calculable.
 * Expected SMA values are computed in comments for each test.
 */

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// ── Will fail with "Cannot find module" until Phase 3 is implemented. ──
const { evaluateMaCrossRule, generateAlerts } = require('../lib/alerts.js');

// ─────────────────────────────────────────────────────────────────────────────
// Helper: build a sorted price array for a single instrument.
// ─────────────────────────────────────────────────────────────────────────────
function prices(instrument, entries) {
  return entries
    .map(([date, close]) => ({ date, instrument, close }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

// ─────────────────────────────────────────────────────────────────────────────
// CASE 23 — SMA is undefined until a complete window exists
// ─────────────────────────────────────────────────────────────────────────────
describe('Case 23: SMA is undefined until a complete window exists', () => {
  it('produces no alert before the long window is complete', () => {
    /*
     * Rule: short=2, long=3, direction="above"
     * SMA_2 is first defined at index 1 (2nd observation).
     * SMA_3 is first defined at index 2 (3rd observation).
     *
     * Price series (5 observations, all ascending so SMAs never cross "above"):
     *   idx 0 → 2026-09-01: 100
     *   idx 1 → 2026-09-02: 110   SMA_2=105,  SMA_3=undefined
     *   idx 2 → 2026-09-03: 120   SMA_2=115,  SMA_3=110   ← both first defined
     *   idx 3 → 2026-09-04: 130   SMA_2=125,  SMA_3=120
     *   idx 4 → 2026-09-05: 140   SMA_2=135,  SMA_3=130
     *
     * SMA_2 is always > SMA_3 here (faster MA on rising series), but we need
     * BOTH prev AND curr defined. The first crossing evaluation is at idx=3.
     * No "above" crossing occurs because prevShort > prevLong already from idx=3.
     *
     * To test "no alert before window is complete", use a series where a
     * crossing would have fired at idx=1 or 2 IF partial windows were allowed,
     * but no alert fires because we require a full long window.
     */
    const rule = { id: 'r1', instrument: 'INFY', type: 'ma_cross', direction: 'above', short: 2, long: 3 };
    const series = prices('INFY', [
      ['2026-09-01', 100],
      ['2026-09-02', 200],  // Big jump - if partial SMA_2(idx=1)=150 > hypothetical SMA_3(undefined) this should NOT fire
      ['2026-09-03', 110],  // SMA_2=155, SMA_3=136.67 (both now defined, prev unavail for long)
    ]);
    // Only 3 points: SMA_long(t-1) requires t >= long = 3, so index 3 = 4th point.
    // With only 3 points we can never evaluate a crossing.
    const alerts = evaluateMaCrossRule(series, rule);
    assert.equal(alerts.length, 0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CASE 24 — No crossing before both current AND previous SMAs are defined
// ─────────────────────────────────────────────────────────────────────────────
describe('Case 24: no crossing before both current and previous SMAs are defined', () => {
  it('does not fire on the first day where SMA_long is defined (no previous SMA_long yet)', () => {
    /*
     * Rule: short=2, long=4, direction="above"
     *
     * Prices (4 observations):
     *   idx 0 → 2026-09-01: 100   SMA_2=undefined, SMA_4=undefined
     *   idx 1 → 2026-09-02: 110   SMA_2=105,       SMA_4=undefined
     *   idx 2 → 2026-09-03: 90    SMA_2=100,       SMA_4=undefined
     *   idx 3 → 2026-09-04: 200   SMA_2=145,       SMA_4=125     ← SMA_4 first defined here
     *
     * At idx=3, SMA_4 is defined for the first time, but SMA_4(idx=2) does not
     * exist. We cannot evaluate the crossing because prevLong is undefined.
     * → No alert can fire with only 4 observations.
     *
     * Manually: SMA_2(3)=145, SMA_4(3)=125. For crossing we need SMA_2(2) and SMA_4(2).
     * SMA_4(2) is undefined (only 3 observations for a window of 4).
     */
    const rule = { id: 'r1', instrument: 'INFY', type: 'ma_cross', direction: 'above', short: 2, long: 4 };
    const series = prices('INFY', [
      ['2026-09-01', 100],
      ['2026-09-02', 110],
      ['2026-09-03', 90],
      ['2026-09-04', 200],
    ]);

    const alerts = evaluateMaCrossRule(series, rule);
    assert.equal(alerts.length, 0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CASE 25 — Short average crosses ABOVE long average
// ─────────────────────────────────────────────────────────────────────────────
describe('Case 25: short average crosses above long average', () => {
  it('fires ma_cross above when short SMA crosses above long SMA', () => {
    /*
     * Rule: short=2, long=4, direction="above"
     *
     * Hand-calculated price series:
     *   idx 0 → 2026-09-01: 100
     *   idx 1 → 2026-09-02: 100
     *   idx 2 → 2026-09-03: 100
     *   idx 3 → 2026-09-04: 100   SMA_2=100, SMA_4=100  (both defined, first day to have prev)
     *   idx 4 → 2026-09-05: 200   SMA_2=150, SMA_4=125
     *
     * Crossing evaluation at idx=4:
     *   prevShort = SMA_2(idx=3) = (100+100)/2 = 100
     *   prevLong  = SMA_4(idx=3) = (100+100+100+100)/4 = 100
     *   currShort = SMA_2(idx=4) = (100+200)/2 = 150
     *   currLong  = SMA_4(idx=4) = (100+100+100+200)/4 = 125
     *
     * Above condition: prevShort(100) <= prevLong(100) ✓  AND  currShort(150) > currLong(125) ✓
     * → FIRES "ma_cross 2/4 above" on 2026-09-05 ✓
     */
    const rule = { id: 'r1', instrument: 'INFY', type: 'ma_cross', direction: 'above', short: 2, long: 4 };
    const series = prices('INFY', [
      ['2026-09-01', 100],
      ['2026-09-02', 100],
      ['2026-09-03', 100],
      ['2026-09-04', 100],
      ['2026-09-05', 200],
    ]);

    const alerts = evaluateMaCrossRule(series, rule);

    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].date,        '2026-09-05');
    assert.equal(alerts[0].ruleId,      'r1');
    assert.equal(alerts[0].instrument,  'INFY');
    assert.equal(alerts[0].description, 'ma_cross 2/4 above');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CASE 26 — Short average crosses BELOW long average
// ─────────────────────────────────────────────────────────────────────────────
describe('Case 26: short average crosses below long average', () => {
  it('fires ma_cross below when short SMA crosses below long SMA', () => {
    /*
     * Rule: short=2, long=4, direction="below"
     *
     * Hand-calculated price series:
     *   idx 0 → 2026-09-01: 200
     *   idx 1 → 2026-09-02: 200
     *   idx 2 → 2026-09-03: 200
     *   idx 3 → 2026-09-04: 200   SMA_2=200, SMA_4=200
     *   idx 4 → 2026-09-05: 100   SMA_2=150, SMA_4=175
     *
     * Crossing evaluation at idx=4:
     *   prevShort = SMA_2(idx=3) = 200
     *   prevLong  = SMA_4(idx=3) = 200
     *   currShort = SMA_2(idx=4) = (200+100)/2 = 150
     *   currLong  = SMA_4(idx=4) = (200+200+200+100)/4 = 175
     *
     * Below condition: prevShort(200) >= prevLong(200) ✓  AND  currShort(150) < currLong(175) ✓
     * → FIRES "ma_cross 2/4 below" on 2026-09-05 ✓
     */
    const rule = { id: 'r1', instrument: 'INFY', type: 'ma_cross', direction: 'below', short: 2, long: 4 };
    const series = prices('INFY', [
      ['2026-09-01', 200],
      ['2026-09-02', 200],
      ['2026-09-03', 200],
      ['2026-09-04', 200],
      ['2026-09-05', 100],
    ]);

    const alerts = evaluateMaCrossRule(series, rule);

    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].date,        '2026-09-05');
    assert.equal(alerts[0].ruleId,      'r1');
    assert.equal(alerts[0].instrument,  'INFY');
    assert.equal(alerts[0].description, 'ma_cross 2/4 below');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CASE 27 — No alert when averages do not cross
// ─────────────────────────────────────────────────────────────────────────────
describe('Case 27: no alert when averages do not cross', () => {
  it('fires no alert when the short SMA is consistently below the long SMA', () => {
    /*
     * Descending series: short MA reacts faster so it stays below long MA.
     * Rule: direction="above"  (watches for short to overtake long)
     *
     * Prices:
     *   idx 0: 200
     *   idx 1: 180
     *   idx 2: 160
     *   idx 3: 140   SMA_2=150,  SMA_4=170   short < long
     *   idx 4: 120   SMA_2=130,  SMA_4=150   short < long
     *
     * prevShort(150) <= prevLong(170) ✓, but currShort(130) > currLong(150)? NO.
     * → no "above" crossing.
     */
    const rule = { id: 'r1', instrument: 'INFY', type: 'ma_cross', direction: 'above', short: 2, long: 4 };
    const series = prices('INFY', [
      ['2026-09-01', 200],
      ['2026-09-02', 180],
      ['2026-09-03', 160],
      ['2026-09-04', 140],
      ['2026-09-05', 120],
    ]);

    const alerts = evaluateMaCrossRule(series, rule);
    assert.equal(alerts.length, 0);
  });

  it('fires no alert when the short SMA is consistently above the long SMA', () => {
    /*
     * Ascending series: short MA is always above long MA on an uptrend.
     * Rule: direction="below"  (watches for short to drop below long)
     *
     * prevShort >= prevLong is satisfied but currShort < currLong is never true
     * on a rising series where short reacts faster upward.
     */
    const rule = { id: 'r1', instrument: 'INFY', type: 'ma_cross', direction: 'below', short: 2, long: 4 };
    const series = prices('INFY', [
      ['2026-09-01', 100],
      ['2026-09-02', 120],
      ['2026-09-03', 140],
      ['2026-09-04', 160],
      ['2026-09-05', 180],
    ]);

    const alerts = evaluateMaCrossRule(series, rule);
    assert.equal(alerts.length, 0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CASE 28 — Out-of-order dates still produce correct moving averages
// ─────────────────────────────────────────────────────────────────────────────
describe('Case 28: out-of-order dates still produce correct moving averages', () => {
  it('produces the same alert regardless of input row order', () => {
    /*
     * Same 5-observation series as Case 25, but rows are shuffled in the input.
     * After chronological sorting, the SMA calculation must be identical.
     *
     * Shuffled input order: idx 4, idx 1, idx 3, idx 0, idx 2
     * After sort: [2026-09-01, 2026-09-02, 2026-09-03, 2026-09-04, 2026-09-05]
     * Expected alert: 2026-09-05 (same as Case 25)
     */
    const rule = { id: 'r1', instrument: 'INFY', type: 'ma_cross', direction: 'above', short: 2, long: 4 };

    // Intentionally shuffled — evaluateMaCrossRule must sort before computing SMAs
    const seriesShuffled = [
      { date: '2026-09-05', instrument: 'INFY', close: 200 },
      { date: '2026-09-02', instrument: 'INFY', close: 100 },
      { date: '2026-09-04', instrument: 'INFY', close: 100 },
      { date: '2026-09-01', instrument: 'INFY', close: 100 },
      { date: '2026-09-03', instrument: 'INFY', close: 100 },
    ];

    const alerts = evaluateMaCrossRule(seriesShuffled, rule);

    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].date,        '2026-09-05');
    assert.equal(alerts[0].description, 'ma_cross 2/4 above');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CASE 29 — Different instruments have separate MA histories
// ─────────────────────────────────────────────────────────────────────────────
describe('Case 29: different instruments have separate MA histories', () => {
  it('computes independent SMAs for INFY and TCS, never mixing them', () => {
    /*
     * INFY series (5 observations): triggers "above" on 2026-09-05 (same as Case 25)
     * TCS series (5 observations):  all flat at 3900, SMAs never cross
     *
     * Rule r1 watches INFY above 2/4 → should fire.
     * Rule r2 watches TCS above 2/4  → should NOT fire (flat series, no crossing).
     *
     * TCS SMAs at each step (all flat):
     *   SMA_2(3)=3900, SMA_4(3)=3900; SMA_2(4)=3900, SMA_4(4)=3900
     *   prevShort(3900) <= prevLong(3900) ✓, but currShort(3900) > currLong(3900)? NO (equal).
     *   → r2 does not fire.
     */
    const pricesByInstrument = {
      INFY: prices('INFY', [
        ['2026-09-01', 100],
        ['2026-09-02', 100],
        ['2026-09-03', 100],
        ['2026-09-04', 100],
        ['2026-09-05', 200],
      ]),
      TCS: prices('TCS', [
        ['2026-09-01', 3900],
        ['2026-09-02', 3900],
        ['2026-09-03', 3900],
        ['2026-09-04', 3900],
        ['2026-09-05', 3900],
      ]),
    };

    const rules = [
      { id: 'r1', instrument: 'INFY', type: 'ma_cross', direction: 'above', short: 2, long: 4 },
      { id: 'r2', instrument: 'TCS',  type: 'ma_cross', direction: 'above', short: 2, long: 4 },
    ];

    const alerts = generateAlerts(pricesByInstrument, rules);

    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].ruleId,     'r1');
    assert.equal(alerts[0].instrument, 'INFY');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CASE 30 — Window of 1 handled correctly
// ─────────────────────────────────────────────────────────────────────────────
describe('Case 30: short window of 1 handled correctly', () => {
  it('SMA_1(t) equals the closing price on that day', () => {
    /*
     * Rule: short=1, long=3, direction="above"
     *
     * SMA_1(t) = close(t)  (always equals the most recent close)
     * SMA_3 is defined at idx=2.
     *
     * Prices:
     *   idx 0 → 2026-09-01: 100   SMA_1=100, SMA_3=undefined
     *   idx 1 → 2026-09-02: 100   SMA_1=100, SMA_3=undefined
     *   idx 2 → 2026-09-03: 100   SMA_1=100, SMA_3=100         ← first time both defined
     *   idx 3 → 2026-09-04: 200   SMA_1=200, SMA_3=133.33      ← first crossing evaluation
     *
     * Crossing at idx=3:
     *   prevShort = SMA_1(2) = 100
     *   prevLong  = SMA_3(2) = (100+100+100)/3 = 100
     *   currShort = SMA_1(3) = 200
     *   currLong  = SMA_3(3) = (100+100+200)/3 = 133.33
     *
     * Above: prevShort(100) <= prevLong(100) ✓  AND  currShort(200) > currLong(133.33) ✓
     * → FIRES on 2026-09-04 ✓
     */
    const rule = { id: 'r1', instrument: 'INFY', type: 'ma_cross', direction: 'above', short: 1, long: 3 };
    const series = prices('INFY', [
      ['2026-09-01', 100],
      ['2026-09-02', 100],
      ['2026-09-03', 100],
      ['2026-09-04', 200],
    ]);

    const alerts = evaluateMaCrossRule(series, rule);

    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].date,        '2026-09-04');
    assert.equal(alerts[0].description, 'ma_cross 1/3 above');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CASE 31 — Multiple rules evaluated independently
// ─────────────────────────────────────────────────────────────────────────────
describe('Case 31: multiple MA rules on the same instrument are evaluated independently', () => {
  it('evaluates two MA rules with different windows separately', () => {
    /*
     * INFY prices: 5 observations, same as Case 25 (crosses above on day 5).
     *
     * r1: short=2, long=4, direction="above"
     *     Fires on 2026-09-05 (shown in Case 25).
     *
     * r2: short=2, long=4, direction="below"
     *     Same series. Crossing evaluation at idx=4:
     *     prevShort(100) >= prevLong(100) ✓, but currShort(150) < currLong(125)? NO.
     *     → r2 does NOT fire.
     *
     * Expected: only r1 fires.
     */
    const pricesByInstrument = {
      INFY: prices('INFY', [
        ['2026-09-01', 100],
        ['2026-09-02', 100],
        ['2026-09-03', 100],
        ['2026-09-04', 100],
        ['2026-09-05', 200],
      ]),
    };

    const rules = [
      { id: 'r1', instrument: 'INFY', type: 'ma_cross', direction: 'above', short: 2, long: 4 },
      { id: 'r2', instrument: 'INFY', type: 'ma_cross', direction: 'below', short: 2, long: 4 },
    ];

    const alerts = generateAlerts(pricesByInstrument, rules);

    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].ruleId, 'r1');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CASE 32 — A price series that never triggers any alert produces no output
// ─────────────────────────────────────────────────────────────────────────────
describe('Case 32: flat price series produces no alerts', () => {
  it('returns an empty alerts array for a perfectly flat price series', () => {
    /*
     * All prices identical = 1000. SMAs at any window are always 1000.
     *   prevShort == prevLong always (equal, not strictly crossing)
     *   currShort == currLong always
     *
     * "above": currShort > currLong → 1000 > 1000 is false → no fire
     * "below": currShort < currLong → 1000 < 1000 is false → no fire
     */
    const pricesByInstrument = {
      INFY: prices('INFY', [
        ['2026-09-01', 1000],
        ['2026-09-02', 1000],
        ['2026-09-03', 1000],
        ['2026-09-04', 1000],
        ['2026-09-05', 1000],
      ]),
    };

    const rules = [
      { id: 'r1', instrument: 'INFY', type: 'ma_cross', direction: 'above', short: 2, long: 4 },
      { id: 'r2', instrument: 'INFY', type: 'ma_cross', direction: 'below', short: 2, long: 4 },
    ];

    const alerts = generateAlerts(pricesByInstrument, rules);
    assert.equal(alerts.length, 0);
  });
});
