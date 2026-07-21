'use strict';

// Tests for the bottling-invite SEND-TRACKING UI (batch detail pane).
//
// Feature: after a bottling invite is sent, the batch record carries
// bottling_invite_sent_at (+ bottling_invite_email), stamped by the middleware.
// The detail pane must then:
//   - show an "Invite sent {date} to {email}" note, and
//   - relabel the action button "Resend Invite" (vs "Send Bottling Invite").
// A batch with no prior send shows neither.

global.window = global.window || {};
global.navigator = global.navigator || {};
global.google = { accounts: { oauth2: { initTokenClient: jest.fn() } } };
global.fetch = jest.fn();
global.localStorage = {
  _data: {},
  getItem: function (k) { return this._data[k] || null; },
  setItem: function (k, v) { this._data[k] = v; },
  removeItem: function (k) { delete this._data[k]; },
  clear: function () { this._data = {}; }
};
global.sessionStorage = global.localStorage;

global.SHEETS_CONFIG = {
  MIDDLEWARE_URL: 'http://mw.test',
  MW_API_KEY: 'test-api-key',
  SPREADSHEET_ID: 'test-id',
  GOOGLE_CLIENT_ID: 'test-client-id',
  STAFF_EMAILS: 'test@example.com',
  API_BASE: 'https://script.google.com/test',
  SERVER_TOKEN: 'test-token',
  ADMIN_API_URL: 'https://script.google.com/test/admin'
};

var _auth = require('../../js/lib/auth');
global.waitForGoogleIdentity = _auth.waitForGoogleIdentity;
global.gsiInitTokenClient = _auth.gsiInitTokenClient;
global.fetchGoogleUserInfo = _auth.fetchGoogleUserInfo;

var bp = require('../../js/brewpad');

function renderDetailPane(batch) {
  document.body.innerHTML = '<div id="bp-batch-detail-pane"></div>';
  bp._renderBatchDetailForTest({ batch: batch, tasks: [], plato_readings: [] });
  return document.getElementById('bp-batch-detail-pane');
}

var BASE_BATCH = {
  batch_id: 'SV-B-000200',
  status: 'primary',
  product_name: 'Pinot Noir',
  customer_name: 'Jane Doe',
  customer_email: 'jane@example.ca'
};

function withOverrides(extra) {
  var out = {};
  Object.keys(BASE_BATCH).forEach(function (k) { out[k] = BASE_BATCH[k]; });
  Object.keys(extra || {}).forEach(function (k) { out[k] = extra[k]; });
  return out;
}

describe('bottling-invite send tracking — batch detail render', function () {
  test('exposes the render test hook', function () {
    expect(typeof bp._renderBatchDetailForTest).toBe('function');
  });

  test('never-sent batch shows "Send Bottling Invite" and no sent note', function () {
    var pane = renderDetailPane(withOverrides({}));
    var btn = pane.querySelector('#bp-bottling-invite-btn');
    expect(btn).not.toBeNull();
    expect(btn.textContent).toBe('Send Bottling Invite');
    expect(pane.querySelector('#bp-invite-sent-note')).toBeNull();
  });

  test('previously-sent batch shows the sent note and a "Resend Invite" button', function () {
    var pane = renderDetailPane(withOverrides({
      bottling_invite_sent_at: '2026-07-15T18:03:00.000Z',
      bottling_invite_email: 'jane@example.ca'
    }));
    var btn = pane.querySelector('#bp-bottling-invite-btn');
    expect(btn).not.toBeNull();
    expect(btn.textContent).toBe('Resend Invite');

    var note = pane.querySelector('#bp-invite-sent-note');
    expect(note).not.toBeNull();
    expect(note.textContent).toContain('2026-07-15');
    expect(note.textContent).toContain('jane@example.ca');
  });

  test('falls back to customer_email in the note when the stamped email is absent', function () {
    var pane = renderDetailPane(withOverrides({
      bottling_invite_sent_at: '2026-07-15T18:03:00.000Z'
      // no bottling_invite_email
    }));
    var note = pane.querySelector('#bp-invite-sent-note');
    expect(note).not.toBeNull();
    expect(note.textContent).toContain('jane@example.ca');
  });

  test('no invite button at all when the batch has no customer email', function () {
    var pane = renderDetailPane(withOverrides({
      customer_email: '',
      bottling_invite_sent_at: '2026-07-15T18:03:00.000Z'
    }));
    expect(pane.querySelector('#bp-bottling-invite-btn')).toBeNull();
    expect(pane.querySelector('#bp-invite-sent-note')).toBeNull();
  });
});
