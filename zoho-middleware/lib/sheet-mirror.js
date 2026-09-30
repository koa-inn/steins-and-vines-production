'use strict';

/**
 * Production-only Sheet mirror gate — Phase 83 (DB-02, D-07).
 *
 * Owner decision (2026-09-23): production keeps a fire-and-forget Google
 * Sheet mirror for every migrated table indefinitely; staging writes only to
 * its own Postgres and NEVER mirrors to the shared production workbook. This
 * module is the single gate every later phase's mirror call goes through.
 *
 * Staging and production BOTH run NODE_ENV=production (confirmed by this
 * codebase's own validateEnv.js D-02 boot assertion), so NODE_ENV alone
 * cannot distinguish them. The existing RAILWAY_ENVIRONMENT var only proves
 * "this process is running on Railway" (also documented in validateEnv.js) —
 * it has never been compared against a specific environment name anywhere in
 * this codebase and must not be reused for this check. Railway's
 * per-environment-name variable is RAILWAY_ENVIRONMENT_NAME; its recorded
 * values (docs/RUNBOOK.md, Plan 83-01 provisioning record) are
 * 'production' for the production environment and 'staging' for staging.
 *
 * This gate is intentionally NOT overridable by any env var or flag — the
 * only way to enable mirroring on another environment is a code change. A
 * Railway variable is operator-editable at runtime; the mirror's failure
 * mode (writing staging data into the shared production workbook) is severe
 * enough that it must require a deploy, not a Variables-tab edit. Comparison
 * is strict `===`, with no trim/lowercase — an environment name with
 * different case or stray whitespace is treated as "not production".
 */

var log = require('./logger');
var sentryCapture = require('./sentry-capture');

// Recorded in docs/RUNBOOK.md's "Railway Postgres (staging + production)"
// provisioning record (Plan 83-01) — frozen, not env-configurable.
var PRODUCTION_ENVIRONMENT_NAME = 'production';

/**
 * @returns {boolean} true only when this process is the production Railway
 *   environment (NODE_ENV=production AND RAILWAY_ENVIRONMENT_NAME matches
 *   the recorded production name exactly).
 */
function isProductionEnvironment() {
  return process.env.NODE_ENV === 'production' &&
    process.env.RAILWAY_ENVIRONMENT_NAME === PRODUCTION_ENVIRONMENT_NAME;
}

/**
 * @returns {boolean} whether the Sheet mirror should run. Currently
 *   identical to isProductionEnvironment() — kept as a separate export so
 *   call sites read intent ("is the mirror on") rather than environment
 *   trivia, and so a future non-environment condition could be added here
 *   without touching every caller.
 */
function isMirrorEnabled() {
  return isProductionEnvironment();
}

/**
 * Fire a mirror write without ever blocking or failing the caller. No-op
 * (fn never called) unless isMirrorEnabled(). When enabled, fn() is invoked
 * synchronously; any synchronous throw or promise rejection is swallowed and
 * reported via captureExceptionSafe — the mirror write is never awaited, and
 * its failure never surfaces to the caller, because the Postgres write is
 * the authoritative one.
 *
 * @param {string} label - short identifier for logs/Sentry tags (e.g. 'giftcards.redeem')
 * @param {function(): (Promise|void)} fn - the mirror write to attempt
 * @returns {undefined} always, synchronously
 */
function mirrorFireAndForget(label, fn) {
  if (!isMirrorEnabled()) return undefined;

  function reportFailure(err) {
    var message = (err && err.message) || String(err);
    log.warn('[sheet-mirror] ' + label + ' failed: ' + message);
    sentryCapture.captureExceptionSafe(err, {
      level: 'warning',
      tags: { component: 'sheet-mirror', mirror: label }
    });
  }

  try {
    var result = fn();
    if (result && typeof result.then === 'function') {
      result.catch(reportFailure);
    }
  } catch (err) {
    reportFailure(err);
  }

  return undefined;
}

/**
 * Log exactly one boot-time info line stating whether the mirror is enabled
 * and for which environment, so staging/production Railway logs are the
 * auditable proof of D-07.
 */
function logMirrorStatus() {
  var enabled = isMirrorEnabled();
  var envName = process.env.RAILWAY_ENVIRONMENT_NAME || 'unset';
  log.info('[sheet-mirror] mirror ' + (enabled ? 'ENABLED' : 'DISABLED') + ' (environment=' + envName + ')');
}

module.exports = {
  isProductionEnvironment: isProductionEnvironment,
  isMirrorEnabled: isMirrorEnabled,
  mirrorFireAndForget: mirrorFireAndForget,
  logMirrorStatus: logMirrorStatus,
  PRODUCTION_ENVIRONMENT_NAME: PRODUCTION_ENVIRONMENT_NAME
};
