module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.js'],
  // Per-file env isolation (clears the shared API key vars). See jest.setup.js.
  setupFiles: ['<rootDir>/jest.setup.js'],
  collectCoverage: true,
  collectCoverageFrom: [
    'lib/**/*.js',
    'routes/**/*.js' // D-05: include route files — was silently excluded before; D-08: no stale !-prefix exclusions found in config
  ],
  // Honest thresholds measured 2026-06-17 after all Phase 31 route tests exist.
  // Global: measured 63.04% lines — floor set at 62 (D-06: just below actual, 1pt headroom).
  // Per-file money-path floors (D-07): set just below each file's measured % Lines so
  //   the money path cannot silently regress even while the global stays low.
  //   Measured: checkout 53.08%, payments 37.20%, webhooks 62.96%, helcim 26.53%.
  // No !-prefix exclusions in collectCoverageFrom (D-08: honest number, no inflation).
  coverageThreshold: {
    global: { lines: 62 },
    // Money-path per-file floors (D-07):
    './routes/checkout.js':  { lines: 52 },
    './routes/payments.js':  { lines: 36 },
    './routes/webhooks.js':  { lines: 62 },
    './lib/helcim.js':       { lines: 25 },
    // Existing utility floors (restored — both measured at 100%):
    './lib/validate.js': { lines: 98 },
    './lib/logger.js':   { lines: 98 }
  },
  coverageReporters: ['text', 'lcov']
};
