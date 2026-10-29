'use strict';

// ---------------------------------------------------------------------------
// WHY ADVANCE (Phase 100 D-01): a limited-release deposit is a customer
// liability until the kit is invoiced on brew day, so it is booked as an
// unapplied advance against the SO with salesorders_to_apply. This file is the
// ONE sanctioned use of salesorders_to_apply in the codebase (see the ban in
// lib/money-path.js finalizeSalesOrderInvoiceAndApplyPayment). Never import
// bookSalesOrderDepositAdvance from checkout, collect or kiosk SO-pay paths.
// Brew day applies the advance with POST /invoices/{id}/credits (Plan 08).
//
// Spike facts (100-SPIKE-RESULTS.md): salesorders_to_apply does NOT link the
// payment to the SO in Zoho, so the link is our own description text; notes
// are dropped on payments; duplicate reference_numbers are accepted; one
// payment per SO; cleanup order is payment -> SO (draft SOs delete directly).
// ---------------------------------------------------------------------------

var log = require('./logger');
var LR = require('./limited-releases');

// Lazy getters so route tests can mock these.
function getZoho() { return require('./zoho-api'); }
function getCache() { return require('./cache'); }
function getHelpers() { return require('./checkout-helpers'); }
function getConstants() { return require('./constants'); }

var RATE_TTL = 600;
var DESCRIPTION_MARKER = LR.CAMPAIGN_REFERENCE + ' deposit ';

function has(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

/**
 * Live Zoho rate for an allowlisted kit. Fails closed.
 * @param {string} itemId
 * @returns {Promise<number>}
 */
function getKitRate(itemId) {
  if (typeof itemId !== 'string' || !has(LR.ALLOWLIST, itemId)) {
    return Promise.reject(new Error('Kit not in limited-release allowlist'));
  }
  var cache = getCache();
  var key = 'lr:itemrate:' + itemId;
  return Promise.resolve(cache.get(key)).then(function (hit) {
    var cached = parseFloat(hit);
    if (cached > 0) return cached;
    return getZoho().zohoGet('/items/' + itemId).then(function (data) {
      var item = data && data.item;
      if (!item) throw new Error('Kit item not found in Zoho: ' + itemId);
      if (item.status !== 'active') throw new Error('Kit item is not active: ' + itemId);
      var rate = parseFloat(item.rate);
      if (!(rate > 0)) throw new Error('Kit item has no valid rate: ' + itemId);
      return Promise.resolve(cache.set(key, rate, RATE_TTL)).catch(function () {}).then(function () {
        return rate;
      });
    });
  });
}

/**
 * Resolve Maker's Fee + Materials Fee items (numeric Zoho ids only).
 * @returns {Promise<{makers:{item_id:string,rate:number}, materials:{item_id:string,rate:number}}>}
 */
function resolveFeeItems() {
  var helpers = getHelpers();
  var C = getConstants();
  return Promise.resolve(getCache().get(C.CACHE_KEYS.SERVICES)).then(function (services) {
    if (!Array.isArray(services) || services.length === 0) {
      services = helpers.readServicesSnapshot();
    }
    var mk = helpers.findMakersFeeItem(services, process.env.MAKERS_FEE_ITEM_ID);
    var mt = helpers.findMaterialsFeeItem(services, process.env.MATERIALS_FEE_ITEM_ID);
    function bad(s) {
      return !s || !/^\d+$/.test(String(s.item_id || '')) || !(parseFloat(s.rate) >= 0);
    }
    if (bad(mk) || bad(mt)) {
      var err = new Error('Fee items unavailable');
      err.isFeeConfig = true;
      throw err;
    }
    return {
      makers: { item_id: String(mk.item_id), rate: parseFloat(mk.rate) },
      materials: { item_id: String(mt.item_id), rate: parseFloat(mt.rate) }
    };
  });
}

/**
 * Build the SO payload for one kit unit. No tax_id: Zoho applies each item's
 * own tax (kit is zero-rated, fees carry their configured tax).
 */
function buildDepositSalesOrder(o) {
  var unit = o.unit;
  var notes = 'Limited release deposit: $' + LR.DEPOSIT_PER_KIT + ' paid online. ' +
    'Helcim txn ' + o.txnId + '. ' +
    'Release: ' + unit.release_label + '. ' +
    'Kit ' + unit.unitIndex + ' of ' + unit.unitCount + '. ' +
    'Consent: "' + o.consentText + '" at ' + o.consentAt + '. ' +
    "Maker's Fee and Materials Fee are on this SO and are invoiced on brew day.";
  return {
    customer_id: o.customerId,
    date: o.date,
    reference_number: LR.CAMPAIGN_REFERENCE,
    line_items: [
      { item_id: unit.item_id, quantity: 1, rate: o.kitRate },
      { item_id: o.fees.makers.item_id, quantity: 1, rate: o.fees.makers.rate },
      { item_id: o.fees.materials.item_id, quantity: 1, rate: o.fees.materials.rate }
    ],
    notes: notes
  };
}

/**
 * Book the deposit as an unapplied advance (the sanctioned exception).
 * Resolves the Zoho response; payment id at res.payment.payment_id.
 */
function bookSalesOrderDepositAdvance(o) {
  return getZoho().zohoPostOnce('/customerpayments', {
    customer_id: o.customerId,
    payment_mode: 'creditcard',
    amount: o.amount,
    date: o.date,
    reference_number: String(o.helcimTxnId),
    description: DESCRIPTION_MARKER + o.soNumber + ' (Helcim ' + o.helcimTxnId + ')',
    salesorders_to_apply: [{ salesorder_id: o.soId, amount_applied: o.amount }]
  });
}

function isLimitedReleaseSalesOrder(so) {
  return !!so && String(so.reference_number || '').indexOf('LIMITED-') === 0;
}

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Find the deposit advance for an SO (spike "Deposit lookup").
 * @returns {Promise<{payment_id:string, unused_amount:number, amount:number}|null>}
 */
function findDepositAdvanceForSalesOrder(so) {
  var soNumber = String((so && so.salesorder_number) || '');
  if (!soNumber || !so.customer_id) return Promise.resolve(null);
  var re = new RegExp(escapeRe(DESCRIPTION_MARKER + soNumber) + '(?!\\d)');
  var path = '/customerpayments?customer_id=' + encodeURIComponent(so.customer_id) +
    '&search_text=' + encodeURIComponent(soNumber);
  return getZoho().zohoGet(path).then(function (data) {
    var rows = (data && data.customerpayments) || [];
    var match = null;
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (re.test(String(r.description || '')) && parseFloat(r.unused_amount) > 0) {
        match = r;
        break;
      }
    }
    if (!match) return null;
    return getZoho().zohoGet('/customerpayments/' + match.payment_id).then(function (d) {
      var p = (d && d.payment) || match;
      return {
        payment_id: String(p.payment_id || match.payment_id),
        unused_amount: parseFloat(p.unused_amount),
        amount: parseFloat(p.amount)
      };
    });
  });
}

function isTimeout(err) {
  return !!err && (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT' || !err.response);
}

/**
 * Sequentially create one SO + one $50 advance per unit. All-or-nothing is the
 * caller's job via cleanupDepositSet(err.created). No retries here.
 */
async function createDepositSet(o) {
  var created = [];
  var zoho = getZoho();
  for (var i = 0; i < o.units.length; i++) {
    var unit = o.units[i];
    var rec = {
      item_id: unit.item_id,
      salesorder_id: null,
      salesorder_number: null,
      payment_id: null,
      release_label: unit.release_label,
      name: unit.name
    };
    var step = 'salesorder';
    try {
      var soBody = buildDepositSalesOrder({
        customerId: o.customerId,
        unit: unit,
        kitRate: o.kitRates[unit.item_id],
        fees: o.fees,
        txnId: o.txnId,
        consentText: o.consentText,
        consentAt: o.consentAt,
        date: o.date
      });
      var soRes = await zoho.zohoPostOnce('/salesorders', soBody);
      var so = soRes && soRes.salesorder;
      if (!so || !so.salesorder_id) throw new Error('Zoho returned no sales order');
      rec.salesorder_id = String(so.salesorder_id);
      rec.salesorder_number = so.salesorder_number;
      created.push(rec);
      step = 'payment';
      var payRes = await bookSalesOrderDepositAdvance({
        customerId: o.customerId,
        soId: rec.salesorder_id,
        soNumber: rec.salesorder_number,
        amount: LR.DEPOSIT_PER_KIT,
        date: o.date,
        helcimTxnId: o.txnId
      });
      var pay = payRes && payRes.payment;
      if (!pay || !pay.payment_id) throw new Error('Zoho returned no payment');
      rec.payment_id = String(pay.payment_id);
    } catch (err) {
      err.created = created;
      if (isTimeout(err)) err.possibleOrphan = true;
      err.failedStep = step;
      throw err;
    }
  }
  return { created: created };
}

/**
 * Best-effort removal: payment first, then the SO. Never rejects.
 */
async function cleanupDepositSet(created, txnId) {
  var leftovers = [];
  var zoho = getZoho();
  var list = (created || []).slice().reverse();
  for (var i = 0; i < list.length; i++) {
    var rec = list[i];
    var payGone = true;
    if (rec.payment_id) {
      try {
        await zoho.zohoDelete('/customerpayments/' + rec.payment_id);
      } catch (e) {
        payGone = false;
        leftovers.push({ kind: 'payment', id: rec.payment_id, error: e && e.message });
        log.warn('[limited-releases] payment cleanup failed id=' + rec.payment_id + ' txn=' + txnId);
      }
    }
    if (!rec.salesorder_id) continue;
    try {
      await zoho.zohoDelete('/salesorders/' + rec.salesorder_id);
    } catch (e1) {
      try {
        await zoho.zohoPost('/salesorders/' + rec.salesorder_id + '/status/void', {});
      } catch (e2) {
        leftovers.push({ kind: 'salesorder', id: rec.salesorder_id, error: (e2 && e2.message) || (e1 && e1.message) });
        log.warn('[limited-releases] SO cleanup failed id=' + rec.salesorder_id + ' txn=' + txnId + (payGone ? '' : ' (payment also left)'));
      }
    }
  }
  return { ok: leftovers.length === 0, leftovers: leftovers };
}

module.exports = {
  getKitRate: getKitRate,
  resolveFeeItems: resolveFeeItems,
  buildDepositSalesOrder: buildDepositSalesOrder,
  bookSalesOrderDepositAdvance: bookSalesOrderDepositAdvance,
  createDepositSet: createDepositSet,
  cleanupDepositSet: cleanupDepositSet,
  findDepositAdvanceForSalesOrder: findDepositAdvanceForSalesOrder,
  isLimitedReleaseSalesOrder: isLimitedReleaseSalesOrder
};
