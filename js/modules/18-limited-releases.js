// ===== Limited Releases Page Module =====
// Standalone module (NOT in concat:js). Phase 100 limited-releases page.
// Renders the kits, calendar, terms and JSON-LD from
// content/limited-releases-2026-27.json and drives the stepper, basket,
// sticky bar and pay-button gating. The payment flow is added separately.
// ES5 only. All content strings are written with textContent (no HTML parsing of content).

var LR_CONTENT_URL = 'content/limited-releases-2026-27.json';
var LR_SITE_URL = 'https://steinsandvines.ca/';
var LR_MAX_PER_KIT = 10;
var LR_MAX_PER_ORDER = 10;
var LR_PHONE = '(604) 567-4565';
var LR_MSG_ORDER_MAX = 'Up to 10 kits per order. Call us for more: ' + LR_PHONE;
var LR_MSG_KIT_MAX = 'Maximum 10 per kit. Call us for larger orders: ' + LR_PHONE;
var LR_BROCHURE_LABELS = { le26: 'Brochure (PDF, 0.6 MB)', rq27: 'Brochure (PDF, 0.7 MB)' };
var LR_RQ27_BOTTLES = { ember: [235, 900], aria: [240, 900], acqua: [234, 900], terre: [238, 900], sol: [239, 900] };
var LR_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

// ---------------------------------------------------------------------------
// Module-private state
// ---------------------------------------------------------------------------

var _lrData = null;
var _lrKits = [];          // kits in display order (collection order, then release)
var _lrQty = {};           // sku -> qty
var _lrLocked = false;
var _lrReserveVisible = false;
var _lrCookieOpen = false;
var _lrLiveTimer = null;
var _lrHandlersBound = false;

// ---------------------------------------------------------------------------
// Pure functions (exported for tests)
// ---------------------------------------------------------------------------

function lrFindCollection(data, id) {
  var list = (data && data.collections) || [];
  for (var i = 0; i < list.length; i++) {
    if (list[i].id === id) return list[i];
  }
  return null;
}

/**
 * Collections in JSON order, each with its kits in ascending release order.
 * @returns {Array} [{collection, kits}]
 */
function groupKitsByCollection(data) {
  var kits = (data && data.kits) || [];
  return ((data && data.collections) || []).map(function (collection) {
    var mine = [];
    for (var i = 0; i < kits.length; i++) {
      if (kits[i].collection === collection.id) mine.push({ kit: kits[i], idx: i });
    }
    mine.sort(function (a, b) {
      if (a.kit.release < b.kit.release) return -1;
      if (a.kit.release > b.kit.release) return 1;
      return a.idx - b.idx;
    });
    return { collection: collection, kits: mine.map(function (m) { return m.kit; }) };
  });
}

function lrMonthLabel(release) {
  var parts = String(release).split('-');
  var m = parseInt(parts[1], 10);
  return (LR_MONTHS[m - 1] || '') + ' ' + parts[0];
}

function lrSupplierTag(collection) {
  var name = (collection && collection.supplier) || '';
  return name.split(' ')[0];
}

/**
 * Chronological release calendar built from the kits' release field.
 * Within a month, kits keep collection order (JSON order of collections).
 * @returns {Array} [{month, label, kits:[{sku, short_name, supplier, collection}]}]
 */
function buildCalendar(data) {
  var byMonth = {};
  var months = [];
  var groups = groupKitsByCollection(data);
  groups.forEach(function (g) {
    g.kits.forEach(function (kit) {
      if (!byMonth[kit.release]) {
        byMonth[kit.release] = [];
        months.push(kit.release);
      }
      byMonth[kit.release].push({
        sku: kit.sku,
        short_name: kit.short_name,
        supplier: lrSupplierTag(g.collection),
        collection: kit.collection
      });
    });
  });
  months.sort();
  return months.map(function (m) {
    return { month: m, label: lrMonthLabel(m), kits: byMonth[m] };
  });
}

function computeDepositTotal(basket, perKit) {
  var per = typeof perKit === 'number' ? perKit : 50;
  var n = 0;
  for (var k in basket) {
    if (Object.prototype.hasOwnProperty.call(basket, k)) n += basket[k] || 0;
  }
  return n * per;
}

function lrTotalKits(basket) {
  var n = 0;
  for (var k in basket) {
    if (Object.prototype.hasOwnProperty.call(basket, k)) n += basket[k] || 0;
  }
  return n;
}

function isPayEnabled(totalKits, consentTicked) {
  return totalKits >= 1 && !!consentTicked;
}

/**
 * Applies a quantity change without mutating the input.
 * @returns {{basket:Object, changed:boolean, reason:string}} reason is one of
 *   '', 'kit-max', 'order-max', 'min'
 */
function applyQtyChange(basket, sku, delta) {
  var next = {};
  for (var k in basket) {
    if (Object.prototype.hasOwnProperty.call(basket, k)) next[k] = basket[k];
  }
  var cur = next[sku] || 0;
  var target = cur + delta;
  var reason = '';
  if (delta > 0) {
    if (cur >= LR_MAX_PER_KIT) {
      return { basket: next, changed: false, reason: 'kit-max' };
    }
    if (lrTotalKits(next) + delta > LR_MAX_PER_ORDER) {
      return { basket: next, changed: false, reason: 'order-max' };
    }
  }
  if (target < 0) {
    target = 0;
    reason = 'min';
  }
  if (target > LR_MAX_PER_KIT) target = LR_MAX_PER_KIT;
  next[sku] = target;
  return { basket: next, changed: target !== cur, reason: reason };
}

/** Spec chips for a kit. Weeks is shown only when non-null (D-08). */
function formatSpecs(kit) {
  var out = [];
  if (kit.colour) out.push(kit.colour);
  if (kit.sweetness) out.push(kit.sweetness);
  if (kit.body) out.push(kit.body + ' body');
  if (kit.oak) out.push('Oak: ' + kit.oak);
  if (kit.abv !== null && kit.abv !== undefined) out.push(kit.abv + '% ABV');
  if (kit.weeks !== null && kit.weeks !== undefined) out.push(kit.weeks + ' weeks');
  return out;
}

function lrFormatMoney(n) {
  return n % 1 === 0 ? '$' + n : '$' + n.toFixed(2);
}

function lrKitsLabel(n) {
  return n + (n === 1 ? ' kit' : ' kits');
}

function lrPayLabel(totalKits) {
  return totalKits >= 1 ? 'Pay ' + lrFormatMoney(totalKits * 50) + ' deposit' : 'Pay deposit';
}

function lrBarText(totalKits) {
  return lrKitsLabel(totalKits) + ' · ' + lrFormatMoney(totalKits * 50) + ' deposit';
}

function lrLiveText(totalKits) {
  if (totalKits < 1) return 'No kits selected.';
  return totalKits + ' kits selected. Deposit total ' + lrFormatMoney(totalKits * 50) + '.';
}

/** [width, height] for a content image, looked up by file name; null if unknown. */
function lrImageDims(path) {
  var f = String(path || '').split('/').pop();
  var m;
  if (/^le26-hero/.test(f)) return [1920, 1080];
  if (/^rq27-hero/.test(f)) return [1920, 1233];
  if (/^le26-group/.test(f)) return [1400, 1124];
  if (/^rq27-group/.test(f)) return [1100, 1375];
  if (/^le26-logo/.test(f)) return [700, 302];
  if (/^rq27-logo/.test(f)) return [700, 441];
  if (/^le26-.*-scene/.test(f)) return [1200, 857];
  if (/^le26-.*-bottle/.test(f)) return [455, 900];
  m = /^rq27-([a-z]+)-bottle/.exec(f);
  if (m && LR_RQ27_BOTTLES[m[1]]) return LR_RQ27_BOTTLES[m[1]];
  return null;
}

function buildJsonLd(data) {
  var graph = [];
  groupKitsByCollection(data).forEach(function (g) {
    g.kits.forEach(function (kit) {
      graph.push({
        '@type': 'Product',
        name: kit.short_name + ' (' + g.collection.name + ')',
        description: kit.notes,
        sku: kit.sku,
        image: [LR_SITE_URL + kit.image],
        brand: { '@type': 'Brand', name: g.collection.supplier },
        offers: {
          '@type': 'Offer',
          priceCurrency: 'CAD',
          price: kit.price,
          availability: 'https://schema.org/PreOrder',
          availabilityStarts: kit.release + '-01',
          url: LR_SITE_URL + 'limited-releases#lr-kit-' + kit.sku,
          seller: { '@type': 'Organization', name: 'Steins & Vines' }
        }
      });
    });
  });
  return { '@context': 'https://schema.org', '@graph': graph };
}

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

function lrEl(tag, cls, text) {
  var e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined && text !== null) e.textContent = text;
  return e;
}

function lrById(id) {
  return document.getElementById(id);
}

function lrClear(node) {
  while (node && node.firstChild) node.removeChild(node.firstChild);
}

function lrImg(src, alt, cls, opts) {
  var img = document.createElement('img');
  img.className = cls;
  img.src = src;
  img.alt = alt;
  var d = lrImageDims(src);
  if (d) {
    img.setAttribute('width', String(d[0]));
    img.setAttribute('height', String(d[1]));
  }
  if (opts && opts.eager) {
    img.setAttribute('fetchpriority', 'high');
  } else {
    img.setAttribute('loading', 'lazy');
  }
  img.setAttribute('decoding', 'async');
  return img;
}

function lrWideScreen() {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' &&
    window.matchMedia('(min-width: 640px)').matches;
}

function lrKitBySku(sku) {
  for (var i = 0; i < _lrKits.length; i++) {
    if (_lrKits[i].sku === sku) return _lrKits[i];
  }
  return null;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function lrBuildStepper(kit) {
  var group = lrEl('div', 'lr-stepper');
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', 'Quantity for ' + kit.short_name);
  var minus = lrEl('button', 'lr-stepper__btn', '−');
  minus.type = 'button';
  minus.setAttribute('data-action', 'remove');
  minus.setAttribute('data-sku', kit.sku);
  minus.setAttribute('aria-label', 'Remove one ' + kit.short_name);
  minus.disabled = true;
  var out = lrEl('output', 'lr-qty', '0');
  out.setAttribute('aria-live', 'off');
  var plus = lrEl('button', 'lr-stepper__btn', '+');
  plus.type = 'button';
  plus.setAttribute('data-action', 'add');
  plus.setAttribute('data-sku', kit.sku);
  plus.setAttribute('aria-label', 'Add one ' + kit.short_name);
  group.appendChild(minus);
  group.appendChild(out);
  group.appendChild(plus);
  return group;
}

function lrBuildKitCard(kit) {
  var card = lrEl('article', 'lr-kit');
  card.id = 'lr-kit-' + kit.sku;
  var nameId = 'lr-kit-name-' + kit.sku;
  card.setAttribute('aria-labelledby', nameId);

  if (kit.scene_image) {
    card.appendChild(lrImg(kit.scene_image, '', 'lr-kit__scene'));
  }
  var media = lrEl('div', 'lr-kit__media');
  media.appendChild(lrImg(kit.image, kit.image_alt, 'lr-kit__bottle'));
  card.appendChild(media);

  card.appendChild(lrEl('span', 'lr-chip', 'Releases ' + kit.release_label));
  var h3 = lrEl('h3', 'lr-kit__name', kit.short_name);
  h3.id = nameId;
  card.appendChild(h3);
  card.appendChild(lrEl('p', 'lr-kit__grapes', kit.grapes));
  card.appendChild(lrEl('p', 'lr-kit__region', kit.region));
  if (kit.region_note) card.appendChild(lrEl('p', 'lr-kit__region-note', kit.region_note));

  var specs = lrEl('ul', 'lr-specs');
  formatSpecs(kit).forEach(function (s) { specs.appendChild(lrEl('li', '', s)); });
  card.appendChild(specs);

  card.appendChild(lrEl('p', 'lr-kit__notes', kit.notes));

  var pairs = lrEl('details', 'lr-pairs');
  if (lrWideScreen()) pairs.setAttribute('open', '');
  pairs.appendChild(lrEl('summary', '', 'Pairs with'));
  var pl = lrEl('ul');
  (kit.food_pairings || []).forEach(function (p) { pl.appendChild(lrEl('li', '', p)); });
  pairs.appendChild(pl);
  card.appendChild(pairs);

  var footer = lrEl('div', 'lr-kit__footer');
  var price = lrEl('span', 'lr-price', 'Kit price ');
  price.appendChild(lrEl('strong', '', lrFormatMoney(kit.price)));
  footer.appendChild(price);
  footer.appendChild(lrBuildStepper(kit));
  card.appendChild(footer);

  var note = lrEl('p', 'lr-max-note');
  note.setAttribute('role', 'status');
  note.hidden = true;
  card.appendChild(note);
  return card;
}

function lrBuildCollection(group, index) {
  var c = group.collection;
  var section = lrEl('section', 'lr-collection');
  section.id = 'lr-collection-' + c.id;
  var h2Id = 'lr-collection-name-' + c.id;
  section.setAttribute('aria-labelledby', h2Id);

  var header = lrEl('div', 'lr-collection__header');
  if (c.logo && c.logo.light) {
    header.appendChild(lrImg(c.logo.light, c.name, 'lr-collection__logo'));
  }
  var text = lrEl('div');
  var h2 = lrEl('h2', '', c.name);
  h2.id = h2Id;
  text.appendChild(h2);
  text.appendChild(lrEl('p', 'lr-collection__theme', c.theme));
  text.appendChild(lrEl('p', 'lr-collection__blurb', c.blurb));
  header.appendChild(text);
  section.appendChild(header);

  var frame = lrEl('div', 'lr-collection__hero-frame');
  frame.appendChild(lrImg(c.hero_image, c.hero_image_alt, 'lr-collection__hero', { eager: index === 0 }));
  section.appendChild(frame);

  var link = lrEl('a', 'btn-secondary lr-brochure', LR_BROCHURE_LABELS[c.id] || 'Brochure (PDF)');
  link.href = c.brochure_pdf;
  link.setAttribute('download', '');
  section.appendChild(link);

  var grid = lrEl('div', 'lr-grid');
  group.kits.forEach(function (kit) { grid.appendChild(lrBuildKitCard(kit)); });
  section.appendChild(grid);
  return section;
}

function lrBuildCalendar(data) {
  var ol = lrById('lr-calendar');
  if (!ol) return;
  lrClear(ol);
  var now = new Date();
  var current = now.getFullYear() + '-' + (now.getMonth() < 9 ? '0' : '') + (now.getMonth() + 1);
  buildCalendar(data).forEach(function (cell) {
    var li = lrEl('li', 'lr-calendar__month' + (cell.month === current ? ' lr-calendar__month--active' : ''));
    li.appendChild(lrEl('strong', '', cell.label));
    cell.kits.forEach(function (k) {
      var entry = lrEl('span', 'lr-calendar__kit');
      var a = lrEl('a', '', k.short_name);
      a.href = '#lr-kit-' + k.sku;
      entry.appendChild(a);
      entry.appendChild(lrEl('span', 'lr-calendar__tag', ' ' + k.supplier));
      li.appendChild(entry);
    });
    ol.appendChild(li);
  });
}

function lrInjectJsonLd(data) {
  var old = lrById('lr-jsonld');
  if (old && old.parentNode) old.parentNode.removeChild(old);
  var s = document.createElement('script');
  s.type = 'application/ld+json';
  s.id = 'lr-jsonld';
  s.textContent = JSON.stringify(buildJsonLd(data)).replace(/</g, '\\u003c');
  document.head.appendChild(s);
}

function lrRender(data) {
  _lrData = data;
  _lrQty = {};
  _lrKits = [];
  var groups = groupKitsByCollection(data);
  groups.forEach(function (g) {
    g.kits.forEach(function (k) { _lrKits.push(k); _lrQty[k.sku] = 0; });
  });
  var copy = data.copy || {};

  var heroSub = lrById('lr-hero-sub');
  if (heroSub && copy.hero_sub) heroSub.textContent = copy.hero_sub;

  var steps = lrById('lr-how-steps');
  if (steps) {
    lrClear(steps);
    (copy.how_it_works || []).forEach(function (s) {
      var li = lrEl('li');
      li.appendChild(lrEl('strong', '', s.step));
      li.appendChild(document.createTextNode(': ' + s.text));
      steps.appendChild(li);
    });
  }

  lrBuildCalendar(data);

  var host = lrById('lr-collections');
  if (host) {
    lrClear(host);
    groups.forEach(function (g, i) { host.appendChild(lrBuildCollection(g, i)); });
  }

  var terms = lrById('lr-terms');
  if (terms) {
    lrClear(terms);
    (copy.deposit_terms || []).forEach(function (t) { terms.appendChild(lrEl('li', '', t)); });
  }
  var priceNote = lrById('lr-price-note');
  if (priceNote && copy.price_note) priceNote.textContent = copy.price_note;
  var consentLabel = lrById('lr-consent-label');
  if (consentLabel && copy.deposit_checkbox_label) consentLabel.textContent = copy.deposit_checkbox_label;
  var attr = lrById('lr-attribution');
  if (attr && data.assets && data.assets.attribution) attr.textContent = data.assets.attribution;

  lrInjectJsonLd(data);
  lrBindHandlers();
  lrUpdateAll(true);
}

// ---------------------------------------------------------------------------
// Basket, stepper, pay gating, sticky bar
// ---------------------------------------------------------------------------

function lrTotal() {
  return lrTotalKits(_lrQty);
}

function lrSyncCard(sku, message) {
  var card = lrById('lr-kit-' + sku);
  if (!card) return;
  var qty = _lrQty[sku] || 0;
  var out = card.querySelector('.lr-qty');
  if (out) out.textContent = String(qty);
  var minus = card.querySelector('.lr-stepper__btn[data-action="remove"]');
  var plus = card.querySelector('.lr-stepper__btn[data-action="add"]');
  if (minus) minus.disabled = _lrLocked || qty <= 0;
  if (plus) plus.disabled = _lrLocked || qty >= LR_MAX_PER_KIT;
  if (qty >= 1) card.classList.add('lr-kit--selected');
  else card.classList.remove('lr-kit--selected');

  var badge = card.querySelector('.lr-badge');
  if (qty >= 1) {
    if (!badge) {
      badge = lrEl('span', 'lr-badge');
      var media = card.querySelector('.lr-kit__media');
      if (media) media.appendChild(badge);
    }
    badge.textContent = qty + ' selected';
  } else if (badge && badge.parentNode) {
    badge.parentNode.removeChild(badge);
  }

  var note = card.querySelector('.lr-max-note');
  if (note) {
    var text = message || (qty >= LR_MAX_PER_KIT ? LR_MSG_KIT_MAX : '');
    note.textContent = text;
    note.hidden = !text;
  }
}

function lrRenderBasket() {
  var box = lrById('lr-basket');
  if (!box) return;
  lrClear(box);
  var total = lrTotal();
  if (total < 1) {
    box.appendChild(lrEl('h3', 'lr-basket__empty-heading', 'No kits chosen yet'));
    box.appendChild(lrEl('p', 'lr-basket__empty',
      'Use the + buttons on the kits above to choose how many of each you want. Your deposit total will appear here.'));
    return;
  }
  var list = lrEl('ul', 'lr-basket__list');
  list.style.listStyle = 'none';
  list.style.padding = '0';
  _lrKits.forEach(function (kit) {
    var qty = _lrQty[kit.sku] || 0;
    if (qty < 1) return;
    var row = lrEl('li', 'lr-basket__row');
    row.appendChild(lrEl('span', '', kit.short_name + ' × ' + qty));
    row.appendChild(lrEl('span', 'lr-basket__release', kit.release_label));
    var rm = lrEl('button', 'btn-secondary lr-basket__remove', 'Remove');
    rm.type = 'button';
    rm.setAttribute('data-action', 'clear');
    rm.setAttribute('data-sku', kit.sku);
    rm.setAttribute('aria-label', 'Remove ' + kit.short_name);
    rm.disabled = _lrLocked;
    row.appendChild(rm);
    list.appendChild(row);
  });
  box.appendChild(list);
  var totalRow = lrEl('div', 'lr-basket__total');
  totalRow.appendChild(lrEl('span', '', lrKitsLabel(total)));
  var dep = lrEl('span', '', 'Deposit today: ');
  dep.appendChild(lrEl('strong', '', lrFormatMoney(total * 50)));
  totalRow.appendChild(dep);
  box.appendChild(totalRow);
}

function lrUpdatePay() {
  var btn = lrById('lr-pay');
  var consent = lrById('lr-consent');
  var hint = lrById('lr-pay-hint');
  var total = lrTotal();
  var enabled = isPayEnabled(total, consent && consent.checked);
  if (btn) {
    btn.disabled = !enabled;
    btn.textContent = lrPayLabel(total);
  }
  if (hint) hint.hidden = enabled;
}

function lrUpdateBar() {
  var bar = lrById('lr-bar');
  if (!bar) return;
  var total = lrTotal();
  var show = total >= 1 && !_lrLocked && !_lrReserveVisible;
  var section = lrBarPadTarget();
  if (!show) {
    bar.classList.add('hidden');
    if (section) section.style.paddingBottom = '';
    return;
  }
  var text = lrById('lr-bar-text');
  if (text) text.textContent = lrBarText(total);
  var btn = lrById('lr-bar-btn');
  if (btn) {
    btn.setAttribute('aria-label', 'Reserve ' + lrKitsLabel(total) + ', ' +
      lrFormatMoney(total * 50) + ' deposit');
  }
  bar.classList.remove('hidden');
  if (_lrCookieOpen) bar.classList.add('lr-bar--static');
  else bar.classList.remove('lr-bar--static');
  var h = bar.offsetHeight || 0;
  if (bar.style && bar.style.setProperty) bar.style.setProperty('--lr-bar-h', h + 'px');
  if (section) section.style.paddingBottom = (_lrCookieOpen || !h) ? '' : h + 'px';
}

function lrBarPadTarget() {
  var attr = lrById('lr-attribution');
  var node = attr;
  while (node && node.tagName !== 'SECTION') node = node.parentNode;
  return node;
}

function lrScheduleLive() {
  if (_lrLiveTimer) clearTimeout(_lrLiveTimer);
  _lrLiveTimer = setTimeout(function () {
    _lrLiveTimer = null;
    var live = lrById('lr-live');
    if (live) live.textContent = lrLiveText(lrTotal());
  }, 400);
}

function lrUpdateAll(skipLive) {
  _lrKits.forEach(function (k) { lrSyncCard(k.sku); });
  lrRenderBasket();
  lrUpdatePay();
  lrUpdateBar();
  if (!skipLive) lrScheduleLive();
}

function lrChange(sku, delta) {
  var res = applyQtyChange(_lrQty, sku, delta);
  _lrQty = res.basket;
  var msg = '';
  if (res.reason === 'order-max') msg = LR_MSG_ORDER_MAX;
  // Refresh every card so a stale refusal message on another card is cleared.
  _lrKits.forEach(function (k) { lrSyncCard(k.sku, k.sku === sku ? msg : ''); });
  lrRenderBasket();
  lrUpdatePay();
  lrUpdateBar();
  lrScheduleLive();
}

function lrSetQty(sku, qty) {
  lrChange(sku, qty - (_lrQty[sku] || 0));
}

function getBasketLines() {
  var lines = [];
  _lrKits.forEach(function (k) {
    var q = _lrQty[k.sku] || 0;
    if (q > 0) lines.push({ item_id: k.zoho_item_id, qty: q });
  });
  return lines;
}

function setControlsLocked(locked) {
  _lrLocked = !!locked;
  var form = lrById('lr-form');
  if (form) {
    var inputs = form.querySelectorAll('input');
    for (var i = 0; i < inputs.length; i++) inputs[i].disabled = _lrLocked;
  }
  lrUpdateAll(true);
  var rm = document.querySelectorAll('#lr-basket button');
  for (var j = 0; j < rm.length; j++) rm[j].disabled = _lrLocked;
}

function clearBasket() {
  for (var k in _lrQty) {
    if (Object.prototype.hasOwnProperty.call(_lrQty, k)) _lrQty[k] = 0;
  }
  lrUpdateAll();
}

function lrBindHandlers() {
  if (_lrHandlersBound) return;
  _lrHandlersBound = true;

  var host = lrById('lr-collections');
  if (host) {
    host.addEventListener('click', function (e) {
      var t = e.target;
      while (t && t !== host && !(t.getAttribute && t.getAttribute('data-action'))) t = t.parentNode;
      if (!t || t === host || !t.classList || !t.classList.contains('lr-stepper__btn')) return;
      if (t.disabled || _lrLocked) return;
      lrChange(t.getAttribute('data-sku'), t.getAttribute('data-action') === 'add' ? 1 : -1);
    });
  }

  var basket = lrById('lr-basket');
  if (basket) {
    basket.addEventListener('click', function (e) {
      var t = e.target;
      while (t && t !== basket && !(t.getAttribute && t.getAttribute('data-action') === 'clear')) t = t.parentNode;
      if (!t || t === basket || t.disabled || _lrLocked) return;
      lrSetQty(t.getAttribute('data-sku'), 0);
    });
  }

  var consent = lrById('lr-consent');
  if (consent) consent.addEventListener('change', lrUpdatePay);

  var barBtn = lrById('lr-bar-btn');
  if (barBtn) {
    barBtn.addEventListener('click', function () {
      var reserve = lrById('lr-reserve');
      var reduced = typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (reserve && typeof reserve.scrollIntoView === 'function') {
        reserve.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
      }
      var heading = lrById('lr-reserve-heading');
      if (heading) {
        try { heading.focus({ preventScroll: true }); } catch (err) { heading.focus(); }
      }
    });
  }

  var reserveEl = lrById('lr-reserve');
  if (reserveEl && typeof IntersectionObserver === 'function') {
    var io = new IntersectionObserver(function (entries) {
      if (entries && entries.length) {
        _lrReserveVisible = !!entries[entries.length - 1].isIntersecting;
        lrUpdateBar();
      }
    });
    io.observe(reserveEl);
  }

  if (typeof MutationObserver === 'function') {
    var root = document.documentElement;
    var sync = function () {
      _lrCookieOpen = root.classList.contains('cookie-notice-open');
      lrUpdateBar();
    };
    new MutationObserver(sync).observe(root, { attributes: true, attributeFilter: ['class'] });
    _lrCookieOpen = root.classList.contains('cookie-notice-open');
  }
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

function lrShowLoadError() {
  var host = lrById('lr-collections');
  if (!host) return;
  lrClear(host);
  var p = lrEl('p', 'lr-load-error',
    'We couldn’t load the kits. Please refresh, or call us at ' + LR_PHONE + '.');
  p.style.color = 'var(--color-muted)';
  host.appendChild(p);
}

function lrBoot() {
  if (!document.body || !document.body.dataset || document.body.dataset.page !== 'limited-releases') return;
  if (typeof fetch !== 'function') { lrShowLoadError(); return; }
  fetch(LR_CONTENT_URL).then(function (r) {
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }).then(function (data) {
    lrRender(data);
  }).catch(function () {
    lrShowLoadError();
  });
}

// Public surface for the payment flow (loaded as a separate script).
if (typeof window !== 'undefined') {
  window.LimitedReleases = {
    getBasketLines: getBasketLines,
    setControlsLocked: setControlsLocked,
    clearBasket: clearBasket,
    computeDepositTotal: computeDepositTotal
  };
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', lrBoot);
  } else {
    lrBoot();
  }
}

// ---------------------------------------------------------------------------
// Module exports (for unit testing)
// ---------------------------------------------------------------------------

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    groupKitsByCollection: groupKitsByCollection,
    buildCalendar: buildCalendar,
    computeDepositTotal: computeDepositTotal,
    isPayEnabled: isPayEnabled,
    formatSpecs: formatSpecs,
    buildJsonLd: buildJsonLd,
    applyQtyChange: applyQtyChange,
    render: lrRender,
    getBasketLines: getBasketLines,
    setControlsLocked: setControlsLocked,
    clearBasket: clearBasket
  };
}
