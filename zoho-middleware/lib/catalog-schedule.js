'use strict';

// Scheduled Zoho Inventory catalog jobs (boot pre-warm, 05:00/13:00 UTC
// warm-up, every-10-minute kiosk catalog refresh).
//
// Staging and production share ONE Zoho org and therefore one 1,000-calls/day
// Inventory quota (incident 2026-10-29, quick task 261029-zq1). Setting
// ZOHO_SCHEDULED_JOBS=off (staging) skips every job here; on-demand requests
// still fetch and cache as before.

/**
 * @param {Object} [env] - defaults to process.env
 * @returns {boolean} false only when ZOHO_SCHEDULED_JOBS is "off"
 */
function scheduledJobsEnabled(env) {
  var v = String((env || process.env).ZOHO_SCHEDULED_JOBS || '').trim().toLowerCase();
  return v !== 'off';
}

/**
 * Register the scheduled catalog jobs.
 *
 * @param {Object} deps
 * @param {Object} deps.cron      - node-cron
 * @param {Object} deps.catalog   - routes/catalog router (refreshProducts, refreshIngredients, refreshKioskCatalogInBackground)
 * @param {Object} deps.zohoAuth  - lib/zohoAuth
 * @param {Object} deps.log       - lib/logger
 * @param {Function} [deps.setTimeout]
 * @param {Object} [deps.env]     - defaults to process.env
 * @returns {{enabled: boolean}}
 */
function registerCatalogJobs(deps) {
  var cron = deps.cron;
  var catalog = deps.catalog;
  var zohoAuth = deps.zohoAuth;
  var log = deps.log;
  var later = deps.setTimeout || setTimeout;
  var bg = { background: true };

  if (!scheduledJobsEnabled(deps.env)) {
    log.info('[cron] ZOHO_SCHEDULED_JOBS=off — boot pre-warm, warm-up and kiosk catalog crons are DISABLED (on-demand requests still work)');
    return { enabled: false };
  }
  log.info('[cron] ZOHO_SCHEDULED_JOBS enabled — registering scheduled Zoho catalog jobs');

  if (zohoAuth.isAuthenticated()) {
    // Pre-warm product and ingredients caches on startup
    log.info('Pre-warming product cache...');
    catalog.refreshProducts(bg).then(function () {
      log.info('Product cache pre-warmed');
      // Pre-warm ingredients after products (sequential to avoid rate-limiting)
      log.info('Pre-warming ingredients cache...');
      return catalog.refreshIngredients(bg);
    }).then(function () {
      log.info('Ingredients cache pre-warmed');
    }).catch(function (err) {
      log.error('Pre-warm failed: ' + err.message);
    });

    // Scheduled cache warm-up: 5 AM and 1 PM UTC daily
    // Keeps Redis caches hot during business hours so user requests never
    // trigger a cold Zoho fetch. Products first, ingredients staggered 60s later
    // to stay within Zoho's per-minute rate limit.
    cron.schedule('0 5,13 * * *', function () {
      if (!zohoAuth.isAuthenticated()) {
        log.warn('[cron] Skipping warm-up — Zoho not authenticated');
        return;
      }
      log.info('[cron] Scheduled cache warm-up starting');
      catalog.refreshProducts(bg).then(function () {
        log.info('[cron] Products cache refreshed');
      }).catch(function (err) {
        log.error('[cron] Products warm-up failed: ' + err.message);
      });
      later(function () {
        if (!zohoAuth.isAuthenticated()) return;
        catalog.refreshIngredients(bg).then(function () {
          log.info('[cron] Ingredients cache refreshed');
        }).catch(function (err) {
          log.error('[cron] Ingredients warm-up failed: ' + err.message);
        });
      }, 60000); // 60s after products to avoid rate-limit burst
    });
    log.info('[cron] Scheduled warm-up registered: 05:00 and 13:00 UTC daily');
  }

  // Kiosk catalog: rebuild every 10 minutes from 9:00 to 19:50 shop time so the
  // 30-minute cache never expires during opening hours and a kiosk load never
  // waits on a cold Zoho rebuild (5-11 s in production logs, 2026-10). Registered
  // outside the authenticated branch and checked per run, so it still starts
  // working if Zoho authenticates after boot.
  cron.schedule('*/10 9-19 * * *', function () {
    if (!zohoAuth.isAuthenticated()) return;
    catalog.refreshKioskCatalogInBackground();
  }, { timezone: 'America/Vancouver' });
  log.info('[cron] Kiosk catalog refresh registered: every 10 min, 09:00-19:50 America/Vancouver');

  return { enabled: true };
}

module.exports = {
  scheduledJobsEnabled: scheduledJobsEnabled,
  registerCatalogJobs: registerCatalogJobs
};
