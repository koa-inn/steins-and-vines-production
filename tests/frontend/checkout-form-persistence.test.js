'use strict';

global.SHEETS_CONFIG = { SPREADSHEET_ID: 'test', MIDDLEWARE_URL: '' };
global.navigator = global.navigator || {};
global.navigator.vibrate = jest.fn();

beforeEach(function () {
  localStorage.clear();
  jest.clearAllMocks();
});

var checkout = require('../../js/modules/12-checkout');
var saveCheckoutFormDraft    = checkout.saveCheckoutFormDraft;
var restoreCheckoutFormDraft = checkout.restoreCheckoutFormDraft;
var clearCheckoutFormDraft   = checkout.clearCheckoutFormDraft;

var DRAFT_KEY = 'sv-checkout-form-draft';

// ---------------------------------------------------------------------------
// saveCheckoutFormDraft
// ---------------------------------------------------------------------------
describe('saveCheckoutFormDraft', function () {
  test('saves name, email, phone to localStorage', function () {
    document.body.innerHTML =
      '<input id="res-name" value="Jane Doe">' +
      '<input id="res-email" value="jane@test.com">' +
      '<input id="res-phone" value="604-555-1234">' +
      '<input id="res-website" value="spam">';

    saveCheckoutFormDraft();

    var raw = localStorage.getItem(DRAFT_KEY);
    expect(raw).not.toBeNull();
    var draft = JSON.parse(raw);
    expect(draft.name).toBe('Jane Doe');
    expect(draft.email).toBe('jane@test.com');
    expect(draft.phone).toBe('604-555-1234');
  });

  test('does NOT save the honeypot field (res-website)', function () {
    document.body.innerHTML =
      '<input id="res-name" value="Jane">' +
      '<input id="res-email" value="jane@test.com">' +
      '<input id="res-phone" value="604-555-1234">' +
      '<input id="res-website" value="spam-value">';

    saveCheckoutFormDraft();

    var raw = localStorage.getItem(DRAFT_KEY);
    var draft = JSON.parse(raw);
    expect(draft).not.toHaveProperty('website');
    expect(JSON.stringify(draft)).not.toContain('spam-value');
  });

  test('removes localStorage key when all fields are empty', function () {
    document.body.innerHTML =
      '<input id="res-name" value="">' +
      '<input id="res-email" value="">' +
      '<input id="res-phone" value="">';

    // Pre-populate to confirm it gets cleared
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ name: 'old', email: 'old@old.com', phone: '1234567890' }));

    saveCheckoutFormDraft();

    expect(localStorage.getItem(DRAFT_KEY)).toBeNull();
  });

  test('saves when only some fields are populated', function () {
    document.body.innerHTML =
      '<input id="res-name" value="Alex">' +
      '<input id="res-email" value="">' +
      '<input id="res-phone" value="">';

    saveCheckoutFormDraft();

    var raw = localStorage.getItem(DRAFT_KEY);
    expect(raw).not.toBeNull();
    var draft = JSON.parse(raw);
    expect(draft.name).toBe('Alex');
    expect(draft.email).toBe('');
    expect(draft.phone).toBe('');
  });
});

// ---------------------------------------------------------------------------
// restoreCheckoutFormDraft
// ---------------------------------------------------------------------------
describe('restoreCheckoutFormDraft', function () {
  test('restores saved name, email, phone into DOM inputs', function () {
    document.body.innerHTML =
      '<input id="res-name" value="">' +
      '<input id="res-email" value="">' +
      '<input id="res-phone" value="">';

    localStorage.setItem(DRAFT_KEY, JSON.stringify({
      name: 'Jane Doe',
      email: 'jane@test.com',
      phone: '604-555-1234'
    }));

    restoreCheckoutFormDraft();

    expect(document.getElementById('res-name').value).toBe('Jane Doe');
    expect(document.getElementById('res-email').value).toBe('jane@test.com');
    expect(document.getElementById('res-phone').value).toBe('604-555-1234');
  });

  test('does nothing if no saved draft exists', function () {
    document.body.innerHTML =
      '<input id="res-name" value="">' +
      '<input id="res-email" value="">' +
      '<input id="res-phone" value="">';

    // localStorage is empty (cleared in beforeEach)
    restoreCheckoutFormDraft();

    expect(document.getElementById('res-name').value).toBe('');
    expect(document.getElementById('res-email').value).toBe('');
    expect(document.getElementById('res-phone').value).toBe('');
  });

  test('does NOT restore if all saved fields are empty strings', function () {
    document.body.innerHTML =
      '<input id="res-name" value="existing">' +
      '<input id="res-email" value="existing@test.com">' +
      '<input id="res-phone" value="555-1234">';

    localStorage.setItem(DRAFT_KEY, JSON.stringify({ name: '', email: '', phone: '' }));

    restoreCheckoutFormDraft();

    // Inputs should remain unchanged — empty draft is a no-op
    expect(document.getElementById('res-name').value).toBe('existing');
    expect(document.getElementById('res-email').value).toBe('existing@test.com');
    expect(document.getElementById('res-phone').value).toBe('555-1234');
  });

  test('restores only present fields (partial draft)', function () {
    document.body.innerHTML =
      '<input id="res-name" value="">' +
      '<input id="res-email" value="">' +
      '<input id="res-phone" value="">';

    localStorage.setItem(DRAFT_KEY, JSON.stringify({ name: 'Bob', email: 'bob@test.com', phone: '' }));

    restoreCheckoutFormDraft();

    expect(document.getElementById('res-name').value).toBe('Bob');
    expect(document.getElementById('res-email').value).toBe('bob@test.com');
    // phone was empty string in draft — should not be set (only set if truthy)
    expect(document.getElementById('res-phone').value).toBe('');
  });

  test('does not throw when input elements are absent', function () {
    document.body.innerHTML = '';

    localStorage.setItem(DRAFT_KEY, JSON.stringify({ name: 'Jane', email: 'j@t.com', phone: '604-555-0000' }));

    expect(function () { restoreCheckoutFormDraft(); }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// clearCheckoutFormDraft
// ---------------------------------------------------------------------------
describe('clearCheckoutFormDraft', function () {
  test('removes the localStorage draft key', function () {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ name: 'Jane', email: 'j@j.com', phone: '6045551234' }));

    clearCheckoutFormDraft();

    expect(localStorage.getItem(DRAFT_KEY)).toBeNull();
  });

  test('is a no-op when no draft is stored', function () {
    // Should not throw
    expect(function () { clearCheckoutFormDraft(); }).not.toThrow();
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull();
  });
});
