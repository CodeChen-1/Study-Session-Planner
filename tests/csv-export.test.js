'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const csv = require('../csv.js');

const ISO_8601_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

test('header row is logged_at,minutes', () => {
  assert.equal(csv.CSV_HEADER, 'logged_at,minutes');
  assert.ok(csv.serializeEntries([]).startsWith('logged_at,minutes\r\n'));
});

test('empty history serializes to just the header', () => {
  assert.equal(csv.serializeEntries([]), 'logged_at,minutes\r\n');
  assert.equal(csv.serializeEntries(null), 'logged_at,minutes\r\n');
});

test('rows use ISO 8601 UTC timestamps and integer minutes', () => {
  const ts = Date.UTC(2026, 10, 18, 9, 30, 0);
  const out = csv.serializeEntries([{ ts: ts, minutes: 25 }]);
  const lines = out.split('\r\n');
  assert.deepEqual(lines, [
    'logged_at,minutes',
    new Date(ts).toISOString() + ',25',
    ''
  ]);
  assert.match(new Date(ts).toISOString(), ISO_8601_UTC);
});

test('every valid stored record is exported, beyond the latest 50 shown on screen', () => {
  const base = Date.UTC(2026, 0, 1, 8, 0, 0);
  const entries = [];
  for (let i = 0; i < 75; i += 1) {
    entries.push({ ts: base + i * 60000, minutes: (i % 60) + 1 });
  }
  const out = csv.serializeEntries(entries);
  const lines = out.split('\r\n');
  // header + 75 rows + trailing empty piece from the final CRLF
  assert.equal(lines.length, 77);
  assert.equal(lines[0], 'logged_at,minutes');
  assert.equal(lines[1], new Date(base).toISOString() + ',1');
  assert.equal(lines[75], new Date(base + 74 * 60000).toISOString() + ',15');
  // no record dropped: each timestamp appears exactly once, in input order
  for (let i = 0; i < 75; i += 1) {
    const expected = new Date(base + i * 60000).toISOString();
    assert.ok(lines.includes(expected + ',' + ((i % 60) + 1)), 'row ' + i + ' missing');
  }
});

test('input order is preserved (oldest first) when exporting', () => {
  const older = Date.UTC(2026, 0, 1);
  const newer = Date.UTC(2026, 0, 2);
  const out = csv.serializeEntries([
    { ts: older, minutes: 10 },
    { ts: newer, minutes: 30 }
  ]);
  const lines = out.split('\r\n');
  assert.equal(lines[1], new Date(older).toISOString() + ',10');
  assert.equal(lines[2], new Date(newer).toISOString() + ',30');
});

test('invalid records are skipped; valid records around them are kept', () => {
  const base = Date.UTC(2026, 5, 15, 12, 0, 0);
  const out = csv.serializeEntries([
    { ts: base, minutes: 25 },
    null,
    { ts: 'not-a-number', minutes: 25 },
    { ts: base + 60000, minutes: 0 },
    { ts: base + 60000, minutes: 1.5 },
    { ts: base + 60000, minutes: 1441 },
    { ts: -5, minutes: 25 },
    { ts: base + 120000, minutes: 50 }
  ]);
  const lines = out.split('\r\n');
  assert.equal(lines.length, 4); // header + 2 valid rows + trailing piece
  assert.equal(lines[1], new Date(base).toISOString() + ',25');
  assert.equal(lines[2], new Date(base + 120000).toISOString() + ',50');
});

test('finite but out-of-range timestamps are skipped without throwing', () => {
  const earlier = Date.UTC(2026, 5, 15, 12, 0, 0);
  const later = Date.UTC(2026, 5, 15, 12, 5, 0);
  let out;
  assert.doesNotThrow(() => {
    out = csv.serializeEntries([
      { ts: earlier, minutes: 25 },
      { ts: Number.MAX_VALUE, minutes: 25 },
      { ts: later, minutes: 40 }
    ]);
  }, 'out-of-range finite ts must not abort the export');
  const lines = out.split('\r\n');
  assert.equal(lines.length, 4); // header + 2 valid rows + trailing piece
  assert.equal(lines[1], new Date(earlier).toISOString() + ',25');
  assert.equal(lines[2], new Date(later).toISOString() + ',40');
});

test('fields are escaped per RFC 4180 only when necessary', () => {
  assert.equal(csv.escapeField('plain'), 'plain');
  assert.equal(csv.escapeField(25), '25');
  assert.equal(csv.escapeField('a,b'), '"a,b"');
  assert.equal(csv.escapeField('say "hi"'), '"say ""hi"""');
  assert.equal(csv.escapeField('line1\nline2'), '"line1\nline2"');
  assert.equal(csv.escapeField('cr\rlf'), '"cr\rlf"');
  assert.equal(csv.escapeField('"'), '""""');
});

test('exported timestamps never need quoting, so rows stay comma-separated pairs', () => {
  const base = Date.UTC(2026, 7, 9, 23, 59, 59);
  const out = csv.serializeEntries([
    { ts: base, minutes: 1440 },
    { ts: base + 1, minutes: 1 }
  ]);
  for (const line of out.split('\r\n').slice(1)) {
    if (line === '') { continue; }
    const parts = line.split(',');
    assert.equal(parts.length, 2, 'unexpected extra comma in: ' + line);
    assert.match(parts[0], ISO_8601_UTC);
    assert.match(parts[1], /^\d+$/);
  }
});

test('filename includes today\'s date', () => {
  assert.equal(
    csv.filenameForDate(new Date(2026, 10, 18, 9, 30, 0)),
    'study-focus-log-2026-11-18.csv'
  );
  assert.equal(
    csv.filenameForDate(new Date(2027, 0, 2, 23, 59, 0)),
    'study-focus-log-2027-01-02.csv'
  );
});
