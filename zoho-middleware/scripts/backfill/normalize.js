/**
 * Trap-by-trap normalisers for the Sheets -> Postgres backfill pipeline.
 * Source: .planning/notes/sheets-to-postgres-data-conversion.md §2 (Traps 1-4c).
 *
 * Every normaliser REJECTS anything it cannot confidently convert — it never coerces
 * (D-12). A silently-NULLed date or a silently-truncated decimal is worse than a
 * failed row; failed rows go to the rejects report (rejects.js) for a human to review.
 *
 * Money/numeric values are emitted as decimal STRINGS (never floats) built from a
 * rounded integer of minor units — never `toFixed` on an unrounded float (Trap 1).
 */
'use strict';

var ISO_WITH_OFFSET_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
var DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
var NUMERIC_STRING_RE = /^-?\d+(\.\d+)?$/;

// ---------------------------------------------------------------------------
// Timezone helpers (Trap 2) — convert a "wall clock in `timezone`" into a real
// UTC instant using Intl.DateTimeFormat offset lookup, no dependency.
// ---------------------------------------------------------------------------

function getUtcOffsetMinutes(utcMs, timeZone) {
  var dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
  var parts = dtf.formatToParts(new Date(utcMs));
  var map = {};
  parts.forEach(function (p) {
    if (p.type !== 'literal') map[p.type] = p.value;
  });
  var hour = parseInt(map.hour, 10);
  if (hour === 24) hour = 0; // some ICU implementations emit "24" for midnight under h23
  var asIfUtc = Date.UTC(
    parseInt(map.year, 10),
    parseInt(map.month, 10) - 1,
    parseInt(map.day, 10),
    hour,
    parseInt(map.minute, 10),
    parseInt(map.second, 10)
  );
  return (asIfUtc - utcMs) / 60000;
}

// Converts wall-clock components (as observed in `timeZone`) to a true UTC instant
// (milliseconds since epoch). Iterates once more after the first offset lookup to
// stay correct across a DST transition.
function zonedTimeToUtc(year, monthIndex, day, hour, minute, second, timeZone) {
  var guess = Date.UTC(year, monthIndex, day, hour, minute, second);
  var offset1 = getUtcOffsetMinutes(guess, timeZone);
  var utc1 = guess - offset1 * 60000;
  var offset2 = getUtcOffsetMinutes(utc1, timeZone);
  return guess - offset2 * 60000;
}

// ---------------------------------------------------------------------------
// normalizeTimestamp (Trap 2)
// ---------------------------------------------------------------------------

function normalizeTimestamp(raw, opts) {
  opts = opts || {};
  var timezone = opts.timezone;

  if (raw instanceof Date) {
    if (isNaN(raw.getTime())) {
      return { ok: false, reason: 'invalid Date value' };
    }
    if (!timezone) {
      return { ok: false, reason: 'timezone required to interpret a Date (wall-clock) value' };
    }
    var instant = zonedTimeToUtc(
      raw.getUTCFullYear(), raw.getUTCMonth(), raw.getUTCDate(),
      raw.getUTCHours(), raw.getUTCMinutes(), raw.getUTCSeconds(),
      timezone
    );
    return { ok: true, value: new Date(instant).toISOString() };
  }

  if (typeof raw === 'string') {
    var trimmed = raw.trim();

    if (ISO_WITH_OFFSET_RE.test(trimmed)) {
      var d1 = new Date(trimmed);
      if (isNaN(d1.getTime())) {
        return { ok: false, reason: 'unparseable ISO timestamp: "' + trimmed + '"' };
      }
      return { ok: true, value: d1.toISOString() };
    }

    if (DATE_ONLY_RE.test(trimmed)) {
      if (!timezone) {
        return { ok: false, reason: 'timezone required to interpret a date-only value' };
      }
      var parts = trimmed.split('-');
      var y = parseInt(parts[0], 10);
      var mo = parseInt(parts[1], 10) - 1;
      var d = parseInt(parts[2], 10);
      var instant2 = zonedTimeToUtc(y, mo, d, 0, 0, 0, timezone);
      return {
        ok: true,
        value: new Date(instant2).toISOString(),
        note: 'date-only interpreted as local midnight'
      };
    }

    return {
      ok: false,
      reason: 'unrecognized timestamp format: "' + trimmed +
        '" (need ISO 8601 with Z/offset, or YYYY-MM-DD)'
    };
  }

  if (raw && typeof raw === 'object' && raw.cellError) {
    return { ok: false, reason: 'cell error: ' + raw.cellError };
  }

  return {
    ok: false,
    reason: 'unsupported timestamp type: ' + (raw === null ? 'null' : typeof raw)
  };
}

// ---------------------------------------------------------------------------
// normalizeEmpty (Trap 4 — '' vs NULL)
// ---------------------------------------------------------------------------

function normalizeEmpty(raw) {
  if (raw === null || raw === undefined) return { ok: true, value: null };
  if (typeof raw === 'string' && raw.trim() === '') return { ok: true, value: null };
  return { ok: false, reason: 'not empty' };
}

function isEmptyRaw(raw) {
  return normalizeEmpty(raw).ok;
}

// ---------------------------------------------------------------------------
// normalizeBoolean (Trap 4b)
// ---------------------------------------------------------------------------

function normalizeBoolean(raw) {
  if (raw === true || raw === false) return { ok: true, value: raw };
  if (raw === 'TRUE') return { ok: true, value: true };
  if (raw === 'FALSE') return { ok: true, value: false };
  return { ok: false, reason: 'expected boolean TRUE/FALSE, got ' + JSON.stringify(raw) };
}

// ---------------------------------------------------------------------------
// normalizeJson (Trap 4c)
// ---------------------------------------------------------------------------

function normalizeJson(raw) {
  if (typeof raw !== 'string') {
    return { ok: false, reason: 'expected a JSON string, got ' + typeof raw };
  }
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch (e) {
    return { ok: false, reason: 'invalid JSON: ' + e.message };
  }
}

// ---------------------------------------------------------------------------
// normalizeNumeric (Trap 1 — money/decimal as a string, never a float)
// ---------------------------------------------------------------------------

// Builds a fixed-point decimal string from an integer count of minor units
// (e.g. cents), without ever calling toFixed on an unrounded float.
function formatFixed(minorUnits, scale) {
  var sign = minorUnits < 0 ? '-' : '';
  var abs = Math.abs(minorUnits);
  var str = String(abs);
  while (str.length <= scale) str = '0' + str;
  if (scale === 0) return sign + str;
  var intPart = str.slice(0, str.length - scale);
  var fracPart = str.slice(str.length - scale);
  return sign + intPart + '.' + fracPart;
}

var NUMERIC_EPSILON = 1e-9;

function normalizeNumeric(raw, opts) {
  opts = opts || {};
  var precision = opts.precision;
  var scale = opts.scale != null ? opts.scale : 2;

  var num;
  if (typeof raw === 'number') {
    num = raw;
  } else if (typeof raw === 'string') {
    var trimmed = raw.trim();
    if (!NUMERIC_STRING_RE.test(trimmed)) {
      return { ok: false, reason: 'not a valid number: "' + raw + '"' };
    }
    num = Number(trimmed);
  } else {
    return { ok: false, reason: 'expected a number or numeric string, got ' + typeof raw };
  }

  if (!isFinite(num) || isNaN(num)) {
    return { ok: false, reason: 'not a finite number: ' + raw };
  }

  var factor = Math.pow(10, scale);
  var roundedMinor = Math.round(num * factor);
  var rounded = roundedMinor / factor;

  if (Math.abs(num - rounded) > NUMERIC_EPSILON) {
    return { ok: false, reason: 'more decimal places than scale ' + scale + ' allows' };
  }

  var formatted = formatFixed(roundedMinor, scale);

  if (precision != null) {
    var totalDigits = formatted.replace('-', '').replace('.', '').length;
    if (totalDigits > precision) {
      return { ok: false, reason: 'exceeds precision ' + precision + ' (scale ' + scale + ')' };
    }
  }

  return { ok: true, value: formatted };
}

// ---------------------------------------------------------------------------
// normalizeId (Trap 3 — zero-padded text IDs)
// ---------------------------------------------------------------------------

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeId(raw, opts) {
  opts = opts || {};
  if (typeof raw !== 'string') {
    return {
      ok: false,
      reason: 'expected a text ID, got ' + (raw === null ? 'null' : typeof raw)
    };
  }
  var trimmed = raw.trim();
  if (trimmed === '') {
    return { ok: false, reason: 'ID is empty' };
  }
  if (opts.prefix) {
    var pad = opts.pad || 0;
    var pattern = new RegExp('^' + escapeRegExp(opts.prefix) + '-\\d{' + pad + '}$');
    if (!pattern.test(trimmed)) {
      return {
        ok: false,
        reason: 'expected ' + opts.prefix + '-<' + pad + ' digits>, got "' + trimmed + '"'
      };
    }
  }
  return { ok: true, value: trimmed };
}

// ---------------------------------------------------------------------------
// normalizeText — internal only (not part of the public interface), used by
// normalizeRow for plain 'text' columns.
// ---------------------------------------------------------------------------

function normalizeText(raw) {
  if (typeof raw === 'string') return { ok: true, value: raw.trim() };
  return { ok: true, value: String(raw) };
}

// ---------------------------------------------------------------------------
// normalizeRow — dispatches every column of a spec through the right normaliser.
//
// Order per column: empty-check first (an empty OPTIONAL column becomes null
// regardless of its declared type — a '' timestamp does not get run through
// normalizeTimestamp and rejected); empty REQUIRED columns reject with reason
// 'required'. Non-empty values dispatch to the type-specific normaliser
// (timestamptz -> boolean -> jsonb -> numeric -> id -> text, per column type).
// ---------------------------------------------------------------------------

function normalizeRow(spec, rawValuesByHeader, opts) {
  opts = opts || {};
  var values = {};
  var reasons = [];
  var notes = [];

  spec.columns.forEach(function (col) {
    var raw = rawValuesByHeader[col.header];

    if (isEmptyRaw(raw)) {
      if (col.required) {
        reasons.push({ column: col.name, reason: 'required', rawType: typeof raw });
        return;
      }
      values[col.name] = null;
      return;
    }

    var result;
    switch (col.type) {
      case 'timestamptz':
        result = normalizeTimestamp(raw, { timezone: opts.timezone });
        break;
      case 'boolean':
        result = normalizeBoolean(raw);
        break;
      case 'jsonb':
        result = normalizeJson(raw);
        break;
      case 'numeric':
        result = normalizeNumeric(raw, { precision: col.precision, scale: col.scale });
        break;
      case 'id':
        result = normalizeId(raw, { prefix: col.prefix, pad: col.pad });
        break;
      case 'text':
        result = normalizeText(raw);
        break;
      default:
        result = { ok: false, reason: 'unknown column type: ' + col.type };
    }

    if (!result.ok) {
      reasons.push({ column: col.name, reason: result.reason, rawType: typeof raw });
      return;
    }

    values[col.name] = result.value;
    if (result.note) notes.push({ column: col.name, note: result.note });
  });

  if (reasons.length > 0) {
    return { ok: false, reasons: reasons };
  }
  return { ok: true, values: values, notes: notes };
}

module.exports = {
  normalizeTimestamp: normalizeTimestamp,
  normalizeEmpty: normalizeEmpty,
  normalizeBoolean: normalizeBoolean,
  normalizeJson: normalizeJson,
  normalizeNumeric: normalizeNumeric,
  normalizeId: normalizeId,
  normalizeRow: normalizeRow
};
