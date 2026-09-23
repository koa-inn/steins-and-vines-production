// ===== reCAPTCHA site key =====
window.RECAPTCHA_SITE_KEY = (typeof SHEETS_CONFIG !== 'undefined' && SHEETS_CONFIG.RECAPTCHA_SITE_KEY) ? SHEETS_CONFIG.RECAPTCHA_SITE_KEY : '';

// ===== Payment flag =====
var PAYMENT_DISABLED = false;
// HOLD-BACK (2026-09-23): beer.html is deployed but unlinked and unindexed until
// the beer programme launches. Flip to true (and remove the nav/hub/sitemap
// hold-back) with the launch commit.
var BEER_PAGE_LIVE = false;
