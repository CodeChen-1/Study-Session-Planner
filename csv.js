/*
 * CSV helpers for the Study Session Planner.
 *
 * Loaded as a plain <script> in the browser (exposed as window.StudyCsv) and
 * as a CommonJS module in Node for the test suite. Dependency-free.
 *
 * Export format (RFC 4180-style CSV, CRLF line endings):
 *   logged_at,minutes
 *   2026-11-18T09:30:00.000Z,25
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.StudyCsv = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var CSV_HEADER = 'logged_at,minutes';
  var LINE_ENDING = '\r\n';

  /* Quote a field only when needed; doubled quotes inside quoted fields. */
  function escapeField(value) {
    var text = String(value);
    if (/["\r\n,]/.test(text)) {
      return '"' + text.replace(/"/g, '""') + '"';
    }
    return text;
  }

  /* Mirrors the validation used before entries reach localStorage. */
  function isValidEntry(item) {
    return Boolean(item)
      && typeof item === 'object'
      && !Array.isArray(item)
      && Number.isInteger(item.minutes)
      && item.minutes >= 1
      && item.minutes <= 1440
      && typeof item.ts === 'number'
      && isFinite(item.ts)
      && item.ts >= 0
      /* Reject finite timestamps outside JavaScript's valid Date range
       * (e.g. Number.MAX_VALUE): `toISOString` throws on such values, so
       * they must not reach `entryRow`. */
      && isFinite(new Date(item.ts).getTime());
  }

  function entryRow(entry) {
    return escapeField(new Date(entry.ts).toISOString()) + ',' + escapeField(entry.minutes);
  }

  /* Serializes every valid record, in input order, regardless of how many
   * entries the on-screen list displays. */
  function serializeEntries(entries) {
    var rows = [CSV_HEADER];
    var list = Array.isArray(entries) ? entries : [];
    for (var i = 0; i < list.length; i += 1) {
      if (isValidEntry(list[i])) {
        rows.push(entryRow(list[i]));
      }
    }
    return rows.join(LINE_ENDING) + LINE_ENDING;
  }

  function localDateKey(date) {
    var month = String(date.getMonth() + 1).padStart(2, '0');
    var day = String(date.getDate()).padStart(2, '0');
    return date.getFullYear() + '-' + month + '-' + day;
  }

  function filenameForDate(date) {
    return 'study-focus-log-' + localDateKey(date) + '.csv';
  }

  return {
    CSV_HEADER: CSV_HEADER,
    escapeField: escapeField,
    isValidEntry: isValidEntry,
    serializeEntries: serializeEntries,
    filenameForDate: filenameForDate
  };
});
