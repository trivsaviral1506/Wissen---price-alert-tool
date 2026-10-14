/**
 * test/cli.test.js
 *
 * Test suite covering Cases 33–40 of the Price Alert Tool specification:
 *   CLI behavior, output format, deterministic sorting, and error handling.
 *
 * Integration strategy:
 *   - Cases 33, 34, 40: Use generateAlerts() directly to verify alert structure
 *     and output formatting via formatAlert(), then verify sorted order.
 *   - Cases 35–39: Spawn the CLI as a child process using node:child_process
 *     to test end-to-end behavior including stderr, exit codes, and stdout.
 *
 * Fixture files are in fixtures/ relative to the project root.
 * The CLI is invoked as: node alerts.js <prices_csv> <rules_json>
 */

'use strict';

const { describe, it }  = require('node:test');
const assert            = require('node:assert/strict');
const { spawnSync }     = require('node:child_process');
const path              = require('node:path');
const fs                = require('node:fs');
const os                = require('node:os');

// ── Will fail with "Cannot find module" until Phase 3 is implemented. ──
const { generateAlerts, formatAlert } = require('../lib/alerts.js');

// ─────────────────────────────────────────────────────────────────────────────
// Path helpers
// ─────────────────────────────────────────────────────────────────────────────
// Root of the project (one level up from test/)
const ROOT     = path.join(__dirname, '..');
const CLI_PATH = path.join(ROOT, 'alerts.js');
const FIXTURES = path.join(ROOT, 'fixtures');

// Helper: run the CLI synchronously and return { stdout, stderr, status }
function runCli(args = [], cwd = ROOT) {
  const result = spawnSync('node', [CLI_PATH, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 5000,
  });
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    status: result.status ?? 1,
  };
}

// Helper: build a sorted price array for a single instrument.
function prices(instrument, entries) {
  return entries
    .map(([date, close]) => ({ date, instrument, close }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

// ─────────────────────────────────────────────────────────────────────────────
// CASE 33 — Alerts are sorted by date ascending, then rule ID ascending
// ─────────────────────────────────────────────────────────────────────────────
describe('Case 33: alerts are sorted by date then rule ID', () => {
  it('returns alerts in date-ascending order for different instruments', () => {
    /*
     * Scenario:
     *   INFY crosses below 1500 on 2026-09-03  → r1
     *   TCS  crosses below 3900 on 2026-09-02  → r2
     *
     * Expected sort: r2 (2026-09-02) first, then r1 (2026-09-03).
     */
    const pricesByInstrument = {
      INFY: prices('INFY', [
        ['2026-09-01', 1520.00],
        ['2026-09-02', 1515.00],
        ['2026-09-03', 1498.00],
      ]),
      TCS: prices('TCS', [
        ['2026-09-01', 3910.00],
        ['2026-09-02', 3880.00],
        ['2026-09-03', 3870.00],
      ]),
    };

    const rules = [
      { id: 'r1', instrument: 'INFY', type: 'level', direction: 'below', level: 1500 },
      { id: 'r2', instrument: 'TCS',  type: 'level', direction: 'below', level: 3900 },
    ];

    const alerts = generateAlerts(pricesByInstrument, rules);

    assert.equal(alerts.length, 2);
    assert.equal(alerts[0].date,   '2026-09-02');
    assert.equal(alerts[0].ruleId, 'r2');
    assert.equal(alerts[1].date,   '2026-09-03');
    assert.equal(alerts[1].ruleId, 'r1');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CASE 34 — Multiple rules firing on the same day are ordered by rule ID
// ─────────────────────────────────────────────────────────────────────────────
describe('Case 34: same-day alerts are sorted by rule ID ascending', () => {
  it('orders alerts by ruleId when two alerts fire on the same date', () => {
    /*
     * Both r1 and r2 fire on 2026-09-03.
     * r1 < r2 lexicographically → r1 comes first.
     */
    const pricesByInstrument = {
      INFY: prices('INFY', [
        ['2026-09-01', 1520.00],
        ['2026-09-02', 1534.00],
        ['2026-09-03', 1498.00],
      ]),
    };

    const rules = [
      { id: 'r2', instrument: 'INFY', type: 'level', direction: 'below', level: 1500 },
      { id: 'r1', instrument: 'INFY', type: 'level', direction: 'below', level: 1510 },
    ];

    const alerts = generateAlerts(pricesByInstrument, rules);

    assert.equal(alerts.length, 2);
    assert.ok(alerts.every(a => a.date === '2026-09-03'));
    assert.equal(alerts[0].ruleId, 'r1');  // lexicographically smaller
    assert.equal(alerts[1].ruleId, 'r2');
  });

  it('applies string (Unicode code-point) comparison for rule ID ordering', () => {
    /*
     * Rule IDs 'r10' and 'r9': string comparison → 'r1' < 'r9' ('1' < '9').
     * Numeric interpretation would give r9 < r10, but we use string order.
     * Expected order: r10 before r9.
     */
    const pricesByInstrument = {
      INFY: prices('INFY', [
        ['2026-09-01', 1520.00],
        ['2026-09-03', 1498.00],
      ]),
    };

    const rules = [
      { id: 'r9',  instrument: 'INFY', type: 'level', direction: 'below', level: 1510 },
      { id: 'r10', instrument: 'INFY', type: 'level', direction: 'below', level: 1510 },
    ];

    const alerts = generateAlerts(pricesByInstrument, rules);

    // Both fire on the same date; string sort puts 'r10' before 'r9'
    assert.equal(alerts.length, 2);
    assert.equal(alerts[0].ruleId, 'r10');
    assert.equal(alerts[1].ruleId, 'r9');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CASE 35 — The program works with the documented CLI command
// ─────────────────────────────────────────────────────────────────────────────
describe('Case 35: CLI works with documented command', () => {
  it('exits with code 0 and prints alert lines for valid fixture inputs', () => {
    /*
     * fixtures/prices.csv and fixtures/rules.json are bundled with the project.
     * The exact output depends on fixture content; we verify:
     *   - exit code is 0
     *   - stdout is non-empty (at least one alert fires in the fixture)
     *   - every output line matches the expected format: date    ruleId    instrument    description
     */
    const { stdout, stderr, status } = runCli([
      path.join(FIXTURES, 'prices.csv'),
      path.join(FIXTURES, 'rules.json'),
    ]);

    assert.equal(status, 0, `Expected exit 0, got ${status}. stderr: ${stderr}`);
    // stderr should be silent on success
    assert.equal(stderr, '', `Unexpected stderr: ${stderr}`);

    // Every non-empty output line should match the output format
    const lines = stdout.split('\n').filter(l => l.trim() !== '');
    assert.ok(lines.length > 0, 'Expected at least one alert to fire');

    // Format: date(YYYY-MM-DD)    ruleId    instrument    description
    const linePattern = /^\d{4}-\d{2}-\d{2}\s+\S+\s+\S+\s+.+$/;
    for (const line of lines) {
      assert.match(line, linePattern, `Output line does not match format: "${line}"`);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CASE 36 — Missing command-line arguments produce a useful error
// ─────────────────────────────────────────────────────────────────────────────
describe('Case 36: missing CLI arguments produce a useful error', () => {
  it('exits with code 1 and prints usage to stderr when no arguments given', () => {
    const { stdout, stderr, status } = runCli([]);

    assert.equal(status, 1, `Expected exit 1, got ${status}`);
    assert.match(stderr, /usage|arguments|prices|rules/i);
    assert.equal(stdout, '', 'stdout must be empty on argument error');
  });

  it('exits with code 1 when only one argument is given', () => {
    const { stdout, stderr, status } = runCli([path.join(FIXTURES, 'prices.csv')]);

    assert.equal(status, 1, `Expected exit 1, got ${status}`);
    assert.match(stderr, /usage|arguments|prices|rules/i);
    assert.equal(stdout, '', 'stdout must be empty on argument error');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CASE 37 — A nonexistent input file produces a useful error and non-zero exit
// ─────────────────────────────────────────────────────────────────────────────
describe('Case 37: nonexistent input file produces useful error', () => {
  it('exits with code 1 when the prices CSV file does not exist', () => {
    const { stdout, stderr, status } = runCli([
      'nonexistent_prices.csv',
      path.join(FIXTURES, 'rules.json'),
    ]);

    assert.equal(status, 1);
    assert.match(stderr, /not found|no such file|cannot open|failed/i);
    assert.equal(stdout, '');
  });

  it('exits with code 1 when the rules JSON file does not exist', () => {
    const { stdout, stderr, status } = runCli([
      path.join(FIXTURES, 'prices.csv'),
      'nonexistent_rules.json',
    ]);

    assert.equal(status, 1);
    assert.match(stderr, /not found|no such file|cannot open|failed/i);
    assert.equal(stdout, '');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CASE 38 — Invalid input does not print misleading partial output to stdout
// ─────────────────────────────────────────────────────────────────────────────
describe('Case 38: invalid input does not produce partial stdout output', () => {
  it('writes nothing to stdout when prices CSV is malformed', () => {
    // Create a temp file with malformed CSV content
    const tmpFile = path.join(os.tmpdir(), `bad_prices_${Date.now()}.csv`);
    fs.writeFileSync(tmpFile, 'date,instrument,close\n2026-13-01,INFY,1520.50');

    const { stdout, stderr, status } = runCli([
      tmpFile,
      path.join(FIXTURES, 'rules.json'),
    ]);

    fs.unlinkSync(tmpFile);  // cleanup

    assert.equal(status, 1);
    assert.notEqual(stderr, '', 'Expected error message in stderr');
    assert.equal(stdout, '', 'stdout must be completely empty for invalid input');
  });

  it('writes nothing to stdout when rules JSON is malformed', () => {
    const tmpFile = path.join(os.tmpdir(), `bad_rules_${Date.now()}.json`);
    fs.writeFileSync(tmpFile, '{ this is not valid JSON ]]]');

    const { stdout, stderr, status } = runCli([
      path.join(FIXTURES, 'prices.csv'),
      tmpFile,
    ]);

    fs.unlinkSync(tmpFile);  // cleanup

    assert.equal(status, 1);
    assert.notEqual(stderr, '', 'Expected error message in stderr');
    assert.equal(stdout, '', 'stdout must be completely empty for invalid input');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CASE 39 — No-alert output is empty on standard output
// ─────────────────────────────────────────────────────────────────────────────
describe('Case 39: no-alert case produces empty stdout', () => {
  it('prints nothing to stdout and exits 0 when no alerts fire', () => {
    /*
     * Create a temporary prices CSV where the price never crosses any rule level.
     * Rule: INFY below 1000 — but prices are always >= 1500.
     */
    const tmpPrices = path.join(os.tmpdir(), `no_alert_prices_${Date.now()}.csv`);
    const tmpRules  = path.join(os.tmpdir(), `no_alert_rules_${Date.now()}.json`);

    fs.writeFileSync(tmpPrices, [
      'date,instrument,close',
      '2026-09-01,INFY,1500.00',
      '2026-09-02,INFY,1520.00',
      '2026-09-03,INFY,1510.00',
    ].join('\n'));

    fs.writeFileSync(tmpRules, JSON.stringify([
      { id: 'r1', instrument: 'INFY', type: 'level', direction: 'below', level: 1000 }
    ]));

    const { stdout, stderr, status } = runCli([tmpPrices, tmpRules]);

    fs.unlinkSync(tmpPrices);
    fs.unlinkSync(tmpRules);

    assert.equal(status, 0,  `Expected exit 0, got ${status}. stderr: ${stderr}`);
    assert.equal(stderr, '', `Expected silent stderr, got: ${stderr}`);
    assert.equal(stdout, '', 'Expected empty stdout when no alerts fire');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CASE 40 — Output description matches required format exactly
// ─────────────────────────────────────────────────────────────────────────────
describe('Case 40: output description format matches specification', () => {
  it('formats a level alert as "date    ruleId    instrument    level below LEVEL"', () => {
    /*
     * The formatAlert() function is the single source of output formatting.
     * Test it directly with known inputs.
     * Fields separated by four spaces (    ) as documented in README.
     */
    const alert = {
      date:        '2026-09-03',
      ruleId:      'r1',
      instrument:  'INFY',
      description: 'level below 1500',
    };

    const line = formatAlert(alert);
    assert.equal(line, '2026-09-03    r1    INFY    level below 1500');
  });

  it('formats an ma_cross alert as "date    ruleId    instrument    ma_cross SHORT/LONG above"', () => {
    const alert = {
      date:        '2026-09-24',
      ruleId:      'r2',
      instrument:  'TCS',
      description: 'ma_cross 5/20 above',
    };

    const line = formatAlert(alert);
    assert.equal(line, '2026-09-24    r2    TCS    ma_cross 5/20 above');
  });

  it('generates correct descriptions from generateAlerts() for a level rule', () => {
    /*
     * End-to-end check: generateAlerts returns alerts whose description
     * fields match the specification format strings exactly.
     */
    const pricesByInstrument = {
      INFY: prices('INFY', [
        ['2026-09-01', 1520.00],
        ['2026-09-02', 1498.00],  // crosses below 1500
      ]),
    };
    const rules = [
      { id: 'r1', instrument: 'INFY', type: 'level', direction: 'below', level: 1500 }
    ];

    const alerts = generateAlerts(pricesByInstrument, rules);
    assert.equal(alerts[0].description, 'level below 1500');
  });

  it('generates correct descriptions for an ma_cross rule', () => {
    /*
     * SMA cross with short=2, long=4 firing above.
     * Expected description: "ma_cross 2/4 above"
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
      { id: 'r1', instrument: 'INFY', type: 'ma_cross', direction: 'above', short: 2, long: 4 }
    ];

    const alerts = generateAlerts(pricesByInstrument, rules);
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].description, 'ma_cross 2/4 above');
  });
});
