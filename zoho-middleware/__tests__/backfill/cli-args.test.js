'use strict';

/**
 * parseArgs unit tests for the backfill CLI — Phase 83 Plan 07 (DB-02 SC4).
 *
 * No Postgres/Docker dependency — runs in the main `npm test` suite.
 */

var path = require('path');
var backfill = require('../../scripts/backfill/backfill');
var rejectsLib = require('../../scripts/backfill/rejects');
var parseArgs = backfill.parseArgs;

describe('backfill CLI parseArgs', function () {
  it('applies defaults (schema, timezone, outDir, promote, acceptRejects)', function () {
    var opts = parseArgs(['--file=/x.xlsx', '--sheet=PlatoReadings']);
    expect(opts.file).toBe('/x.xlsx');
    expect(opts.sheet).toBe('PlatoReadings');
    expect(opts.schema).toBe('scratch_backfill');
    expect(opts.timezone).toBe('America/Vancouver');
    expect(opts.outDir).toBe(rejectsLib.DEFAULT_OUT_DIR);
    expect(opts.promote).toBe(false);
    expect(opts.acceptRejects).toBe(false);
    expect(opts.status).toBe(false);
    expect(opts.dryRun).toBe(false);
    expect(opts.yes).toBe(false);
  });

  it('throws when any argv value looks like a Postgres connection string (--target=)', function () {
    expect(function () {
      parseArgs(['--target=postgres://user:pass@host:5432/db']);
    }).toThrow('pass the database via BACKFILL_DATABASE_URL, never on the command line');
  });

  it('throws on any argv value matching postgres(ql):// regardless of which flag carries it', function () {
    expect(function () {
      parseArgs(['--file=postgresql://evil']);
    }).toThrow('pass the database via BACKFILL_DATABASE_URL, never on the command line');
  });

  it('throws on an unknown flag, listing valid flags', function () {
    expect(function () {
      parseArgs(['--bogus-flag']);
    }).toThrow(/unknown flag "--bogus-flag" — valid flags: /);
  });

  it('throws on an unknown sheet, listing listSpecs()', function () {
    expect(function () {
      parseArgs(['--sheet=Nope']);
    }).toThrow(/unknown sheet "Nope" — valid sheets: VesselHistory, PlatoReadings, FermSchedules/);
  });

  it('accepts a known sheet without error', function () {
    expect(function () {
      parseArgs(['--sheet=VesselHistory']);
    }).not.toThrow();
  });

  it('sets boolean flags true when present', function () {
    var opts = parseArgs(['--promote', '--accept-rejects', '--status', '--dry-run', '--yes']);
    expect(opts.promote).toBe(true);
    expect(opts.acceptRejects).toBe(true);
    expect(opts.status).toBe(true);
    expect(opts.dryRun).toBe(true);
    expect(opts.yes).toBe(true);
  });

  it('honours explicit --schema/--timezone/--out-dir overrides', function () {
    var outDir = path.join('/tmp', 'sv-backfill-test');
    var opts = parseArgs(['--schema=scratch_custom', '--timezone=UTC', '--out-dir=' + outDir]);
    expect(opts.schema).toBe('scratch_custom');
    expect(opts.timezone).toBe('UTC');
    expect(opts.outDir).toBe(outDir);
  });
});
