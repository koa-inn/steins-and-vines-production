module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.js'],
  collectCoverage: true,
  collectCoverageFrom: [
    'lib/**/*.js'
  ],
  // Per-file thresholds for Campaign 1 targets; global is achievable with 5 tested files
  coverageThreshold: {
    global: { lines: 35 },
    './lib/validate.js': { lines: 98 },
    './lib/logger.js': { lines: 98 }
  },
  coverageReporters: ['text', 'lcov']
};
