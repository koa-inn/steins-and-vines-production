// Real-Postgres Jest config — Phase 83 Plan 05 (DB-02 SC3, D-14).
//
// Isolated from jest.config.js on purpose: `npm test` (the command CLAUDE.md's pre-commit
// rule and every existing CI job run) must NEVER start a Testcontainers Postgres container.
// Run this config explicitly via `npm run test:db`.
module.exports = {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/__tests__/db/**/*.test.js'],
  // Per-test-file isolation for the shared admin API key env (same as the main config).
  setupFiles: ['<rootDir>/jest.setup.js'],
  // Coverage stays off here — these tests exercise lib/db.js via the SAME coverage-collected
  // paths as the main suite; double-counting would let jest.config.js's per-file floors be
  // gamed by a config nobody runs locally without Docker.
  collectCoverage: false,
  // Container startup + migration apply can take a while, especially on a cold image pull.
  testTimeout: 120000,
  maxWorkers: 2
};
