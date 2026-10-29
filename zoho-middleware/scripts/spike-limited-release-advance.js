#!/usr/bin/env node
/**
 * spike-limited-release-advance.js -- STAGING-ONLY Wave-0 live spike (Phase 100, D-16)
 *
 * Settles the undocumented Zoho advance behaviour (LV1-LV10) and whether HelcimPay
 * carries invoiceRequest.invoiceNumber into the card-transaction readback (LV11).
 * Staging talks to the LIVE Zoho org and LIVE Helcim account, so everything this
 * creates is cleaned up in a finally block and listed in a JSON ledger.
 *
 * USAGE (inside the staging container, via `railway ssh`):
 *   node scripts/spike-limited-release-advance.js --zoho
 *   node scripts/spike-limited-release-advance.js --helcim-init [--amount 1.00]
 *   node scripts/spike-limited-release-advance.js --helcim-readback TXN
 *   node scripts/spike-limited-release-advance.js --helcim-void TXN [--force]
 *
 * Never logs contact data or card data. Not required by any route or test.
 */

'use strict';

if (process.env.SENTRY_ENVIRONMENT !== 'staging') {
  console.error('REFUSING: SENTRY_ENVIRONMENT must be "staging" (got "' +
    (process.env.SENTRY_ENVIRONMENT || '') + '"). Spike is staging-only.');
  process.exit(2);
}

var crypto = require('crypto');
var axios = require('axios');
var cache = require('../lib/cache');
var helcim = require('../lib/helcim');
var zohoApi = require('../lib/zoho-api');
var zohoAuth = require('../lib/zohoAuth');
var moneyPath = require('../lib/money-path');

var zohoGet = zohoApi.zohoGet;
var zohoPost = zohoApi.zohoPost;

var EMBER_ITEM_ID = '109900000001719001';
var HELCIM_BASE = 'https://api.helcim.com/v2';

function arg(name, def) {
  var i = process.argv.indexOf('--' + name);
  if (i !== -1 && i + 1 < process.argv.length) return process.argv[i + 1];
  return def;
}
function flag(name) { return process.argv.indexOf('--' + name) !== -1; }
function out(label, obj) {
  console.log('\n### ' + label);
  if (obj !== undefined) console.log(typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2));
}
function errInfo(e) {
  var d = e && e.response && e.response.data;
  return { message: e && e.message, status: e && e.response && e.response.status, data: d };
}

function zohoDelete(path) {
  return zohoAuth.getAccessToken().then(function (token) {
    return axios.delete(zohoApi.ZOHO_API_BASE + path, {
      headers: { Authorization: 'Zoho-oauthtoken ' + token },
      params: { organization_id: process.env.ZOHO_ORG_ID },
      timeout: 15000
    }).then(function (r) { return r.data; });
  });
}

function helcimHeaders() {
  return {
    'api-token': process.env.HELCIM_API_TOKEN || '',
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  };
}

function boot() {
  return cache.init()
    .then(function () { helcim.init(); })
    .then(function () { return zohoAuth.init(); })
    .then(function () {
      if (!zohoAuth.isAuthenticated()) throw new Error('Zoho not authenticated');
    });
}

// ---------------------------------------------------------------------------
// --zoho
// ---------------------------------------------------------------------------
function runZoho() {
  var stamp = new Date().toISOString();
  var created = []; // {id, kind, extra}
  var cleanup = [];
  var ctx = {};

  function track(id, kind) { created.push({ id: id, kind: kind }); }
  function lines(withRate) {
    var ember = { item_id: EMBER_ITEM_ID, quantity: 1 };
    if (withRate) ember.rate = 230;
    return [
      ember,
      { item_id: process.env.MAKERS_FEE_ITEM_ID, quantity: 1 },
      { item_id: process.env.MATERIALS_FEE_ITEM_ID, quantity: 1 }
    ];
  }
  function createSO(label, withRate, confirm) {
    return zohoPost('/salesorders', {
      customer_id: ctx.contactId,
      reference_number: 'LIMITED-SPIKE',
      line_items: lines(withRate)
    }).then(function (r) {
      var so = r.salesorder;
      track(so.salesorder_id, 'salesorder');
      out(label + ' created (LV5 stock-0 creation OK)', {
        id: so.salesorder_id, number: so.salesorder_number, status: so.status,
        total: so.total, line_items: (so.line_items || []).map(function (l) {
          return { item_id: l.item_id, rate: l.rate, tax_id: l.tax_id, tax_percentage: l.tax_percentage, item_total: l.item_total };
        })
      });
      if (!confirm) return so;
      return zohoPost('/salesorders/' + so.salesorder_id + '/status/confirmed', {}).then(function (c) {
        out(label + ' confirmed', c && c.message);
        return so;
      });
    });
  }
  function pay(so, amount, ref, extra) {
    var body = {
      customer_id: ctx.contactId,
      payment_mode: 'creditcard',
      amount: amount,
      date: stamp.substring(0, 10),
      reference_number: ref,
      description: 'LIMITED-SPIKE deposit ' + so.salesorder_number,
      notes: 'spike-notes-probe',
      salesorders_to_apply: [{ salesorder_id: so.salesorder_id, amount_applied: amount }]
    };
    if (extra) body.salesorders_to_apply = extra;
    return zohoPost('/customerpayments', body).then(function (r) {
      var p = r.payment;
      track(p.payment_id, 'customerpayment');
      return p;
    });
  }
  function showPayment(label, id) {
    return zohoGet('/customerpayments/' + id).then(function (r) {
      var p = r.payment || {};
      out(label, {
        payment_id: p.payment_id, amount: p.amount, unused_amount: p.unused_amount,
        description: p.description, notes: p.notes, reference_number: p.reference_number,
        salesorder_fields: Object.keys(p).filter(function (k) { return /salesorder|order/i.test(k); }),
        invoices: p.invoices, salesorders: p.salesorders,
        keys: Object.keys(p)
      });
      return p;
    });
  }
  function showSO(label, id) {
    return zohoGet('/salesorders/' + id).then(function (r) {
      var s = r.salesorder || {};
      out(label, {
        status: s.status, total: s.total, balance: s.balance,
        advance_fields: Object.keys(s).filter(function (k) { return /payment|advance|paid|balance|credit/i.test(k); }).reduce(function (a, k) { a[k] = s[k]; return a; }, {}),
        invoiced_status: s.invoiced_status, paid_status: s.paid_status
      });
      return s;
    });
  }

  var soA, soB, soC, payA, payB, invoiceId;

  return zohoPost('/contacts', {
    contact_name: 'ZZ Spike LR ' + stamp,
    contact_type: 'customer'
  }).then(function (r) {
    ctx.contactId = r.contact.contact_id;
    track(ctx.contactId, 'contact');
    out('contact created', { id: ctx.contactId });
    return createSO('SO-A (draft)', true, false);
  }).then(function (s) { soA = s; return createSO('SO-B (confirmed)', true, true); })
    .then(function (s) { soB = s; return createSO('SO-C (no rate, LV9)', false, false); })
    .then(function (s) { soC = s; })
    // (3) payments with salesorders_to_apply
    .then(function () { return pay(soA, 50, 'SPIKE-' + Date.now()); })
    .then(function (p) { payA = p; return showPayment('LV1/LV6 payment A readback', p.payment_id); })
    .then(function () { return pay(soB, 50, 'SPIKE-' + Date.now() + 'B'); })
    .then(function (p) { payB = p; return showPayment('LV1/LV6 payment B readback', p.payment_id); })
    .then(function () {
      // duplicate reference number test
      return pay(soC, 1, payA.reference_number, [{ salesorder_id: soC.salesorder_id, amount_applied: 1 }])
        .then(function (p) { out('LV6 duplicate reference_number ACCEPTED', { id: p.payment_id }); })
        .catch(function (e) { out('LV6 duplicate reference_number REJECTED', errInfo(e)); });
    })
    // (4) SO state after payments
    .then(function () { return showSO('LV2 SO-A after payment', soA.salesorder_id); })
    .then(function () { return showSO('LV2 SO-B after payment', soB.salesorder_id); })
    // (5) list + search
    .then(function () {
      return zohoGet('/customerpayments', { customer_id: ctx.contactId }).then(function (r) {
        out('LV7 list by customer_id', (r.customerpayments || []).map(function (p) {
          return { payment_id: p.payment_id, unused_amount: p.unused_amount, has_unused_in_row: p.unused_amount !== undefined, description: p.description, reference_number: p.reference_number, keys: Object.keys(p) };
        }));
      });
    })
    .then(function () {
      return zohoGet('/customerpayments', { search_text: soB.salesorder_number }).then(function (r) {
        out('LV6/LV7 search_text=SO number', { count: (r.customerpayments || []).length, ids: (r.customerpayments || []).map(function (p) { return p.payment_id; }) });
      }).catch(function (e) { out('LV7 search_text FAILED', errInfo(e)); });
    })
    .then(function () {
      return zohoGet('/customerpayments', { description_contains: 'LIMITED-SPIKE', customer_id: ctx.contactId }).then(function (r) {
        out('LV7 description_contains filter', { count: (r.customerpayments || []).length });
      }).catch(function (e) { out('LV7 description_contains FAILED', errInfo(e)); });
    })
    // (6) convert SO-B to invoice, test auto-apply (LV3) and /credits (LV4)
    .then(function () { return moneyPath.ensureOpenInvoiceForSalesOrder(soB.salesorder_id); })
    .then(function (id) {
      invoiceId = id;
      track(id, 'invoice');
      return zohoGet('/invoices/' + id);
    })
    .then(function (r) {
      var inv = r.invoice || {};
      out('LV3 invoice after conversion', {
        id: inv.invoice_id, status: inv.status, total: inv.total, balance_due: inv.balance,
        payment_made: inv.payment_made, credits_applied: inv.credits_applied
      });
      return showPayment('LV3 payment B after conversion', payB.payment_id);
    })
    .then(function () {
      return zohoPost('/invoices/' + invoiceId + '/credits', {
        invoice_payments: [{ payment_id: payB.payment_id, amount_applied: 50 }]
      }).then(function (r) { out('LV4 /credits response', r && r.message); })
        .catch(function (e) { out('LV4 /credits FAILED', errInfo(e)); });
    })
    .then(function () { return zohoGet('/invoices/' + invoiceId); })
    .then(function (r) {
      var inv = r.invoice || {};
      out('LV4 invoice after /credits', { balance_due: inv.balance, payment_made: inv.payment_made, credits_applied: inv.credits_applied, status: inv.status });
      return showPayment('LV4 payment B after /credits', payB.payment_id);
    })
    // (7) LV10 multi-SO payment
    .then(function () {
      return pay(soA, 2, 'SPIKE-' + Date.now() + 'M', [
        { salesorder_id: soA.salesorder_id, amount_applied: 1 },
        { salesorder_id: soC.salesorder_id, amount_applied: 1 }
      ]).then(function (p) { return showPayment('LV10 multi-SO payment readback', p.payment_id); })
        .catch(function (e) { out('LV10 multi-SO payment FAILED', errInfo(e)); });
    })
    .catch(function (e) { out('SPIKE ERROR', errInfo(e)); })
    .then(function () {
      // (8) cleanup, reverse creation order
      var chain = Promise.resolve();
      var rev = created.slice().reverse();
      function rec(item, outcome) { cleanup.push({ id: item.id, kind: item.kind, outcome: outcome }); }
      rev.forEach(function (item) {
        chain = chain.then(function () {
          if (item.kind === 'customerpayment') {
            return zohoDelete('/customerpayments/' + item.id)
              .then(function () { rec(item, 'deleted'); })
              .catch(function (e) { rec(item, 'DELETE FAILED ' + JSON.stringify(errInfo(e))); });
          }
          if (item.kind === 'invoice') {
            return zohoPost('/invoices/' + item.id + '/status/void', {})
              .then(function () { return 'voided'; }, function (e) { return 'void failed ' + JSON.stringify(errInfo(e)); })
              .then(function (v) {
                return zohoDelete('/invoices/' + item.id)
                  .then(function () { rec(item, v + ' then deleted'); })
                  .catch(function (e) { rec(item, v + '; DELETE FAILED ' + JSON.stringify(errInfo(e))); });
              });
          }
          if (item.kind === 'salesorder') {
            return zohoDelete('/salesorders/' + item.id)
              .then(function () { rec(item, 'deleted directly (no void needed)'); })
              .catch(function (e1) {
                return zohoPost('/salesorders/' + item.id + '/status/void', {})
                  .then(function () { return zohoDelete('/salesorders/' + item.id); })
                  .then(function () { rec(item, 'direct delete failed (' + JSON.stringify(errInfo(e1)) + '); void then delete OK'); })
                  .catch(function (e2) { rec(item, 'LEFTOVER: ' + JSON.stringify(errInfo(e2))); });
              });
          }
          if (item.kind === 'contact') {
            return zohoDelete('/contacts/' + item.id)
              .then(function () { rec(item, 'deleted'); })
              .catch(function (e1) {
                return zohoPost('/contacts/' + item.id + '/inactive', {})
                  .then(function () { rec(item, 'delete refused (' + JSON.stringify(errInfo(e1)) + '); marked inactive'); })
                  .catch(function (e2) { rec(item, 'LEFTOVER: ' + JSON.stringify(errInfo(e2))); });
              });
          }
        });
      });
      return chain;
    })
    .then(function () {
      out('LEDGER', { created: created, cleanup: cleanup });
    });
}

// ---------------------------------------------------------------------------
// --helcim-*
// ---------------------------------------------------------------------------
function runHelcimInit() {
  var amount = parseFloat(arg('amount', '1.00'));
  var invNo = 'LR-SPIKE-' + crypto.randomBytes(4).toString('hex');
  var base = { paymentType: 'purchase', amount: amount, currency: 'CAD' };
  var nested = Object.assign({}, base, { invoiceRequest: { invoiceNumber: invNo, lineItems: [{ description: 'Spike deposit', quantity: 1, price: amount, total: amount }] } });
  return axios.post(HELCIM_BASE + '/helcim-pay/initialize', nested, { headers: helcimHeaders(), timeout: 10000 })
    .then(function (r) { return { form: 'invoiceRequest.invoiceNumber', data: r.data }; })
    .catch(function (e) {
      out('invoiceRequest form rejected', errInfo(e));
      var top = Object.assign({}, base, { invoiceNumber: invNo });
      return axios.post(HELCIM_BASE + '/helcim-pay/initialize', top, { headers: helcimHeaders(), timeout: 10000 })
        .then(function (r) { return { form: 'top-level invoiceNumber', data: r.data }; });
    })
    .then(function (res) {
      out('HELCIM INIT', {
        acceptedForm: res.form,
        invoiceNumberSent: invNo,
        checkoutToken: res.data.checkoutToken,
        secretToken: res.data.secretToken
      });
    });
}

function runHelcimReadback(txn) {
  return helcim.getCardTransactionById(txn).then(function (t) { out('READBACK (LV11)', t); });
}

function runHelcimVoid(txn) {
  return helcim.getCardTransactionById(txn).then(function (t) {
    out('READBACK before void', t);
    if (!flag('force') && String(t.invoiceNumber).indexOf('LR-SPIKE-') !== 0) {
      throw new Error('Refusing to void: invoiceNumber does not start with LR-SPIKE- (use --force after owner ok)');
    }
    return helcim.voidTransaction(txn).then(function (r) { out('VOID RESULT', r); });
  });
}

// ---------------------------------------------------------------------------
function main() {
  var txnR = arg('helcim-readback');
  var txnV = arg('helcim-void');
  var task;
  if (flag('zoho')) task = runZoho;
  else if (flag('helcim-init')) task = runHelcimInit;
  else if (txnR) task = function () { return runHelcimReadback(txnR); };
  else if (txnV) task = function () { return runHelcimVoid(txnV); };
  else {
    console.error('Usage: --zoho | --helcim-init [--amount 1.00] | --helcim-readback TXN | --helcim-void TXN [--force]');
    process.exit(1);
  }
  boot().then(task).then(function () { process.exit(0); }, function (e) {
    console.error('FAILED', JSON.stringify(errInfo(e)));
    process.exit(1);
  });
}

main();
