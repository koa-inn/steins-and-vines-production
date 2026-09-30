'use strict';

/**
 * Generic dual-write discrepancy comparator — Phase 83 (DB-02, D-08).
 *
 * Phase 84+ stores that write to BOTH Sheets and Postgres during their
 * 'dual' window call compareAndReport() after each write to detect drift
 * between the two stores and surface it to Sentry as a grouped warning.
 *
 * Mirrors lib/sentry-capture.js's never-throw wrapper pattern: a comparison
 * helper must never break the write path it is auditing, so EVERYTHING here
 * — including the Sentry call itself — runs inside one outer try/catch. A
 * throwing getter, a circular structure in either input, or captureExceptionSafe
 * itself throwing all result in { match: null, differences: [] } plus a
 * logged warning, never an exception into the caller.
 *
 * Reported Sentry payloads carry dotted field PATHS and TYPES only by
 * default — never raw values (customer PII: names, emails, balances) —
 * unless the caller explicitly opts a key into reportValuesFor (Phase 84
 * uses this for non-PII fields such as balances).
 *
 * Normalisation traps handled before comparing two leaf values (see
 * .planning/research/sheets-to-postgres-migration.md and the Phase 83
 * research's Task 2 <behavior> spec):
 *   - '' / null / undefined all treated as equivalent "empty"
 *   - a number compared against a numeric string (pg numeric columns come
 *     back as strings) compares as fixed 2-decimal amounts — a JS float and
 *     a Postgres numeric string for the same cents must match
 *   - a Date object compared against an ISO timestamp string of the same
 *     instant compares by epoch ms, not by string identity
 *   - Sheets' 'TRUE'/'FALSE' string convention compared against a real
 *     boolean compares by boolean value
 *   - everything else falls back to strict equality
 */

var log = require('./logger');
var sentryCapture = require('./sentry-capture');

var ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
var MAX_REPORTED_PATHS = 20;

function isEmpty(v) {
  return v === '' || v === null || v === undefined;
}

function isIsoDateString(v) {
  return typeof v === 'string' && ISO_DATE_RE.test(v);
}

function isDateLike(v) {
  return v instanceof Date || isIsoDateString(v);
}

function toEpoch(v) {
  return v instanceof Date ? v.getTime() : new Date(v).getTime();
}

function toBoolMaybe(v) {
  if (typeof v === 'boolean') return v;
  if (v === 'TRUE') return true;
  if (v === 'FALSE') return false;
  return undefined;
}

function isNumericLike(v) {
  if (typeof v === 'number') return !isNaN(v);
  if (typeof v === 'string' && v.trim() !== '') return !isNaN(Number(v));
  return false;
}

function toMoneyString(v) {
  return Number(v).toFixed(2);
}

/**
 * Compare two leaf (non-container) values applying the normalisation traps
 * above. Not exported — internal to diffValues' tree walk.
 */
function leavesEqual(a, b) {
  var aEmpty = isEmpty(a);
  var bEmpty = isEmpty(b);
  if (aEmpty || bEmpty) return aEmpty === bEmpty;

  if (typeof a === 'boolean' || typeof b === 'boolean') {
    var boolA = toBoolMaybe(a);
    var boolB = toBoolMaybe(b);
    if (boolA !== undefined && boolB !== undefined) return boolA === boolB;
  }

  if (isDateLike(a) && isDateLike(b) && (a instanceof Date || b instanceof Date || (isIsoDateString(a) && isIsoDateString(b)))) {
    return toEpoch(a) === toEpoch(b);
  }

  if ((typeof a === 'number' || typeof b === 'number') && isNumericLike(a) && isNumericLike(b)) {
    return toMoneyString(a) === toMoneyString(b);
  }

  return a === b;
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !(v instanceof Date) && !Array.isArray(v);
}

function typeLabel(v) {
  if (v === undefined) return 'undefined';
  if (v === null) return 'null';
  if (v instanceof Date) return 'date';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

/**
 * Walk two values (objects/arrays/leaves) and return every path where they
 * disagree after normalisation. Never called directly in a try/catch by
 * itself — compareAndReport is the safety boundary (see module comment).
 *
 * @param {*} a - the Sheets-side value
 * @param {*} b - the Postgres-side value
 * @param {{ignoreKeys?: string[]}} [opts]
 * @returns {Array<{path: string, sheetsType: string, postgresType: string}>}
 */
function diffValues(a, b, opts) {
  opts = opts || {};
  var ignoreKeys = opts.ignoreKeys || [];
  var differences = [];

  function walk(path, av, bv) {
    if (isPlainObject(av) && isPlainObject(bv)) {
      var keys = Object.keys(Object.assign({}, av, bv));
      keys.forEach(function (key) {
        if (ignoreKeys.indexOf(key) !== -1) return;
        walk(path ? path + '.' + key : key, av[key], bv[key]);
      });
      return;
    }

    if (Array.isArray(av) && Array.isArray(bv)) {
      var len = Math.max(av.length, bv.length);
      for (var i = 0; i < len; i++) {
        walk(path ? path + '.' + i : String(i), av[i], bv[i]);
      }
      return;
    }

    if (!leavesEqual(av, bv)) {
      differences.push({ path: path, sheetsType: typeLabel(av), postgresType: typeLabel(bv) });
    }
  }

  walk('', a, b);
  return differences;
}

function getAtPath(obj, path) {
  var parts = path.split('.');
  var cur = obj;
  for (var i = 0; i < parts.length; i++) {
    if (cur === null || cur === undefined) return undefined;
    cur = cur[parts[i]];
  }
  return cur;
}

/**
 * Compare a store's Sheets result against its Postgres result and report
 * any discrepancy to Sentry, grouped by store+operation. Never throws.
 *
 * @param {object} params
 * @param {string} params.store - e.g. 'giftcards'
 * @param {string} params.operation - e.g. 'redeem'
 * @param {*} params.sheets - the Sheets-side result
 * @param {*} params.postgres - the Postgres-side result
 * @param {string[]} [params.ignoreKeys] - keys to exclude from comparison entirely
 * @param {string[]} [params.reportValuesFor] - keys whose actual values (not just
 *   paths/types) are safe to send to Sentry (e.g. non-PII fields like balances)
 * @returns {{match: boolean|null, differences: Array}}
 */
function compareAndReport(params) {
  try {
    params = params || {};
    var store = params.store;
    var operation = params.operation;
    var sheets = params.sheets;
    var postgres = params.postgres;
    var ignoreKeys = params.ignoreKeys || [];
    var reportValuesFor = params.reportValuesFor || [];

    var differences = diffValues(sheets, postgres, { ignoreKeys: ignoreKeys });

    if (differences.length === 0) {
      return { match: true, differences: [] };
    }

    var paths = differences.map(function (d) { return d.path; });
    log.warn('[dual-write] ' + store + '.' + operation + ' ' + differences.length +
      ' difference(s): ' + paths.join(', '));

    var extra = {
      differenceCount: differences.length,
      paths: paths.slice(0, MAX_REPORTED_PATHS)
    };

    if (reportValuesFor.length > 0) {
      var values = {};
      differences.forEach(function (d) {
        var key = d.path.split('.').pop();
        if (reportValuesFor.indexOf(key) !== -1) {
          values[d.path] = { sheets: getAtPath(sheets, d.path), postgres: getAtPath(postgres, d.path) };
        }
      });
      if (Object.keys(values).length > 0) extra.values = values;
    }

    var err = new Error('[dual-write] ' + store + '.' + operation + ' discrepancy');
    sentryCapture.captureExceptionSafe(err, {
      level: 'warning',
      tags: { component: 'dual-write', store: store, operation: operation },
      fingerprint: ['dual-write', store, operation],
      extra: extra
    });

    return { match: false, differences: differences };
  } catch (err) {
    var message = (err && err.message) || String(err);
    log.warn('[dual-write] comparison failed, treating as unknown: ' + message);
    return { match: null, differences: [] };
  }
}

module.exports = { compareAndReport: compareAndReport, diffValues: diffValues };
