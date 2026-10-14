/**
 * lib/alerts.js
 *
 * Responsibility: Pure domain logic — moving averages, crossing detection,
 *                 alert generation, sorting, and output formatting.
 *
 * Exports:
 *   sma(closes, endIndex, window)             → number | null
 *   evaluateLevelRule(sortedPrices, rule)      → Alert[]
 *   evaluateMaCrossRule(prices, rule)          → Alert[]
 *   groupAndSortPrices(records)               → { [instrument]: PriceRecord[] }
 *   generateAlerts(pricesByInstrument, rules) → Alert[]
 *   formatAlert(alert)                        → string
 *
 * ─── Level crossing convention ──────────────────────────────────────────────
 *   "above": prev_close <= level  AND  curr_close >  level  → fires
 *   "below": prev_close >= level  AND  curr_close <  level  → fires
 *
 *   The first observation cannot fire any alert (no previous close exists).
 *   Touching the level without crossing does NOT fire (strict inequality on curr).
 *   When the previous close equals the level, the alert CAN fire on the next bar
 *   if the price then crosses strictly past the level.
 *
 * ─── Moving-average crossing convention ─────────────────────────────────────
 *   SMA_N(t) = arithmetic mean of the N most recent closing prices ending at t.
 *   Defined only when t >= N-1 (a complete window of N observations).
 *   No partial-window averages are calculated.
 *
 *   A crossing is only evaluated when ALL FOUR of the following are defined:
 *     SMA_short(t),  SMA_long(t),  SMA_short(t-1),  SMA_long(t-1)
 *
 *   Because short < long, SMA_long first exists at t = long-1.
 *   SMA_long(t-1) first exists at t-1 = long-1, i.e. t = long.
 *   Therefore, the earliest index at which a crossing can be evaluated is
 *   t = long, which requires at least long + 1 total observations.
 *
 *   "above": SMA_short(t-1) <= SMA_long(t-1)  AND  SMA_short(t) >  SMA_long(t)
 *   "below": SMA_short(t-1) >= SMA_long(t-1)  AND  SMA_short(t) <  SMA_long(t)
 *
 * ─── Output format ──────────────────────────────────────────────────────────
 *   Each alert is one line:
 *     date    ruleId    instrument    description
 *   Fields are separated by four spaces.
 *   Descriptions:
 *     Level rule:    "level below LEVEL"   or   "level above LEVEL"
 *     MA cross rule: "ma_cross SHORT/LONG above"  or  "ma_cross SHORT/LONG below"
 *
 * ─── Sorting ─────────────────────────────────────────────────────────────────
 *   All fired alerts are sorted:
 *     1. date ascending  (ISO string lexicographic order = chronological)
 *     2. ruleId ascending (Unicode code-point / lexicographic string order)
 *
 * ─── Isolation guarantee ─────────────────────────────────────────────────────
 *   groupAndSortPrices() produces a completely separate price array per
 *   instrument. No function in this module reads across instruments.
 */

'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// sma — Simple Moving Average
// ─────────────────────────────────────────────────────────────────────────────

/**
 * sma(closes, endIndex, window)
 *
 * Returns the simple moving average of `window` closing prices ending at
 * (and including) `closes[endIndex]`.
 *
 * Returns null when a complete window of N prices is not yet available,
 * i.e. when endIndex < window - 1.
 *
 * Complexity: O(N) time, O(1) space (no intermediate array).
 *
 * @param {number[]} closes   - chronologically sorted array of closing prices
 * @param {number}   endIndex - the index of the most recent price (inclusive)
 * @param {number}   window   - window size N (positive integer)
 * @returns {number|null}
 *
 * @example
 *   sma([100, 110, 120], 2, 2)  → (110 + 120) / 2 = 115
 *   sma([100, 110, 120], 1, 3)  → null  (only 2 prices available for window=3)
 */
function sma(closes, endIndex, window) {
  // Not enough data for a complete window
  if (endIndex < window - 1) return null;

  let sum = 0;
  for (let i = endIndex - window + 1; i <= endIndex; i++) {
    sum += closes[i];
  }
  return sum / window;
}

// ─────────────────────────────────────────────────────────────────────────────
// evaluateLevelRule
// ─────────────────────────────────────────────────────────────────────────────

/**
 * evaluateLevelRule(sortedPrices, rule)
 *
 * Evaluates a "level" alert rule against a chronologically sorted price array
 * for a single instrument.
 *
 * The crossing detection starts at index 1 (the second observation). Index 0
 * is the first available price and has no previous close, so no alert can fire.
 *
 * Crossing conventions (see module header for full explanation):
 *   "above": sortedPrices[i-1].close <= level  AND  sortedPrices[i].close >  level
 *   "below": sortedPrices[i-1].close >= level  AND  sortedPrices[i].close <  level
 *
 * @param {Array<{date:string, instrument:string, close:number}>} sortedPrices
 *   Price records for ONE instrument, sorted chronologically (ascending by date).
 * @param {{ id:string, instrument:string, type:'level', direction:string, level:number }} rule
 * @returns {Array<{date:string, ruleId:string, instrument:string, description:string}>}
 */
function evaluateLevelRule(sortedPrices, rule) {
  const alerts = [];
  const { level, direction, id: ruleId, instrument } = rule;

  for (let i = 1; i < sortedPrices.length; i++) {
    const prev = sortedPrices[i - 1].close;
    const curr = sortedPrices[i].close;

    let fires = false;
    if (direction === 'above') {
      // Crosses above: was at or below level, now strictly above
      fires = (prev <= level) && (curr > level);
    } else {
      // Crosses below: was at or above level, now strictly below
      fires = (prev >= level) && (curr < level);
    }

    if (fires) {
      alerts.push({
        date:        sortedPrices[i].date,
        ruleId,
        instrument,
        description: `level ${direction} ${level}`,
      });
    }
  }

  return alerts;
}

// ─────────────────────────────────────────────────────────────────────────────
// evaluateMaCrossRule
// ─────────────────────────────────────────────────────────────────────────────

/**
 * evaluateMaCrossRule(prices, rule)
 *
 * Evaluates an "ma_cross" alert rule against the price series for one instrument.
 *
 * The function defensively sorts `prices` by date before computing SMAs, so it
 * is safe to pass an unsorted array (e.g. CSV rows in their original order).
 * The source array is not mutated — a shallow copy is sorted internally.
 *
 * SMA window notes:
 *   - SMA_short(t)  is first defined at t = short - 1.
 *   - SMA_long(t)   is first defined at t = long  - 1.
 *   - SMA_long(t-1) is first defined at t = long.
 *   Therefore, crossing evaluation begins at index t = long (the (long+1)-th
 *   observation). Fewer observations → no alerts possible.
 *
 * @param {Array<{date:string, instrument:string, close:number}>} prices
 *   Price records for ONE instrument (may be unsorted).
 * @param {{ id:string, instrument:string, type:'ma_cross',
 *           direction:string, short:number, long:number }} rule
 * @returns {Array<{date:string, ruleId:string, instrument:string, description:string}>}
 */
function evaluateMaCrossRule(prices, rule) {
  const alerts = [];
  const { short, long, direction, id: ruleId, instrument } = rule;

  // Sort chronologically without mutating the original array
  const sorted = [...prices].sort((a, b) => a.date.localeCompare(b.date));
  const closes = sorted.map(p => p.close);

  for (let i = 1; i < sorted.length; i++) {
    // Compute all four required SMAs
    const currShort = sma(closes, i,     short);
    const currLong  = sma(closes, i,     long);
    const prevShort = sma(closes, i - 1, short);
    const prevLong  = sma(closes, i - 1, long);

    // ALL four must be defined (complete windows for both current and previous bar)
    if (currShort === null || currLong === null ||
        prevShort === null || prevLong === null) {
      continue;
    }

    let fires = false;
    if (direction === 'above') {
      // Short was at or below long, now strictly above
      fires = (prevShort <= prevLong) && (currShort > currLong);
    } else {
      // Short was at or above long, now strictly below
      fires = (prevShort >= prevLong) && (currShort < currLong);
    }

    if (fires) {
      alerts.push({
        date:        sorted[i].date,
        ruleId,
        instrument,
        description: `ma_cross ${short}/${long} ${direction}`,
      });
    }
  }

  return alerts;
}

// ─────────────────────────────────────────────────────────────────────────────
// groupAndSortPrices
// ─────────────────────────────────────────────────────────────────────────────

/**
 * groupAndSortPrices(records)
 *
 * Partitions validated price records by instrument and sorts each instrument's
 * array chronologically (ascending by date string, which is ISO YYYY-MM-DD so
 * lexicographic order equals chronological order).
 *
 * Returns a plain object whose keys are instrument names and whose values are
 * sorted price arrays. Each instrument's array is independent — no sharing.
 *
 * Time complexity: O(N log N) overall (dominated by sorting within each group).
 * Space complexity: O(N) — all records are referenced exactly once.
 *
 * @param {Array<{date:string, instrument:string, close:number}>} records
 * @returns {Object.<string, Array<{date:string, instrument:string, close:number}>>}
 */
function groupAndSortPrices(records) {
  const grouped = Object.create(null);  // no prototype to avoid key collisions

  for (const record of records) {
    if (!grouped[record.instrument]) {
      grouped[record.instrument] = [];
    }
    grouped[record.instrument].push(record);
  }

  // Sort each group chronologically
  for (const instrument of Object.keys(grouped)) {
    grouped[instrument].sort((a, b) => a.date.localeCompare(b.date));
  }

  return grouped;
}

// ─────────────────────────────────────────────────────────────────────────────
// generateAlerts
// ─────────────────────────────────────────────────────────────────────────────

/**
 * generateAlerts(pricesByInstrument, rules)
 *
 * Evaluates every rule against its instrument's price history, collects all
 * fired alerts, and returns them sorted by date ascending then ruleId ascending.
 *
 * Each rule is evaluated independently:
 *   - A "level" rule uses evaluateLevelRule().
 *   - An "ma_cross" rule uses evaluateMaCrossRule().
 *   - Rules for different instruments never share a price array.
 *
 * If a rule's instrument is not present in pricesByInstrument (which should
 * not happen after validation), that rule is silently skipped.
 *
 * Sorting:
 *   Primary key:   date ascending  (ISO lexicographic = chronological)
 *   Secondary key: ruleId ascending (Unicode code-point string comparison)
 *   Example: 'r10' sorts before 'r9' because '1' < '9' in Unicode.
 *
 * @param {Object.<string, Array>} pricesByInstrument - output of groupAndSortPrices()
 * @param {Array}                  rules              - validated rules array
 * @returns {Array<{date:string, ruleId:string, instrument:string, description:string}>}
 */
function generateAlerts(pricesByInstrument, rules) {
  const allAlerts = [];

  for (const rule of rules) {
    const prices = pricesByInstrument[rule.instrument];
    if (!prices) continue;  // guard — should be caught by validateRules

    let ruleAlerts;
    if (rule.type === 'level') {
      ruleAlerts = evaluateLevelRule(prices, rule);
    } else if (rule.type === 'ma_cross') {
      ruleAlerts = evaluateMaCrossRule(prices, rule);
    } else {
      continue; // unknown type — guard, should be caught by validateRules
    }

    allAlerts.push(...ruleAlerts);
  }

  // Sort: date ascending, then ruleId ascending (both use localeCompare)
  allAlerts.sort((a, b) => {
    const dateCmp = a.date.localeCompare(b.date);
    if (dateCmp !== 0) return dateCmp;
    return a.ruleId.localeCompare(b.ruleId);
  });

  return allAlerts;
}

// ─────────────────────────────────────────────────────────────────────────────
// formatAlert
// ─────────────────────────────────────────────────────────────────────────────

/**
 * formatAlert(alert)
 *
 * Formats a single fired alert as a fixed output line.
 *
 * Format (fields separated by four spaces):
 *   date    ruleId    instrument    description
 *
 * Examples:
 *   "2026-09-03    r1    INFY    level below 1500"
 *   "2026-09-24    r2    TCS    ma_cross 5/20 above"
 *
 * @param {{ date:string, ruleId:string, instrument:string, description:string }} alert
 * @returns {string}
 */
function formatAlert(alert) {
  return `${alert.date}    ${alert.ruleId}    ${alert.instrument}    ${alert.description}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────
module.exports = {
  sma,
  evaluateLevelRule,
  evaluateMaCrossRule,
  groupAndSortPrices,
  generateAlerts,
  formatAlert,
};
