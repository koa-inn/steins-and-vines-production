# Phase 53: Money-Path Observability & CI Gates - Pattern Map

**Mapped:** 2026-07-03
**Files analyzed:** 14 (4 money-path catch sites, server.js, jest.config.js, 2× eslint.config.js, 2× package.json, 2× .nvmrc (new), tests.yml, RUNBOOK.md)
**Analogs found:** 9 / 14 (Sentry `captureException` itself has no in-repo analog — this is a genuinely new primitive; everything else has a direct, real analog)

## IMPORTANT — Two discoveries that change scope

1. **A request-id already exists.** `server.js:102-109` already generates a
   per-request id and attaches it as `req.id` on every request:
   ```javascript
   // server.js:101-109
   // Request logging middleware (attaches reqId, logs method/path/status/ms)
   app.use(function (req, res, next) {
     var reqId = crypto.randomBytes(4).toString('hex');
     req.id = reqId;
     var start = Date.now();
     res.on('finish', function () {
       log.info(req.method + ' ' + req.path, { reqId: reqId, status: res.statusCode, ms: Date.now() - start });
     });
     next();
   });
   ```
   It is currently **only used for the access log** — nothing downstream reads
   `req.id`. **D-02 does not need a new middleware file.** The only work is:
   (a) optionally rename the local var / field to `reqId` consistently if
   desired (cosmetic, not required — `req.id` already works), and (b) thread
   `req.id` into the money-path catch blocks in `routes/checkout.js`,
   `routes/pos.js`, `routes/webhooks.js` so it can be tagged on the Sentry
   event. `lib/money-path.js` functions don't currently receive `req` — the
   planner will need to decide whether to pass `req.id` down as a parameter
   or have callers wrap the primitive's rejection with their own
   `captureException` at the route layer (simpler, no signature change to
   the shared lib).

2. **The "60 warnings" in D-05 is the middleware count only.** Confirmed by
   running `npm run lint` in each workspace right now:
   - `zoho-middleware`: `npm run lint` → **60 problems (60 warnings)** — matches D-05 exactly.
   - root (`eslint js/`): **125 problems (125 warnings)**, not 60. The ES5-only
     rule (D-06) will also newly flag ES6 syntax already present in `js/` —
     confirmed via grep: `js/brewpad.js`, `js/modules/16-catalog-subpage.js`,
     `js/lib/recipe-grouping.js` use `const`/`let`/arrow functions today (5
     occurrences total). **The lint-cleanup commit (D-05) is larger on the
     frontend side than CONTEXT.md's "60" implies** — flag this to the planner/
     implementer so the cleanup commit's scope isn't underestimated.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `zoho-middleware/routes/checkout.js` (modify: add `captureException`) | route/controller | request-response (money movement) | itself — existing `log.error` + `eventLog.logEvent` catch blocks (lines 613, 687, 750, 898-970) | exact (same file, extend existing catches) |
| `zoho-middleware/routes/pos.js` (modify: add `captureException`) | route/controller | request-response (money movement) | `routes/checkout.js` catch-block shape (money-path is shared via `lib/money-path.js`) | role-match |
| `zoho-middleware/routes/webhooks.js` (modify: add `captureException`) | route/controller (webhook handler) | event-driven | `routes/checkout.js` money-path catches (same failure semantics, different trigger) | role-match |
| `zoho-middleware/lib/money-path.js` (modify: add `captureException`) | service/lib (shared primitive) | request-response | itself — `rejectWithVoid` / `voidWithTimeout` `.catch()` blocks (lines 156-164, 209-231) | exact |
| `zoho-middleware/server.js` (modify: add `beforeSend` + fingerprint to `Sentry.init`) | config/bootstrap | request-response | itself — existing `Sentry.init` block (lines 8-15) | exact |
| Request-id tagging (no new file — reuse `req.id`) | middleware | request-response | itself — `server.js:101-109` | exact (already exists) |
| `zoho-middleware/jest.config.js` (modify: add `pos.js` floor) | config | CRUD/test-config | itself — existing per-file floor block (lines 17-27) | exact |
| `eslint.config.js` (root, modify: ES5 rule) | config | transform | itself — existing `js/**/*.js` block (lines 8-21) | exact |
| `zoho-middleware/eslint.config.js` (modify: confirm ES2020 stays, no ES5 rule) | config | transform | itself (lines 1-19) | exact (mostly unchanged) |
| `package.json` (root, modify: `--max-warnings 0`, `engines`) | config | build | itself — `scripts.lint` (line with `"lint": "eslint js/"`) | exact |
| `zoho-middleware/package.json` (modify: `--max-warnings 0`, `engines`) | config | build | itself — `scripts.lint` (`"lint": "eslint routes/ lib/ server.js"`) | exact |
| `.nvmrc` (root, new) | config | — | none in repo (new file type) | no analog |
| `zoho-middleware/.nvmrc` (new) | config | — | none in repo (new file type) | no analog |
| `.github/workflows/tests.yml` (modify: `npm ci`, lint flag, Node pin) | CI config | batch | itself — existing `test-middleware`/`test-frontend` jobs | exact |
| `package-lock.json` (root, already tracked) / `zoho-middleware/package-lock.json` (new, commit) | config | — | root lockfile is the analog for the middleware one | exact |
| `docs/RUNBOOK.md` (modify: note `npm ci` in Railway install) | docs | — | itself — existing Deploy History / Railway sections | exact |

## Pattern Assignments

### `zoho-middleware/routes/checkout.js` (route, request-response) — add `captureException`

**Analog:** itself — existing catch-block conventions

**Money-movement catch inventory (candidates per D-01 boundary):**

| Line | What it guards | In-scope per D-01? |
|---|---|---|
| 613 | `captureReadErr` — captured-amount readback (MONEY-01/H2) | **YES** — captured-amount verification |
| 750 | Main `catch (err)` — order creation failure after charge | **YES** — primary money-movement catch |
| 173, 900, 921, 939, 947, 970 | `helcimLib.voidTransaction(...).catch(...)` — void-after-early-reject | **YES** — void |
| 687 | `payErr` — customerpayment recording | **YES** — customerpayment recording |
| 259, 270, 280, 303, 646, 704, 713, 732, 824 | contact cache, mailer confirmation, idempotency cache write, batch alert email | **NO** — best-effort, per D-01 exclusion |

**Imports pattern** (top of file — confirm exact lines when implementing; representative names already in scope):
```javascript
var log = require('../lib/logger');
var eventLog = require('../lib/eventLog');
var moneyPath = require('../lib/money-path');
// Sentry is required once in server.js; routes do NOT currently require
// '@sentry/node' directly anywhere in the repo — this will be a new require
// in each of these route files (or centralize via a small wrapper — see
// "No Analog Found" below).
```

**Core catch pattern to extend** (lines 750-784, main order-creation catch):
```javascript
} catch (err) {
  if (responseSent) {
    log.error('[checkout] Error after response already sent: ' + err.message);
    return;
  }

  var status = 502;
  var internalMessage = err.message;

  if (err.isSnapshotFallback) { status = 503; }
  if (err.isCapturedAmountMismatch) { status = 402; }

  if (err.response && err.response.data) {
    internalMessage = err.response.data.message || err.response.data.error || internalMessage;
    if (err.response.status >= 400 && err.response.status < 500) { status = 400; }
  }

  log.error('[checkout] Order creation failed: ' + internalMessage);
  // <-- D-01/D-02/D-03/D-04 insertion point: Sentry.captureException(err, { tags: {...}, fingerprint: [...] })
  var clientMsg = err.isSnapshotFallback ? err.message : 'Order creation failed. Please try again.';
  ...
```

**Void-catch pattern to extend** (lines 898-925, representative):
```javascript
} catch (cacheErr) {
  log.error('[checkout/pre-validate] Cache read failed: ' + cacheErr.message);
  helcimLib.voidTransaction(transactionId).catch(function (vErr) {
    log.error('[checkout/pre-validate] Void after cache failure failed: ' + vErr.message);
  });
  return res.status(503).json({ error: 'Unable to verify item prices. Please try again.' });
}
```

---

### `zoho-middleware/routes/pos.js` (route, request-response) — add `captureException`

**Analog:** `routes/checkout.js` void-on-failure pattern (pos.js reuses `moneyPath.voidWithTimeout`)

**Core pattern** (lines 1255-1299, the `sale/confirm` failure handler — this is the primary money-movement catch in pos.js):
```javascript
}).catch(function (err) {
  if (err && err.__manualVerify) {
    if (res.headersSent) return;
    if (err.__manualVerify === 'declined') {
      return res.status(400).json({ error: '...' });
    }
    return res.status(409).json({ error: '...' });
  }
  log.error('[pos/kiosk/sale/confirm] Error: ' + err.message);
  // <-- D-01 insertion point (this IS the void/customerpayment boundary for pos.js)
  var _txnIdForVoid = (body && body.transaction_id) ? String(body.transaction_id) : null;
  if (_txnIdForVoid) {
    var _voidFailed = false;
    var _helcimForVoid = {
      voidTransaction: function (txnId) {
        return helcimLib.voidTransaction(txnId).catch(function (voidErr) {
          _voidFailed = true;
          var failRecord = { txnId: _txnIdForVoid, timestamp: new Date().toISOString(), error: voidErr.message, needs_manual_review: true };
          cache.set('sv:void-failure:' + Date.now(), failRecord, 60 * 60 * 24 * 30).catch(function () {});
          throw voidErr;
        });
      }
    };
    moneyPath.voidWithTimeout(_helcimForVoid, _txnIdForVoid, 0, { mailer: mailer, eventLog: eventLog /* ... */ });
```

Note: `pos.js` has ~70 `.catch()` sites total (grepped); the vast majority are
best-effort (`cache.del`, `cache.set` for caching, list-refresh) and are
explicitly OUT of scope per D-01. The line-1255 handler above is the
consolidated money-movement boundary for `sale/confirm` — search for
similarly-shaped `moneyPath.voidWithTimeout(...)` call sites elsewhere in the
file (terminal charge / gift-card flows) for the remaining in-scope catches.

---

### `zoho-middleware/routes/webhooks.js` (route, event-driven) — add `captureException`

**Analog:** `routes/checkout.js` catch conventions, adapted for webhook (no `res` to respond to — Helcim/Cal.com webhooks always 200 back to the sender; failures are logged, not surfaced to an HTTP caller)

**Core pattern** (lines 234-243, D-13 reconcile-pending-charge backstop — this is THE money-movement catch in webhooks.js: a late-approved terminal charge with no matching Zoho order):
```javascript
if (status === 'APPROVED' && invoiceNumber) {
  reconcile.reconcilePendingCharge(transactionId).catch(function (err) {
    log.warn('[webhook/helcim] Kiosk pending charge reconcile error: ' + err.message);
    // <-- D-01 insertion point: this IS money movement (orphan-charge reconciliation)
  });
}
```
Other `.catch()` sites in this file (collect-pending cache cleanup at line 229,
cache busting throughout) are best-effort per D-01 — do not instrument.

---

### `zoho-middleware/lib/money-path.js` (service/lib, request-response) — add `captureException`

**Analog:** itself — this file already IS the money-movement boundary (per D-01, "the money-movement primitives in `lib/money-path.js` define the boundary")

**`rejectWithVoid` catch** (lines 145-167 — void-before-reject):
```javascript
function rejectWithVoid(res, body, status, errorMsg, deps) {
  var helcim = (deps && deps.helcim) || getHelcim();
  var mailer = (deps && deps.mailer) || getMailer();
  var token = body && body.payment_token;
  if (typeof token === 'string' && token.length > 0 && token.length <= 500 && helcim.isEnabled()) {
    log.error('[money-path] Early reject after charge — voiding txn=' + token + ' (' + status + ': ' + errorMsg + ')');
    eventLog.logEvent('checkout.void_early_reject', { status: status, reason: String(errorMsg).substring(0, 80) });
    helcim.voidTransaction(token).catch(function (vErr) {
      log.error('[money-path] Void after early reject failed for txn=' + token + ': ' + vErr.message);
      // <-- D-01 insertion point
      mailer.sendVoidFailureAlert({ txnId: token, amount: 0, error: '...', timestamp: new Date().toISOString() }).catch(function () {});
    });
  }
  return res.status(status).json({ error: errorMsg });
}
```

**`voidWithTimeout` catch** (lines 186-232 — the canonical void-on-failure primitive shared by checkout.js and pos.js):
```javascript
.catch(function (voidErr) {
  if (voidErr && voidErr.message && voidErr.message.indexOf('Timeout') === 0) {
    log.error('[money-path] Helcim void timed out — manual void required for txn=' + token + ': ' + voidErr.message);
    // <-- D-01 insertion point (timeout branch — still money movement)
  } else {
    var voidFailTs = new Date().toISOString();
    log.error('[money-path] CRITICAL: Void failed for txn=' + token + ': ' + voidErr.message);
    // <-- D-01 insertion point (CRITICAL branch — level=error per D-04, NOT fatal;
    //     sendVoidFailureAlert below already pages staff, so no double-escalation)
    eventLogDep.logEvent('checkout.void_failed', { txnId: token, voidError: voidErr.message });
    return mailerDep.sendVoidFailureAlert({ txnId: token, amount: amount, error: voidErr.message, timestamp: voidFailTs })
      .catch(function (mailErr) { log.error('[money-path] Void failure alert email failed: ' + mailErr.message); });
  }
});
```

Instrumenting here (rather than only at each call site in checkout.js/pos.js)
gives D-01 coverage for BOTH routes in one place for the void path — the
planner should decide whether route-level catches are still needed for the
non-void failures (order creation, customerpayment) that don't flow through
`money-path.js`.

---

### `zoho-middleware/server.js` — `beforeSend` + fingerprint config (D-02/D-03/D-04)

**Analog:** itself — existing `Sentry.init` block

**Current state** (lines 8-15):
```javascript
var Sentry = require('@sentry/node');
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'production',
    tracesSampleRate: 0.1
  });
}
```

**Extend to add `beforeSend`** (no in-repo analog for the scrub function
itself — model it on `lib/redact.js`'s masking philosophy, which already
establishes the "mask, don't drop the whole field" convention for this
codebase):
```javascript
// lib/redact.js:11-20 — existing masking convention to mirror for beforeSend
function maskEmail(email) {
  if (typeof email !== 'string' || email.length === 0) return '(none)';
  var at = email.indexOf('@');
  if (at <= 0) { return email.charAt(0) + '***'; }
  var domain = email.slice(at + 1);
  return email.charAt(0) + '***@' + domain;
}
```
`beforeSend` should call something in this spirit on `event.user.email`,
`event.request.data` (body), and any tag/extra values that could carry a raw
email — per D-03, "strip customer emails and any PII before send; only safe
correlation ids (`reqId`, `txnId`, invoice/SO id) go in tags."

**Error handler placement — unchanged, no new pattern needed** (line 590):
```javascript
if (process.env.SENTRY_DSN) {
  Sentry.setupExpressErrorHandler(app);
}
```

**`validateEnv.js` already requires `SENTRY_DSN` in prod** (lines with
`REQUIRED_IN_PROD` array, `SENTRY_DSN` entry) — no change needed there; it's
confirmation the DSN-gated pattern (`if (process.env.SENTRY_DSN)`) used above
is already the established convention and should be reused for the
`captureException` call sites too (i.e. every `captureException` call must
also be behind the same DSN-presence check, or rely on the no-op behavior
`@sentry/node` has when uninitialized — confirm which at implementation
time).

---

### `zoho-middleware/jest.config.js` — add `pos.js` coverage floor (D-10)

**Analog:** itself — the existing per-file floor block IS the template

**Current state** (lines 17-27, to extend):
```javascript
coverageThreshold: {
  global: { lines: 62 },
  // Money-path per-file floors (D-07):
  './routes/checkout.js':  { lines: 52 },
  './routes/payments.js':  { lines: 36 },
  './routes/webhooks.js':  { lines: 62 },
  './lib/helcim.js':       { lines: 25 },
  // Existing utility floors (restored — both measured at 100%):
  './lib/validate.js': { lines: 98 },
  './lib/logger.js':   { lines: 98 }
},
```
**`pos.js` currently has NO entry in this file** — D-10 is a net-new line,
not an edit to an existing one. Add, following the exact same comment style
("measured X%, floor set at Y — Npt headroom"):
```javascript
  './routes/pos.js':       { lines: 80 }, // D-10: measured ~81% — confirm exact number at implementation time
```
Confirm the live measured percentage by running
`cd zoho-middleware && npm run test:coverage` and reading the `pos.js` row
before locking the floor number (per D-10 discretion note).

---

### `eslint.config.js` (root) — ES5 enforcement (D-06) + `--max-warnings 0` (D-05)

**Analog:** itself

**Current state** (full file, 22 lines):
```javascript
const globals = require('globals');

module.exports = [
  { ignores: ['js/main.js', '**/*.min.js'] },
  {
    files: ['js/**/*.js'],
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: 'script',
      globals: { ...globals.browser },
    },
    rules: {
      eqeqeq: 'warn',
      'no-console': 'warn',
    },
  },
];
```
Change `ecmaVersion: 2020` → `ecmaVersion: 5` (or add a `no-restricted-syntax`
ban list) for the `files: ['js/**/*.js']` block — this is the exact line the
D-06 discretion is about. **Risk already confirmed real**: `js/brewpad.js`,
`js/modules/16-catalog-subpage.js`, and `js/lib/recipe-grouping.js` use
`const`/`let`/arrow-function syntax today and will need conversion to ES5
(`var`, named `function`) before this rule can pass cleanly.

`--max-warnings 0` is a CLI flag, not a config-file change — it belongs in
`package.json`'s `scripts.lint` or directly in `tests.yml`'s lint step (see
below); no `eslint.config.js` edit is needed for D-05 itself.

---

### `zoho-middleware/eslint.config.js` — stays ES2020 (no D-06 change here)

**Current state** (full file, 19 lines) — confirmed to stay as-is per D-06
("Middleware stays `ecmaVersion: 2020`"):
```javascript
const globals = require('globals');

module.exports = [
  {
    files: ['routes/**/*.js', 'lib/**/*.js', 'server.js'],
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    rules: {
      'no-unused-vars': 'warn',
      eqeqeq: 'warn',
      'no-console': 'off',
    },
  },
];
```
Only the D-05 `--max-warnings 0` flag applies here (via `package.json`
`scripts.lint` or `tests.yml`), plus the D-05 cleanup commit for the 60
existing warnings (confirmed count: `no-unused-vars` + `eqeqeq` violations).

---

### `package.json` (root) / `zoho-middleware/package.json` — `--max-warnings 0`, `engines`, `npm ci`

**Analog:** itself — existing `scripts.lint` lines

**Root current state:**
```json
"lint": "eslint js/",
```
→ `"lint": "eslint js/ --max-warnings 0"`

**Middleware current state:**
```json
"lint": "eslint routes/ lib/ server.js",
```
→ `"lint": "eslint routes/ lib/ server.js --max-warnings 0"`

**`engines` field — net new in both `package.json` files** (neither currently
has one):
```json
"engines": { "node": "20.x" }
```

---

### `.nvmrc` (root, new) / `zoho-middleware/.nvmrc` (new)

**No analog** — neither file exists anywhere in the repo today. Content is a
single line matching CI's pinned Node version:
```
20
```

---

### `.github/workflows/tests.yml` — `npm ci`, Node pin, lint gate (D-05/D-08/D-09)

**Analog:** itself — existing `test-middleware` / `test-frontend` jobs (lines 9-39)

**Current state** (representative, `test-middleware` job, lines 9-25):
```yaml
test-middleware:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
      with:
        node-version: '20'
    - run: npm install
      working-directory: zoho-middleware
    - run: npm test
      working-directory: zoho-middleware
    - name: Lint middleware
      run: npm run lint
      working-directory: zoho-middleware
    - name: Audit middleware dependencies
      run: npm audit --audit-level=high --omit=dev
      working-directory: zoho-middleware
```
Changes needed (mirrored in `test-frontend`, lines 27-39, and `test-e2e`,
lines 53-62, which also does a bare root `npm install`):
1. `npm install` → `npm ci` in every `working-directory` (3 occurrences: root
   x2, middleware x1).
2. `node-version: '20'` can optionally read from `.nvmrc` via
   `actions/setup-node@v4`'s `node-version-file: '.nvmrc'` input instead of
   the hardcoded string — either satisfies D-09; hardcoded `'20'` already
   matches the `.nvmrc` value so no behavior change either way.
3. The `Lint middleware` / `Lint frontend` steps already just call
   `npm run lint` — once D-05's `--max-warnings 0` is added to each
   `package.json`'s `lint` script, these steps automatically enforce the
   gate with no `tests.yml` edit required (confirm this is the chosen
   mechanism vs. adding the flag directly in the workflow step).

---

### `docs/RUNBOOK.md` — note the `npm ci` change for Railway (D-08)

**Analog:** itself — existing Railway/deploy sections (no explicit
`npm install`/`npm ci` line exists in RUNBOOK.md today; Railway's Nixpacks
builder auto-detects `npm ci` vs `npm install` based on whether a
`package-lock.json` is present). Once D-07 commits
`zoho-middleware/package-lock.json`, Railway's install step switches to
`npm ci` automatically — **no `railway.toml` change is needed** (confirmed:
`zoho-middleware/railway.toml` only sets `watchPatterns`, no custom build/
install command to edit). RUNBOOK.md should get a short note under the
deploy section documenting this side effect so a future reader isn't
surprised by the install-command change with no corresponding config diff.

## Shared Patterns

### Money-path catch boundary (D-01)
**Source:** `zoho-middleware/lib/money-path.js` (whole file — this file's
functions ARE the boundary definition)
**Apply to:** `routes/checkout.js`, `routes/pos.js`, `routes/webhooks.js`,
`lib/money-path.js` itself
Every catch that guards a terminal charge, a void, captured-amount
verification, `customerpayment` recording, or gift-card money movement gets
`Sentry.captureException`. Best-effort catches (`cache.del`/`cache.set`
housekeeping, list-refresh, snapshot busting, log-only branches with no
financial consequence) do NOT.

### PII scrub convention
**Source:** `zoho-middleware/lib/redact.js:11-20` (`maskEmail`)
**Apply to:** the new `beforeSend` in `server.js`
This codebase's existing convention is to **mask, not silently drop** —
`j***@gmail.com` rather than `[REDACTED]`. Model `beforeSend`'s scrub on this
same philosophy per D-03.

### Correlation-id tagging
**Source:** `zoho-middleware/server.js:101-109` (already-existing `req.id`)
**Apply to:** every `captureException` call site
Reuse `req.id` — do not build a second id generator. Tag `reqId` + `txnId` +
invoice/SO id (where available) per D-02.

### DSN-gated Sentry calls
**Source:** `zoho-middleware/server.js:9` (`if (process.env.SENTRY_DSN) { ... }`)
**Apply to:** `server.js` (already established), and confirm at
implementation time whether route-level `captureException` calls need the
same guard or rely on `@sentry/node`'s built-in no-op-when-uninitialized
behavior.

### Coverage-floor calibration
**Source:** `zoho-middleware/jest.config.js:11-27` (comment convention:
"measured X%, floor set at Y — Npt headroom")
**Apply to:** the new `./routes/pos.js` entry (D-10) — keep the same comment
style so future floors stay self-documenting.

## No Analog Found

| File/Pattern | Role | Data Flow | Reason |
|---|---|---|---|
| `Sentry.captureException(err, {...})` call construction | instrumentation | request-response | No existing `captureException` call anywhere in the repo (grepped, zero hits outside `node_modules`) — this is genuinely new. Base it on `@sentry/node`'s standard API (`captureException(error, { tags, fingerprint, level, extra })`) combined with this codebase's existing `log.error(...)` message conventions for tag/extra content. |
| Fingerprint config | instrumentation | request-response | No existing Sentry fingerprint usage in repo. D-04: fingerprint by error class/type (e.g. `[err.name || 'Error']` or a custom `err.code`-based key) so a failure burst groups into one issue. |
| `.nvmrc` (both) | config | — | Net new file type for this repo. |
| `engines` field (both `package.json`) | config | — | Neither `package.json` currently has an `engines` block. |
| ES5-restriction eslint rule content | config | — | `eslint.config.js` (root) has never enforced `ecmaVersion: 5`; no in-repo example of the restricted-syntax list if that mechanism is chosen instead. |

## Metadata

**Analog search scope:** `zoho-middleware/routes/`, `zoho-middleware/lib/`,
`zoho-middleware/server.js`, `zoho-middleware/jest.config.js`,
`zoho-middleware/__tests__/`, root `eslint.config.js` +
`zoho-middleware/eslint.config.js`, both `package.json` files,
`.github/workflows/tests.yml`, `docs/RUNBOOK.md`,
`zoho-middleware/railway.toml`.
**Files scanned:** ~20 read/grepped directly; `grep -rn "captureException|Sentry\."`
and `grep -rn "reqId|requestId|request-id|randomUUID"` run repo-wide
(middleware) to confirm zero existing analogs before concluding "no analog."
**Pattern extraction date:** 2026-07-03
