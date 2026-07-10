// ===== Anonymous Event Tracking =====

var _eventQueue = [];
var _EVENT_FLUSH_THRESHOLD = 5;

function trackEvent(type, sku, name) {
  var url = (typeof SHEETS_CONFIG !== 'undefined' && SHEETS_CONFIG.TRACK_EVENTS_URL)
    ? SHEETS_CONFIG.TRACK_EVENTS_URL
    : '';
  if (!url) return;
  _eventQueue.push({ type: type, sku: sku, name: name });
  if (_eventQueue.length >= _EVENT_FLUSH_THRESHOLD) {
    flushEvents();
  }
}

function flushEvents() {
  if (_eventQueue.length === 0) return;
  var url = (typeof SHEETS_CONFIG !== 'undefined' && SHEETS_CONFIG.TRACK_EVENTS_URL)
    ? SHEETS_CONFIG.TRACK_EVENTS_URL
    : '';
  if (!url) return;
  var payload = JSON.stringify({ events: _eventQueue });
  _eventQueue = [];
  if (navigator.sendBeacon) {
    navigator.sendBeacon(url, new Blob([payload], { type: 'application/json' }));
  }
}

document.addEventListener('visibilitychange', function () {
  if (document.visibilityState === 'hidden') {
    flushEvents();
  }
});

// ===== GA4 Ecommerce (Google Tag Manager dataLayer) =====
// Mirrors cart/checkout actions into the GTM dataLayer so GA4 can report
// revenue and the shopping funnel. GTM (GTM-NHRCGLC5) reads these events and
// forwards them to GA4 (G-WDYSXCM703). These helpers are defensive by design:
// analytics must NEVER throw into the cart or checkout flow.

function _ga4ParsePrice(v) {
  return parseFloat(String(v === null || v === undefined ? '0' : v).replace(/[^0-9.]/g, '')) || 0;
}

function _ga4Round(n) {
  return Math.round((parseFloat(n) || 0) * 100) / 100;
}

// Push a GA4 ecommerce event into the GTM dataLayer. Clears the previous
// ecommerce object first (per Google's recommendation) so item data never bleeds
// between events. Safe no-op if the page has no dataLayer.
function pushEcommerce(eventName, ecommerce) {
  try {
    if (typeof window === 'undefined') return;
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({ ecommerce: null });
    window.dataLayer.push({ event: eventName, ecommerce: ecommerce });
  } catch (e) { /* analytics must never break the page */ }
}

// Map internal cart/product items to GA4 ecommerce item objects.
function toGa4Items(items, category) {
  var out = [];
  if (!items || !items.length) return out;
  for (var i = 0; i < items.length; i++) {
    var it = items[i] || {};
    out.push({
      item_id: String(it.sku || it.zoho_item_id || it.item_id || it.name || ''),
      item_name: String(it.name || 'Item'),
      item_category: category || it.item_type || it._item_type || 'kit',
      price: _ga4ParsePrice(it.price || it.retail_instore || it.retail_kit || it.price_per_unit),
      quantity: parseFloat(it.qty) || 1
    });
  }
  return out;
}

// add_to_cart — called alongside the existing trackEvent('add_to_cart', ...) sites.
function ga4AddToCart(product, qty) {
  try {
    if (!product) return;
    var q = parseFloat(qty) || 1;
    var price = _ga4ParsePrice(product.retail_instore || product.retail_kit || product.price_per_unit || product.price);
    pushEcommerce('add_to_cart', {
      currency: 'CAD',
      value: _ga4Round(price * q),
      items: [{
        item_id: String(product.sku || product.zoho_item_id || product.item_id || product.name || ''),
        item_name: String(product.name || 'Item'),
        item_category: product._item_type || product.item_type || 'kit',
        price: price,
        quantity: q
      }]
    });
  } catch (e) { /* no-op */ }
}

// begin_checkout — fired once when a checkout is initiated.
function ga4BeginCheckout(items, value) {
  pushEcommerce('begin_checkout', {
    currency: 'CAD',
    value: _ga4Round(value),
    items: toGa4Items(items)
  });
}

// purchase — fired at most ONCE per transaction id (guards against double-firing
// if a success handler runs twice). transactionId must be unique per order.
var _ga4PurchasesSent = {};
function ga4Purchase(transactionId, value, tax, items) {
  try {
    var txn = String(transactionId || '');
    if (!txn) return;
    if (_ga4PurchasesSent[txn]) return;
    _ga4PurchasesSent[txn] = true;
    var ecom = {
      transaction_id: txn,
      value: _ga4Round(value),
      currency: 'CAD',
      items: items || []
    };
    if (tax !== null && tax !== undefined) ecom.tax = _ga4Round(tax);
    pushEcommerce('purchase', ecom);
  } catch (e) { /* no-op */ }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    trackEvent: trackEvent,
    flushEvents: flushEvents,
    pushEcommerce: pushEcommerce,
    toGa4Items: toGa4Items,
    ga4AddToCart: ga4AddToCart,
    ga4BeginCheckout: ga4BeginCheckout,
    ga4Purchase: ga4Purchase
  };
}
