'use strict';

/**
 * Tests for __tests__/db/helpers/pg-harness.js — D-14 (CI never skips the real-Postgres suite)
 *
 * Runs in the MAIN Jest suite (npm test), not jest.db.config.js — no Docker needed here.
 * pg-harness.js must lazily require('@testcontainers/postgresql') only inside startPostgres(),
 * so simply requiring the module must never touch Docker or that package.
 *
 * Covers every <behavior> bullet in 83-05-PLAN.md Task 1:
 *   1. shouldSkipDbTests({ docker: false, ci: false }) -> true
 *   2. shouldSkipDbTests({ docker: false, ci: true }) -> false (CI must fail, not skip)
 *   3. shouldSkipDbTests({ docker: true, ci: false }) -> false
 *   4. shouldSkipDbTests({ docker: true, ci: true }) -> false
 *   5. CI derivation: process.env.CI is a non-empty value other than 'false'
 */

describe('pg-harness (db-harness-gate)', () => {
  var pgHarness;
  var SAVED_CI;

  beforeAll(() => {
    pgHarness = require('./db/helpers/pg-harness');
  });

  beforeEach(() => {
    SAVED_CI = process.env.CI;
  });

  afterEach(() => {
    if (SAVED_CI === undefined) {
      delete process.env.CI;
    } else {
      process.env.CI = SAVED_CI;
    }
  });

  describe('module shape', () => {
    it('exports the full pg-harness contract', () => {
      expect(typeof pgHarness.dockerAvailable).toBe('function');
      expect(typeof pgHarness.shouldSkipDbTests).toBe('function');
      expect(typeof pgHarness.describeDb).toBe('function');
      expect(typeof pgHarness.startPostgres).toBe('function');
      expect(typeof pgHarness.applyMigrations).toBe('function');
      expect(typeof pgHarness.rollbackEachTest).toBe('function');
    });

    it('never requires @testcontainers/postgresql at module load (lazy require inside startPostgres only)', () => {
      var resolved = require.resolve('@testcontainers/postgresql');
      expect(require.cache[resolved]).toBeUndefined();
    });
  });

  describe('shouldSkipDbTests truth table', () => {
    it('docker:false, ci:false -> true (skip locally, no Docker, not CI)', () => {
      expect(pgHarness.shouldSkipDbTests({ docker: false, ci: false })).toBe(true);
    });

    it('docker:false, ci:true -> false (CI must fail, not skip)', () => {
      expect(pgHarness.shouldSkipDbTests({ docker: false, ci: true })).toBe(false);
    });

    it('docker:true, ci:false -> false (Docker present locally, run for real)', () => {
      expect(pgHarness.shouldSkipDbTests({ docker: true, ci: false })).toBe(false);
    });

    it('docker:true, ci:true -> false', () => {
      expect(pgHarness.shouldSkipDbTests({ docker: true, ci: true })).toBe(false);
    });
  });

  describe('CI derivation (isCiEnv)', () => {
    it('process.env.CI unset -> not CI', () => {
      delete process.env.CI;
      expect(pgHarness.isCiEnv()).toBe(false);
    });

    it("process.env.CI === 'false' -> not CI", () => {
      process.env.CI = 'false';
      expect(pgHarness.isCiEnv()).toBe(false);
    });

    it("process.env.CI === '' -> not CI (empty string)", () => {
      process.env.CI = '';
      expect(pgHarness.isCiEnv()).toBe(false);
    });

    it("process.env.CI === 'true' -> CI (GitHub Actions default)", () => {
      process.env.CI = 'true';
      expect(pgHarness.isCiEnv()).toBe(true);
    });

    it("process.env.CI === '1' -> CI (any non-empty, non-'false' value)", () => {
      process.env.CI = '1';
      expect(pgHarness.isCiEnv()).toBe(true);
    });
  });

  describe('dockerAvailable()', () => {
    it('returns a boolean without throwing', () => {
      expect(typeof pgHarness.dockerAvailable()).toBe('boolean');
    });
  });
});
