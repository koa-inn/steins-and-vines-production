'use strict';

// Behavioural coverage for mirrorGiftCardState (Phase 84 D-04): the post-flip copy-state action
// that keeps the production GiftCards/GiftCardTransactions sheets an accurate read-only mirror
// once GIFT_CARDS_STORE flips to 'postgres'. Postgres is authoritative; this function runs NO
// Phase 51 business logic (no claim/settle, no balance arithmetic, no status rules) — it is a
// pure row-upsert + idempotent ledger-append.
//
// Extends the Task 1 fake-Sheets-runtime approach (adminapi-giftcard-ledger-ensure-sheet.test.js)
// with a GiftCards sheet fake, a fake LockService/acquireScriptLock, and Utilities.getUuid — all
// injected as `new Function` parameters so they shadow the real Apps Script globals of the same
// name. apps-script/adminApi.gs has no local Sheets/Lock runtime, so this is a model of the real
// APIs, not proof Google's runtime agrees; the live redeploy + probe (84-10) is the real gate.

var fs = require('fs');
var path = require('path');

var ADMIN_API_PATH = path.join(__dirname, '../../apps-script/adminApi.gs');

var GIFT_CARDS_HEADERS = [
  'cert_number', 'face_value', 'current_balance', 'status', 'issued_date',
  'issued_by', 'zoho_invoice_number', 'notes', 'last_updated', 'last_tx_ref'
];

var LEDGER_HEADERS = [
  'tx_id', 'cert_number', 'tx_ref', 'kind', 'amount', 'balance_before',
  'balance_after', 'status', 'needs_manual_review', 'created_at', 'settled_at', 'notes'
];

// --- Fake Sheets runtime ---------------------------------------------------------------------

function makeFakeSheet(headerRow) {
  var grid = headerRow ? [headerRow.slice()] : [];
  var calls = { setValue: [], appendRow: [] };

  return {
    _grid: grid,
    _calls: calls,

    getLastColumn: function () {
      return grid.reduce(function (max, row) { return Math.max(max, row.length); }, 0);
    },

    getLastRow: function () {
      return grid.length;
    },

    appendRow: function (values) {
      calls.appendRow.push(values.slice());
      grid.push(values.slice());
    },

    getDataRange: function () {
      var self = this;
      return {
        getValues: function () {
          return self._grid.map(function (r) { return r.slice(); });
        }
      };
    },

    getRange: function (row, col, numRows, numCols) {
      var self = this;
      if (numRows === undefined) {
        // single-cell addressing: getRange(row, col)
        return {
          setValue: function (value) {
            calls.setValue.push({ row: row, col: col, value: value });
            if (!self._grid[row - 1]) self._grid[row - 1] = [];
            self._grid[row - 1][col - 1] = value;
          },
          getValue: function () {
            return (self._grid[row - 1] || [])[col - 1];
          }
        };
      }
      if (numCols < 1) {
        throw new Error('The number of columns in the range must be at least 1.');
      }
      return {
        getValues: function () {
          var out = [];
          for (var r = 0; r < numRows; r++) {
            var src = self._grid[row - 1 + r] || [];
            var line = [];
            for (var c = 0; c < numCols; c++) {
              line.push(src[col - 1 + c] === undefined ? '' : src[col - 1 + c]);
            }
            out.push(line);
          }
          return out;
        },
        setFontWeight: function () { return this; }
      };
    },

    setFrozenRows: function () {}
  };
}

function makeFakeSpreadsheetApp(sheetsByName) {
  var sheets = sheetsByName || {};
  return {
    _sheets: sheets,
    getActiveSpreadsheet: function () {
      return {
        getSheetByName: function (name) {
          return Object.prototype.hasOwnProperty.call(sheets, name) ? sheets[name] : null;
        },
        insertSheet: function (name) {
          var s = makeFakeSheet([]);
          sheets[name] = s;
          return s;
        }
      };
    }
  };
}

function makeFakeLockService() {
  return {
    getScriptLock: function () {
      return {
        waitLock: function () {},
        releaseLock: function () {}
      };
    }
  };
}

function makeFakeUtilities() {
  var counter = 0;
  return {
    getUuid: function () {
      counter++;
      return 'FAKE-UUID-' + counter;
    }
  };
}

function loadAdminApi(spreadsheetApp) {
  var src = fs.readFileSync(ADMIN_API_PATH, 'utf8');
  var logged = [];
  var logger = { log: function (msg) { logged.push(String(msg)); } };
  var factory = new Function(
    'SpreadsheetApp', 'Logger', 'LockService', 'Utilities',
    src + '\nreturn {' +
      'mirrorGiftCardState: (typeof mirrorGiftCardState !== "undefined" ? mirrorGiftCardState : undefined),' +
      'GIFT_CARDS_SHEET_NAME: (typeof GIFT_CARDS_SHEET_NAME !== "undefined" ? GIFT_CARDS_SHEET_NAME : undefined),' +
      'GIFT_CARD_TRANSACTIONS_SHEET_NAME: (typeof GIFT_CARD_TRANSACTIONS_SHEET_NAME !== "undefined" ? GIFT_CARD_TRANSACTIONS_SHEET_NAME : undefined)' +
      '};'
  );
  var api = factory(spreadsheetApp, logger, makeFakeLockService(), makeFakeUtilities());
  api._logged = logged;
  return api;
}

function basePayload(overrides) {
  var payload = {
    cert_number: 'GC-000001',
    face_value: 50,
    current_balance: 40,
    status: 'active',
    issued_date: '2026-09-01',
    issued_by: 'kiosk',
    zoho_invoice_number: 'INV-000171',
    notes: '',
    last_updated: '2026-10-03T12:00:00.000Z',
    ledger_entry: {
      tx_ref: 'KIOSK-5000:GC-000001:redeem',
      kind: 'redeem',
      amount: -10,
      balance_before: 50,
      balance_after: 40,
      created_at: '2026-10-03T12:00:00.000Z',
      actor: 'postgres-mirror'
    }
  };
  if (overrides) {
    for (var k in overrides) {
      if (Object.prototype.hasOwnProperty.call(overrides, k)) payload[k] = overrides[k];
    }
  }
  return payload;
}

function rawSource() {
  return fs.readFileSync(ADMIN_API_PATH, 'utf8');
}

// --- Tests -------------------------------------------------------------------------------

describe('mirrorGiftCardState — unknown cert (row insert)', function () {
  test('appends a 10-column GiftCards row in header order with last_tx_ref set, and a settled ledger row', function () {
    var giftCards = makeFakeSheet(GIFT_CARDS_HEADERS.slice());
    var ledger = makeFakeSheet(LEDGER_HEADERS.slice());
    var app = makeFakeSpreadsheetApp({ GiftCards: giftCards, GiftCardTransactions: ledger });
    var api = loadAdminApi(app);

    var result = api.mirrorGiftCardState(basePayload());

    expect(result).toEqual({ ok: true, row_action: 'inserted', ledger_action: 'appended' });
    expect(giftCards._calls.appendRow.length).toBe(1);
    expect(giftCards._calls.appendRow[0]).toEqual([
      'GC-000001', 50, 40, 'active', '2026-09-01', 'kiosk', 'INV-000171', '', '2026-10-03T12:00:00.000Z', 'KIOSK-5000:GC-000001:redeem'
    ]);

    expect(ledger._calls.appendRow.length).toBe(1);
    var ledgerRow = ledger._calls.appendRow[0];
    var col = {};
    LEDGER_HEADERS.forEach(function (name, i) { col[name] = ledgerRow[i]; });
    expect(col.cert_number).toBe('GC-000001');
    expect(col.tx_ref).toBe('KIOSK-5000:GC-000001:redeem');
    expect(col.status).toBe('settled');
    expect(col.needs_manual_review).toBe(false);
    expect(col.notes).toMatch(/^mirror:postgres/);
  });
});

describe('mirrorGiftCardState — known cert (row update)', function () {
  test('updates current_balance/status/last_updated/zoho_invoice_number/last_tx_ref; leaves face_value/issued_date/issued_by untouched', function () {
    var giftCards = makeFakeSheet(GIFT_CARDS_HEADERS.slice());
    giftCards.appendRow(['GC-000002', 25, 25, 'active', '2026-08-01', 'staff-a', '', '', '2026-08-01T00:00:00.000Z', '']);
    giftCards._calls.appendRow = []; // reset after seeding fixture row
    var ledger = makeFakeSheet(LEDGER_HEADERS.slice());
    var app = makeFakeSpreadsheetApp({ GiftCards: giftCards, GiftCardTransactions: ledger });
    var api = loadAdminApi(app);

    var payload = basePayload({
      cert_number: 'GC-000002',
      face_value: 999, // must be ignored on update — face_value column untouched
      current_balance: 15,
      zoho_invoice_number: 'INV-000200',
      last_updated: '2026-10-03T13:00:00.000Z',
      ledger_entry: {
        tx_ref: 'KIOSK-5001:GC-000002:redeem',
        kind: 'redeem', amount: -10, balance_before: 25, balance_after: 15,
        created_at: '2026-10-03T13:00:00.000Z', actor: 'postgres-mirror'
      }
    });

    var result = api.mirrorGiftCardState(payload);

    expect(result).toEqual({ ok: true, row_action: 'updated', ledger_action: 'appended' });
    expect(giftCards._calls.appendRow).toEqual([]); // no new row
    var row = giftCards._grid[1];
    var col = {};
    GIFT_CARDS_HEADERS.forEach(function (name, i) { col[name] = row[i]; });
    expect(col.current_balance).toBe(15);
    expect(col.status).toBe('active');
    expect(col.last_updated).toBe('2026-10-03T13:00:00.000Z');
    expect(col.zoho_invoice_number).toBe('INV-000200');
    expect(col.last_tx_ref).toBe('KIOSK-5001:GC-000002:redeem');
    // Untouched columns:
    expect(col.face_value).toBe(25); // NOT 999 — face_value is never written on update
    expect(col.issued_date).toBe('2026-08-01');
    expect(col.issued_by).toBe('staff-a');
  });
});

describe('mirrorGiftCardState — idempotent on (cert_number, tx_ref)', function () {
  test('mirroring the same (cert, tx_ref) twice appends exactly one ledger row and reports skipped_duplicate the second time', function () {
    var giftCards = makeFakeSheet(GIFT_CARDS_HEADERS.slice());
    var ledger = makeFakeSheet(LEDGER_HEADERS.slice());
    var app = makeFakeSpreadsheetApp({ GiftCards: giftCards, GiftCardTransactions: ledger });
    var api = loadAdminApi(app);

    var payload = basePayload();
    var first = api.mirrorGiftCardState(payload);
    var second = api.mirrorGiftCardState(basePayload({ current_balance: 40 }));

    expect(first.ledger_action).toBe('appended');
    expect(second.ok).toBe(true);
    expect(second.ledger_action).toBe('skipped_duplicate');
    // Exactly one ledger row total (header row + 1 data row).
    expect(ledger._grid.length).toBe(2);
  });
});

describe('mirrorGiftCardState — ledger_entry null (invoice-number-only update)', function () {
  test('row is updated, ledger_action is none, no ledger sheet touched', function () {
    var giftCards = makeFakeSheet(GIFT_CARDS_HEADERS.slice());
    giftCards.appendRow(['GC-000003', 50, 50, 'active', '2026-08-01', 'staff-b', '', '', '2026-08-01T00:00:00.000Z', '']);
    giftCards._calls.appendRow = [];
    var ledger = makeFakeSheet(LEDGER_HEADERS.slice());
    var app = makeFakeSpreadsheetApp({ GiftCards: giftCards, GiftCardTransactions: ledger });
    var api = loadAdminApi(app);

    var payload = basePayload({
      cert_number: 'GC-000003',
      current_balance: 50,
      zoho_invoice_number: 'INV-000300',
      ledger_entry: null
    });

    var result = api.mirrorGiftCardState(payload);

    expect(result).toEqual({ ok: true, row_action: 'updated', ledger_action: 'none' });
    expect(ledger._calls.appendRow).toEqual([]);
    expect(ledger._grid.length).toBe(1); // header only
  });
});

describe('mirrorGiftCardState — validation failures (no writes)', function () {
  function freshApi() {
    var giftCards = makeFakeSheet(GIFT_CARDS_HEADERS.slice());
    var ledger = makeFakeSheet(LEDGER_HEADERS.slice());
    var app = makeFakeSpreadsheetApp({ GiftCards: giftCards, GiftCardTransactions: ledger });
    return { api: loadAdminApi(app), giftCards: giftCards, ledger: ledger };
  }

  test('cert_number not matching /^GC-[0-9]{6}$/ -> missing_fields, no writes', function () {
    var ctx = freshApi();
    var result = ctx.api.mirrorGiftCardState(basePayload({ cert_number: 'GC-42' }));
    expect(result).toEqual({ ok: false, error: 'missing_fields' });
    expect(ctx.giftCards._calls.appendRow).toEqual([]);
    expect(ctx.ledger._calls.appendRow).toEqual([]);
  });

  test('non-numeric current_balance -> invalid_amount, no writes', function () {
    var ctx = freshApi();
    var result = ctx.api.mirrorGiftCardState(basePayload({ current_balance: 'not-a-number' }));
    expect(result).toEqual({ ok: false, error: 'invalid_amount' });
    expect(ctx.giftCards._calls.appendRow).toEqual([]);
    expect(ctx.ledger._calls.appendRow).toEqual([]);
  });

  test("status outside active/depleted/void -> invalid_status, no writes", function () {
    var ctx = freshApi();
    var result = ctx.api.mirrorGiftCardState(basePayload({ status: 'claimed' }));
    expect(result).toEqual({ ok: false, error: 'invalid_status' });
    expect(ctx.giftCards._calls.appendRow).toEqual([]);
    expect(ctx.ledger._calls.appendRow).toEqual([]);
  });
});

describe('mirrorGiftCardState — formula-injection text fields pass through sanitizeInput', function () {
  test("notes '=IMPORTRANGE(...)' is written via sanitizeInput, not the raw payload value", function () {
    var giftCards = makeFakeSheet(GIFT_CARDS_HEADERS.slice());
    var ledger = makeFakeSheet(LEDGER_HEADERS.slice());
    var app = makeFakeSpreadsheetApp({ GiftCards: giftCards, GiftCardTransactions: ledger });
    var api = loadAdminApi(app);

    var dangerous = '=IMPORTRANGE("evil","Sheet1!A1")';
    api.mirrorGiftCardState(basePayload({ notes: dangerous, ledger_entry: null }));

    var row = giftCards._grid[1];
    var col = {};
    GIFT_CARDS_HEADERS.forEach(function (name, i) { col[name] = row[i]; });
    // sanitizeInput doesn't strip a bare leading '=' (it targets script/event-handler XSS, per
    // its own source) — this asserts the mirror ROUTES the value through sanitizeInput rather
    // than writing payload.notes directly, matching every other gift-card write path in this file.
    var sanitizeInputSrc = rawSource().match(/function sanitizeInput\([^]*?\n\}/)[0];
    var sanitizeInputFn = new Function('return ' + sanitizeInputSrc)();
    expect(col.notes).toBe(sanitizeInputFn(dangerous));
  });
});

describe('mirrorGiftCardState — doPost dispatch (D-04/D-07)', function () {
  test("source contains action === 'mirror_gift_card_state' inside the server_token block", function () {
    var src = rawSource();
    var doPostMarker = 'function doPost(';
    var doPostStart = src.indexOf(doPostMarker);
    expect(doPostStart).toBeGreaterThan(-1);
    var serverTokenMarker = 'if (payload.server_token) {';
    var serverTokenStart = src.indexOf(serverTokenMarker, doPostStart);
    expect(serverTokenStart).toBeGreaterThan(-1);
    var unknownActionMarker = 'Unknown server action';
    var unknownActionIdx = src.indexOf(unknownActionMarker, serverTokenStart);
    expect(unknownActionIdx).toBeGreaterThan(-1);
    var block = src.slice(serverTokenStart, unknownActionIdx);
    expect(block).toMatch(/action === 'mirror_gift_card_state'/);
  });

  test("source contains no adjust_gift_card action (D-07)", function () {
    var src = rawSource();
    expect(src).not.toMatch(/adjust_gift_card/);
  });

  test('mirrorGiftCardState exists as a top-level function exactly once', function () {
    var src = rawSource();
    var matches = src.match(/function mirrorGiftCardState\(/g) || [];
    expect(matches.length).toBe(1);
  });
});
