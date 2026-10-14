'use strict';

// Phase 90-06: guided invoice review in the batch detail view ("Possible invoices").
// fetch is mocked; the middleware route itself is built in Plan 90-05.

global.document = global.document || {};
global.google = { accounts: { oauth2: { initTokenClient: jest.fn() } } };
global.fetch = jest.fn();
global.localStorage = {
  _data: {},
  getItem: function (k) { return Object.prototype.hasOwnProperty.call(this._data, k) ? this._data[k] : null; },
  setItem: function (k, v) { this._data[k] = String(v); },
  removeItem: function (k) { delete this._data[k]; },
  clear: function () { this._data = {}; }
};
var _ssData = {};
global.sessionStorage = {
  getItem: function (k) { return _ssData[k] !== undefined ? _ssData[k] : null; },
  setItem: function (k, v) { _ssData[k] = v; },
  removeItem: function (k) { delete _ssData[k]; },
  clear: function () { Object.keys(_ssData).forEach(function (k) { delete _ssData[k]; }); }
};
global.SHEETS_CONFIG = { MIDDLEWARE_URL: 'http://mw.test' };

var _auth = require('../../js/lib/auth');
global.waitForGoogleIdentity = _auth.waitForGoogleIdentity;
global.gsiInitTokenClient = _auth.gsiInitTokenClient;
global.fetchGoogleUserInfo = _auth.fetchGoogleUserInfo;

var bp = require('../../js/brewpad');

function flush() {
  return new Promise(function (r) { setTimeout(r, 0); });
}
function flushAll() {
  return flush().then(flush).then(flush);
}

function candidate(over) {
  var c = {
    invoice_id: 'zi1',
    invoice_number: 'INV-000171',
    date: '2026-08-12',
    total: 85.5,
    status: 'paid',
    balance: 0,
    customer_name: 'Lush Ltd',
    has_kit_line: true,
    line_items: [{ name: 'Pale Ale Kit', quantity: 1, rate: 80 }],
    linked_batches: [],
    date_distance_days: 2
  };
  Object.keys(over || {}).forEach(function (k) { c[k] = over[k]; });
  return c;
}

var respondWith;
var adminPosts;

function installFetch() {
  adminPosts = [];
  global.fetch = jest.fn(function (url, options) {
    var u = String(url);
    if (u.indexOf('/api/batch/link-candidates') !== -1) {
      return respondWith(u);
    }
    if (u.indexOf('/api/batch/admin-proxy') !== -1 && options && options.method === 'POST') {
      var body = JSON.parse(options.body || '{}');
      adminPosts.push(body);
    }
    return Promise.resolve({
      ok: true, status: 200,
      json: function () { return Promise.resolve({ ok: true, data: { batches: [] } }); }
    });
  });
}

function jsonOk(body) {
  return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve(body); } });
}

function batch(over) {
  var b = {
    batch_id: 'SV-B-000010',
    product_name: 'Pale Ale',
    status: 'primary',
    zoho_so_number: '',
    source: 'manual',
    customer_id: '123',
    customer_name: 'Lush Ltd',
    start_date: '2026-08-10',
    last_updated: 'v1'
  };
  Object.keys(over || {}).forEach(function (k) { b[k] = over[k]; });
  return b;
}

function mount(b) {
  document.body.innerHTML = '<div id="bp-batch-detail-pane"></div><div id="bp-toast-container"></div>';
  bp._renderBatchDetailForTest({ batch: b, tasks: [], plato_readings: [] });
}

function candidateCalls() {
  return global.fetch.mock.calls.filter(function (c) {
    return String(c[0]).indexOf('/api/batch/link-candidates') !== -1;
  });
}

beforeEach(function () {
  global.localStorage.clear();
  respondWith = function () { return jsonOk({ candidates: [], index_available: true, inspected_all: true, uninspected_count: 0 }); };
  installFetch();
});

describe('Possible invoices section', function () {
  test('fetches candidates for an unlinked batch with the customer and start date', function () {
    mount(batch());
    return flushAll().then(function () {
      var calls = candidateCalls();
      expect(calls.length).toBe(1);
      expect(calls[0][0]).toBe('http://mw.test/api/batch/link-candidates?customer_id=123&customer_name=Lush%20Ltd&start_date=2026-08-10');
      expect(calls[0][1].credentials).toBe('include');
      var section = document.getElementById('bp-link-review');
      expect(section.textContent).toContain('Possible invoices');
      expect(section.textContent).toContain('Same customer, within 60 days of the start date. Nothing is saved until you tap Link invoice.');
    });
  });

  test('shows skeletons and aria-busy while loading', function () {
    respondWith = function () { return new Promise(function () {}); };
    mount(batch());
    var section = document.getElementById('bp-link-review');
    expect(section.getAttribute('aria-busy')).toBe('true');
    expect(section.querySelectorAll('.bp-link-skeleton').length).toBe(3);
    expect(section.textContent).toContain('Looking for invoices...');
  });

  test('renders one card per candidate with pill, date, total and distance', function () {
    respondWith = function () {
      return jsonOk({
        candidates: [
          candidate(),
          candidate({ invoice_id: 'zi2', invoice_number: 'INV-000172', status: 'partially_paid', has_kit_line: false, date_distance_days: 1 })
        ],
        inspected_all: true, uninspected_count: 0
      });
    };
    mount(batch());
    return flushAll().then(function () {
      var cards = document.querySelectorAll('.bp-link-card');
      expect(cards.length).toBe(2);
      expect(cards[0].textContent).toContain('INV-000171');
      expect(cards[0].querySelector('.bp-pill').textContent).toBe('Paid');
      expect(cards[0].textContent).toContain('12 Aug 2026');
      expect(cards[0].textContent).toContain('$85.50');
      expect(cards[0].textContent).toContain('2 days from start');
      expect(cards[0].textContent).toContain('1 x Pale Ale Kit');
      expect(cards[0].textContent).not.toContain('No kit or fee line');
      expect(cards[1].querySelector('.bp-pill').textContent).toBe('Part paid');
      expect(cards[1].textContent).toContain('No kit or fee line');
      var labels = Array.prototype.map.call(cards[0].querySelectorAll('button'), function (x) { return x.textContent; });
      expect(labels).toEqual(['Link invoice', 'Not this', 'Mark internal']);
    });
  });

  test('pill labels for overdue and unpaid', function () {
    respondWith = function () {
      return jsonOk({
        candidates: [
          candidate({ invoice_number: 'INV-1', status: 'overdue' }),
          candidate({ invoice_number: 'INV-2', status: 'sent' })
        ],
        inspected_all: true
      });
    };
    mount(batch());
    return flushAll().then(function () {
      var pills = document.querySelectorAll('.bp-pill');
      expect(pills[0].textContent).toBe('Overdue');
      expect(pills[1].textContent).toBe('Unpaid');
    });
  });

  test('shows at most 3 cards and at most 4 line rows then "+N more"', function () {
    var lines = [1, 2, 3, 4, 5, 6].map(function (n) { return { name: 'Item ' + n, quantity: n }; });
    respondWith = function () {
      return jsonOk({
        candidates: [1, 2, 3, 4].map(function (n) { return candidate({ invoice_number: 'INV-' + n, line_items: lines }); }),
        inspected_all: true
      });
    };
    mount(batch());
    return flushAll().then(function () {
      var cards = document.querySelectorAll('.bp-link-card');
      expect(cards.length).toBe(3);
      expect(cards[0].querySelectorAll('.bp-link-card-lines li').length).toBe(4);
      expect(cards[0].textContent).toContain('+2 more');
    });
  });

  test('already linked batches show a notice and keep Link invoice enabled; null shows unknown', function () {
    respondWith = function () {
      return jsonOk({
        candidates: [
          candidate({ invoice_number: 'INV-1', linked_batches: ['SV-B-000063'] }),
          candidate({ invoice_number: 'INV-2', linked_batches: null })
        ],
        inspected_all: true
      });
    };
    mount(batch());
    return flushAll().then(function () {
      var cards = document.querySelectorAll('.bp-link-card');
      expect(cards[0].textContent).toContain('Already linked to SV-B-000063');
      expect(cards[0].querySelector('[data-action="link"]').disabled).toBe(false);
      expect(cards[1].textContent).toContain('Link status unknown');
      expect(cards[1].querySelector('[data-action="link"]').disabled).toBe(false);
      expect(cards[1].textContent).not.toContain('Already linked');
    });
  });

  test('escapes server-supplied text', function () {
    respondWith = function () {
      return jsonOk({
        candidates: [candidate({ invoice_number: 'INV-<img src=x>', line_items: [{ name: '<script>x</script>', quantity: 1 }], linked_batches: ['<b>x</b>'] })],
        inspected_all: true
      });
    };
    mount(batch());
    return flushAll().then(function () {
      var section = document.getElementById('bp-link-review');
      expect(section.querySelector('img')).toBeNull();
      expect(section.querySelector('script')).toBeNull();
      expect(section.querySelector('b')).toBeNull();
    });
  });

  test('uninspected hint appears only when not all invoices were checked', function () {
    respondWith = function () {
      return jsonOk({ candidates: [candidate()], inspected_all: false, uninspected_count: 3 });
    };
    mount(batch());
    return flushAll().then(function () {
      var section = document.getElementById('bp-link-review');
      expect(section.textContent).toContain('3 more invoices from this customer in the window were not checked. Use Search all invoices.');
      expect(section.querySelector('button[data-action="search-all"]')).not.toBeNull();
    }).then(function () {
      respondWith = function () { return jsonOk({ candidates: [candidate()], inspected_all: true, uninspected_count: 0 }); };
      mount(batch());
      return flushAll();
    }).then(function () {
      var section = document.getElementById('bp-link-review');
      expect(section.textContent).not.toContain('not checked');
      expect(section.querySelector('button[data-action="search-all"]')).toBeNull();
    });
  });

  test('Not this hides the card, persists, and never writes', function () {
    respondWith = function () {
      return jsonOk({ candidates: [candidate({ invoice_number: 'INV-1' }), candidate({ invoice_number: 'INV-2' })], inspected_all: true });
    };
    mount(batch());
    return flushAll().then(function () {
      document.querySelector('.bp-link-card [data-action="dismiss"]').click();
      var cards = document.querySelectorAll('.bp-link-card');
      expect(cards.length).toBe(1);
      expect(cards[0].getAttribute('data-so-number')).toBe('INV-2');
      expect(JSON.parse(global.localStorage.getItem('bp-link-dismissed:SV-B-000010'))).toEqual(['INV-1']);
      expect(adminPosts.length).toBe(0);
      // Re-open the same batch: the dismissed card stays hidden.
      mount(batch());
      return flushAll();
    }).then(function () {
      var cards = document.querySelectorAll('.bp-link-card');
      expect(cards.length).toBe(1);
      expect(cards[0].getAttribute('data-so-number')).toBe('INV-2');
    });
  });

  test('dismissing every card shows the empty state', function () {
    respondWith = function () { return jsonOk({ candidates: [candidate({ invoice_number: 'INV-1' })], inspected_all: true }); };
    mount(batch());
    return flushAll().then(function () {
      document.querySelector('[data-action="dismiss"]').click();
      var section = document.getElementById('bp-link-review');
      expect(section.querySelectorAll('.bp-link-card').length).toBe(0);
      expect(section.textContent).toContain('No matching invoices found');
    });
  });

  test('corrupt localStorage dismissals are treated as empty', function () {
    global.localStorage.setItem('bp-link-dismissed:SV-B-000010', '{not json');
    respondWith = function () { return jsonOk({ candidates: [candidate()], inspected_all: true }); };
    mount(batch());
    return flushAll().then(function () {
      expect(document.querySelectorAll('.bp-link-card').length).toBe(1);
    });
  });

  test('blank customer: no fetch and the no-customer message', function () {
    mount(batch({ customer_id: '', customer_name: '' }));
    return flushAll().then(function () {
      expect(candidateCalls().length).toBe(0);
      expect(document.getElementById('bp-link-review').textContent).toContain('This batch has no customer, so no invoices can be suggested.');
    });
  });

  test('Walk-In customer: no fetch', function () {
    mount(batch({ customer_id: '9', customer_name: 'Walk-In' }));
    return flushAll().then(function () {
      expect(candidateCalls().length).toBe(0);
      expect(document.getElementById('bp-link-review').textContent).toContain('no invoices can be suggested');
    });
  });

  test('zero candidates: empty state with both buttons', function () {
    mount(batch());
    return flushAll().then(function () {
      var section = document.getElementById('bp-link-review');
      expect(section.textContent).toContain('No matching invoices found');
      expect(section.textContent).toContain('Try Search all invoices, or mark this batch Internal if it was made for the shop.');
      var labels = Array.prototype.map.call(section.querySelectorAll('button'), function (x) { return x.textContent; });
      expect(labels).toEqual(['Search all invoices', 'Mark internal']);
    });
  });

  test('502 shows an alert with Try again, which refetches', function () {
    var calls = 0;
    respondWith = function () {
      calls++;
      if (calls === 1) {
        return Promise.resolve({ ok: false, status: 502, json: function () { return Promise.resolve({ error: 'zoho' }); } });
      }
      return jsonOk({ candidates: [candidate()], inspected_all: true });
    };
    mount(batch());
    return flushAll().then(function () {
      var alertEl = document.querySelector('#bp-link-review [role="alert"]');
      expect(alertEl.textContent).toBe('Invoice lookup failed. Zoho may be busy, try again in a minute or search manually.');
      document.querySelector('#bp-link-review [data-action="retry"]').click();
      return flushAll();
    }).then(function () {
      expect(candidateCalls().length).toBe(2);
      expect(document.querySelectorAll('.bp-link-card').length).toBe(1);
    });
  });

  test('Search all invoices opens the existing search panel', function () {
    mount(batch());
    return flushAll().then(function () {
      expect(document.getElementById('bp-link-so-search').style.display).toBe('none');
      document.querySelector('#bp-link-review [data-action="search-all"]').click();
    }).then(function () {
      // #bp-link-so-btn is wired by the detail binder; the click must have been forwarded to it.
      expect(document.getElementById('bp-link-so-search').style.display).toBe('');
    });
  });

  test('linked and Internal batches get no review section and no fetch', function () {
    mount(batch({ zoho_so_number: 'INV-000171' }));
    expect(document.getElementById('bp-link-review')).toBeNull();
    mount(batch({ source: 'internal' }));
    expect(document.getElementById('bp-link-review')).toBeNull();
    return flushAll().then(function () {
      expect(candidateCalls().length).toBe(0);
    });
  });

  test('rendering the section never calls update_batch', function () {
    respondWith = function () { return jsonOk({ candidates: [candidate()], inspected_all: true }); };
    mount(batch());
    return flushAll().then(function () {
      expect(adminPosts.length).toBe(0);
    });
  });

  test('exposes the load seam', function () {
    expect(typeof bp._loadLinkCandidatesForTest).toBe('function');
  });
});
