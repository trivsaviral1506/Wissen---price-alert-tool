/**
 * lib/validation.js
 *
 * Responsibility: Semantic validation of parsed CSV records and rule objects.
 *
 * Exports:
 *   validatePrices(parsed)                    → PriceRecord[]
 *   validateRules(rules, availableInstruments) → Rule[]
 *
 * ─── Date policy ────────────────────────────────────────────────────────────
 * Accepted format: YYYY-MM-DD (exactly 10 characters, two hyphens).
 * Single-digit months/days (e.g. 2026-9-1) are rejected.
 * Calendar validity is enforced: 2026-02-29 and 2026-04-31 are rejected.
 * The validation uses JavaScript's Date rollover property: if Date(y, m-1, d)
 * rolls into a different month or day, the original date was invalid.
 *
 * ─── Price policy ────────────────────────────────────────────────────────────
 * Closing price must be a positive finite number (> 0).
 * NaN, Infinity, -Infinity, 0, and negative values are all rejected.
 *
 * ─── Duplicate policy ────────────────────────────────────────────────────────
 * The brief specifies exactly one closing price per instrument per trading day.
 * Duplicate (instrument, date) pairs are an error, not a merge operation.
 *
 * ─── Rule validation ─────────────────────────────────────────────────────────
 * Rules must be a non-empty JSON array.
 * Each rule must have: id (non-empty string), instrument, type, direction.
 * Rule IDs must be unique across the array.
 * Level rules additionally require: level (finite number).
 * MA cross rules additionally require: short, long (positive integers, short < long strictly).
 */

'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────
const REQUIRED_HEADERS  = ['date', 'instrument', 'close'];
const VALID_RULE_TYPES  = new Set(['level', 'ma_cross']);
const VALID_DIRECTIONS  = new Set(['above', 'below']);

// Matches exactly YYYY-MM-DD (four digits, dash, two digits, dash, two digits)
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

// ─────────────────────────────────────────────────────────────────────────────
// Private helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * isValidCalendarDate(str)
 *
 * Returns true iff str is a syntactically and calendrically valid date in the
 * YYYY-MM-DD format.
 *
 * Steps:
 *   1. Regex check — enforces exactly YYYY-MM-DD with two-digit month/day.
 *   2. Parse year, month, day as integers.
 *   3. Range pre-check: month 1–12, day 1–31 (catches obvious impossibilities).
 *   4. Date rollover check: new Date(y, m-1, d) rolls invalid dates forward
 *      (e.g. April 31 becomes May 1). We confirm the constructed date's
 *      year/month/day match the input to catch calendar-invalid dates.
 *
 * @param {string} str
 * @returns {boolean}
 */
function isValidCalendarDate(str) {
  if (!DATE_REGEX.test(str)) return false;

  const [y, m, d] = str.split('-').map(Number);

  // Fast pre-check (Date object accepts month=0/day=0 as roll-under)
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;

  // Rollover check
  const dt = new Date(y, m - 1, d);  // month is 0-indexed in JS Date
  return (
    dt.getFullYear() === y &&
    dt.getMonth()    === m - 1 &&
    dt.getDate()     === d
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// validatePrices
// ─────────────────────────────────────────────────────────────────────────────

/**
 * validatePrices({ headers, rows })
 *
 * Validates a parsed CSV structure produced by parseCsv() and returns an array
 * of clean, type-coerced price records.
 *
 * Validation order (fails fast on first error):
 *   1. CSV is not empty (has at least headers).
 *   2. All required columns (date, instrument, close) are present.
 *   3. At least one data row exists.
 *   4. Each row has exactly the expected number of fields.
 *   5. date is a valid YYYY-MM-DD calendar date.
 *   6. instrument is a non-empty string.
 *   7. close is a positive finite number.
 *   8. (instrument, date) pair has not been seen before.
 *
 * @param {{ headers: string[], rows: string[][] }} parsed - output of parseCsv()
 * @returns {Array<{ date: string, instrument: string, close: number }>}
 * @throws {Error} with a descriptive message on any validation failure
 */
function validatePrices({ headers, rows }) {
  // ── 1. Empty file check ──────────────────────────────────────────────────
  if (headers.length === 0) {
    throw new Error(
      'CSV is empty: no headers found. ' +
      'The first line must be: date,instrument,close'
    );
  }

  // ── 2. Required column check ─────────────────────────────────────────────
  for (const col of REQUIRED_HEADERS) {
    if (!headers.includes(col)) {
      throw new Error(
        `Missing required column: "${col}". ` +
        `CSV headers must include all of: ${REQUIRED_HEADERS.join(', ')}`
      );
    }
  }

  // ── 3. No data rows ──────────────────────────────────────────────────────
  if (rows.length === 0) {
    throw new Error(
      'CSV contains no price records (header-only file). ' +
      'At least one data row is required.'
    );
  }

  // Pre-compute column indices (supports any column order)
  const dateIdx  = headers.indexOf('date');
  const instrIdx = headers.indexOf('instrument');
  const closeIdx = headers.indexOf('close');
  const expectedFieldCount = headers.length;

  const seen    = new Set();   // tracks (instrument:date) pairs for duplicate detection
  const records = [];

  for (let i = 0; i < rows.length; i++) {
    const row    = rows[i];
    const rowNum = i + 2;  // 1-indexed, row 1 = header, data starts at row 2

    // ── 4. Field count ───────────────────────────────────────────────────
    if (row.length !== expectedFieldCount) {
      throw new Error(
        `Row ${rowNum}: malformed — expected ${expectedFieldCount} fields ` +
        `but got ${row.length}. Values: [${row.join(', ')}]`
      );
    }

    const dateStr  = row[dateIdx];
    const instrStr = row[instrIdx];
    const closeStr = row[closeIdx];

    // ── 5. Date validation ───────────────────────────────────────────────
    if (!isValidCalendarDate(dateStr)) {
      throw new Error(
        `Row ${rowNum}: invalid date "${dateStr}". ` +
        `Expected format: YYYY-MM-DD with a valid calendar date ` +
        `(e.g. 2026-09-01). Single-digit months/days and non-existent ` +
        `dates (e.g. 2026-02-29 in a non-leap year) are rejected.`
      );
    }

    // ── 6. Instrument validation ─────────────────────────────────────────
    if (!instrStr || instrStr.trim() === '') {
      throw new Error(
        `Row ${rowNum}: instrument name is empty or missing.`
      );
    }

    // ── 7. Close price validation ────────────────────────────────────────
    const close = Number(closeStr);
    if (!Number.isFinite(close) || close <= 0) {
      throw new Error(
        `Row ${rowNum}: invalid closing price "${closeStr}". ` +
        `Price must be a positive finite number ` +
        `(non-numeric, non-finite, zero, and negative values are rejected).`
      );
    }

    // ── 8. Duplicate (instrument, date) check ────────────────────────────
    const key = `${instrStr}:${dateStr}`;
    if (seen.has(key)) {
      throw new Error(
        `Duplicate record: instrument "${instrStr}" already has a price ` +
        `entry for ${dateStr}. ` +
        `Each instrument must have at most one closing price per trading day.`
      );
    }
    seen.add(key);

    records.push({ date: dateStr, instrument: instrStr, close });
  }

  return records;
}

// ─────────────────────────────────────────────────────────────────────────────
// validateRules
// ─────────────────────────────────────────────────────────────────────────────

/**
 * validateRules(rules, availableInstruments)
 *
 * Validates a parsed rules value (expected to be a JSON array) and returns
 * the validated rules array unchanged (objects are not cloned).
 *
 * Validation order:
 *   1. rules must be a non-null, non-empty Array.
 *   2. Each rule:
 *      a. id     — non-empty string, unique across all rules.
 *      b. instrument — non-empty string present in availableInstruments.
 *      c. type   — one of: "level", "ma_cross".
 *      d. direction — one of: "above", "below".
 *      e. Type-specific fields:
 *         level:    level  (finite number, required).
 *         ma_cross: short, long (positive integers); short < long strictly.
 *
 * @param {*} rules - the parsed JSON value (should be an array)
 * @param {Set<string>} availableInstruments - set of instrument names from prices
 * @returns {Array} the validated rules array
 * @throws {Error} with a descriptive message on any validation failure
 */
function validateRules(rules, availableInstruments) {
  // ── 1. Must be a non-null array ──────────────────────────────────────────
  if (!Array.isArray(rules)) {
    throw new Error(
      `Rules must be a JSON array. Got: ${rules === null ? 'null' : typeof rules}`
    );
  }
  if (rules.length === 0) {
    throw new Error(
      'Rules array is empty. At least one rule is required.'
    );
  }

  const seenIds = new Set();

  for (const rule of rules) {
    // ── 2a. id ───────────────────────────────────────────────────────────
    if (rule.id === undefined || rule.id === null) {
      throw new Error('A rule is missing required "id" field.');
    }
    if (typeof rule.id !== 'string' || rule.id.trim() === '') {
      throw new Error(
        `Rule id must be a non-empty string. Got: "${rule.id}"`
      );
    }
    if (seenIds.has(rule.id)) {
      throw new Error(
        `Duplicate rule id: "${rule.id}" already exists. Rule IDs must be unique.`
      );
    }
    seenIds.add(rule.id);

    // ── 2b. instrument ───────────────────────────────────────────────────
    if (!rule.instrument) {
      throw new Error(
        `Rule "${rule.id}": missing required "instrument" field.`
      );
    }
    if (!availableInstruments.has(rule.instrument)) {
      throw new Error(
        `Rule "${rule.id}": unknown instrument "${rule.instrument}" — ` +
        `not found in the prices CSV. ` +
        `Available instruments: ${[...availableInstruments].join(', ')}`
      );
    }

    // ── 2c. type ─────────────────────────────────────────────────────────
    if (!VALID_RULE_TYPES.has(rule.type)) {
      throw new Error(
        `Rule "${rule.id}": unknown or unsupported rule type "${rule.type}". ` +
        `Supported types: ${[...VALID_RULE_TYPES].join(', ')}`
      );
    }

    // ── 2d. direction ────────────────────────────────────────────────────
    if (!VALID_DIRECTIONS.has(rule.direction)) {
      throw new Error(
        `Rule "${rule.id}": invalid direction "${rule.direction}". ` +
        `Direction must be "above" or "below".`
      );
    }

    // ── 2e. Type-specific fields ─────────────────────────────────────────
    if (rule.type === 'level') {
      if (rule.level === undefined || rule.level === null) {
        throw new Error(
          `Rule "${rule.id}": missing required "level" field for a level rule.`
        );
      }
      if (!Number.isFinite(rule.level)) {
        throw new Error(
          `Rule "${rule.id}": "level" must be a finite number. Got: ${rule.level}`
        );
      }
    }

    if (rule.type === 'ma_cross') {
      // Validate short
      if (rule.short === undefined || rule.short === null) {
        throw new Error(
          `Rule "${rule.id}": missing required "short" field for an ma_cross rule.`
        );
      }
      if (!Number.isInteger(rule.short) || rule.short < 1) {
        throw new Error(
          `Rule "${rule.id}": invalid "short" window — ` +
          `must be a positive integer (>= 1). Got: ${rule.short}`
        );
      }

      // Validate long
      if (rule.long === undefined || rule.long === null) {
        throw new Error(
          `Rule "${rule.id}": missing required "long" field for an ma_cross rule.`
        );
      }
      if (!Number.isInteger(rule.long) || rule.long < 1) {
        throw new Error(
          `Rule "${rule.id}": invalid "long" window — ` +
          `must be a positive integer (>= 1). Got: ${rule.long}`
        );
      }

      // Validate short < long strictly
      if (rule.short >= rule.long) {
        throw new Error(
          `Rule "${rule.id}": short window (${rule.short}) must be ` +
          `strictly less than long window (${rule.long}). ` +
          `Constraint: short < long.`
        );
      }
    }
  }

  return rules;
}

module.exports = { validatePrices, validateRules, isValidCalendarDate };
