# Phase 48: Kiosk POS De-Fork (kiosk-core.js) - Research

**Researched:** 2026-07-03
**Domain:** Vanilla-JS ES5 client refactor (code de-duplication) across two IIFE bundles that share no runtime, backed by an already-hardened Express money-path (`zoho-middleware/routes/pos.js`)
**Confidence:** HIGH (all findings below are `[VERIFIED: codebase]` — obtained by direct `grep`/`diff`/`wc` against `js/kiosk.js`, `js/admin.js`, `kiosk.html`, `admin.html`, `package.json`, `zoho-middleware/routes/pos.js`, and `tests/frontend/*.test.js` in this repo, not from training-data assumptions)

## Summary

This is a pure client-side de-duplication refactor with a hard behaviour-preservation constraint, not new-technology research. The real risk is not "what library to use" — it's "which of two already-diverged copies of ~37 functions is the correct one to keep," because a byte-level diff shows the two copies are **not** identical today. `js/admin.js`'s embedded kiosk (`#tab-kiosk`) is missing: the entire discount subsystem (confirmed, 0 discount DOM elements and 0 discount JS functions), the dual-cart/sales-order-import flow (confirmed, `kioskCollectPayment`/`kioskCreateSalesOrder`/`kioskImportSoToCart` exist only in `kiosk.js`), and — most importantly — it silently omits `modified_ingredients` from its recipe-sale payload while still using it to preview the price, and it still POSTs its own client-side `create_batch` call for kit items even though the server (`pos.js:1219`, `brewpad-integration.js createBatchesFromSale`) already auto-creates that batch record for every kiosk sale — a duplicate-batch bug that `kiosk.js` already found and fixed in itself (see `js/kiosk.js:3748-3759`) but never had a chance to fix in `admin.js`, because the two files are hand-maintained forks with no shared module. Every one of these is direct, cited evidence that D-02's framing ("divergence = accidental fork to unify") is correct and that the extraction is where these real bugs get fixed as a side effect — not scope creep to flag away.

The two files are genuinely separate runtimes: `admin.html` loads only `admin.js` (defer), `kiosk.html` loads only `kiosk.js`; they never coexist in the same page, so there is no existing shared-state risk from double-loading — but it also means **kiosk-core.js must work when `require()`d directly under Jest** (existing tests do `require('../../js/kiosk.js')` with no bundler and no prior `require('./kiosk-core.js')`), which is the single trickiest new-territory decision in this phase (see Pitfall 3).

**Primary recommendation:** Extract into `js/kiosk-core.js` as an ES5 IIFE that both attaches `window.KioskCore = {...}` AND performs the identical `if (typeof module !== 'undefined' && module.exports) { module.exports = ... }` test-export pattern already used at the bottom of `kiosk.js`/`admin.js`. Load it as its own minified bundle (`js/kiosk-core.min.js`) via a new `<script>` tag placed *before* `kiosk.min.js`/`admin.min.js` on each HTML page, with its own terser target in `package.json`. Use `kiosk.js`'s copies as canonical source (they are the more-recently-hardened, bug-fixed copies) for every one of the ~37 shared functions, and additionally promote the kiosk.js-only discount subsystem (12 functions) into kiosk-core.js per D-04 — which requires porting ~45 lines of static HTML markup from `kiosk.html` into `admin.html`'s `#tab-kiosk` panel (the CSS for `.kiosk-discount-*` is already loaded on both pages via the shared `kiosk.min.css`, so no new stylesheet work is needed).

## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** `js/kiosk-core.js` is an ES5 IIFE that attaches a single `window.KioskCore` namespace object exposing the shared functions; `kiosk.js` and `admin.js` call into it (e.g. `KioskCore.proceedToPayment(...)`). Bare-globals and `window.SV` were both rejected — `KioskCore` can be rehomed under `window.SV.kiosk` later without rework.
- **D-02:** `kiosk-core.js` is context-agnostic — truly identical behaviour on both surfaces. The two consumers inject only *environment* at init (middleware URL / `kioskMwUrl`, mode, DOM mount roots), never behaviour. Any place `kiosk.js` and `admin.js` currently diverge in the money/cart path is an accidental fork to unify, not a difference to preserve.
- **D-03:** Parity verified by (a) existing kiosk tests passing unweakened, (b) a new automated payload-parity test asserting identical fetch request payloads/call flow across surfaces for the same cart, (c) a manual iPad Safari checkpoint (SC#5) — not automatable (staging calls prod middleware).
- **D-04:** The product-type discount becomes purely identical on both surfaces by moving into `kiosk-core.js` — no admin-specific override, no staff affordance. Single allowed behaviour change; keep it minimal.
- **Out of scope:** changing money-path behaviour, adopting `money-path.js` primitives (Phase 50), introducing `window.SV`, any UI redesign.

### Claude's Discretion
- Exact `KioskCore` API surface (function names, `init(env)` signature, environment injection mechanism) — constrained by D-01/D-02.
- Build wiring for `kiosk-core.js` (separate `<script>` vs prepend-per-bundle at build time).

### Deferred Ideas (OUT OF SCOPE)
- `window.SV` namespace adoption — future phase; `KioskCore` is designed to rehome under it later without rework.
- Kiosk adopting `money-path.js` primitives (synchronous void-on-failure hardening) — Phase 50 (MONEY-02), explicitly enabled by this de-fork but out of scope here.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| KIOSK-01 | Kiosk POS logic exists in a single shared `js/kiosk-core.js` consumed by both `kiosk.js` and `admin.js`; cart/payment/checkout paths can no longer diverge; behaviour-preserving except product-type discount now identical on both surfaces | Full function inventory (Standard Stack / Architecture Patterns), drift map (Common Pitfalls), build wiring recommendation, and parity-test strategy below directly enable planning KIOSK-01's tasks |

## Project Constraints (from CLAUDE.md)

- ES5-only: `js/` is lint-enforced at `ecmaVersion: 5` (Phase 53, OBS-01). `kiosk-core.js` must use `var`, `function` declarations, no arrow functions/template literals/`const`/`let`/destructuring. Verified: both source files already comply (`'use strict'`, `var`, function expressions only).
- Never hand-edit `js/kiosk.min.js` / `js/admin.min.js` (or the new `js/kiosk-core.min.js`) — edit sources, then `npm run build`.
- Run `npm run build` after any JS module change (regenerates all `*.min.js` + HTML `?v=` stamps).
- `npm run lint` (`eslint js/ --max-warnings 0`) and both test suites (`npm test`, `cd zoho-middleware && npm test`) must be clean before every commit.
- Write a regression/parity test — for this phase, a NEW automated payload-parity test (no such test exists today; see Validation Architecture below) plus keeping all existing kiosk/admin frontend tests green.
- One logical change per commit — this phase's natural commit boundaries are: (1) create kiosk-core.js + build wiring, (2) migrate kiosk.js to consume it, (3) migrate admin.js to consume it + port discount markup, (4) parity test, (5) any drift-bug fixes surfaced during migration (batch-dup / modified_ingredients) as their own commit(s) since they are behaviourally meaningful even though they fall out of "unify the fork."
- Do NOT modify existing tests unless explicitly asked — this directly shapes the build-wiring decision (see Pitfall 3): whatever mechanism loads `kiosk-core.js` under Jest must not require editing `tests/frontend/kiosk-*.test.js` or `admin-*.test.js`, since none of them currently `require('./kiosk-core.js')`.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Cart building / totals / discount calc | Browser / Client (`kiosk-core.js`) | — | Pure client-side state (`_kioskCart`) and display math; server re-validates totals independently (`pos.js` recomputes tax/discount server-side before charging — not touched by this phase) |
| Terminal push / poll / confirm orchestration | Browser / Client (`kiosk-core.js`) | API / Backend (`pos.js` `/api/kiosk/sale`, `/api/kiosk/sale/confirm`) | Client owns the UI state machine (poll timers, cancel button, spinner); server owns the actual Helcim terminal call + Zoho invoice/payment + void-on-failure — this phase touches only the client orchestration layer, never the server logic |
| Void-on-failure | API / Backend (`pos.js`, `lib/money-path.js` — untouched) | Browser / Client (display of `payment_voided` flag) | The client never initiates or decides a void; it only renders `result.data.payment_voided` / `voided_transaction_id`. Confirmed no void-triggering logic exists client-side in either file. |
| Dual-cart / sales-order import + shared-charge collection | Browser / Client (`kiosk-core.js`, moved from kiosk.js-only) | API / Backend (`/api/kiosk/salesorder-update`, `/api/kiosk/salesorder-pay`) | Currently kiosk.js-exclusive; centralizing gives admin this capability only if admin.html also gets the missing UI entry points (out of scope unless the planner explicitly adds them — see Pitfall 5) |
| Environment/auth injection (`mwUrl`, device-token vs cookie auth, DOM roots) | Browser / Client (consumer-supplied `init(env)` args) | — | The one deliberate per-surface difference `kiosk-core.js` must never hard-code; see Environment Injection Seam below |
| Batch record creation for kit sales | API / Backend (`brewpad-integration.js createBatchesFromSale`, fire-and-forget on every `/api/kiosk/sale`) | — | Server-authoritative since Phase 46; `admin.js`'s client-side `create_batch` loop is dead-weight duplicate work this phase should remove (see Pitfall 2) |

## Standard Stack

No new libraries. This phase adds zero npm dependencies (frontend or middleware) — it is a pure internal-module extraction using the project's existing ES5-IIFE-with-conditional-`module.exports` pattern (already used identically at the bottom of both `js/kiosk.js:5501` and `js/admin.js:9746`/`12756`).

### Core
| Component | Version | Purpose | Why Standard |
|-----------|---------|---------|--------------|
| terser | ^5.31.0 (already a devDependency) | Minifies `kiosk-core.js` → `kiosk-core.min.js` | Already used identically for `kiosk.js`→`kiosk.min.js` and `admin.js`→`admin.min.js` in `package.json`'s `minify:js` script — no new tool |
| Jest 29.7 + jest-environment-jsdom | already configured | Runs existing + new parity tests | `jest.config.js` already sets `testEnvironment: 'jsdom'`; existing kiosk tests `require()` the raw ES5 source directly |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Separate `<script src="kiosk-core.min.js">` before each consumer | Prepend kiosk-core.js source into each bundle at build time (`cat kiosk-core.js kiosk.js > combined && terser`) | Prepend avoids a 4th network request and load-order footguns, but (a) breaks the existing `require('../../js/kiosk.js')` Jest pattern since the concatenated file would need to exist as a build artifact that tests would have to require instead, forcing exactly the "modify existing tests" CLAUDE.md violation this phase must avoid; (b) defeats D-03's payload-parity test, which wants to assert against one shared `KioskCore` module identity, not two copy-pasted bundles. **Rejected — use separate script tag (see Build Wiring below).** |

**Installation:** none — no `npm install` needed for this phase.

## Package Legitimacy Audit

Not applicable — this phase introduces zero new external packages (frontend or middleware). No `slopcheck`/registry verification is required.

## Architecture Patterns

### System Architecture Diagram

```
┌─────────────────────────┐        ┌──────────────────────────┐
│      kiosk.html          │        │       admin.html          │
│  (standalone kiosk)      │        │  (#tab-kiosk embedded)     │
└──────────┬───────────────┘        └───────────┬───────────────┘
           │ <script> load order (both pages, in this order):     │
           │  1. js/lib/*.js (constants, utils, auth,              │
           │     recipe-grouping, discount-match*)                 │
           │  2. js/sheets-config.js, js/admin-config.js            │
           │  3. js/kiosk-core.min.js   <-- NEW, loads BEFORE #4    │
           │  4. js/kiosk.min.js   OR   js/admin.min.js             │
           ▼                                       ▼
┌──────────────────────┐              ┌───────────────────────┐
│  kiosk.js IIFE        │              │  admin.js IIFE          │
│  KioskCore.init({      │              │  KioskCore.init({        │
│    mwUrl: kioskMwUrl,  │              │    mwUrl: kioskMwUrl,    │
│    authHeader: 'x-     │              │    authHeader: null,     │  <-- env seam
│      device-token',    │              │    credentials:          │
│    deviceToken:         │              │      'include',          │
│      kioskDeviceToken() │              │  })                       │
│  })                     │              │                          │
│  + kiosk.js-only:       │              │  + admin.js-only:        │
│    discount UI wiring,  │              │    kit-batch dedupe fix, │
│    dual-cart/SO UI      │              │    recipe volume/quick-  │
│                          │              │    edit UI                │
└──────────┬───────────────┘              └───────────┬───────────────┘
           │  KioskCore.proceedToPayment() (shared)     │
           ▼                                             ▼
┌────────────────────────────────────────────────────────────────┐
│                     window.KioskCore (kiosk-core.js)             │
│  cart build → totals/discount calc → GC panel → terminal push    │
│  → poll → confirm → receipt/error render → dual-cart SO flow      │
│  (all ~37 shared fns + discount subsystem, unchanged logic)        │
└──────────────────────────────┬───────────────────────────────────┘
                                │ fetch(mwUrl + '/api/kiosk/...', {headers/credentials from init env})
                                ▼
┌────────────────────────────────────────────────────────────────┐
│         zoho-middleware/routes/pos.js  (UNTOUCHED this phase)     │
│  /api/kiosk/sale, /recipe-sale, /sale/confirm, /recipe-sale/confirm│
│  /salesorder-create, /salesorder-update, /salesorder-pay           │
│  → Helcim terminal charge → Zoho invoice/payment → void-on-failure │
│    (lib/money-path.js) → brewpad-integration.js createBatchesFromSale│
└────────────────────────────────────────────────────────────────┘
```

### Recommended Project Structure
```
js/
├── kiosk-core.js         # NEW — ES5 IIFE, window.KioskCore + module.exports
├── kiosk.js              # slimmed: consumer wiring + kiosk-only UI (discount mgmt modal trigger reuse, dual-cart SO UI, customer-browse tabs)
├── admin.js              # slimmed: consumer wiring + admin-only UI (recipe quick-edit, save-as-new, admin gift-card mgmt modal, kit-batch fix)
└── lib/
    └── discount-match.js # UNCHANGED — must now also be <script>-loaded on admin.html (currently kiosk.html-only)
```

### Pattern 1: Environment-injected `init(env)` entry point (the core of D-02)
**What:** `KioskCore.init({ mwUrl, authHeaders, credentials, deviceToken })` called once by each consumer at DOMContentLoaded, before any cart/payment function runs. All shared functions read environment through a closure variable set by `init()`, never through a global the consumer happens to define.
**When to use:** Any shared function that currently does `fetch(mwUrl + '/api/...', { headers: {...} })`.
**Example (concrete, derived from the actual divergent code found in this repo):**
```javascript
// Source: js/kiosk-core.js (proposed)
var _kcEnv = { mwUrl: '', buildAuthOptions: function () { return {}; } };

function kcInit(env) {
  _kcEnv.mwUrl = env.mwUrl || '';
  _kcEnv.buildAuthOptions = env.buildAuthOptions || function () { return {}; };
}

// kiosk.js's env (VERIFIED at js/kiosk.js:15-17, every fetch call e.g. line 3215):
//   KioskCore.init({ mwUrl: kioskMwUrl(), buildAuthOptions: function () {
//     return { headers: { 'x-device-token': kioskDeviceToken() } };
//   }});
// admin.js's env (VERIFIED at js/admin.js:11049-11052 — credentials:'include', no header):
//   KioskCore.init({ mwUrl: kioskMwUrl(), buildAuthOptions: function () {
//     return { credentials: 'include' };
//   }});
```
**Why this shape:** it is the *only* real environment difference found across every one of the ~37 shared functions' fetch calls (see Environment Injection Seam below) — `mwUrl` itself is already computed identically by a byte-identical `kioskMwUrl()` in both files (reads `SHEETS_CONFIG.MIDDLEWARE_URL`), so it does not need injecting from outside `kiosk-core.js` at all; only the *auth mechanism* differs.

### Pattern 2: Dual-mode module export (browser global + CommonJS) — already established, must be copied exactly
**What:** Every existing frontend module in this repo ends with the same guard, which `kiosk-core.js` must replicate so existing tests keep working without modification.
**Example:**
```javascript
// Source: js/kiosk.js:5501-5533 (existing pattern to replicate in kiosk-core.js)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Object.assign(module.exports || {}, {
    kioskFetchRecipeQuote: kioskFetchRecipeQuote,
    _kioskSetSelectedRecipe: function (r) { _kioskSelectedRecipe = r; }
    // ... etc
  });
}
```

### Anti-Patterns to Avoid
- **Silently picking "whichever file is alphabetically/numerically first" as canonical per function:** the two copies are NOT interchangeable — `kiosk.js`'s copy is demonstrably the more-recently-fixed one for at least 2 functions (batch-dup, modified_ingredients forwarding). Do a per-function diff before choosing, don't blanket-assume kiosk.js wins everywhere (e.g., admin.js's `kioskCalcTotals` computing tax via the shared `kioskItemTax()` helper is arguably *cleaner* than kiosk.js's inlined duplicate math — though kiosk.js's version is required because it needs the discount-adjusted taxable amount).
- **Treating `mwUrl` as the environment seam:** it is not — `kioskMwUrl()` is byte-identical in both files. The real (and only) seam is the **auth mechanism** (`x-device-token` header vs `credentials:'include'` cookie). Don't over-build the `init(env)` signature around `mwUrl` variance that doesn't exist.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Discount type/scope classification | A third copy of `classifyDiscountItem`/`discountMatches` inside `kiosk-core.js` | Keep calling the existing `js/lib/discount-match.js` global functions (`classifyDiscountItem`, `discountMatches`) exactly as `kiosk.js:1018-1019` already does, guarded by `typeof discountMatches === 'function'` | It's already a separate shared lib with its own dedicated test (`tests/frontend/discount-match.test.js`) mirroring `zoho-middleware/lib/discount-match.js` server-side — don't duplicate its logic into kiosk-core.js, just add its `<script>` tag to `admin.html` (currently missing) |
| Server-side batch creation for kit sales | Any client-side `create_batch` call from kiosk-core.js | Nothing — `pos.js:1219`/`1934` already fire-and-forget calls `brewpadIntegration.createBatchesFromSale` server-side on every `/api/kiosk/sale` and `/api/kiosk/salesorder-pay` | `admin.js`'s existing client-side loop (lines ~11178-11213) duplicates this and produces a second, unlinked batch record per kit item — this is dead code to delete, not logic to preserve |

**Key insight:** almost everything this phase needs already exists in exactly one of the two files — the job is elimination and careful selection, not new construction.

## Common Pitfalls

### Pitfall 1: The two "identical-named" functions are not identical — a line-count diff is not enough
**What goes wrong:** Assuming that because both files define `function kioskProceedToPayment()` (or `kioskCalcTotals`, `kioskShowReceipt`, etc.) the bodies are drop-in-swappable.
**Why it happens:** `kioskProceedToPayment` in `kiosk.js` is **1,101 lines** (js/kiosk.js:3160-4260) including the imported-SO checkout fork and the full GC-panel + terminal + confirm closures (`_kioskPushToTerminal`); the admin.js version is **523 lines** (js/admin.js:10921-11443) with a differently-named internal closure (`_adminDoSale` instead of `_kioskPushToTerminal`), no SO-import fork, a different `idempotency_key` construction (`refNumber + '-' + Math.random().toString(36).slice(2,9)` vs kiosk.js's plain `refNumber`), and a client-side kit-batch-creation block that duplicates server work. `[VERIFIED: codebase — diff /tmp/admin_proceedToPayment.js /tmp/kiosk_proceedToPayment.js]`
**How to avoid:** Diff every one of the ~37 shared function bodies (not just names) before writing the unified version; treat kiosk.js as canonical per D-02 but verify nothing admin-only-and-load-bearing (e.g. the kit-batch client call, until the bug is confirmed and removed) gets silently dropped without an explicit decision.
**Warning signs:** Any shared function where one file's version references a helper/global the other file also defines with a different name for the "same" concept (`_kioskPushToTerminal` vs `_adminDoSale`; `kioskGetItemType()` vs inline `.product_type.toLowerCase()==='kit'` checks).

### Pitfall 2: admin.js has a live duplicate-batch bug that kiosk.js already fixed in itself
**What goes wrong:** Every kit-item kiosk sale made through the admin-embedded kiosk tab creates **two** BrewPad batch records for the same sale — one from the server's automatic `createBatchesFromSale` (fire-and-forget on every `/api/kiosk/sale` confirm, `pos.js:1219`) and one from admin.js's own client-side loop (`js/admin.js` ~11178-11213, `adminApiPost('create_batch', ...)` per kit line item), because the client-side payload has no `zoho_so_number`, so Apps Script's `duplicate_so_number` dedup guard never catches it.
**Why it happens:** kiosk.js already discovered and removed this exact pattern from itself — the removal is explicitly documented in a comment at `js/kiosk.js:3748-3759` ("NOTE (D-46-01): ... investigation found the middleware already auto-creates one batch per kit line item ... this client-side call had no zoho_so_number in its payload ... a second, unlinked batch was created"). admin.js was never revisited when kiosk.js fixed this.
**How to avoid:** When unifying `kioskProceedToPayment`/the sale-confirm handler into kiosk-core.js, delete admin.js's client-side `create_batch` loop along with the rest of the duplicated logic — this is a natural, in-scope fix of "the accidental fork," not new behaviour, but it IS a real behaviour change for admin.js users (fewer duplicate batches after this ships) and should be called out explicitly to the plan/verification stage as a fix, not silently swallowed into "no behaviour changed."
**Warning signs:** BrewPad showing two pending batches per kit sold via the admin kiosk tab today — worth a quick manual spot-check before/after to confirm the fix lands.

### Pitfall 3: admin.js's recipe-sale payload silently omits `modified_ingredients` — a price-preview-vs-charge mismatch
**What goes wrong:** admin.js's `kioskFetchRecipeQuote` (quote/preview) DOES forward `_kioskModifiedIngredients` (`js/admin.js:11887-11888`, MOD-02), so staff editing ingredient quantities on the admin-embedded kiosk see a correctly modified preview price — but admin.js's `recipeSaleBody` sent to `/api/kiosk/recipe-sale` (`js/admin.js` ~11016-11026) has **no `modified_ingredients` key at all**, so the server prices the actual sale off the *unmodified* base recipe. kiosk.js's equivalent body (`js/kiosk.js:3300-3313`) correctly forwards `modified_ingredients: Array.isArray(_kioskModifiedIngredients) ? _kioskModifiedIngredients : undefined`.
**Why it happens:** Same root cause as Pitfall 2 — two hand-maintained forks, one evolved (kiosk.js, Phase 36 MOD-02 + later hardening) and the other frozen at an earlier state.
**How to avoid:** Unifying the sale-body-builder into kiosk-core.js using kiosk.js's version fixes this automatically. Flag explicitly to the planner/user: this is a genuine price-correctness bug fix beyond the discount (SC#3's explicitly-named single allowed change) — CONTEXT.md's D-04 language ("single allowed behaviour change... keep it minimal") was written before this drift was discovered. Recommend treating both this and Pitfall 2 as **consequences of "the money/cart path can no longer diverge" (SC#1/SC#2)**, not as new scope, but surfacing them explicitly in the plan and to the user before execution so it isn't a surprise at verification. See Open Questions below.
**Warning signs:** A staff member on the admin kiosk tab edits a recipe's ingredient quantities down, sees a lower preview price, but the actual charge/invoice comes out at the full base price.

### Pitfall 4: Requiring `kiosk-core.js` under Jest without a bundler
**What goes wrong:** Existing tests do `var kiosk = require('../../js/kiosk.js');` with no prior `require('./kiosk-core.js')` anywhere in the test file. If `kiosk.js`'s IIFE body calls `KioskCore.someFunction(...)` and nothing has attached `KioskCore` to the test process's `window`/global scope first, every existing kiosk/admin test breaks the moment kiosk.js starts delegating to KioskCore — a direct violation of D-03 ("existing kiosk tests passing unweakened") and CLAUDE.md rule 10 ("do NOT modify existing tests").
**Why it happens:** The browser relies on `<script>` tag load order (kiosk-core.min.js before kiosk.min.js) to make `window.KioskCore` exist by the time kiosk.js's top-level code runs; Node/Jest has no such load-order mechanism unless kiosk.js explicitly requires it.
**How to avoid:** Add a test-only guard at the very top of `kiosk.js` and `admin.js` (mirroring the existing `if (typeof module !== 'undefined' && module.exports)` pattern already used at the bottom of both files) that does `require('./kiosk-core.js')` ONLY under Node — this executes kiosk-core.js's IIFE first (attaching `KioskCore` to the jsdom-provided global `window`, since `jest.config.js` sets `testEnvironment: 'jsdom'`), without needing any test file to change. In the browser, `typeof require === 'undefined'`, so this line is inert there, relying instead on the real `<script src="kiosk-core.min.js">` tag having already run. Verify this pattern works with a throwaway Jest run before committing to it broadly — this is the one piece of this phase that isn't a copy-paste of an existing pattern.
**Warning signs:** Any test failure of the form `Cannot read properties of undefined (reading 'proceedToPayment')` after wiring kiosk.js to call into KioskCore.

### Pitfall 5: Moving dual-cart/SO functions into kiosk-core.js does not give admin.js working SO-import UI
**What goes wrong:** Assuming that because `kioskCollectPayment`/`kioskCreateSalesOrder`/`kioskImportSoToCart`/`kioskAddSoItem`/`kioskRemoveSoItem`/`kioskRenderSoList`/`kioskWireSoChips` (all kiosk.js-only today) move into `KioskCore`, admin's embedded kiosk automatically gains a working "held sales order" tab like the discount does.
**Why it happens:** Unlike the discount (which only needs ~45 lines of static markup ported, since the CSS is already shared via `kiosk.min.css`), the SO-import flow's DOM (`#kiosk-view-browse-customer` equivalents, SO list/chips UI at kiosk.html ~lines 228+) doesn't exist in `admin.html` at all, and this is explicitly **out of ROADMAP Phase 48 scope** — the phase's 5 success criteria only require the shared *logic* to exist in one place and be consumed by both; they do not require admin.html to gain new UI surface for SO-import.
**How to avoid:** Move the SO/dual-cart functions into kiosk-core.js (satisfying SC#1's "exist in exactly one place"), have kiosk.js keep wiring its own SO-browse UI to them, and explicitly do NOT add SO-import UI to admin.html in this phase — confirm this scope boundary with the user/plan-checker since it's easy to over-build by analogy with the discount fix.
**Warning signs:** A plan task that adds new `#kiosk-so-*` markup to admin.html — that's scope creep beyond KIOSK-01's 5 success criteria.

## Code Examples

### The three genuinely-shared environment reads (everything else in the ~37 functions is either byte-identical or a straightforward D-02 unification)
```javascript
// mwUrl — byte-identical in both files, VERIFIED js/kiosk.js:571-574 == js/admin.js:9803-9806
function kioskMwUrl() {
  return (typeof SHEETS_CONFIG !== 'undefined' && SHEETS_CONFIG.MIDDLEWARE_URL)
    ? SHEETS_CONFIG.MIDDLEWARE_URL : '';
}

// auth — THIS differs and must be injected. kiosk.js (28 call sites, VERIFIED via grep):
fetch(mwUrl + '/api/kiosk/sale', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-device-token': kioskDeviceToken() },
  body: JSON.stringify(saleBody)
});

// admin.js (VERIFIED js/admin.js:11049-11052) — zero x-device-token references anywhere in the file:
fetch(saleUrl, {
  method: 'POST',
  credentials: 'include',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(saleBody)
});
```

### Discount markup that must be ported from kiosk.html into admin.html's `#tab-kiosk` panel (SC#3)
```html
<!-- Source: kiosk.html:184-221 (in-cart discount zone + popover) and 426-468 (management modal) -->
<!-- CSS already shared: admin.html:21 loads css/kiosk.min.css?v=... which contains all
     36 .kiosk-discount-* rules (VERIFIED: grep -c "kiosk-discount" css/kiosk.css => 36) -->
<div class="kiosk-discount-zone" id="kiosk-discount-zone">
  <button type="button" class="btn-secondary kiosk-discount-btn" id="kiosk-discount-btn" disabled>Apply Discount</button>
  <!-- ...applied/popover/mgmt-modal markup, verbatim from kiosk.html... -->
</div>
```

## Runtime State Inventory

This is a code-only refactor phase (no rename/rebrand of any externally-visible identifier, API route, env var, or data key), so most categories are N/A. Included per the "refactor" trigger for completeness.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — no database/Sheets/ChromaDB keys reference `kiosk.js`/`admin.js`/function names by string | none |
| Live service config | None — no n8n/Datadog/Cloudflare config references these file/function names | none |
| OS-registered state | None — this is browser-served static JS, no Task Scheduler/pm2/launchd registration | none |
| Secrets/env vars | None — `SHEETS_CONFIG.MIDDLEWARE_URL`, `KIOSK_PIN`, device tokens are all unaffected by this refactor (same globals, same localStorage keys) | none |
| Build artifacts | `js/kiosk.min.js`, `js/admin.min.js` are stale immediately upon any source edit; a NEW artifact `js/kiosk-core.min.js` must be added to `package.json`'s `minify:js` and to both HTML pages' `stamp:*` scripts | `npm run build` after every JS change (already a CLAUDE.md rule); add the new terser + stamp targets described in Build Wiring |

## Build Wiring (resolves the open mechanic — Research Question 4)

**Recommendation: Option (a) — separate `<script src="js/kiosk-core.min.js">` tag, loaded before each consumer.** Concrete changes:

1. **`package.json` `minify:js`** — add a new terser invocation, keeping the existing separate-bundle pattern:
   ```
   ... && terser js/kiosk-core.js -o js/kiosk-core.min.js -c -m && terser js/kiosk.js -o js/kiosk.min.js -c -m && terser js/admin.js -o js/admin.min.js -c -m && ...
   ```
   (Order matters only for readability, not for build correctness — each terser call is independent.)

2. **`admin.html`** — add, immediately before the existing `js/admin.min.js` script tag (line 997):
   ```html
   <script src="js/kiosk-core.min.js?v=INITIAL" defer></script>
   <script src="js/admin.min.js?v=mr53l244" defer></script>
   ```
   Also add `<script src="js/lib/discount-match.js" defer></script>` (admin.html currently does not load it at all — required for the discount subsystem to function per D-04).

3. **`kiosk.html`** — add, immediately before the existing `js/kiosk.min.js` script tag (line 24):
   ```html
   <script src="js/kiosk-core.min.js?v=INITIAL"></script>
   <script src="js/kiosk.min.js?v=mr53l270"></script>
   ```
   (kiosk.html already loads `js/lib/discount-match.js` at line 18 — no change needed there.)

4. **`package.json` `stamp:admin`** and **`stamp:kiosk`** — both use a regex-replace-on-`Date.now().toString(36)` pattern (see `package.json:13-14`). Add one more `.replace(...)` clause each for `kiosk-core\.min\.js\?v=[^"]+` matching the existing style, so the cache-bust version updates on every build alongside the consumer bundle.

5. **Defer vs no-defer:** `admin.html` uses `defer` on all its script tags (they execute in document order regardless); `kiosk.html` does not use `defer` at all (scripts execute synchronously in document order as parsed). Both patterns preserve load order as long as `kiosk-core.min.js`'s tag is placed textually before its consumer's tag — no `async` should ever be used here.

**Load-order requirement:** `kiosk-core.min.js` MUST execute before `kiosk.min.js`/`admin.min.js` so `window.KioskCore` exists when the consumer's top-level `KioskCore.init(...)` call runs at `DOMContentLoaded`. Both recommended placements satisfy this via document order.

## Discount-Parity Fix — What It Concretely Requires (Research Question 5)

Confirmed via `grep`: **zero** discount-related DOM IDs exist in `admin.html` (`grep -c "kiosk-discount" admin.html` → 0) and **zero** discount-related functions exist in `admin.js` today (all 12 — `kioskApplyDiscount`, `kioskCalcDiscountAmount`, `kioskCollectAppliesTo`, `kioskDiscountScopeLabel`, `kioskLoadDiscountPresets`, `kioskPopulateDiscountForm`, `kioskRefreshAfterDiscountChange`, `kioskRemoveDiscount`, `kioskRenderDiscountMgmtList`, `kioskShowDiscountMgmt`, `kioskShowDiscountPopover`, `kioskUpdateDiscountDisplay` — are kiosk.js-exclusive). This is NOT self-contained: giving admin the discount "for free" requires three things, not one:
1. Move the 12 discount functions + the discount-aware branch of `kioskCalcTotals` into `kiosk-core.js` (logic).
2. Port ~45 lines of static HTML from `kiosk.html:184-221` + `426-468` into `admin.html`'s `#tab-kiosk` panel (structure) — CSS is already shared (`kiosk.min.css` loaded by both pages), so no new stylesheet work.
3. Add `<script src="js/lib/discount-match.js">` to `admin.html` (dependency) — currently absent, so `typeof discountMatches === 'function'` would silently no-op the type-scoped discount matching on admin even after the JS logic and markup are both in place.

## Parity Test Strategy (Research Question 6)

**Existing test structure:** `tests/frontend/kiosk-*.test.js` (6 files: `kiosk-attract-reset`, `kiosk-device-token`, `kiosk-recipe-live-price`, `kiosk-recipe-modify`, `kiosk-recipe-quote`, `kiosk-recipe-volume-factor`) and `tests/frontend/admin-*.test.js` (7 relevant files incl. `admin-recipe-modify`, `admin-recipe-volume-factor`, `admin-gift-card-mgmt`). Total 53 files under `tests/frontend/`. Pattern (VERIFIED `kiosk-device-token.test.js`): each file stubs `global.window`, `global.fetch = jest.fn(...)`, `global.SHEETS_CONFIG`, `global.setTimeout`/`setInterval` (synchronous-fire mocks so debounce/poll logic collapses in tests), then `require('../../js/kiosk.js')` directly (no jsdom `<script>` tag loading — raw CommonJS require of the ES5 source). Assertions read `global.fetch.mock.calls[N][0]` (URL) and `[N][1]` (options/body) directly — this is exactly the mechanism the new parity test should reuse.

**Critical nuance found in the payload itself:** the sale payloads are NOT deterministic — `refNumber = 'KIOSK-' + Date.now()` (kiosk.js) and `idempotencyKey = refNumber + '-' + Math.random().toString(36).slice(2, 9)` (admin.js, VERIFIED js/admin.js:11000) both embed non-deterministic values. **A parity test cannot do a raw `JSON.stringify(bodyA) === JSON.stringify(bodyB)` comparison** — it must either (a) mock `Date.now` and `Math.random` to fixed values in both requires so the generated keys match, or (b) strip/normalize `reference_number`/`idempotency_key` fields before comparing and assert everything else field-by-field. Recommend (b) — simpler, and also naturally documents that the idempotency-key *generation strategy itself* should be unified as part of this phase (kiosk.js's plain `refNumber` reuse is simpler and is the version that should become canonical, since admin.js's extra `Math.random()` suffix adds no protection — the whole key already changes on every new sale attempt via `Date.now()`).

**Recommended parity test shape:**
```javascript
// New file: tests/frontend/kiosk-core-parity.test.js
// 1. require kiosk-core.js twice is unnecessary — require it once, then require
//    kiosk.js and admin.js, each of which internally requires kiosk-core.js
//    (see Pitfall 4). Build an identical cart via each surface's own
//    _kioskSetCart/_kioskGetCart test hooks (already exported — see
//    js/kiosk.js:5511 _kioskGetCart / _kioskSetSelectedRecipe patterns).
// 2. Call KioskCore.proceedToPayment() (or whatever the unified name is)
//    through each consumer's own init(env).
// 3. Assert global.fetch was called with the same URL (mwUrl + '/api/kiosk/sale')
//    and the same body EXCLUDING reference_number/idempotency_key, and that
//    auth is injected correctly per-surface (x-device-token vs credentials:'include').
```

**SC#5 (iPad Safari manual checkpoint):** confirmed not automatable — `[Phase ?]: No separate staging middleware — middleware changes deploy to the prod Railway instance; staging site calls prod middleware` (STATE.md decision log). This must remain a `checkpoint:human-verify` task in the plan, not something the parity test substitutes for.

## Environment Injection Seam — Full Enumeration (Research Question 2)

| What differs | kiosk.js (standalone) | admin.js (embedded) | Injection mechanism |
|---|---|---|---|
| Middleware URL | `kioskMwUrl()` reads `SHEETS_CONFIG.MIDDLEWARE_URL` | Identical, byte-for-byte | **Not actually an env difference** — both can call the same `kioskMwUrl()` helper (keep it outside KioskCore, in each consumer, or duplicate the 3-line function in both — trivial either way, not worth injecting) |
| Auth mechanism | `x-device-token` header via `kioskDeviceToken()` (localStorage `sv_kiosk_device_token`) on every fetch (28 call sites) | `credentials: 'include'` (Google OAuth session cookie), zero `x-device-token` references in the entire file | **Must be injected** — `KioskCore.init({ buildAuthOptions: fn })` per Pattern 1 above |
| DOM mount root | `document.body` (top-level `#kiosk-app`, `#kiosk-view-*` elements) | Same element IDs, nested under `#tab-kiosk` inside `admin.html`'s tab system | No injection needed — `document.getElementById(...)` calls work identically since IDs are not renamed inside the tab wrapper (VERIFIED: `#kiosk-product-grid`, `#kiosk-view-browse` etc. exist with identical IDs in both HTML files) |
| Discount UI DOM | Present (`kiosk-discount-*`, ~30 elements) | Absent (0 elements) — must be added per SC#3 | Not an injection — a one-time HTML port (see above) |
| `js/lib/discount-match.js` availability | Loaded (`kiosk.html:18`) | Not loaded | Add `<script>` tag to `admin.html` (see Build Wiring) |
| SO-import UI DOM | Present (kiosk.js-only feature) | Absent | Out of scope this phase — logic moves to KioskCore, UI stays kiosk.js-only (Pitfall 5) |
| Batch-creation on sale | None client-side (removed per D-46-01, server-authoritative) | Client-side duplicate loop still present | Delete in admin.js as part of unification (Pitfall 2) |
| `modified_ingredients` in recipe-sale body | Forwarded | Silently omitted | Unify via kiosk.js's version (Pitfall 3) |
| Idempotency key construction | `refNumber` (`'KIOSK-' + Date.now()`) | `refNumber + '-' + Math.random().toString(36).slice(2,9)` | Unify on kiosk.js's simpler form (no protective benefit to the extra random suffix — see Parity Test Strategy) |

## Shared-Function Dependency Graph (Research Question 3)

**Top-level shared functions (37, byte-name-identical in both files, confirmed via `comm -12` on sorted `function kiosk*` declarations):**
`kioskAddRecipeToCart, kioskAddToCart, kioskCalcTotals, kioskCartHasKits, kioskCartIsEmpty, kioskCheckRecipeAvailability, kioskCheckTerminal, kioskClearCart, kioskFetchRecipeQuote, kioskFmt, kioskItemTax, kioskLoadProducts, kioskLoadRecipes, kioskMwUrl, kioskPopulateCategories, kioskProceedToPayment, kioskRecipePrice, kioskRecipePriceForContext, kioskRenderAvailBanner, kioskRenderCart, kioskRenderProducts, kioskRenderRecipeIngredients, kioskRenderRecipes, kioskScheduleRecipeQuote, kioskSelectCustomer, kioskSelectSaleType, kioskSetMode, kioskSetQty, kioskSetTerminalStatus, kioskShowCustomerStep, kioskShowError, kioskShowReceipt, kioskShowRecipePrompt, kioskShowView, kioskStartCheckout, kioskUpdateAddToCartButton, kioskUpdateSummaryPrice`

Note: this is 37, not the ROADMAP's approximate "~34" — close enough that the estimate was directionally right; the exact count doesn't change the extraction strategy.

**kiosk.js-only (58 functions)** — includes the entire discount subsystem (12, promote per D-04), the entire dual-cart/SO subsystem (`kioskAddSoItem, kioskClearImportedSo, kioskCollectPayment, kioskCreateSalesOrder, kioskImportSoToCart, kioskRemoveSoItem, kioskRenderSoChips, kioskRenderSoCustomerInfo, kioskRenderSoItems, kioskRenderSoList, kioskReorderSo, kioskShowCreateSo, kioskShowSoError, kioskWireSoChips, kioskLoadSalesOrders` — 15, keep kiosk.js-only per Pitfall 5), the customer-browse/product-catalog-browse subsystem (`kioskCbIsBeer, kioskCbIsWine, kioskCbRenderBeerCard, kioskCbRenderCard, kioskCbRenderWineCard, kioskExitCustomerBrowse, kioskRenderCbGrid, kioskShowCustomerBrowse, kioskUpdateCbCartBar` — 9, kiosk.js-only UI, not part of KIOSK-01 scope), custom-item/gift-card-issue modals (kiosk.js-flavored, `kioskShowCustomItemModal, kioskSubmitCustomItem, kioskShowGiftCardIssueModal, kioskSubmitGiftCardIssue` — these pair with admin's own `kioskShowAdminCustomItemModal, kioskSubmitAdminCustomItem, kioskShowAdminGiftCardIssueModal, kioskSubmitAdminGiftCardIssue` as **intentionally parallel, differently-named admin-flavored equivalents** — do NOT unify these, they're deliberately separate per prior Phase 44 decisions, D-46 device-token gating differences), and small helpers (`kioskGetItemType, kioskIsConsignment, kioskItemCategory, kioskFindProductById, kioskFindMakersFee, kioskFindMaterialsFee, kioskIsKitFee, kioskCountKitsInCart, kioskSyncKitFees, kioskCheckStockOverflow, kioskIsWeightItem, kioskEffectiveRate, kioskGetFilteredProducts, kioskRenderProductGrid, kioskRenderProductList, kioskDeviceToken, kioskHideIngredientAutocomplete, kioskShowIngredientAutocomplete, kioskLoadIngredientCatalog, kioskR2` — mostly product-classification helpers used by `kioskCalcTotals`'s discount branch and `kioskGetFilteredProducts`; since the discount branch moves to KioskCore, `kioskGetItemType`/`kioskIsConsignment`/`kioskItemCategory`/`kioskR2` must move with it — they're in the transitive closure of the promoted discount code even though they weren't in the "duplicated" list).

**admin.js-only (8 functions):** `kioskOpenModifyPanel, kioskSaveAsNewRecipe, kioskSaveRecipeQuickEdit, kioskShowAdminCustomItemModal, kioskShowAdminGiftCardIssueModal, kioskShowAdminGiftCardMgmtModal, kioskSubmitAdminCustomItem, kioskSubmitAdminGiftCardIssue` — admin-exclusive UI (recipe quick-edit/save-as-new gated off standalone kiosk per existing UI-SPEC §2 decision, and admin-flavored gift-card/custom-item modals). Leave in admin.js.

**Non-function-declaration closures that must also move (not caught by a `function kiosk*` grep, but load-bearing):** `_kioskPushToTerminal` (kiosk.js, nested inside `kioskProceedToPayment`) and its admin-side counterpart `_adminDoSale` (admin.js, same nesting) — these are the GC-panel-to-terminal-push orchestration and must be unified as part of `kioskProceedToPayment`'s extraction, not treated as separate shared functions since they aren't top-level declarations.

**Module-scope state that must move together with the logic (the "globals the other code also touches" boundary):** `_kioskCart`, `_kioskDiscount`, `_kioskGiftCard`, `_kioskCustomer`, `_kioskRecipeContext`, `_kioskSelectedRecipe`, `_kioskSaleType`, `_kioskTargetVolumeL`, `_kioskModifiedIngredients`, `_kioskMillGrain`, `_kioskQuote`, `_kioskSaleData`, `_kioskMode`. These are declared independently in both files today (same names, same shapes in most cases) — moving the functions into kiosk-core.js means these `var`s move too, becoming KioskCore's private closure state, exposed only through accessor functions (mirroring the existing `_kioskGetCart`/`_kioskSetSelectedRecipe` test-export pattern already used for Jest access). Both kiosk.js and admin.js currently read/write these directly by closure; after the move, both must go through KioskCore accessors instead. **`_kioskCustomCounter`/`_kioskGiftCertCounter`, `_kioskSoItems`/`_kioskSoCustomer` etc. stay in whichever file owns their exclusive UI** (custom-item modal, SO UI) since those subsystems aren't moving.

## State of the Art

Not applicable in the conventional sense (no external framework/library version currency to check) — the relevant "state of the art" is internal: kiosk.js is the more current/hardened fork (Phase 44-46 fixes applied), admin.js is the stale one for at least the 3 items in the Common Pitfalls section.

| Old Approach (admin.js) | Current Approach (kiosk.js) | When Changed | Impact |
|--------------------------|-------------------------------|---------------|--------|
| Client-side `create_batch` POST per kit item after sale | Server-side fire-and-forget `createBatchesFromSale` only, no client call | Phase 46 (D-46-01), documented at js/kiosk.js:3748-3759 | admin.js still double-creates batches; fix falls out of this de-fork |
| `x-device-token`-less, cookie-only auth via `credentials:'include'` | (kiosk.js moved to) explicit `x-device-token` header, no cookie reliance | Phase 46 (D-46-01/02) | This is a deliberate, ongoing environment difference (admin retains Google-OAuth-cookie auth; kiosk retains device-token) — NOT something to unify, this is the one legitimate env-injection seam, not drift |

**Deprecated/outdated:** admin.js's client-side kit-batch-creation loop (superseded by server-side auto-creation, Phase 46) — should be deleted as part of this phase's unification, not preserved.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Fixing the two admin.js-only bugs found (duplicate batch creation, missing `modified_ingredients` forwarding) is in-scope for this phase as a natural consequence of unification, even though CONTEXT.md names only the discount as "the single allowed behaviour change" | Common Pitfalls 2 & 3 | If the user intended a strictly mechanical extraction with truly zero incidental behaviour change beyond the discount, these two fixes need explicit sign-off before the plan bakes them in — recommend surfacing as an Open Question at plan/discuss time rather than silently fixing |
| A2 | The `require('./kiosk-core.js')` Node-only guard (Pitfall 4) is the right mechanism to make existing Jest tests keep passing without modification, versus some other test-harness change | Pitfall 4 / Architecture Patterns | If this guard interacts badly with jsdom's `window` global assignment timing, tests could fail in a way that looks like a regression; recommend a small spike/smoke test of this exact mechanism as the very first task of the first plan wave, before building the rest of the extraction on top of it |

**A1 and A2 are the two claims most worth a quick explicit confirmation before planning proceeds** — everything else in this document is directly observed code, not inference.

## Open Questions

1. **Should this phase also fix the duplicate-batch-creation bug and the missing-`modified_ingredients`-forwarding bug in admin.js, or strictly limit itself to mechanical extraction + the named discount fix?**
   - What we know: both are real, verified bugs in admin.js's current code; both are naturally fixed by using kiosk.js's version as canonical during unification (which D-02 mandates); both are money/cart-path correctness issues squarely inside KIOSK-01's stated concern ("cart and payment/checkout paths can no longer diverge").
   - What's unclear: whether the user wants these called out and confirmed before the plan bakes them in, given CONTEXT.md explicitly scoped "the single allowed behaviour change" to the discount.
   - Recommendation: surface both explicitly to the user/plan-checker as "found during research, recommend fixing as part of unification since D-02 already mandates resolving all such divergence" — likely a quick confirm rather than a blocker, but shouldn't be silently absorbed.

2. **Exact final `KioskCore` function-naming convention** (drop the `kiosk` prefix inside the namespace, e.g. `KioskCore.proceedToPayment` vs keep `KioskCore.kioskProceedToPayment`)?
   - What we know: D-01/CONTEXT's "Specific Ideas" section shows `KioskCore.proceedToPayment(...)` as an example, implying the prefix is dropped.
   - What's unclear: whether dropping the prefix on all ~37+12 promoted functions is worth the mechanical rename risk (every call site in both consumers needs updating either way, so cost is similar) versus keeping `kiosk`-prefixed names for a smaller diff.
   - Recommendation: drop the `kiosk` prefix for functions exposed on `KioskCore` (cleaner, matches D-01's own example) since call sites already need updating from `kioskProceedToPayment()` to `KioskCore.something()` regardless — the prefix is redundant on a namespace already called `KioskCore`.

## Environment Availability

Skipped — this phase has no new external tool/service/runtime dependency. `terser`, `jest`, `eslint` are already installed devDependencies confirmed present in `package.json`; no new probe needed.

## Validation Architecture

Skipped — `.planning/config.json` has `workflow.nyquist_validation: false` (explicit).

## Security Domain

`security_enforcement: true` (ASVS level 1, block on high) per `.planning/config.json`, so this section is required even though this phase's own scope is a refactor, not new security surface.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-------------------|
| V2 Authentication | Indirectly — this phase must preserve, not weaken, the two existing auth mechanisms (kiosk device-token header, admin Google-OAuth session cookie) when injecting them into `KioskCore.init()` | Preserve exactly as documented in Environment Injection Seam; no new auth code, only relocation of where the header/cookie option gets attached to `fetch()` |
| V4 Access Control | No change — `pos.js` route-level auth guards are untouched by this phase | N/A this phase |
| V5 Input Validation | No change — client-side validation (e.g. cart quantity, discount value bounds) is being relocated, not altered; server-side re-validation in `pos.js` is untouched | N/A this phase |
| V6 Cryptography | No change | N/A |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|----------------------|
| Regression reintroducing the leaked-key-era auth pattern (e.g. accidentally sending both `x-device-token` AND a stale `x-api-key` header from a copy-paste mistake during the merge) | Spoofing | The existing `kiosk-device-token.test.js` T2/T3 tests already assert `opts.headers['x-api-key']).toBeUndefined()` — keep these tests green unmodified; this is the regression guard already in place, not something new to build |
| Idempotency-key weakening during unification (accidentally picking a *less* collision-resistant key generation than either original) | Tampering / Repudiation (duplicate charges) | Use kiosk.js's simpler `refNumber` (`'KIOSK-' + Date.now()`) as the unified idempotency key per the Parity Test Strategy finding — do not invent a third scheme |

## Sources

### Primary (HIGH confidence — direct codebase inspection, this session)
- `js/kiosk.js` (5,535 lines) — full symbol inventory, `kioskProceedToPayment` (3160-4260), discount subsystem (868-1084, 4787-4980+), device-token auth (1-21), test-export block (5501-5533)
- `js/admin.js` (12,787 lines) — full symbol inventory, `kioskProceedToPayment` (10921-11443), `kioskCalcTotals` (9834-9849, no discount), `_adminDoSale` closure, kit-batch client loop (~11178-11213)
- `js/lib/discount-match.js` (94 lines) — `classifyDiscountItem`/`discountMatches`, confirmed loaded only by `kiosk.html`
- `kiosk.html` / `admin.html` — full `<script>` load-order diff, discount markup line ranges (kiosk.html:184-221, 426-468), confirmed 0 discount markup in admin.html
- `package.json` — `minify:js`/`stamp:admin`/`stamp:kiosk` scripts, confirmed separate terser bundles
- `zoho-middleware/routes/pos.js` — confirmed `/api/kiosk/sale`, `/recipe-sale`, `/sale/confirm`, `/recipe-sale/confirm`, `/salesorder-create`, `/salesorder-update`, `/salesorder-pay` route list; `createBatchesFromSale` call sites (1219, 1934)
- `zoho-middleware/lib/money-path.js` (254 lines) — `markTxnUsed`, `rejectWithVoid`, `voidWithTimeout` exports, confirmed untouched by this phase
- `tests/frontend/kiosk-device-token.test.js`, `tests/frontend/discount-match.test.js` — existing test patterns (global stubs, `require()` pattern, fetch-mock assertion style)
- `.planning/ROADMAP.md` §"Phase 48" — 5 success criteria (authoritative acceptance)
- `.planning/config.json` — `nyquist_validation: false`, `security_enforcement: true`

### Secondary (MEDIUM confidence)
- `.planning/codebase/STRUCTURE.md`/`ARCHITECTURE.md` line-count references for `kiosk.js`/`admin.js` are stale (report 3,154/8,856 lines vs actual 5,535/12,787 — a known backlog item, BL-MAP) — this research used direct `wc -l` instead, not the stale docs.

### Tertiary (LOW confidence)
- None — no WebSearch/external-web sources were needed for this phase; it is entirely internal-codebase research.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new libraries, verified existing build tooling directly
- Architecture / drift map: HIGH — every claim backed by grep/diff/line numbers from this session, not inference
- Pitfalls: HIGH — the 3 most important pitfalls (duplicate batch, missing modified_ingredients, non-deterministic idempotency key) are each backed by exact line ranges and, for Pitfall 2, an explicit code comment from the codebase's own author explaining the prior fix

**Research date:** 2026-07-03
**Valid until:** No external dependency to go stale — valid until the next commit touches `js/kiosk.js` or `js/admin.js` (re-diff before planning if either file changes before this phase executes)
