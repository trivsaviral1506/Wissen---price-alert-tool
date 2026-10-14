/**
 * lib/csv.js
 *
 * Responsibility: Parse raw CSV text into a structured { headers, rows } object.
 *
 * This module is intentionally "dumb" — it does structural parsing only.
 * All semantic validation (required columns, date formats, price ranges,
 * duplicate records, etc.) is delegated to lib/validation.js.
 *
 * Supported CSV features:
 *   - Comma-separated fields
 *   - Double-quoted fields (allows commas inside quotes)
 *   - Escaped double-quotes inside quoted fields: "" → "
 *   - Whitespace is trimmed from unquoted field values
 *   - Trailing empty / whitespace-only lines are ignored
 *
 * NOT supported (and not required by the brief):
 *   - Multi-line quoted fields
 *   - Alternate delimiters (semicolons, tabs)
 */

'use strict';

/**
 * parseCsvLine(line)
 *
 * Splits a single CSV line into an array of field strings.
 * Handles double-quoted fields: commas inside quotes are NOT separators.
 * Handles escaped quotes: two consecutive quote chars ("") inside a quoted
 * field are decoded to a single double-quote character.
 *
 * Examples:
 *   parseCsvLine('a,b,c')           → ['a', 'b', 'c']
 *   parseCsvLine('"a,b",c')         → ['a,b', 'c']
 *   parseCsvLine('"say ""hi""",x')  → ['say "hi"', 'x']
 *   parseCsvLine('  x , y ')        → ['x', 'y']   (unquoted fields are trimmed)
 *
 * @param {string} line - a single CSV line (no trailing newline)
 * @returns {string[]} array of field strings
 */
function parseCsvLine(line) {
  const fields = [];
  let current  = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (inQuotes) {
      if (ch === '"') {
        // Check for escaped double-quote: "" → "
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;              // skip the second quote
        } else {
          inQuotes = false; // closing quote
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;    // opening quote
      } else if (ch === ',') {
        fields.push(current.trim()); // end of this field
        current = '';
      } else {
        current += ch;
      }
    }
  }

  // Push the last field (there is always at least one)
  fields.push(current.trim());
  return fields;
}

/**
 * parseCsv(text)
 *
 * Parses raw CSV text and returns { headers, rows }.
 *
 *   headers  {string[]}    Column names from the first non-empty line.
 *                          Empty array if the input is blank.
 *   rows     {string[][]}  One entry per data line; each entry is an array of
 *                          field strings (same length as headers if the CSV is
 *                          well-formed, though validation enforces that).
 *
 * Empty and whitespace-only lines are silently discarded because they carry
 * no data and appear naturally at the end of files saved by many editors.
 *
 * This function never throws. Invalid content is returned as-is so that
 * validatePrices() can produce precise, row-numbered error messages.
 *
 * @param {string} text - raw UTF-8 content of the CSV file
 * @returns {{ headers: string[], rows: string[][] }}
 */
function parseCsv(text) {
  // Normalise line endings and split
  const lines = (text || '')
    .replace(/\r\n/g, '\n')     // Windows CRLF → LF
    .replace(/\r/g, '\n')       // old Mac CR  → LF
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0); // discard blank / whitespace-only lines

  if (lines.length === 0) {
    return { headers: [], rows: [] };
  }

  const headers = parseCsvLine(lines[0]);
  const rows    = lines.slice(1).map(line => parseCsvLine(line));

  return { headers, rows };
}

module.exports = { parseCsv, parseCsvLine };
