/**
 * test/validation.test.js
 *
 * Test suite covering Cases 1–15 of the Price Alert Tool specification:
 *   CSV parsing/validation and rule schema validation.
 *
 * Uses only Node.js built-in node:test and node:assert.
 * Every expected error message is verified directly against the returned
 * error string — not by re-calling the same logic under test.
 */

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// ── These imports will throw "Cannot find module" until Phase 3 is written.
// That is the expected, correct failure mode for tests-first development.
const { parseCsv }        = require('../lib/csv.js');
const { validatePrices, validateRules } = require('../lib/validation.js');

// ─────────────────────────────────────────────────────────────────────────────
// Helper: build a minimal valid CSV string from an array of row-objects.
// ─────────────────────────────────────────────────────────────────────────────
function makeCsv(rows) {
  const header = 'date,instrument,close';
  const lines  = rows.map(r => `${r.date},${r.instrument},${r.close}`);
  return [header, ...lines].join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// CASE 1 — Valid CSV input produces clean records
// ─────────────────────────────────────────────────────────────────────────────
describe('Case 1: valid CSV input', () => {
  it('returns correctly typed records for a well-formed CSV', () => {
    const csv = makeCsv([
      { date: '2026-09-01', instrument: 'INFY', close: '1520.50' },
      { date: '2026-09-02', instrument: 'INFY', close: '1534.10' },
      { date: '2026-09-01', instrument: 'TCS',  close: '3890.00' },
    ]);

    const records = validatePrices(parseCsv(csv));

    assert.equal(records.length, 3);

    // Spot-check the first INFY record
    const r = records.find(x => x.instrument === 'INFY' && x.date === '2026-09-01');
    assert.ok(r, 'Expected an INFY record for 2026-09-01');
    assert.equal(r.date,       '2026-09-01');
    assert.equal(r.instrument, 'INFY');
    assert.equal(r.close,      1520.50);   // parsed as a Number
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CASE 2 — Dates supplied out of order are still accepted
// ─────────────────────────────────────────────────────────────────────────────
describe('Case 2: dates supplied out of order in CSV', () => {
  it('accepts all rows regardless of row order in the CSV', () => {
    // Rows are intentionally shuffled:
    const csv = makeCsv([
      { date: '2026-09-03', instrument: 'INFY', close: '1498.00' },
      { date: '2026-09-01', instrument: 'INFY', close: '1520.50' },
      { date: '2026-09-02', instrument: 'INFY', close: '1534.10' },
    ]);

    const records = validatePrices(parseCsv(csv));
    assert.equal(records.length, 3);

    // All three dates present
    const dates = records.map(r => r.date).sort();
    assert.deepEqual(dates, ['2026-09-01', '2026-09-02', '2026-09-03']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CASE 3 — Missing required column headers
// ─────────────────────────────────────────────────────────────────────────────
describe('Case 3: missing required column headers', () => {
  it('throws when the "date" header is absent', () => {
    const csv = 'instrument,close\nINFY,1520.50';
    assert.throws(
      () => validatePrices(parseCsv(csv)),
      (err) => {
        assert.match(err.message, /missing.*column|required.*header|column.*date/i);
        return true;
      }
    );
  });

  it('throws when the "instrument" header is absent', () => {
    const csv = 'date,close\n2026-09-01,1520.50';
    assert.throws(
      () => validatePrices(parseCsv(csv)),
      (err) => {
        assert.match(err.message, /missing.*column|required.*header|column.*instrument/i);
        return true;
      }
    );
  });

  it('throws when the "close" header is absent', () => {
    const csv = 'date,instrument\n2026-09-01,INFY';
    assert.throws(
      () => validatePrices(parseCsv(csv)),
      (err) => {
        assert.match(err.message, /missing.*column|required.*header|column.*close/i);
        return true;
      }
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CASE 4 — Malformed rows (too few or too many fields)
// ─────────────────────────────────────────────────────────────────────────────
describe('Case 4: malformed data rows', () => {
  it('throws on a row with too few fields (only 2 columns)', () => {
    const csv = 'date,instrument,close\n2026-09-01,INFY';
    assert.throws(
      () => validatePrices(parseCsv(csv)),
      (err) => {
        assert.match(err.message, /malformed|expected 3 fields|too few|row 2/i);
        return true;
      }
    );
  });

  it('throws on a row with too many fields (4 columns)', () => {
    const csv = 'date,instrument,close\n2026-09-01,INFY,1520.50,EXTRA';
    assert.throws(
      () => validatePrices(parseCsv(csv)),
      (err) => {
        assert.match(err.message, /malformed|expected 3 fields|too many|row 2/i);
        return true;
      }
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CASE 5 — Invalid calendar dates
// ─────────────────────────────────────────────────────────────────────────────
describe('Case 5: invalid calendar dates', () => {
  const BAD_DATES = [
    ['2026-02-29', 'Feb 29 in a non-leap year'],
    ['2026-13-01', 'month 13 does not exist'],
    ['2026-04-31', 'April has only 30 days'],
    ['2026-00-15', 'month 0 is invalid'],
    ['2026-09-00', 'day 0 is invalid'],
    ['20260901',   'wrong format: no hyphens'],
    ['2026/09/01', 'wrong format: slashes instead of hyphens'],
    ['',           'empty date string'],
    ['2026-9-1',   'wrong format: single digit month/day'],
  ];

  for (const [date, description] of BAD_DATES) {
    it(`throws for invalid date "${date}" (${description})`, () => {
      const csv = `date,instrument,close\n${date},INFY,1520.50`;
      assert.throws(
        () => validatePrices(parseCsv(csv)),
        (err) => {
          assert.match(err.message, /invalid date|date format|YYYY-MM-DD/i);
          return true;
        }
      );
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// CASE 6 — Non-numeric and non-finite closing prices
// ─────────────────────────────────────────────────────────────────────────────
describe('Case 6: invalid closing prices', () => {
  const BAD_PRICES = [
    ['abc',       'non-numeric string'],
    ['',          'empty string'],
    ['NaN',       'NaN literal'],
    ['Infinity',  'Infinity literal'],
    ['-Infinity', '-Infinity literal'],
    ['-100',      'negative number'],
    ['0',         'zero (not a valid price)'],
    ['1e999',     'overflowed to Infinity'],
  ];

  for (const [close, description] of BAD_PRICES) {
    it(`throws for close="${close}" (${description})`, () => {
      const csv = `date,instrument,close\n2026-09-01,INFY,${close}`;
      assert.throws(
        () => validatePrices(parseCsv(csv)),
        (err) => {
          assert.match(err.message, /invalid.*price|non-numeric|non-finite|positive finite/i);
          return true;
        }
      );
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// CASE 7 — Duplicate instrument/date entries
// ─────────────────────────────────────────────────────────────────────────────
describe('Case 7: duplicate instrument/date entries', () => {
  it('throws when the same instrument appears twice on the same date', () => {
    const csv = makeCsv([
      { date: '2026-09-01', instrument: 'INFY', close: '1520.50' },
      { date: '2026-09-02', instrument: 'INFY', close: '1534.10' },
      { date: '2026-09-01', instrument: 'INFY', close: '1499.00' }, // duplicate!
    ]);

    assert.throws(
      () => validatePrices(parseCsv(csv)),
      (err) => {
        assert.match(err.message, /duplicate|already exists|INFY.*2026-09-01|2026-09-01.*INFY/i);
        return true;
      }
    );
  });

  it('allows the same date for different instruments (not a duplicate)', () => {
    const csv = makeCsv([
      { date: '2026-09-01', instrument: 'INFY', close: '1520.50' },
      { date: '2026-09-01', instrument: 'TCS',  close: '3890.00' },
    ]);
    // Must not throw
    const records = validatePrices(parseCsv(csv));
    assert.equal(records.length, 2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CASE 8 — Empty file or header-only CSV
// ─────────────────────────────────────────────────────────────────────────────
describe('Case 8: empty or header-only CSV', () => {
  it('throws for a completely empty CSV (no content at all)', () => {
    assert.throws(
      () => validatePrices(parseCsv('')),
      (err) => {
        assert.match(err.message, /empty|no headers|missing.*header/i);
        return true;
      }
    );
  });

  it('throws for a CSV that contains only whitespace', () => {
    assert.throws(
      () => validatePrices(parseCsv('   \n  \n')),
      (err) => {
        assert.match(err.message, /empty|no headers|missing.*header/i);
        return true;
      }
    );
  });

  it('throws for a header-only CSV with no data rows', () => {
    assert.throws(
      () => validatePrices(parseCsv('date,instrument,close')),
      (err) => {
        assert.match(err.message, /no data|no price records|empty/i);
        return true;
      }
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CASE 9 — Rule references an instrument not present in prices
// ─────────────────────────────────────────────────────────────────────────────
describe('Case 9: unknown instrument referenced by a rule', () => {
  it('throws when a rule instrument is not in the prices dataset', () => {
    const availableInstruments = new Set(['INFY', 'TCS']);
    const rules = [
      { id: 'r1', instrument: 'WIPRO', type: 'level', direction: 'below', level: 500 }
    ];

    assert.throws(
      () => validateRules(rules, availableInstruments),
      (err) => {
        assert.match(err.message, /unknown instrument|WIPRO|not found/i);
        return true;
      }
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CASE 10 — Empty, malformed, or invalid rules JSON
// ─────────────────────────────────────────────────────────────────────────────
describe('Case 10: empty, malformed, or invalid rules JSON', () => {
  const instruments = new Set(['INFY']);

  it('throws when rules is not an array (object)', () => {
    assert.throws(
      () => validateRules({ id: 'r1' }, instruments),
      (err) => {
        assert.match(err.message, /array|rules must be/i);
        return true;
      }
    );
  });

  it('throws when rules is not an array (string)', () => {
    assert.throws(
      () => validateRules('[]', instruments),
      (err) => {
        assert.match(err.message, /array|rules must be/i);
        return true;
      }
    );
  });

  it('throws when rules is an empty array', () => {
    assert.throws(
      () => validateRules([], instruments),
      (err) => {
        assert.match(err.message, /empty|at least one rule|no rules/i);
        return true;
      }
    );
  });

  it('throws when rules is null', () => {
    assert.throws(
      () => validateRules(null, instruments),
      (err) => {
        assert.match(err.message, /array|rules must be/i);
        return true;
      }
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CASE 11 — Duplicate rule IDs
// ─────────────────────────────────────────────────────────────────────────────
describe('Case 11: duplicate rule IDs', () => {
  it('throws when two rules share the same id', () => {
    const instruments = new Set(['INFY']);
    const rules = [
      { id: 'r1', instrument: 'INFY', type: 'level', direction: 'above', level: 1600 },
      { id: 'r1', instrument: 'INFY', type: 'level', direction: 'below', level: 1400 },
    ];

    assert.throws(
      () => validateRules(rules, instruments),
      (err) => {
        assert.match(err.message, /duplicate.*id|id.*r1.*already|r1.*duplicate/i);
        return true;
      }
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CASE 12 — Unknown rule types and invalid directions
// ─────────────────────────────────────────────────────────────────────────────
describe('Case 12: unknown rule types and invalid directions', () => {
  const instruments = new Set(['INFY']);

  it('throws for an unsupported rule type', () => {
    const rules = [
      { id: 'r1', instrument: 'INFY', type: 'momentum', direction: 'above', level: 1600 }
    ];
    assert.throws(
      () => validateRules(rules, instruments),
      (err) => {
        assert.match(err.message, /unknown.*type|unsupported.*type|invalid.*type/i);
        return true;
      }
    );
  });

  it('throws for an invalid direction in a level rule', () => {
    const rules = [
      { id: 'r1', instrument: 'INFY', type: 'level', direction: 'sideways', level: 1600 }
    ];
    assert.throws(
      () => validateRules(rules, instruments),
      (err) => {
        assert.match(err.message, /invalid.*direction|direction.*above.*below/i);
        return true;
      }
    );
  });

  it('throws for an invalid direction in an ma_cross rule', () => {
    const rules = [
      { id: 'r1', instrument: 'INFY', type: 'ma_cross', direction: 'flat', short: 2, long: 5 }
    ];
    assert.throws(
      () => validateRules(rules, instruments),
      (err) => {
        assert.match(err.message, /invalid.*direction|direction.*above.*below/i);
        return true;
      }
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CASE 13 — Missing rule parameters
// ─────────────────────────────────────────────────────────────────────────────
describe('Case 13: missing required rule parameters', () => {
  const instruments = new Set(['INFY']);

  it('throws for a level rule missing the "level" field', () => {
    const rules = [
      { id: 'r1', instrument: 'INFY', type: 'level', direction: 'above' }
      // no "level" field
    ];
    assert.throws(
      () => validateRules(rules, instruments),
      (err) => {
        assert.match(err.message, /missing.*level|level.*required/i);
        return true;
      }
    );
  });

  it('throws for an ma_cross rule missing "short"', () => {
    const rules = [
      { id: 'r1', instrument: 'INFY', type: 'ma_cross', direction: 'above', long: 20 }
      // no "short"
    ];
    assert.throws(
      () => validateRules(rules, instruments),
      (err) => {
        assert.match(err.message, /missing.*short|short.*required/i);
        return true;
      }
    );
  });

  it('throws for an ma_cross rule missing "long"', () => {
    const rules = [
      { id: 'r1', instrument: 'INFY', type: 'ma_cross', direction: 'above', short: 5 }
      // no "long"
    ];
    assert.throws(
      () => validateRules(rules, instruments),
      (err) => {
        assert.match(err.message, /missing.*long|long.*required/i);
        return true;
      }
    );
  });

  it('throws for a rule missing the "id" field', () => {
    const rules = [
      { instrument: 'INFY', type: 'level', direction: 'above', level: 1600 }
    ];
    assert.throws(
      () => validateRules(rules, instruments),
      (err) => {
        assert.match(err.message, /missing.*id|id.*required/i);
        return true;
      }
    );
  });

  it('throws for a rule with an empty-string id', () => {
    const rules = [
      { id: '', instrument: 'INFY', type: 'level', direction: 'above', level: 1600 }
    ];
    assert.throws(
      () => validateRules(rules, instruments),
      (err) => {
        assert.match(err.message, /empty.*id|id.*must be.*non-empty|id.*required/i);
        return true;
      }
    );
  });

  it('throws for a rule missing the "instrument" field', () => {
    const rules = [
      { id: 'r1', type: 'level', direction: 'above', level: 1600 }
    ];
    assert.throws(
      () => validateRules(rules, instruments),
      (err) => {
        assert.match(err.message, /missing.*instrument|instrument.*required/i);
        return true;
      }
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CASE 14 — Zero, negative, fractional, or invalid MA window sizes
// ─────────────────────────────────────────────────────────────────────────────
describe('Case 14: invalid MA window sizes', () => {
  const instruments = new Set(['INFY']);

  const BAD_WINDOWS = [
    [0,    2,    'short is zero'],
    [-1,   5,    'short is negative'],
    [2,    0,    'long is zero'],
    [2,   -5,    'long is negative'],
    [1.5,  5,    'short is fractional'],
    [2,    4.9,  'long is fractional'],
    ['a',  5,    'short is a string'],
    [2,   'b',   'long is a string'],
  ];

  for (const [short, long, description] of BAD_WINDOWS) {
    it(`throws for short=${short}, long=${long} (${description})`, () => {
      const rules = [
        { id: 'r1', instrument: 'INFY', type: 'ma_cross', direction: 'above', short, long }
      ];
      assert.throws(
        () => validateRules(rules, instruments),
        (err) => {
          assert.match(err.message, /invalid.*window|window.*positive integer|short.*integer|long.*integer/i);
          return true;
        }
      );
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// CASE 15 — Short window not strictly smaller than long window
// ─────────────────────────────────────────────────────────────────────────────
describe('Case 15: short window must be strictly smaller than long window', () => {
  const instruments = new Set(['INFY']);

  it('throws when short equals long', () => {
    const rules = [
      { id: 'r1', instrument: 'INFY', type: 'ma_cross', direction: 'above', short: 5, long: 5 }
    ];
    assert.throws(
      () => validateRules(rules, instruments),
      (err) => {
        assert.match(err.message, /short.*less than|short.*smaller.*long|window.*short < long/i);
        return true;
      }
    );
  });

  it('throws when short is greater than long', () => {
    const rules = [
      { id: 'r1', instrument: 'INFY', type: 'ma_cross', direction: 'above', short: 10, long: 5 }
    ];
    assert.throws(
      () => validateRules(rules, instruments),
      (err) => {
        assert.match(err.message, /short.*less than|short.*smaller.*long|window.*short < long/i);
        return true;
      }
    );
  });

  it('accepts when short is strictly less than long', () => {
    const rules = [
      { id: 'r1', instrument: 'INFY', type: 'ma_cross', direction: 'above', short: 2, long: 5 }
    ];
    // Should not throw
    assert.doesNotThrow(() => validateRules(rules, instruments));
  });
});
