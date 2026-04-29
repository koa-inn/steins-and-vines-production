# Phase 5: Auth Reliability - Pattern Map

**Mapped:** 2026-04-29
**Files analyzed:** 3 (1 modified JS, 1 modified CSS, 1 new test)
**Analogs found:** 3 / 3

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `js/brewpad.js` | controller (IIFE) | event-driven (auth lifecycle) | Self — existing auth code at lines 64-470 | exact (extending in-place) |
| `css/brewpad.css` | styles | N/A | Self — existing auth dot + confirm sheet styles | exact (extending in-place) |
| `tests/frontend/brewpad-auth.test.js` | test | unit test | `tests/frontend/brewpad-pure.test.js` | exact |

## Pattern Assignments

### `js/brewpad.js` — Auth Lifecycle Enhancements (controller, event-driven)

All changes are modifications within the existing IIFE. No new files. The patterns below show exactly what already exists and how to extend it.

---

**Analog: State Variables** (lines 69-76):
```javascript
var accessToken = null;
var userEmail = null;
var tokenClient = null;
var _tokenRefreshTimer = null;
var _tokenWarnTimer = null;
var _silentRefreshTimer = null;
var _handlingUnauthorized = false;
```
New variables to add at this location: `_refreshInFlight` (boolean mutex), `_lastTokenTime` (timestamp for visibility-based staleness check).

---

**Analog: Session Save/Load/Clear** (lines 150-171):
```javascript
var SESSION_KEY = 'sv-brewpad-session';

function saveSession(token, expiresIn, email) {
  localStorage.setItem(SESSION_KEY, JSON.stringify({
    token: token,
    expires_at: Date.now() + (expiresIn * 1000),
    email: email
  }));
}

function loadSession() {
  try {
    var raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    var data = JSON.parse(raw);
    if (data.expires_at < Date.now() + 5 * 60 * 1000) return null;
    return data;
  } catch (e) { return null; }
}

function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}
```
**Modification needed per Pitfall 3 (RESEARCH.md):** `loadSession()` currently returns `null` when token is expired (within 5 min of expiry). For 7-day persistence, the email must be stored/returned separately from token validity. The email must survive token expiry so `login_hint` works on wake-from-sleep. `clearSession()` should only remove email on explicit sign-out or after 7 days.

---

**Analog: `gsiInitTokenClient` call** (lines 210-214):
```javascript
tokenClient = gsiInitTokenClient({
  client_id: SHEETS_CONFIG.CLIENT_ID,
  scope: SHEETS_CONFIG.SCOPES + ' https://www.googleapis.com/auth/userinfo.email',
  callback: onTokenResponse
});
```
**Modification needed:** Add `error_callback` parameter to detect popup failures (popup_failed_to_open, popup_closed). This provides faster detection than the 15-second fallback timer. Must reset `_refreshInFlight = false` in the error callback.

---

**Analog: Silent Refresh with Fallback** (lines 230-253):
```javascript
// Fallback: if no response in 15s, just show the signin button.
_silentRefreshTimer = setTimeout(function () {
  _silentRefreshTimer = null;
  showSignInButton();
}, 15000);
var _refreshAttempts = 0;
function attemptSilentRefresh() {
  try {
    tokenClient.requestAccessToken({ prompt: '', login_hint: saved.email });
  } catch (err) {
    _refreshAttempts++;
    if (_refreshAttempts < 3) {
      setTimeout(attemptSilentRefresh, 1000 * _refreshAttempts);
    } else {
      clearTimeout(_silentRefreshTimer);
      _silentRefreshTimer = null;
      clearSession();
      showSignInButton();
    }
  }
}
attemptSilentRefresh();
```
This is the template for the new `tryRefreshToken()` function. The new function must check `_refreshInFlight` and `_handlingUnauthorized` before calling `requestAccessToken`. The visibility handler and the 5-min warning timer both call `tryRefreshToken()` instead of calling `requestAccessToken` directly.

---

**Analog: `onTokenResponse` callback** (lines 272-296):
```javascript
function onTokenResponse(response) {
  if (_silentRefreshTimer) { clearTimeout(_silentRefreshTimer); _silentRefreshTimer = null; }
  _handlingUnauthorized = false;
  if (response.error) {
    if (accessToken) {
      handleUnauthorized();
    } else {
      clearSession();
      showSignInButton();
    }
    return;
  }
  accessToken = response.access_token;
  var expiresIn = response.expires_in || 3600;
  fetchGoogleUserInfo(accessToken)
    .then(function (info) {
      userEmail = info.email;
      saveSession(accessToken, expiresIn, userEmail);
      checkAuthorization();
    })
    .catch(function () { showDenied(); });
}
```
**Modifications needed:** (1) Reset `_refreshInFlight = false` at the top. (2) Update `_lastTokenTime = Date.now()` on success. (3) Remove session expired overlay if present. (4) After `showApp()`, call `restoreAllFormDrafts()` and show toast if any were restored.

---

**Analog: Token Refresh Timer + Expiry Warning** (lines 339-356):
```javascript
if (_tokenRefreshTimer) clearInterval(_tokenRefreshTimer);
_tokenRefreshTimer = setInterval(function () {
  tokenClient.requestAccessToken({ prompt: '' });
}, 50 * 60 * 1000);

// Warn 5 minutes before token expiry
if (_tokenWarnTimer) clearTimeout(_tokenWarnTimer);
var sessionData = null;
try { var raw = localStorage.getItem(SESSION_KEY); if (raw) sessionData = JSON.parse(raw); } catch (e) {}
if (sessionData && sessionData.expires_at) {
  var remainMs = sessionData.expires_at - Date.now();
  var warnMs = Math.max(0, remainMs - 300000);
  _tokenWarnTimer = setTimeout(function () {
    showToast('Session expiring soon — tap to stay signed in', 'warning', { duration: 8000 });
    var d = document.getElementById('bp-auth-dot');
    if (d) { d.className = 'bp-auth-dot bp-auth-dot--warning'; d.title = 'Session expiring soon'; }
  }, warnMs);
}
```
**Modifications needed per D-07:** The 5-min warning timer should call `tryRefreshToken()` instead of showing a toast. On silent success (D-08), show no toast. On failure, show the blocking overlay (D-09). The 50-min interval timer should also route through `tryRefreshToken()`.

---

**Analog: Auth Dot Status Update** (lines 314-316):
```javascript
var dot = document.getElementById('bp-auth-dot');
if (dot) { dot.className = 'bp-auth-dot bp-auth-dot--online'; dot.title = 'Signed in as ' + (userEmail || ''); }
```
Same pattern used in `bpSignOut` (line 420) and `handleUnauthorized` (lines 466-467). New state `bp-auth-dot--refreshing` follows the same class-swap pattern.

---

**Analog: `handleUnauthorized()` — Form Save** (lines 423-468):
```javascript
function handleUnauthorized() {
  if (_handlingUnauthorized) return;
  _handlingUnauthorized = true;
  if (_tokenRefreshTimer) { clearInterval(_tokenRefreshTimer); _tokenRefreshTimer = null; }
  if (_tokenWarnTimer) { clearTimeout(_tokenWarnTimer); _tokenWarnTimer = null; }

  // Save in-progress create-batch form if it's open
  var createSheet = document.getElementById('bp-create-sheet');
  if (createSheet && createSheet.style.display !== 'none') {
    var formState = {};
    var draftFields = [
      ['bp-new-product-text', 'productText'],
      // ... 14 fields
    ];
    var hasData = false;
    for (var i = 0; i < draftFields.length; i++) {
      var el = document.getElementById(draftFields[i][0]);
      if (el && el.value) { formState[draftFields[i][1]] = el.value; hasData = true; }
    }
    if (hasData) {
      try { sessionStorage.setItem('sv-brewpad-form-draft', JSON.stringify(formState)); } catch (e) {}
    }
  }

  clearSession();
  accessToken = null;
  userEmail = null;
  // ... show sign-in screen
}
```
**Modification needed per D-05:** Replace the inline create-batch save with a call to `saveAllFormDrafts()`. The existing create-batch save becomes one entry in the `_formSavers` registry. Four more form savers are added (see Five Form Types section below).

---

**Analog: Create-Batch Form Restore in `showApp()`** (lines 368-399):
```javascript
var draft = null;
try { var draftRaw = sessionStorage.getItem('sv-brewpad-form-draft'); if (draftRaw) draft = JSON.parse(draftRaw); } catch (e) {}
if (draft) {
  sessionStorage.removeItem('sv-brewpad-form-draft');
  showToast('Your in-progress batch form has been restored', 'success');
  switchTab('batches');
  openCreateSheet();
  setTimeout(function () {
    var fields = [
      ['bp-new-product-text', 'productText'],
      // ... 14 fields
    ];
    for (var i = 0; i < fields.length; i++) {
      var el = document.getElementById(fields[i][0]);
      if (el && draft[fields[i][1]]) el.value = draft[fields[i][1]];
    }
  }, 150);
}
```
**Modification needed:** Replace with `restoreAllFormDrafts()` call. The 150ms setTimeout pattern is replicated per form type. Toast message changes to generic "Your in-progress work has been restored" (D-06).

---

**Analog: `showConfirmSheet()` — Overlay Pattern** (lines 1320-1355):
```javascript
function showConfirmSheet(message, okLabel, okCls, onOk) {
  var sheet = document.getElementById('bp-confirm-sheet');
  if (!sheet) {
    sheet = document.createElement('div');
    sheet.id = 'bp-confirm-sheet';
    sheet.className = 'bp-confirm-sheet';
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    sheet.innerHTML =
      '<div class="bp-confirm-sheet-inner">' +
      '<p class="bp-confirm-sheet-msg" id="bp-confirm-sheet-msg"></p>' +
      '<div class="bp-confirm-sheet-actions">' +
      '<button type="button" id="bp-confirm-sheet-ok" class="btn"></button>' +
      '<button type="button" id="bp-confirm-sheet-cancel" class="btn-secondary">Cancel</button>' +
      '</div></div>';
    document.body.appendChild(sheet);
  }
  // ... wire click handlers, add --visible class
  sheet.classList.add('bp-confirm-sheet--visible');
}
```
**Template for D-09 session expired overlay:** Use same `document.createElement` + `classList.add('--visible')` pattern. The session overlay is centered (not bottom-aligned like confirm sheet), has no cancel button, and calls `tokenClient.requestAccessToken()` from the sign-in button click (user gesture, safe for Safari popup rules).

---

**Analog: `saveMeasGridValues()` — Measurement Data Capture** (lines 3004-3020):
```javascript
function saveMeasGridValues() {
  Array.prototype.forEach.call(
    document.querySelectorAll('.bp-meas-multi-row[data-batch-id]'),
    function (row) {
      var batchId = row.getAttribute('data-batch-id');
      var plato = (row.querySelector('.bp-meas-cell-plato') || {}).value || '';
      var temp  = (row.querySelector('.bp-meas-cell-temp')  || {}).value || '';
      var ph    = (row.querySelector('.bp-meas-cell-ph')    || {}).value || '';
      var notes = (row.querySelector('.bp-meas-cell-notes') || {}).value || '';
      if (plato || temp || ph || notes) {
        _measMultiData[batchId] = { plato: plato, temp: temp, ph: ph, notes: notes };
      } else {
        delete _measMultiData[batchId];
      }
    }
  );
}
```
This function already captures measurement grid state into `_measMultiData`. The measurement form saver calls `saveMeasGridValues()` then persists `_measMultiData` + `_measSharedDate` to sessionStorage. Restore repopulates `_measMultiData` and `_measSharedDate`; the grid re-renders from those variables when the measurements tab is opened.

---

**Analog: Existing `document.hidden` check** (line 645):
```javascript
_dashAutoRefreshTimer = setInterval(function () {
  if (document.hidden) return;
  if (_activeTab === 'dashboard') loadDashboard();
}, 300000);
```
Confirms the codebase already uses `document.hidden` (not the vendor-prefixed `webkitHidden`). The new `visibilitychange` listener follows the same API surface.

---

### Five Form Types — Save/Restore Field Maps

Each form type needs a saver in the `_formSavers` registry. The save/restore structure copies the create-batch pattern (lines 430-456 save, 369-399 restore).

| # | Form Type | Storage Key | State to Capture | DOM Check for "is open" |
|---|-----------|-------------|------------------|------------------------|
| 1 | Create-batch | `sv-brewpad-form-draft` | 14 input fields (already implemented) | `bp-create-sheet` visible |
| 2 | Multi-batch measurements | `sv-brewpad-meas-draft` | `_measMultiData` object + `_measSharedDate` | `_activeTab === 'measurements'` |
| 3 | Batch detail (location + notes) | `sv-brewpad-detail-draft` | `bp-edit-vessel`, `bp-edit-shelf`, `bp-edit-bin`, `bp-detail-notes`, `_detailBatchId` | `_detailBatchId !== null` |
| 4 | Single-reading entry (in batch detail) | `sv-brewpad-reading-draft` | `bp-detail-plato-date`, `bp-detail-plato-val`, `bp-detail-plato-temp`, `bp-detail-plato-ph`, `bp-detail-plato-notes`, `_detailPlatoStaging` array, `_detailBatchId` | `_detailBatchId !== null` AND staging has entries |
| 5 | Schedule template editor | `sv-brewpad-sched-draft` | `bp-sched-name`, `bp-sched-desc`, `bp-sched-category`, `_schedSteps` array, `bp-sched-pkg-title`, `bp-sched-pkg-desc`, editing schedule_id | `bp-sched-sheet` visible |

---

### `css/brewpad.css` — Auth Dot + Session Overlay Styles (styles)

**Analog: Auth Dot States** (lines 284-295):
```css
.bp-auth-dot {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  margin-right: 6px;
  vertical-align: middle;
  flex-shrink: 0;
}
.bp-auth-dot--online  { background: #4caf50; }
.bp-auth-dot--warning { background: #ff9800; }
.bp-auth-dot--offline { background: #9e9e9e; }
```
New state to add: `.bp-auth-dot--refreshing` with pulsing green animation (use `@keyframes` like existing `bp-saving-pulse` at line 832).

**Analog: Confirm Sheet Overlay** (lines 1359-1397):
```css
.bp-confirm-sheet {
  position: fixed;
  inset: 0;
  background: rgba(44, 34, 24, 0.55);
  z-index: 900;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.2s ease;
}
.bp-confirm-sheet.bp-confirm-sheet--visible {
  opacity: 1;
  pointer-events: auto;
}
.bp-confirm-sheet-inner {
  background: var(--cellar-raised);
  border-radius: var(--r-lg) var(--r-lg) 0 0;
  padding: 24px 20px calc(24px + env(safe-area-inset-bottom, 0px));
  width: 100%;
  max-width: 560px;
  box-shadow: 0 -4px 24px rgba(44, 34, 24, 0.18);
}
```
Template for session expired overlay. Differences: `align-items: center` (centered, not bottom-aligned), `z-index: 1000` (above confirm sheets), `border-radius` all corners.

---

### `tests/frontend/brewpad-auth.test.js` — New Test File (test, unit)

**Analog:** `tests/frontend/brewpad-pure.test.js`

**Test file setup pattern** (lines 1-16):
```javascript
'use strict';

// brewpad.js runs its IIFE on load — stub the globals it touches at the top level.
global.document = global.document || {};
global.window = global.window || {};
global.navigator = global.navigator || {};
global.google = { accounts: { oauth2: { initTokenClient: jest.fn() } } };
global.fetch = jest.fn();

// auth.js primitives are loaded via <script> in the browser; in tests wire them as globals.
var _auth = require('../../js/lib/auth');
global.waitForGoogleIdentity = _auth.waitForGoogleIdentity;
global.gsiInitTokenClient = _auth.gsiInitTokenClient;
global.fetchGoogleUserInfo = _auth.fetchGoogleUserInfo;

var bp = require('../../js/brewpad');
```

**Test describe/test pattern** (lines 29-41):
```javascript
describe('escapeHTML', function () {
  test('null -> empty string', function () { expect(escapeHTML(null)).toBe(''); });
  test('undefined -> empty string', function () { expect(escapeHTML(undefined)).toBe(''); });
  test('& escaped', function () { expect(escapeHTML('a & b')).toBe('a &amp; b'); });
  // ...
});
```

**Key constraint:** Only top-level (non-IIFE) functions are exported and testable. The auth functions (`tryRefreshToken`, `saveAllFormDrafts`, `restoreAllFormDrafts`) live inside the IIFE and cannot be directly tested. The new test file tests any NEW pure helpers extracted to top-level scope for testability. If no new top-level helpers are created, the test file focuses on integration patterns using jsdom with `localStorage`/`sessionStorage` mocks.

**Module exports pattern** (brewpad.js lines 3861-3868):
```javascript
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    escapeHTML: escapeHTML, fmtDate: fmtDate, todayStr: todayStr,
    isOverdue: isOverdue, isToday: isToday,
    filterBatchesByStatus: filterBatchesByStatus,
    calcAbv: calcAbv, renderDataGapWarning: renderDataGapWarning
  };
}
```
Any new testable functions must be added to this exports block.

---

## Shared Patterns

### Re-entrant Guard (Mutex)
**Source:** `js/brewpad.js` line 76 (`_handlingUnauthorized`) and lines 424-425
**Apply to:** All token refresh trigger paths (visibility, timer, 5-min warning, API 401)
```javascript
if (_handlingUnauthorized) return;
_handlingUnauthorized = true;
```
New `_refreshInFlight` flag follows identical pattern. Both are checked before any `requestAccessToken` call.

### Toast Notifications
**Source:** `js/brewpad.js` lines 175-204
**Apply to:** Form restore success (D-06), refresh failure notification
```javascript
showToast('Your in-progress batch form has been restored', 'success');
// Error variant:
showToast('Session expiring soon', 'warning', { duration: 8000 });
```

### sessionStorage for Drafts
**Source:** `js/brewpad.js` lines 454-456 (save) and lines 370-372 (read + remove)
**Apply to:** All five form draft save/restore operations
```javascript
// Save:
try { sessionStorage.setItem('sv-brewpad-form-draft', JSON.stringify(formState)); } catch (e) {}
// Restore:
try { var draftRaw = sessionStorage.getItem('sv-brewpad-form-draft'); if (draftRaw) draft = JSON.parse(draftRaw); } catch (e) {}
sessionStorage.removeItem('sv-brewpad-form-draft');
```

### Auth Dot Class Swap
**Source:** `js/brewpad.js` lines 314-316 (online), 354 (warning), 420 (offline), 467 (offline)
**Apply to:** New refreshing state during token refresh lifecycle
```javascript
var dot = document.getElementById('bp-auth-dot');
if (dot) { dot.className = 'bp-auth-dot bp-auth-dot--online'; dot.title = 'Signed in as ' + (userEmail || ''); }
```

### ES5 / `var` Convention
**Source:** Entire codebase
**Apply to:** All new code
```javascript
// YES:
var _refreshInFlight = false;
function tryRefreshToken() { ... }

// NO:
let _refreshInFlight = false;
const tryRefreshToken = () => { ... };
```

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| (none) | -- | -- | All new code extends existing patterns within `js/brewpad.js`. Every pattern has a direct analog in the existing codebase. |

---

## Metadata

**Analog search scope:** `js/brewpad.js`, `js/lib/auth.js`, `css/brewpad.css`, `tests/frontend/`
**Files scanned:** 4 primary source files + test directory listing
**Pattern extraction date:** 2026-04-29
