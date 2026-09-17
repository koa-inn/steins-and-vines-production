// =============================================================================
// consent.js — cookie notice + Google Tag Manager gate
//
// Loaded synchronously in the <head> of every public page, in place of the
// inline GTM snippet. Nothing that sets a cookie loads until the visitor
// accepts: GTM (and with it GA4, Google Ads, the Meta pixel and Metricool) is
// injected only after "Accept", or immediately on later visits when an
// accepted choice is stored. "Decline" is remembered too. Either choice is
// asked again after a year. A "Cookie settings" control in the footer
// ([data-cookie-settings]) reopens the notice.
//
// Google Consent Mode v2 defaults are pushed as "denied" before anything
// else, so even if a tag were to load ahead of a choice it would run in
// cookieless mode. On accept they are updated to "granted".
//
// Not gated: Sentry (error monitoring, PII scrubbed), reCAPTCHA on checkout
// (bot protection), the first-party event beacon to Apps Script (no cookie),
// and the Behold Instagram feed on the home page (embedded content).
//
// The notice is skipped for the kiosk (staff iPad) and for automation
// (navigator.webdriver), so Playwright runs are unaffected.
//
// Plain ES5; not part of the concatenated bundle. See docs/TRACKING.md.
// =============================================================================
(function (window, document) {
  'use strict';

  var STORAGE_KEY = 'sv-cookie-consent';
  var GTM_ID = 'GTM-NHRCGLC5';
  var MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;
  var PRIVACY_HREF = '/privacy.html#cookies';

  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }

  gtag('consent', 'default', {
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
    analytics_storage: 'denied',
    wait_for_update: 500
  });

  function readChoice() {
    try {
      var raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      var v = JSON.parse(raw);
      if (!v || (v.choice !== 'accepted' && v.choice !== 'declined')) return null;
      if (typeof v.at !== 'number' || Date.now() - v.at > MAX_AGE_MS) return null;
      return v.choice;
    } catch (e) {
      return null;
    }
  }

  function writeChoice(choice) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ choice: choice, at: Date.now(), v: 1 }));
    } catch (e) { /* private mode / quota — the choice just isn't remembered */ }
  }

  var gtmLoaded = false;
  function loadGtm() {
    if (gtmLoaded) return;
    gtmLoaded = true;
    gtag('consent', 'update', {
      ad_storage: 'granted',
      ad_user_data: 'granted',
      ad_personalization: 'granted',
      analytics_storage: 'granted'
    });
    window.dataLayer.push({ 'gtm.start': new Date().getTime(), event: 'gtm.js' });
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtm.js?id=' + GTM_ID;
    (document.head || document.documentElement).appendChild(s);
  }

  function noticeSuppressed() {
    return window.navigator.webdriver === true ||
      window.location.search.indexOf('kiosk=1') !== -1 ||
      window.navigator.standalone === true;
  }

  var notice = null;

  function removeNotice() {
    if (notice && notice.parentNode) notice.parentNode.removeChild(notice);
    notice = null;
  }

  function buildNotice(current) {
    if (notice || !document.body) return;
    notice = document.createElement('div');
    notice.className = 'cookie-notice';
    notice.id = 'cookie-notice';
    notice.setAttribute('role', 'region');
    notice.setAttribute('aria-label', 'Cookie choices');

    var text = document.createElement('p');
    text.className = 'cookie-notice-text';
    text.appendChild(document.createTextNode(
      'We use cookies for analytics and advertising measurement. Booking and ordering work without them. '));
    var link = document.createElement('a');
    link.href = PRIVACY_HREF;
    link.textContent = 'Privacy Policy';
    text.appendChild(link);
    if (current) {
      var cur = document.createElement('span');
      cur.className = 'cookie-notice-current';
      cur.textContent = ' Current choice: ' + current + '.';
      text.appendChild(cur);
    }
    notice.appendChild(text);

    var actions = document.createElement('div');
    actions.className = 'cookie-notice-actions';
    var decline = document.createElement('button');
    decline.type = 'button';
    decline.className = 'cookie-notice-btn cookie-notice-btn--decline';
    decline.id = 'cookie-decline';
    decline.textContent = 'Decline';
    decline.addEventListener('click', declineCookies);
    var accept = document.createElement('button');
    accept.type = 'button';
    accept.className = 'cookie-notice-btn cookie-notice-btn--accept';
    accept.id = 'cookie-accept';
    accept.textContent = 'Accept';
    accept.addEventListener('click', acceptCookies);
    actions.appendChild(decline);
    actions.appendChild(accept);
    notice.appendChild(actions);

    document.body.appendChild(notice);
  }

  function acceptCookies() {
    writeChoice('accepted');
    loadGtm();
    removeNotice();
  }

  function declineCookies() {
    writeChoice('declined');
    removeNotice();
  }

  function openSettings() {
    removeNotice();
    buildNotice(readChoice());
  }

  // Returning visitor who already accepted: load tags as early as possible.
  if (readChoice() === 'accepted') loadGtm();

  function init() {
    if (readChoice() === null && !noticeSuppressed()) buildNotice(null);
    document.addEventListener('click', function (e) {
      var t = e.target;
      while (t && t !== document) {
        if (t.getAttribute && t.hasAttribute('data-cookie-settings')) {
          e.preventDefault();
          openSettings();
          return;
        }
        t = t.parentNode;
      }
    });
  }

  window.svConsent = {
    get: readChoice,
    accept: acceptCookies,
    decline: declineCookies,
    open: openSettings,
    gtmLoaded: function () { return gtmLoaded; }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window, document);
