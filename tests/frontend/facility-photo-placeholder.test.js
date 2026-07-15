'use strict';

// =============================================================================
// Phase 59 (REVIEW-03): content-image frames must not read as "broken/blank
// boxes" while their lazy image loads.
//
// The external review saw the Our Story image and the mobile "Homebrew Supplies"
// interior photo as empty bordered boxes. Investigation (2026-07-15): all the
// images return 200 on prod — they are `loading="lazy"` content photos below the
// fold, so the .facility-photo-img box (which has an 8px brown border) renders
// EMPTY until the image lazy-loads on scroll. A brand-tone placeholder + shimmer
// (CSS) fills that box; this JS is the progressive enhancement that STOPS the
// shimmer once each image loads by adding an `is-loaded` class.
//
// The image is NEVER hidden by JS — the placeholder sits behind it in CSS — so if
// this JS does not run, images still display (graceful degradation). This test
// pins only the class-toggling contract.
// =============================================================================

global.SHEETS_CONFIG = { SPREADSHEET_ID: 'test', MIDDLEWARE_URL: '' };
global.navigator = global.navigator || {};
global.navigator.vibrate = jest.fn();
global.navigator.standalone = false;
var FERMENT_KEY = 'sv-cart-ferment', INGREDIENT_KEY = 'sv-cart-ingredients', LEGACY_KEY = 'sv-reservation';
global.RESERVATION_KEY = LEGACY_KEY;
global.FERMENT_CART_KEY = FERMENT_KEY;
global.INGREDIENT_CART_KEY = INGREDIENT_KEY;
global.CART_KEYS = { FERMENT: FERMENT_KEY, INGREDIENTS: INGREDIENT_KEY, LEGACY_RESERVATION: LEGACY_KEY };
global.getReservation = function (k) { try { var r = localStorage.getItem(k); return r ? JSON.parse(r) : []; } catch (e) { return []; } };
global.saveReservation = function (i, k) { try { localStorage.setItem(k, JSON.stringify(i)); } catch (e) {} };
global.refreshAllReserveControls = function () {};
global.updateReservationBar = function () {};
global.refreshReservationDependents = function () {};
global.renderCartSidebar = function () {};
global.showToast = function () {};
global.trackEvent = jest.fn();
global.formatCurrency = function (n) { return '$' + parseFloat(n).toFixed(2); };
global.escapeHTML = function (s) { return String(s || ''); };
global.loadTimeslots = function () {};
global.updateCompletionEstimate = function () {};
global.PAYMENT_DISABLED = false;

var init = require('../../js/modules/13-init');

function makeImg(loadedAlready) {
  var img = document.createElement('img');
  img.className = 'facility-photo-img';
  // jsdom can't actually load; simulate "already complete" by defining the props.
  if (loadedAlready) {
    Object.defineProperty(img, 'complete', { value: true, configurable: true });
    Object.defineProperty(img, 'naturalWidth', { value: 1600, configurable: true });
  } else {
    Object.defineProperty(img, 'complete', { value: false, configurable: true });
    Object.defineProperty(img, 'naturalWidth', { value: 0, configurable: true });
  }
  return img;
}

describe('facility-photo placeholder load-state (REVIEW-03)', function () {
  beforeEach(function () { document.body.innerHTML = ''; });

  test('the init helper is exported', function () {
    expect(typeof init.initFacilityPhotoPlaceholders).toBe('function');
  });

  test('an already-loaded image is marked is-loaded immediately (no shimmer left running)', function () {
    var img = makeImg(true);
    document.body.appendChild(img);
    init.initFacilityPhotoPlaceholders();
    expect(img.classList.contains('is-loaded')).toBe(true);
  });

  test('a not-yet-loaded image stays un-marked until its load event fires', function () {
    var img = makeImg(false);
    document.body.appendChild(img);
    init.initFacilityPhotoPlaceholders();
    expect(img.classList.contains('is-loaded')).toBe(false);
    img.dispatchEvent(new Event('load'));
    expect(img.classList.contains('is-loaded')).toBe(true);
  });

  test('a broken image (error) is also marked is-loaded so the shimmer never runs forever', function () {
    var img = makeImg(false);
    document.body.appendChild(img);
    init.initFacilityPhotoPlaceholders();
    img.dispatchEvent(new Event('error'));
    expect(img.classList.contains('is-loaded')).toBe(true);
  });

  test('runs cleanly when there are no facility photos on the page', function () {
    expect(function () { init.initFacilityPhotoPlaceholders(); }).not.toThrow();
  });
});
