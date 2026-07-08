# Phase 54: Gift-Card Management on the Kiosk Surface - Pattern Map

**Mapped:** 2026-07-08
**Files analyzed:** 6 (2 backend, 2 backend tests, 2 frontend + 1 frontend test)
**Analogs found:** 6 / 6

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|--------------------|------|-----------|-----------------|---------------|
| `zoho-middleware/lib/authTiers.js` | config (allowlist) | request-response | same file, `gift-card/lookup` entry (line 39) | exact |
| `zoho-middleware/__tests__/auth-tiers-guard.test.js` | test | request-response | same file, test (4) session-not-403 (line 128) | exact |
| `zoho-middleware/__tests__/pos-auth-tier.test.js` | test | request-response | same file, tests (7b)/(8a) device→403 negatives (lines 210, 223) | exact |
| `js/kiosk-core.js` (new `kgcm-` panel) | component | request-response | `kgcr-` redeem panel (lines 2699-2874) for fetch/view-switch mechanics; `kioskShowDiscountMgmt`/`kiosk-discount-mgmt-modal` (lines 4180-4230) for the overlay container pattern | role-match (composite) |
| `kiosk.html` | markup | request-response | `kiosk-discount-mgmt-modal` (lines 427-434) for overlay structure; `showDeviceTokenPrompt`/"Device Settings" entry (`js/kiosk.js` lines 200-269) for the settings-gate placement | role-match |
| new/extended frontend regression test | test | request-response | `tests/frontend/admin-gift-card-mgmt.test.js` (all 125 lines) for assertions; `tests/frontend/kiosk-core-parity.test.js` `loadSurface()` (lines 144-150) for device-token-real-auth harness | exact (behavioral) + role-match (harness) |

**No-analog files:** none — every file has a direct in-repo precedent.

## Pattern Assignments

### `zoho-middleware/lib/authTiers.js` (config, request-response)

**Analog:** same file — `KIOSK_ROUTES` array + the T-46-07 comment block above it.

**Current state (lines 20-27, the comment to rewrite):**
```javascript
/**
 * ---------------------------------------------------------------------------
 * KIOSK_ROUTES is an EXPLICIT path allowlist, not a `/api/kiosk/*` prefix.
 * Anti-pattern warning (T-46-07): a prefix match would silently pull
 * /api/kiosk/gift-card/void (admin-grade — money-destroying void) into the
 * kiosk-scoped bucket the moment anyone adds a new /api/kiosk/* route.
 * Explicit list = the only route class ever added here is one a human
 * reviewed and decided is safe for a bare device token.
 * ---------------------------------------------------------------------------
 */
```
This must be rewritten to record the D-54-GC reversal: void is now intentionally
in the allowlist (status-only, reason-required, logged), while the "explicit
list, not a prefix" rationale for *other* future `/api/kiosk/*` routes still
stands — do not delete the anti-pattern warning wholesale, just correct the
void-specific claim.

**Allowlist insertion point (lines 36-57), analog entry is `gift-card/lookup`:**
```javascript
var KIOSK_ROUTES = [
  '/api/kiosk/products',
  '/api/kiosk/discounts', // A1: discount-preset CRUD classified kiosk-scoped
  '/api/kiosk/gift-card/lookup',
  '/api/kiosk/gift-card/next-number',
  // ... insert '/api/kiosk/gift-card/void' here, with an inline comment
  // referencing D-54-GC (supersedes T-46-07/D-46-02), e.g.:
  // '/api/kiosk/gift-card/void', // D-54-GC: status-only, reason-required, logged — supersedes T-46-07/D-46-02
  ...
];
```
No other code path changes — `isKioskRoute()` (lines 75-83) and `requireTiers()`
(lines 135-162) are membership-driven; adding the path to the array alone
flips the scope for both `authTiers-guard` global-guard consumers and any
in-route `requireTiers([...])` callers.

---

### `zoho-middleware/__tests__/auth-tiers-guard.test.js` (test, request-response)

**Analog:** test (4) in the same file (already asserts session-not-403 on void — the shape the flipped test (3) must match).

**Test to flip (lines 118-126):**
```javascript
test('(3) valid x-device-token on an admin-grade route (gift-card/void) — 403 (device rejected)', function () {
  return request(app)
    .post('/api/kiosk/gift-card/void')
    .set('x-device-token', DEVICE_TOKEN)
    .send({ cert_number: 'GC-000042', reason: 'test' })
    .then(function (res) {
      expect(res.status).toBe(403);
    });
});
```
Flip to `not.toBe(403)` (mirror test (4)'s assertion at line 135) and rename/
reword the test title + describe comment to reflect D-54-GC (device now
allowed). Do not touch test (4) itself — session was already not-403 and
stays that way.

**Keep unchanged — PII negative test (7a), lines 157-165:**
```javascript
test('(7a) PII GET route /api/contacts with device token only — 403', function () {
  return request(app)
    .get('/api/contacts')
    .query({ email: 'a@b.com' })
    .set('x-device-token', DEVICE_TOKEN)
    .then(function (res) {
      expect(res.status).toBe(403);
    });
});
```
This is the "prove other admin-grade routes are untouched" guard the CONTEXT
requires to remain asserted — do not weaken it while touching test (3).

---

### `zoho-middleware/__tests__/pos-auth-tier.test.js` (test, request-response)

**Analog:** negatives (7b)/(8a) in the same file — the pattern for asserting device→403 stays intact on *other* routes while (3) flips.

**Test to flip (lines 123-131):**
```javascript
test('(3) /api/kiosk/gift-card/void with a valid device token — 403 (admin-grade)', function () {
  return request(app)
    .post('/api/kiosk/gift-card/void')
    .set('x-device-token', DEVICE_TOKEN)
    .send({ cert_number: 'GC-000042', reason: 'test' })
    .then(function (res) {
      expect(res.status).toBe(403);
    });
});
```
Flip to `not.toBe(403)`, matching test (4)'s already-passing shape (lines
133-142, session cookie — not auth-403).

**Keep unchanged — negatives to preserve as-is:**
```javascript
// (7b) BrewPad-GET device→403, lines 210-218
test('(7b) GET /api/batch/search-invoices with x-device-token present but not allowed — 403', function () {
  return request(app)
    .get('/api/batch/search-invoices')
    .query({ search: 'INV-000123' })
    .set('x-device-token', DEVICE_TOKEN)
    .then(function (res) { expect(res.status).toBe(403); });
});

// (8a) admin-GET device→403, lines 223-230
test('(8a) GET /api/orders/recent with x-device-token — 403 (admin GET rejects device)', function () {
  return request(app)
    .get('/api/orders/recent')
    .set('x-device-token', DEVICE_TOKEN)
    .then(function (res) { expect(res.status).toBe(403); });
});
```

---

### Backend route reference (read-only, no edit expected — inline auth already correct)

`zoho-middleware/routes/gift-cards.js`:

**`GET /api/kiosk/gift-card/lookup` (lines 85-108)** — already device-scoped
via inline `authTiers.requireTiers(['legacy', 'device', 'session'])`. Response
contract (F7/45-09): `{ ok: true, data: { cert_number, status, face_value, current_balance } }` — nested under `data.data` when read client-side through the raw fetch response.

**`POST /api/kiosk/gift-card/void` (lines 122-159)** — relies on the *global*
guard (no inline `requireTiers` call), so D-54-GC's `KIOSK_ROUTES` change is
the entire auth-scope fix; no route-handler edit needed. Validation + logging
pattern to note (unaffected by this phase, but confirms the "status-only,
reason-required, logged" safety claims in the CONTEXT):
```javascript
// cert_number format guard (line 126-129)
var cert_number = String(body.cert_number || '').trim().toUpperCase();
if (!cert_number || !/^GC-\d{6}$/.test(cert_number)) {
  return res.status(400).json({ error: 'cert_number must match GC-NNNNNN (e.g. GC-000042)' });
}
// reason required (line 132-135)
var reason = String(body.reason || '').trim().slice(0, 512);
if (!reason) {
  return res.status(400).json({ error: 'reason is required to void a certificate' });
}
// success path (lines 149-154) — event logged, status-only, no money movement
log.info('[gift-cards/void] Certificate voided: ' + cert_number + ' (reason: ' + reason + ')');
eventLog.logEvent('kiosk.gift_card_voided', { certNumber: cert_number, reason: reason });
return res.status(200).json({ ok: true });
```
Error-status contract the frontend panel must branch on: `404` (not found),
`409` (already voided — asserted client-side in admin's reference impl even
though this exact backend snippet doesn't emit 409 itself; verify against
Apps Script `void_gift_card` result before assuming — see admin.js excerpt
below), `500`/`502` (server/upstream failure).

---

### `js/kiosk-core.js` — new `kgcm-` Gift Card Management panel (component, request-response)

Two analogs, each covering a different concern:

**(A) Container/overlay analog — `kioskShowDiscountMgmt()` + `kiosk-discount-mgmt-modal`**
(lines 4180-4230, paired with the HTML shell it toggles). This is the
project's actual **kiosk-native class-based overlay open/close** pattern —
a persistent hidden `<div>` in `kiosk.html`, shown/hidden via `style.display`,
with a render function called on open and a close button wired inline:
```javascript
function kioskShowDiscountMgmt() {
  var modal = document.getElementById('kiosk-discount-mgmt-modal');
  if (!modal) return;
  modal.style.display = '';
  kioskRenderDiscountMgmtList();

  var closeBtn = document.getElementById('kiosk-discount-mgmt-close');
  if (closeBtn) closeBtn.onclick = function () { modal.style.display = 'none'; };
  // ... additional button wiring follows the same guarded-getElementById + onclick shape
}
```
Mirror this shape for `kioskShowGiftCardMgmt()` / `kgcm-panel`: a top-level
overlay div toggled via `style.display`, a `kgcm-close`-style dismiss button,
and an exported entry point (see `showDiscountMgmt: kioskShowDiscountMgmt,`
in the `KioskCore` export object, line 4503) — add a matching
`showGiftCardMgmt: kioskShowGiftCardMgmt,` export.

**(B) Fetch/view-switching analog — the `kgcr-` redeem panel** (lines
2699-2874, 35 refs). This is the closest analog for the actual two-step
lookup→action interaction and for the auth-injected fetch call shape:
```javascript
// Auth-injected GET (line 2795) — the pattern the new lookup call MUST copy:
fetch(mwUrl + '/api/kiosk/gift-card/lookup?cert_number=' + encodeURIComponent(cert2), _kcMergeAuth({}))
.then(function (r) { return r.json().then(function (d) { return { status: r.status, data: d }; }); })
.then(function (res2) {
  gcLookupBtn.disabled = false; gcLookupBtn.textContent = 'Look Up';
  if (res2.status === 404 || !res2.data.ok) {
    if (gcErrorEl) { gcErrorEl.textContent = 'Certificate not found.'; gcErrorEl.style.display = ''; }
    return;
  }
  var d2 = res2.data.data || {};
  // ... status/balance branching, matches the F7 nested-payload contract
})
.catch(function () {
  gcLookupBtn.disabled = false; gcLookupBtn.textContent = 'Look Up';
  if (gcErrorEl) { gcErrorEl.textContent = 'Lookup failed. Check connection and try again.'; gcErrorEl.style.display = ''; }
});
```
Note the auth call MUST be `_kcMergeAuth({})` (or the module's private
equivalent helper) — never a hard-coded `{ credentials: 'include' }` (that is
the admin-only bug pattern explicitly called out in CONTEXT/RESEARCH).

View-switching by toggling `style.display` between named sub-elements (`gcInitialRow`, `gcForm`, `gcApplied` in the kgcr- panel) is the pattern to
mirror for `kgcm-lookup-view` / `kgcm-void-view` swap.

**Shared helpers already in file, reuse verbatim — do not re-implement:**
```javascript
// escapeHTML — line 123
function escapeHTML(str) {
  if (!str) return '';
  return String(str) /* ...apostrophe/HTML escaping body... */;
}
// kioskFmt — line 239 (currency formatting, e.g. kioskFmt(7.5) => '$7.50')
```

**Auth injection seam (`_kcMergeAuth`), lines 96-116** — the ONE mechanism
every outgoing fetch in this file must route through:
```javascript
function _kcMergeAuth(opts) {
  opts = opts || {};
  var auth = _kcEnv.buildAuthOptions() || {};
  if (auth.headers) {
    opts.headers = opts.headers || {};
    for (var k in auth.headers) {
      if (Object.prototype.hasOwnProperty.call(auth.headers, k)) {
        opts.headers[k] = auth.headers[k];
      }
    }
  }
  if (typeof auth.credentials !== 'undefined') {
    opts.credentials = auth.credentials;
  }
  return opts;
}
```
On kiosk, `_kcEnv.buildAuthOptions()` resolves to
`{ headers: { 'x-device-token': kioskDeviceToken() } }` (injected from
`js/kiosk.js` lines 41-45); on admin it resolves to `{ credentials: 'include' }`.
The new panel's fetch calls (lookup GET, void POST) must both go through
`_kcMergeAuth`, exactly like the kgcr- lookup call above and like every other
fetch already in this file.

**Behavioral reference (do NOT copy verbatim — port behavior only) —
`js/admin.js` `kioskShowAdminGiftCardMgmtModal()` (lines 10096-10285):**
Full two-step lookup→void state machine to replicate:
```javascript
// Lookup success branch (lines 10186-10201) — same nested-payload contract,
// same status-color logic, same "hide void button once already voided" guard:
if (result.status === 200 && result.data && result.data.ok) {
  var d = (result.data && result.data.data) || {};
  _mgmtCert = d.cert_number || cert;
  var statusStr = d.status || 'active';
  var statusColor = (statusStr === 'active') ? '#2e7d32' : '#c00';
  resultInfoEl.innerHTML =
    '<strong>Cert #:</strong> ' + escapeHTML(_mgmtCert) + '<br>' +
    '<strong>Status:</strong> <span style="color:' + statusColor + ';font-weight:600;">' + escapeHTML(statusStr) + '</span><br>' +
    '<strong>Face Value:</strong> ' + kioskFmt(d.face_value || 0) + '<br>' +
    '<strong>Current Balance:</strong> ' + kioskFmt(d.current_balance || 0);
  if (voidBtn) voidBtn.style.display = (statusStr === 'voided') ? 'none' : '';
}

// Void-view swap (lines 10216-10228) — "this cannot be undone" label:
voidBtn.onclick = function () {
  if (!_mgmtCert) return;
  lookupView.style.display = 'none';
  voidView.style.display = 'block';
  voidConfirmLabel.textContent = 'Void ' + _mgmtCert + '? This cannot be undone.';
  voidReasonEl.value = ''; voidReasonEl.focus();
};

// Reason-required client-side gate (lines 10240-10246) — mirrors the
// server's own reason-required 400, giving instant feedback before the
// round-trip:
voidConfirmBtn.onclick = function () {
  var reason = voidReasonEl ? voidReasonEl.value.trim() : '';
  if (!reason) {
    voidErrEl.textContent = 'Please enter a reason for voiding.';
    voidErrEl.style.display = 'block';
    return;
  }
  if (!_mgmtCert) return;
  // ... POST /api/kiosk/gift-card/void, branch on 200/404/409/other exactly
  // like the excerpt already shown above from admin.js lines 10250-10282
};
```
Auth difference to correct when porting: admin's fetch calls use hard-coded
`{ credentials: 'include', headers: {'Content-Type': 'application/json'} }`
(lines 10177-10179, 10251-10256) — the kiosk-core version must instead use
`_kcMergeAuth({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cert_number: _mgmtCert, reason: reason }) })`.

---

### `kiosk.html` (markup, request-response)

**Overlay structural analog — `kiosk-discount-mgmt-modal` (lines 427-434):**
```html
<div class="kiosk-discount-mgmt-modal" id="kiosk-discount-mgmt-modal" style="display:none;">
  <div class="kiosk-discount-mgmt-sheet">
    <div class="kiosk-discount-mgmt-header">
      <h2>Discount Presets</h2>
      <button type="button" class="kiosk-discount-mgmt-close" id="kiosk-discount-mgmt-close">&times;</button>
    </div>
    <div id="kiosk-discount-mgmt-list"></div>
    <!-- ... -->
  </div>
</div>
```
Mirror this exact `outer-modal > -sheet > -header (h2 + close button) > body`
shape for `kiosk-gc-mgmt-modal` / `kgcm-panel`, placed as a sibling top-level
div (outside `#kiosk-app`, same as this one at line 425/427) so it isn't
clipped by any parent's `overflow`/`display:none` state.

**Entry-point placement analog — the device-token/PIN settings gate
(`js/kiosk.js` lines 200-269, `#kiosk-signin` reused screen + "Device
Settings" button repurposed at lines 203-209, 320-326):**
```javascript
function initKioskAuth() {
  var signoutBtn = document.getElementById('kiosk-signout');
  if (signoutBtn) {
    signoutBtn.textContent = 'Device Settings';
    signoutBtn.style.display = '';
    signoutBtn.addEventListener('click', showDeviceTokenPrompt);
  }
  // ...
}
```
D-54-01 requires the "Gift Card Management" entry to live behind this same
hidden/staff-only gate, not on the sales toolbar. The `kiosk-discount-manage-btn`
(`kiosk.html` line 222, inside the discount popover) is NOT the right
placement precedent — it's reachable during an active sale. Use the
settings-gate area (`#kiosk-signin` / lock-screen "Device Settings" path) as
the actual placement precedent per CONTEXT's D-54-01, adding a new button
near the existing `kiosk-signout` / `kiosk-lock-signout` controls (`js/kiosk.js`
lines 203, 320) that calls `KioskCore.showGiftCardMgmt()`.

---

### Frontend regression test (test, request-response)

**Behavioral/assertion analog — `tests/frontend/admin-gift-card-mgmt.test.js`
(all 125 lines)** — directly reusable structure: mock fetch, lookup then void,
assert URL + body + rendered fields:
```javascript
var LOOKUP_RESPONSE = {
  ok: true,
  data: { cert_number: 'GC-000001', status: 'active', face_value: 15, current_balance: 7.5 }
};

function mockFetchOnce(status, body) {
  global.fetch.mockImplementationOnce(function () {
    return Promise.resolve({ status: status, json: function () { return Promise.resolve(body); } });
  });
}

test('void posts to the middleware host with cert number and reason', async function () {
  /* kgcm-cert -> lookup -> kgcm-void-btn -> kgcm-void-reason -> kgcm-void-confirm-btn */
  expect(global.fetch).toHaveBeenCalledTimes(2);
  var call = global.fetch.mock.calls[1];
  expect(call[0]).toBe('http://localhost:3001/api/kiosk/gift-card/void');
  var body = JSON.parse(call[1].body);
  expect(body.cert_number).toBe('GC-000001');
  expect(body.reason).toBe('UAT test certificate');
});
```
Port this near-verbatim for the kiosk surface, but assert the device-token
header instead of `credentials:'include'`, and add a reason-required gating
assertion (empty reason -> confirm blocked, no 2nd fetch call — the admin
test file has no equivalent negative case; add one).

**Harness analog for driving the REAL kiosk-core.js through `js/kiosk.js`
with device-token auth (not admin) — `tests/frontend/kiosk-core-parity.test.js`
`loadSurface()` (lines 144-150):**
```javascript
function loadSurface(path) {
  jest.resetModules();
  if (global.window) delete global.window.KioskCore;
  document.body.innerHTML = '';
  var mod = require(path); // eslint-disable-line global-require -- intentional dynamic per-surface isolation
  return { mod: mod, core: global.window.KioskCore };
}
// usage: loadSurface('../../js/kiosk.js') forces a fresh KioskCore singleton
// whose buildAuthOptions sends x-device-token (kiosk.js lines 41-45), so the
// new test can assert the fetch call's headers contain 'x-device-token'
// rather than credentials:'include'.
```
Use this if the new/extended test needs to exercise `kiosk-core.js`'s panel
through the real `js/kiosk.js` env injection (recommended, since D-54-03
requires proving the shared panel picks the kiosk auth path specifically).
If instead extending `admin-gift-card-mgmt.test.js`-style direct testing of
`js/kiosk-core.js` exports, stub `KioskCore.init({ buildAuthOptions: ... })`
directly per the `_kcEnv` shape (`js/kiosk-core.js` lines 45-67, 80-82).

## Shared Patterns

### Auth injection seam (frontend)
**Source:** `js/kiosk-core.js` lines 96-116 (`_kcMergeAuth`), lines 41-45 in
`js/kiosk.js` (kiosk's `buildAuthOptions`), admin.js's equivalent
`credentials:'include'`-only variant.
**Apply to:** every fetch call added to the new `kgcm-` panel in
`js/kiosk-core.js`. Never hard-code `credentials:'include'` — that is the bug
pattern explicitly named in RESEARCH/CONTEXT (D-54-03).

### Device-token allowlist (backend)
**Source:** `zoho-middleware/lib/authTiers.js` `KIOSK_ROUTES` array (lines
36-57) + `isKioskRoute()` (lines 75-83).
**Apply to:** `zoho-middleware/lib/authTiers.js` only — a single array
insertion (`/api/kiosk/gift-card/void`) plus the comment-block correction is
the entire backend change; no route-handler edits needed since void relies on
the global guard.

### Escaping / currency formatting (frontend)
**Source:** `js/kiosk-core.js` `escapeHTML` (line 123) and `kioskFmt` (line
239).
**Apply to:** all `kgcm-` result-card rendering (cert #, status, face value,
balance) — never string-concatenate untrusted values into `innerHTML` without
`escapeHTML`, matching every existing usage in this file (87 `escapeHTML` +
49 `kioskFmt` refs already present).

### Two-step lookup→destructive-action confirmation (both surfaces)
**Source:** `js/admin.js` `kioskShowAdminGiftCardMgmtModal()` (lines
10096-10285) — lookup view ⟷ void view swap, required-reason gate,
"cannot be undone" label, disable-button-during-request pattern
(`voidConfirmBtn.disabled = true; voidConfirmBtn.textContent = 'Voiding…';`).
**Apply to:** the new `kgcm-` panel in `js/kiosk-core.js` — behavior parity
is an explicit requirement (D-54-02); only the auth mechanism changes.

## No Analog Found

None. Every file in scope has at least a role-match, and most (backend
tests, backend config, frontend regression test) have exact analogs in the
same file.

## Metadata

**Analog search scope:** `zoho-middleware/lib/`, `zoho-middleware/routes/`,
`zoho-middleware/__tests__/`, `js/kiosk-core.js`, `js/kiosk.js`, `js/admin.js`,
`kiosk.html`, `tests/frontend/`.
**Files scanned:** 12 (2 middleware source, 2 middleware tests, 3 frontend
source, 2 frontend tests, 1 markup file, plus grep sweeps across the above).
**Pattern extraction date:** 2026-07-08
