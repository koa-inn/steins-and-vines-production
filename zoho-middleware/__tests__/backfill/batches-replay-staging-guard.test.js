'use strict';

/**
 * Production-only guard for scripts/backfill/batches-replay-to-sheet.js - Phase 94 Plan 06 (T-94-49).
 * Staging and production share one workbook and staging never mirrors, so the replay CLI must
 * refuse anywhere but the production Railway environment.
 */

var path = require('path');
var childProcess = require('child_process');
var replay = require('../../scripts/backfill/batches-replay-to-sheet');

var SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'backfill', 'batches-replay-to-sheet.js');
var KEYS = ['NODE_ENV', 'RAILWAY_ENVIRONMENT_NAME'];

describe('assertProductionEnvironment', function () {
  var saved = {};
  beforeEach(function () {
    KEYS.forEach(function (k) { saved[k] = process.env[k]; });
  });
  afterEach(function () {
    KEYS.forEach(function (k) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    });
  });

  it('passes in the production Railway environment', function () {
    process.env.NODE_ENV = 'production';
    process.env.RAILWAY_ENVIRONMENT_NAME = 'production';
    expect(replay.assertProductionEnvironment()).toBe(true);
  });

  it('throws on staging with the shared-workbook explanation', function () {
    process.env.NODE_ENV = 'production';
    process.env.RAILWAY_ENVIRONMENT_NAME = 'staging';
    expect(function () { replay.assertProductionEnvironment(); })
      .toThrow(/staging never mirrors[\s\S]*shared production workbook/);
  });

  it('throws when the Railway environment is unset or not exactly "production"', function () {
    process.env.NODE_ENV = 'production';
    delete process.env.RAILWAY_ENVIRONMENT_NAME;
    expect(function () { replay.assertProductionEnvironment(); }).toThrow(/staging never mirrors/);
    process.env.RAILWAY_ENVIRONMENT_NAME = 'Production';
    expect(function () { replay.assertProductionEnvironment(); }).toThrow();
    process.env.RAILWAY_ENVIRONMENT_NAME = ' production';
    expect(function () { replay.assertProductionEnvironment(); }).toThrow();
  });
});

describe('main() on staging', function () {
  it('exits 1 with the refusal before any connection is attempted', function () {
    var res = childProcess.spawnSync(process.execPath, [SCRIPT, '--since=2026-10-12T00:00:00Z'], {
      env: {
        PATH: process.env.PATH,
        NODE_ENV: 'production',
        RAILWAY_ENVIRONMENT_NAME: 'staging',
        BACKFILL_DATABASE_URL: 'postgres://invalid'
      },
      encoding: 'utf8',
      timeout: 20000
    });
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/staging never mirrors/);
    expect(res.stderr).toMatch(/shared production workbook/);
  });
});
