# Phase 48: Kiosk POS De-Fork (kiosk-core.js) - Pattern Map

**Mapped:** 2026-07-03
**Files analyzed:** 7 (1 new JS, 2 modified JS, 2 modified HTML, 1 modified config, 1 new test)
**Analogs found:** 7 / 7

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|--------------------|------|-----------|-----------------|----------------|
| `js/kiosk-core.js` (NEW) | service (shared client module, IIFE) | request-response + CRUD (cart state) | `js/kiosk.js` (whole-file IIFE shape) | exact — same ES5 IIFE + dual-export idiom already used twice in this repo |
| `js/kiosk.js` (MODIFIED — slim to consumer wiring) | controller (UI wiring / consumer) | request-response | itself (pre-refactor version) + `js/admin.js`'s equivalent consumer role | exact — same file, role narrows |
| `js/admin.js` (MODIFIED — slim to consumer wiring, drop dup logic) | controller (UI wiring / consumer) | request-response | `js/kiosk.js` (canonical/fixed version of the shared logic being removed) | exact |
| `admin.html` (MODIFIED — add script tags + discount markup) | config (HTML wiring) | N/A | `kiosk.html` (script load order + discount markup source) | exact |
| `kiosk.html` (MODIFIED — add kiosk-core script tag) | config (HTML wiring) | N/A | `admin.html`'s existing multi-script pattern (for the "add a script tag before consumer" mechanic) | role-match |
| `package.json` (MODIFIED — new terser target + stamp regex) | config (build script) | batch | its own existing `minify:js`/`stamp:admin`/`stamp:kiosk` entries (self-referential — new target is a peer of existing ones) | exact |
| `tests/frontend/kiosk-core-parity.test.js` (NEW) | test | request-response (fetch-mock assertion) | `tests/frontend/kiosk-device-token.test.js` | exact — same stub/require/fetch-mock-assert idiom |

## Pattern Assignments

### `js/kiosk-core.js` (service, request-response/CRUD) — NEW FILE

**Analog:** `js/kiosk.js` (whole-file shape) + `js/admin.js` (bottom export-block shape)

**IIFE wrapper pattern** (source: `js/kiosk.js:1-5`):
```javascript
// ===== Steins & Vines In-Store POS (Standalone Kiosk) =====
// Self-contained IIFE — no dependency on admin.js.

(function () {
  'use strict';
  // ... var declarations, function declarations ...
})();
```
`kiosk-core.js` should open with an equivalent banner comment (e.g. `// ===== Steins & Vines Kiosk Core (shared cart/payment/void logic) =====`) and the same `(function () { 'use strict'; ... })();` wrapper. No parameters, no return value assigned — it attaches `window.KioskCore` as a side effect (see below), exactly like `kiosk.js` attaches its bootstrap listener as a side effect rather than exporting anything to an outer scope.

**Dual-mode export pattern — copy exactly, adapted for `window.KioskCore` instead of bare `module.exports`** (source: `js/kiosk.js:5499-5533`, mirrored at `js/admin.js:12755-12757` under the comment `// Kiosk module exports for testing (35-06)`):
```javascript
// ===== Test Exports (kiosk.js — mirrors admin.js export pattern) =====
// Exposed only under Node/Jest — not bundled into production traffic.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Object.assign(module.exports || {}, {
    _kioskGetQuote: function () { return _kioskQuote; },
    _kioskSetQuote: function (q) { _kioskQuote = q; },
    // ... accessor per module-scope var, plus the public functions themselves ...
    kioskFetchRecipeQuote: kioskFetchRecipeQuote
  });
}
```
For `kiosk-core.js`, this block must do **two** things, not one — attach the real browser API AND (only under Node) also export it as CommonJS, since Pitfall 4 (RESEARCH.md) requires `kiosk.js`/`admin.js` to `require('./kiosk-core.js')` under Jest:
```javascript
// window.KioskCore is the real, permanent public surface (not test-only).
var KioskCore = {
  proceedToPayment: kioskProceedToPayment,   // D-06: prefix dropped on the namespace
  calcTotals: kioskCalcTotals,
  renderCart: kioskRenderCart,
  init: kcInit
  // ...rest of the ~37 promoted functions + 12 discount functions, D-06 naming...
};
if (typeof window !== 'undefined') {
  window.KioskCore = KioskCore;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = KioskCore;
}
```
This is the concrete resolution of RESEARCH.md Pitfall 4/A2: `kiosk-core.js`'s own IIFE performs the `window` attach unconditionally (browser) and the `module.exports` attach conditionally (Node/Jest) — no `require()` guard is needed *inside kiosk-core.js itself*; the guard belongs in `kiosk.js`/`admin.js` (see next section) so their own top-level code has `KioskCore` defined before it runs under Jest.

**Environment-injection `init(env)` pattern** (source: RESEARCH.md Pattern 1, itself derived from `js/kiosk.js:3480-3484` vs `js/admin.js:11055-11057` — see Shared Patterns > Auth below for the two concrete fetch calls being unified).

**Core CRUD/cart pattern to lift verbatim (kiosk.js is canonical per D-02):**
- `kioskProceedToPayment` body: `js/kiosk.js:3160-4260` — canonical, includes SO-import fork (SO fork's *logic* moves to kiosk-core; kiosk.js keeps its own SO-browse *UI* wiring per Pitfall 5)
- `recipeSaleBody` construction (canonical, includes `modified_ingredients`): `js/kiosk.js:3300-3313` (see exact excerpt below)
- Idempotency key: canonical form is `js/kiosk.js:3310-3311` (`reference_number: refNumber, idempotency_key: refNumber` — same value, no `Math.random()` suffix)

**Auth-seam fetch call to genericize (the ONE injected variable):**
```javascript
// Source: js/kiosk.js:3480-3484 (canonical shape kiosk-core.js should generalize)
fetch(saleUrl, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-device-token': kioskDeviceToken() },
  body: JSON.stringify(saleBody)
})
```
becomes, inside `kiosk-core.js`, something like:
```javascript
var opts = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(saleBody) };
var authOpts = _kcEnv.buildAuthOptions(); // { headers: {'x-device-token': ...} } OR { credentials: 'include' }
// shallow-merge authOpts into opts (headers merge, credentials passthrough) before fetch(saleUrl, opts)
```

---

### `js/kiosk.js` (controller/consumer, request-response) — MODIFIED (slim)

**Analog:** itself pre-refactor (role narrows from "owns all logic" to "wires KioskCore + owns kiosk-only UI")

**Node-only require guard to add** (new pattern for this phase — no existing analog in-repo since this file has never required a sibling module; closest existing idiom is the bottom-of-file `if (typeof module !== 'undefined' && module.exports)` guard at `js/kiosk.js:5501`, inverted to a top-of-file `require`):
```javascript
// ===== Test-only KioskCore attach (mirrors the module.exports guard pattern already
// used at the bottom of this file) — inert in the browser, where <script src=
// "kiosk-core.min.js"> has already run and set window.KioskCore before this file parses.
if (typeof window !== 'undefined' && !window.KioskCore && typeof require === 'function') {
  require('./kiosk-core.js');
}
```
Place this immediately inside the IIFE, before any `KioskCore.xxx(...)` call site is defined/invoked (RESEARCH.md Pitfall 4 / A2 — flagged as the one piece of this phase without a direct copy-paste precedent; smoke-test it first).

**`init(env)` call site to add** (kiosk.js's auth env, from RESEARCH.md Pattern 1, matching the real device-token helper already at `js/kiosk.js:15-17`):
```javascript
KioskCore.init({
  mwUrl: kioskMwUrl(),
  buildAuthOptions: function () {
    return { headers: { 'x-device-token': kioskDeviceToken() } };
  }
});
```

**What stays in kiosk.js (kiosk-only, do NOT move):** SO-browse UI wiring, customer-browse subsystem (`kioskCb*`), discount UI *event wiring* (logic moves to core, but DOM event listeners for kiosk.js's own `#kiosk-discount-*` elements can stay thin wrappers calling `KioskCore.applyDiscount(...)` etc.), `kioskDeviceToken`/`saveKioskDeviceToken`/`initKioskAuth` (device-token gate is kiosk-only per D-46, not part of KioskCore's env-agnostic core).

---

### `js/admin.js` (controller/consumer, request-response) — MODIFIED (slim, drop dup logic + 2 bug fixes)

**Analog:** `js/kiosk.js` (canonical source for the functions being replaced) + itself (role narrows)

**Node-only require guard to add** (same pattern as kiosk.js above, placed near `js/admin.js:1-15` inside the existing IIFE):
```javascript
if (typeof window !== 'undefined' && !window.KioskCore && typeof require === 'function') {
  require('./kiosk-core.js');
}
```

**`init(env)` call site to add** (admin.js's auth env — cookie-based, from the existing `credentials: 'include'` idiom used 20+ times in this file, e.g. `js/admin.js:11057`):
```javascript
KioskCore.init({
  mwUrl: kioskMwUrl(),
  buildAuthOptions: function () {
    return { credentials: 'include' };
  }
});
```

**Delete — duplicate-batch bug (Pitfall 2, D-05):** remove the client-side `create_batch` loop at `js/admin.js:11187-11212` (`var today = new Date()...` through the `batchPromises.push(...)` loop) once `kioskProceedToPayment`'s confirm handler is replaced by the `KioskCore` call — server already auto-creates via `pos.js:1219`/`brewpad-integration.js createBatchesFromSale`. Concrete deleted block:
```javascript
// Source: js/admin.js:11187-11212 (DELETE as part of unification)
var today = new Date().toISOString().slice(0, 10);
var kitItems = items.filter(function (it) {
  return (it.product_type || '').toLowerCase() === 'kit';
});
var batchPromises = [];
kitItems.forEach(function (it) {
  for (var q = 0; q < (it.quantity || 1); q++) {
    batchPromises.push(
      adminApiPost('create_batch', { /* ...no zoho_so_number, this is the bug... */ })
    );
  }
});
```

**Fix — `modified_ingredients` omission (Pitfall 3, D-05):** admin.js's `recipeSaleBody` at `js/admin.js:11017-11027` is missing the `modified_ingredients` key that `js/kiosk.js:3300-3313`'s equivalent has. When `kioskCalcTotals`/sale-body construction moves into `kiosk-core.js`, use kiosk.js's shape (with `modified_ingredients: Array.isArray(_kioskModifiedIngredients) ? _kioskModifiedIngredients : undefined`) as canonical — this silently fixes the price-preview-vs-charge mismatch.

**Fix — idempotency key unification (D-05):** admin.js's `js/admin.js:11000-11001` (`idempotencyKey = refNumber + '-' + Math.random().toString(36).slice(2, 9)`) is replaced by kiosk.js's plain `idempotency_key: refNumber` form (`js/kiosk.js:3311`) when the sale-body builder moves to kiosk-core.js.

---

### `admin.html` (config, HTML wiring) — MODIFIED

**Analog:** `kiosk.html` (script load order + discount markup source)

**Script tags to add**, immediately before the existing `js/admin.min.js` tag at `admin.html:997`:
```html
<script src="js/lib/discount-match.js" defer></script>
<script src="js/kiosk-core.min.js?v=INITIAL" defer></script>
<script src="js/admin.min.js?v=mr53l244" defer></script>
```
(admin.html's existing script block, for placement reference, at `admin.html:989-997`:)
```html
<script src="js/lib/constants.js" defer></script>
<script src="js/lib/utils.js" defer></script>
<script src="js/lib/auth.js" defer></script>
<script src="js/lib/recipe-grouping.js" defer></script>
<script src="js/sheets-config.js" defer></script>
<script src="js/admin-config.js" defer></script>
<script src="https://accounts.google.com/gsi/client" async defer></script>
<script src="js/vendor/qrcode.min.js" defer></script>
<script src="js/admin.min.js?v=mr53l244" defer></script>
```
`discount-match.js` is currently loaded by `kiosk.html:18` (`<script src="js/lib/discount-match.js"></script>`) but absent from `admin.html` entirely — must be added or `typeof discountMatches === 'function'` will silently no-op the type-scoped discount match on admin (RESEARCH.md Discount-Parity section).

**Discount markup to port** (source: `kiosk.html:184-222`, cart-zone + popover — verbatim structure to replicate inside `admin.html`'s `#tab-kiosk` panel; CSS already shared via `kiosk.min.css`, no new stylesheet work):
```html
<div class="kiosk-discount-zone" id="kiosk-discount-zone">
  <button type="button" class="btn-secondary kiosk-discount-btn" id="kiosk-discount-btn" disabled>Apply Discount</button>
  <div class="kiosk-discount-applied" id="kiosk-discount-applied" style="display:none;">
    <span class="kiosk-discount-applied-name" id="kiosk-discount-applied-name"></span>
    <span class="kiosk-discount-applied-amount" id="kiosk-discount-applied-amount"></span>
    <button type="button" class="kiosk-discount-remove-btn" id="kiosk-discount-remove-btn">&times;</button>
  </div>
</div>
<!-- ...kiosk-cart-totals discount row (lines 197-200), kiosk-discount-popover block
     (lines 215-222) — port verbatim into the same relative position inside admin's
     #tab-kiosk cart panel. Also port the management-modal markup at kiosk.html:426-468
     (not read in full here — RESEARCH.md already cites this range; re-read only if the
     exact modal markup is needed at implementation time). -->
```

---

### `kiosk.html` (config, HTML wiring) — MODIFIED

**Analog:** `admin.html`'s general "multiple `<script>` tags in document order" pattern (for the insertion mechanic — kiosk.html itself already has the right load-order shape at `kiosk.html:15-24`, it just needs one more tag)

**Script tag to add**, immediately before the existing `js/kiosk.min.js` tag at `kiosk.html:24`:
```html
<script src="js/kiosk-core.min.js?v=INITIAL"></script>
<script src="js/kiosk.min.js?v=mr53l270"></script>
```
No `defer` attribute needed/used — kiosk.html's existing scripts (`kiosk.html:15-24`) are all plain synchronous `<script>` tags executed in document order; `kiosk-core.min.js`'s tag must appear textually before `kiosk.min.js`'s for `window.KioskCore` to exist when `kiosk.js`'s top-level `KioskCore.init(...)` runs.

---

### `package.json` (config, build script) — MODIFIED

**Analog:** its own existing `minify:js` and `stamp:admin`/`stamp:kiosk` entries — the new target is structurally a peer of `kiosk.js`'s existing terser call, not a new pattern.

**`minify:js` addition** (current full line, for exact insertion point):
```
"minify:js": "npm run concat:js && terser js/main.js -o js/main.min.js -c -m && terser js/admin.js -o js/admin.min.js -c -m && terser js/batch.js -o js/batch.min.js -c -m && terser js/kiosk.js -o js/kiosk.min.js -c -m && terser js/brewpad.js -o js/brewpad.min.js -c -m && ..."
```
Add `&& terser js/kiosk-core.js -o js/kiosk-core.min.js -c -m` anywhere in this chain (order doesn't matter — each terser invocation is independent); place it immediately before the existing `terser js/kiosk.js ...` clause for readability/proximity.

**`stamp:kiosk` addition** (current full script, for exact regex-clause insertion pattern):
```
"stamp:kiosk": "node -e \"const fs=require('fs');let f=fs.readFileSync('kiosk.html','utf8');const v=Date.now().toString(36);f=f.replace(/kiosk\\.min\\.css\\?v=[^\\\"]+/g,'kiosk.min.css?v='+v);f=f.replace(/kiosk\\.min\\.js\\?v=[^\\\"]+/g,'kiosk.min.js?v='+v);fs.writeFileSync('kiosk.html',f);console.log('kiosk.html cache version updated to '+v);\""
```
Add one more `.replace(...)` clause matching `kiosk-core\.min\.js\?v=[^"]+` in the same style, BUT note the existing regex uses `kiosk\.min\.js` which would also match `kiosk-core.min.js`'s `.min.js` suffix incidentally if not scoped carefully — use a distinct, non-overlapping regex e.g. `/kiosk-core\.min\.js\?v=[^\"]+/g` to avoid double-stamping or corrupting the `kiosk-core.min.js?v=...` string.

**`stamp:admin` addition** — same shape, add a `admin\.min\.js` -style clause for `kiosk-core\.min\.js\?v=[^\"]+/` in `admin.html`'s copy of the stamp script (current full script at `package.json:13`).

---

### `tests/frontend/kiosk-core-parity.test.js` (test, request-response) — NEW FILE

**Analog:** `tests/frontend/kiosk-device-token.test.js` (full file read — 229 lines)

**Environment stub block to copy verbatim** (source: `tests/frontend/kiosk-device-token.test.js:17-55`):
```javascript
global.window = global.window || {};
global.window.addEventListener = global.window.addEventListener || jest.fn();
global.navigator = global.navigator || { userAgent: 'test' };
global.console = { log: jest.fn(), warn: jest.fn(), error: jest.fn(), info: jest.fn() };
global.fetch = jest.fn(function () {
  return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({}); } });
});
global.setTimeout = jest.fn(function (fn) { if (typeof fn === 'function') fn(); return 1; });
global.clearTimeout = jest.fn();
global.setInterval = jest.fn(function () { return 1; });
global.clearInterval = jest.fn();
global.alert = jest.fn();
global.SHEETS_CONFIG = {
  MIDDLEWARE_URL: 'http://mw.test',
  SPREADSHEET_ID: 'test-id',
  GOOGLE_CLIENT_ID: 'test-client-id',
  STAFF_EMAILS: 'test@example.com'
};
```

**Require + injectEl helper pattern to copy** (source: `tests/frontend/kiosk-device-token.test.js:57, 64-75`):
```javascript
var kiosk = require('../../js/kiosk.js');
// (parity test additionally: var admin = require('../../js/admin.js');)

function injectEl(id, tag) {
  var existing = document.getElementById(id);
  if (existing) { existing.innerHTML = ''; existing.style.display = ''; return existing; }
  var el = document.createElement(tag || 'div');
  el.id = id;
  document.body.appendChild(el);
  return el;
}
```

**beforeEach/afterEach reset pattern to copy** (source: `tests/frontend/kiosk-device-token.test.js:96-109`):
```javascript
beforeEach(function () {
  localStorage.clear();
  document.body.innerHTML = '';
  global.fetch.mockClear();
  global.fetch.mockResolvedValue({ ok: true, status: 200, json: function () { return Promise.resolve({}); } });
});
afterEach(function () { document.body.innerHTML = ''; });
```

**Fetch-mock assertion pattern to copy** (source: `tests/frontend/kiosk-device-token.test.js:169-192`, T2):
```javascript
kiosk.kioskFetchRecipeQuote(); // or KioskCore-delegated equivalent, called via kiosk's own wrapper
expect(global.fetch).toHaveBeenCalled();
var opts = global.fetch.mock.calls[0][1];
expect(opts.headers['x-device-token']).toBe('kiosk-header-token');
expect(opts.headers['x-api-key']).toBeUndefined();
```
For the parity test specifically, extend this into a same-cart-both-surfaces comparison (per RESEARCH.md's "Parity Test Strategy"): call the equivalent sale-trigger through `kiosk`'s wiring and then through `admin`'s wiring with an identical cart (using each file's own `_kioskSetCart`/`_kioskGetCart`-style test-export accessors, mirrored at `js/kiosk.js:5512-5513`), then assert `global.fetch.mock.calls[N][0]` (URL) is identical and `global.fetch.mock.calls[N][1].body` is deep-equal **after stripping/normalizing** the `reference_number`/`idempotency_key` fields (RESEARCH.md: raw `JSON.stringify` comparison will fail because both are non-deterministic — `Date.now()`-based — even after D-05's unification removes the `Math.random()` suffix). Also assert the two calls differ correctly on auth: one has `headers['x-device-token']` set, the other has `credentials: 'include'` and no `x-device-token` key.

## Shared Patterns

### Dual-mode module export (browser global + CommonJS)
**Source:** `js/kiosk.js:5501-5533` (mirrored `js/admin.js:9746-9747` and `js/admin.js:12755-12757`)
**Apply to:** `js/kiosk-core.js` (new, adapted to attach `window.KioskCore` unconditionally + `module.exports` conditionally), and the new Node-only `require('./kiosk-core.js')` guards added to the tops of `js/kiosk.js` and `js/admin.js`.
```javascript
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Object.assign(module.exports || {}, { /* ...accessors + public fns... */ });
}
```

### Auth-mechanism injection seam (the one real environment difference)
**Source:** `js/kiosk.js:3480-3484` (x-device-token header) vs `js/admin.js:11055-11057` (credentials:'include' cookie)
**Apply to:** every fetch call inside the ~37 functions being promoted to `kiosk-core.js` that currently hard-codes one auth style — all must route through `KioskCore.init({ buildAuthOptions })`.
```javascript
// kiosk.js's env:
KioskCore.init({ mwUrl: kioskMwUrl(), buildAuthOptions: function () {
  return { headers: { 'x-device-token': kioskDeviceToken() } };
}});
// admin.js's env:
KioskCore.init({ mwUrl: kioskMwUrl(), buildAuthOptions: function () {
  return { credentials: 'include' };
}});
```
**Regression guard already in place (do not weaken):** `tests/frontend/kiosk-device-token.test.js` T2/T3 assert `opts.headers['x-api-key']).toBeUndefined()` on every kiosk fetch — keep these green unmodified per CLAUDE.md rule 10.

### `kioskMwUrl()` — byte-identical helper, not an injection seam
**Source:** `js/kiosk.js:571-574`, byte-identical in `js/admin.js` (per RESEARCH.md verification)
```javascript
function kioskMwUrl() {
  return (typeof SHEETS_CONFIG !== 'undefined' && SHEETS_CONFIG.MIDDLEWARE_URL)
    ? SHEETS_CONFIG.MIDDLEWARE_URL : '';
}
```
**Apply to:** either duplicate this 3-line helper in both consumer files unchanged (simplest, matches current state) or move it into `kiosk-core.js` and have both consumers call `KioskCore.mwUrl()` — RESEARCH.md notes this is trivial either way and is NOT part of the auth-injection seam.

### Sale-body construction (canonical shape, D-05 bug fixes baked in)
**Source:** `js/kiosk.js:3300-3321`
**Apply to:** the unified `kioskProceedToPayment`/sale-confirm logic moving into `kiosk-core.js` — use this shape (with `modified_ingredients` present, `idempotency_key: refNumber` — no `Math.random()` suffix) as canonical over admin.js's drifted equivalent at `js/admin.js:11009-11028`.
```javascript
var recipeSaleBody = isRecipeSale ? {
  recipe_id: _kioskRecipeContext.recipe_id,
  sale_type: _kioskRecipeContext.sale_type,
  mill_grain: _kioskRecipeContext.mill_grain,
  target_volume_l: _kioskRecipeContext.target_volume_l,
  modified_ingredients: Array.isArray(_kioskModifiedIngredients) ? _kioskModifiedIngredients : undefined,
  customer_name: (_kioskCustomer && _kioskCustomer.name) || '',
  contact_id: (_kioskCustomer && _kioskCustomer.contact_id) || '',
  reference_number: refNumber,
  idempotency_key: refNumber,
  discount: _kioskDiscount ? { preset_id: _kioskDiscount.presetId, name: _kioskDiscount.name, type: _kioskDiscount.type, value: _kioskDiscount.value, scope: _kioskDiscount.scope } : undefined
} : null;
```

## No Analog Found

None — every file in scope has a strong existing analog (either itself pre-refactor, its sibling fork file, or an existing sibling config/test file of the identical shape). This phase is a pure extraction/de-dup of already-existing, already-working code, so 7/7 files have exact or role-match analogs.

## Metadata

**Analog search scope:** `js/kiosk.js`, `js/admin.js`, `kiosk.html`, `admin.html`, `package.json`, `tests/frontend/kiosk-device-token.test.js` (all directly read/grepped this session, plus RESEARCH.md's own already-cited line numbers cross-checked against the live files)
**Files scanned:** 7 source files + 1 test file directly read; `tests/frontend/` directory listing checked for sibling kiosk test files (6 found, `kiosk-device-token.test.js` selected as strongest analog for the new parity test)
**Pattern extraction date:** 2026-07-03
