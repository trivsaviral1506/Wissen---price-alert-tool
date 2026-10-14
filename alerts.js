/**
 * alerts.js — CLI entry point for the Price Alert Tool
 *
 * Usage:
 *   node alerts.js <prices.csv> <rules.json>
 *
 * Arguments:
 *   prices.csv   Path to a CSV file with columns: date, instrument, close
 *   rules.json   Path to a JSON file containing an array of alert rules
 *
 * Output:
 *   Standard output (stdout): one line per fired alert, sorted by date then rule ID.
 *   Standard error  (stderr): error messages for invalid input or missing files.
 *
 * Exit codes:
 *   0   Success (includes the case where no alerts fire — stdout will be empty)
 *   1   Any validation error, filesystem error, or argument error
 *
 * Design notes:
 *   - ALL validation is completed before any alert is printed.
 *     A malformed input file will never produce partial output on stdout.
 *   - No third-party libraries are used (node:fs, node:path only).
 *   - Debug / progress output is never written to stdout.
 */

'use strict';

const fs   = require('node:fs');
const path = require('node:path');

const { parseCsv }                       = require('./lib/csv.js');
const { validatePrices, validateRules }  = require('./lib/validation.js');
const {
  groupAndSortPrices,
  generateAlerts,
  formatAlert,
}                                        = require('./lib/alerts.js');

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Write a message to stderr (never to stdout). */
function die(message) {
  process.stderr.write(message + '\n');
  process.exit(1);
}

/** Print usage instructions to stderr and exit with code 1. */
function usage() {
  die(
    'Usage: node alerts.js <prices.csv> <rules.json>\n' +
    '\n' +
    '  prices.csv   Path to CSV file with columns: date, instrument, close\n' +
    '  rules.json   Path to JSON file containing an array of alert rules\n' +
    '\n' +
    'Example:\n' +
    '  node alerts.js fixtures/prices.csv fixtures/rules.json'
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

function main() {
  // ── 1. Argument validation ─────────────────────────────────────────────────
  // process.argv = ['node', 'alerts.js', arg1, arg2]
  const args = process.argv.slice(2);

  if (args.length !== 2) {
    usage();
    // usage() calls process.exit(1), but the return is here for clarity
    return;
  }

  const [pricesPath, rulesPath] = args;

  // ── 2. Read prices CSV ─────────────────────────────────────────────────────
  let csvText;
  try {
    csvText = fs.readFileSync(pricesPath, 'utf8');
  } catch (err) {
    die(`Error: cannot open prices file "${pricesPath}": ${err.message}`);
  }

  // ── 3. Read rules JSON ─────────────────────────────────────────────────────
  let rulesText;
  try {
    rulesText = fs.readFileSync(rulesPath, 'utf8');
  } catch (err) {
    die(`Error: cannot open rules file "${rulesPath}": ${err.message}`);
  }

  // ── 4. Parse and validate prices ───────────────────────────────────────────
  let records;
  try {
    records = validatePrices(parseCsv(csvText));
  } catch (err) {
    die(`Error in prices CSV: ${err.message}`);
  }

  // ── 5. Parse rules JSON ────────────────────────────────────────────────────
  let rulesRaw;
  try {
    rulesRaw = JSON.parse(rulesText);
  } catch (err) {
    die(`Error: rules file "${rulesPath}" is not valid JSON: ${err.message}`);
  }

  // ── 6. Group and sort prices by instrument ─────────────────────────────────
  const pricesByInstrument  = groupAndSortPrices(records);
  const availableInstruments = new Set(Object.keys(pricesByInstrument));

  // ── 7. Validate rules ──────────────────────────────────────────────────────
  let rules;
  try {
    rules = validateRules(rulesRaw, availableInstruments);
  } catch (err) {
    die(`Error in rules JSON: ${err.message}`);
  }

  // ── 8. Generate and print alerts ───────────────────────────────────────────
  // All validation has passed at this point.
  // generateAlerts returns alerts already sorted by date then ruleId.
  const alerts = generateAlerts(pricesByInstrument, rules);

  for (const alert of alerts) {
    process.stdout.write(formatAlert(alert) + '\n');
  }

  // If no alerts fired, stdout is empty — this is correct per specification.
  process.exit(0);
}

main();
