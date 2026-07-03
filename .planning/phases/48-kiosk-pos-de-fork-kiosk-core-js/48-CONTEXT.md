# Phase 48: Kiosk POS De-Fork (kiosk-core.js) - Context

**Gathered:** 2026-07-03
**Status:** Ready for planning

<domain>
## Phase Boundary

Extract the ~34 duplicated `kiosk*` functions (cart building, `kioskProceedToPayment`, terminal charge, Zoho invoice/payment, void-on-failure, dual-cart shared-charge handling) out of `js/kiosk.js` (standalone, ~5,535 lines, ~105 `kiosk*` symbols) and `js/admin.js` (embedded kiosk tab, ~12,787 lines, ~46 duplicated `kiosk*` symbols) into a single shared `js/kiosk-core.js` that both files consume. Behaviour-preserving refactor — NOT a redesign. The one allowed behaviour change is bringing the product-type discount (currently only in `kiosk.js`) to the admin-embedded kiosk too (SC#3).

This is the structural prerequisite for MONEY-02 (Phase 50) and MONEY-03 (Phase 51): once the payment path exists in exactly one place, the kiosk can adopt the synchronous void-on-failure primitives from `zoho-middleware/lib/money-path.js` without maintaining two copies.

**In scope:** de-dupe the shared kiosk POS/cart/payment/void logic into `kiosk-core.js`; wire both consumers to it; discount-parity fix; parity tests; build regeneration.
**Out of scope:** changing money-path behaviour, adopting middleware money-path primitives (that's Phase 50), introducing `window.SV` (future phase), any UI redesign of the kiosk.
</domain>

<decisions>
## Implementation Decisions

### Module boundary / exposure (Claude's discretion — user deferred: "whatever you think is best")
- **D-01:** `js/kiosk-core.js` is an ES5 IIFE that attaches a **single `window.KioskCore` namespace object** exposing the shared functions; `kiosk.js` and `admin.js` call into it (e.g. `KioskCore.proceedToPayment(...)`). Rationale: (1) gives an explicit seam the payload-parity test (D-03) can assert against, which bare globals would not; (2) avoids scope creep — introducing the `window.SV` namespace now would exceed the "behaviour-preserving de-fork, not a redesign" constraint, and `KioskCore` can later be rehomed under `window.SV.kiosk` without rework; (3) fits the existing ES5/no-bundler build with no new tooling. Bare-globals and window.SV options were both rejected for these reasons.

### Standalone vs admin-embedded
- **D-02:** `kiosk-core.js` is **context-agnostic — truly identical behaviour** on both surfaces. The two consumers inject only *environment* at init (middleware URL / `kioskMwUrl`, mode, DOM mount roots), never behaviour. All cart, payment, checkout, void, and dual-cart logic is identical by construction — this is the direct enforcement of the goal that the two paths "can no longer diverge." Any place where `kiosk.js` and `admin.js` currently diverge in the money/cart path is treated as an accidental fork to be unified, not a difference to preserve.

### Parity verification
- **D-03:** Beyond the existing kiosk tests passing unchanged (no weakening), add an **automated payload-parity test** asserting the standalone and admin-embedded surfaces produce **identical fetch request payloads / call flow for the same cart** (SC#2), PLUS the **SC#5 manual iPad Safari checkpoint** (a full kiosk sale incl. a product-type discount from both the standalone kiosk URL and the admin-embedded kiosk tab, terminal/void/dual-cart intact). The manual iPad step is a human-verification gate, not automatable here (no staging middleware — staging calls prod middleware).

### Product-type discount parity
- **D-04:** The product-type discount becomes **purely identical on both surfaces** — it simply moves into `kiosk-core.js` so the admin-embedded kiosk gets it for free. No admin-specific override or staff affordance. This is the single allowed behaviour change; keep it minimal.

### Drift-bug fixes surfaced by research (added 2026-07-03 after RESEARCH.md)
- **D-05:** Research found `admin.js`'s money/cart copies have **drifted** from `kiosk.js`, including two real bugs that unifying-to-`kiosk.js`-as-canonical fixes for free. **User decision: fix both as part of unification** (not deferred). D-04's "single allowed behaviour change" is widened to include these, because preserving admin's buggy behaviour would require reintroducing admin-specific divergence into the shared core — which directly contradicts D-02. The two fixes:
  1. **Duplicate batch creation** — delete `admin.js`'s client-side `create_batch` loop (`js/admin.js` ~11178-11213); the server auto-creates the batch (`pos.js:1219`). `kiosk.js` already removed this from itself (documented at `js/kiosk.js:3748-3759`).
  2. **Missing `modified_ingredients`** — `admin.js`'s recipe-sale charge body (`~11016-11026`) omits `modified_ingredients`; unify on `kiosk.js`'s version (`js/kiosk.js:3300-3313`) which forwards it, so the charged price matches the staff-edited preview.
  - Both fixes MUST be called out explicitly in the plan and checked at verification (no duplicate batch; `modified_ingredients` present in admin charge payload) — they are intentional, not silent.
  - **Idempotency-key unification:** also unify on `kiosk.js`'s simpler `refNumber` (`'KIOSK-' + Date.now()`) form; drop `admin.js`'s extra `Math.random()` suffix (no protective benefit). Behaviour-neutral, enables the payload-parity test.
- **D-06 (naming):** functions exposed on `KioskCore` drop the redundant `kiosk` prefix (e.g. `KioskCore.proceedToPayment`, matching D-01's own example), since every call site needs updating regardless. Claude's discretion per CONTEXT — recorded for the planner.

### Reverse-drift fix surfaced by plan-checker (added 2026-07-03 after 1st plan review)
- **D-07:** RESEARCH's blanket premise "`kiosk.js` is always the canonical/hardened copy; `admin.js` is the stale fork" is **backwards for exactly one function: the Manager Override stock-conflict path.** `admin.js` has the COMPLETE, working implementation (`override: _kioskStockOverride` in the recipe-sale body at `js/admin.js:11026`, the `#kiosk-stock-override-btn` click handler at `js/admin.js:11078-11085` that sets `_kioskStockOverride=true` and resubmits, and full 409-conflict rendering). `kiosk.js` has only the DEAD half — `_kioskStockOverride` is declared/reset (js/kiosk.js:539,1454,1482,1514) but never set to true, never wired, never sent; its recipe-sale body (js/kiosk.js:3300-3313) has no `override` key. The server genuinely gates on this (`zoho-middleware/routes/pos-recipe.js:328,610` → 409 when `!stockCheck.ok && !override`). **Decision: for this one function, `admin.js` is the source of truth** — port admin's override field + 409/`conflicts` handling + `#kiosk-stock-override-btn` wiring into `kiosk-core.js`, so BOTH surfaces get the working override (this also FIXES the currently-dead override button on the standalone kiosk). Squarely within D-02 ("unify divergence, never resolve by dropping the more-complete side"); consistent with the user's D-05 approval to fix money/cart-path drift. Verification MUST exercise a stock-insufficient recipe sale on both surfaces (regression test and/or the SC#5 manual checkpoint step), since no existing test covers this path.

### Claude's Discretion
- Exact `KioskCore` API surface (function names, init signature, how environment is injected) — planner/researcher decide, constrained by D-01/D-02.
- Build wiring for `kiosk-core.js` (separate `<script>` before `kiosk.js`/`admin.js` on each page vs prepend-per-bundle at build time) — see Research Hints below.
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### The fork being unified
- `js/kiosk.js` — standalone kiosk; the fuller/canonical copy of the ~105 `kiosk*` symbols (source of truth for the shared logic + the product-type discount).
- `js/admin.js` — admin surface with an embedded kiosk tab; holds ~46 duplicated `kiosk*` symbols that must be replaced by `KioskCore` calls.
- `admin.html` — embeds the kiosk tab (`data-tab="kiosk"`, `#tab-kiosk`); loads `css/kiosk.min.css`. Shows how the admin-embedded kiosk is mounted.
- `kiosk.html` — standalone kiosk host page (script/style wiring reference).

### Money-path (why the de-fork matters; behaviour to preserve, not change here)
- `zoho-middleware/lib/money-path.js` — the shared synchronous void-on-failure primitives the kiosk will adopt in Phase 50. Phase 48 must leave the kiosk money-path *behaviour* unchanged, but structure it so this adoption is possible next.
- `zoho-middleware/routes/pos.js` — kiosk/POS backend the kiosk-core payment path calls.

### Build & structure
- `.planning/codebase/STRUCTURE.md` — module/file layout and how `js/` is organised.
- `.planning/codebase/ARCHITECTURE.md` — build pipeline (concat + minify); note `kiosk.js`→`kiosk.min.js` and `admin.js`→`admin.min.js` are **separate** terser bundles, NOT part of the `main.js` concat.
- `.planning/ROADMAP.md` §"Phase 48" — the 5 success criteria (authoritative acceptance).
- `CLAUDE.md` — ES5-only rule (now lint-enforced by Phase 53), never hand-edit build artifacts, run `npm run build` after JS changes.
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- The ~105 `kiosk*` functions already exist and work in `js/kiosk.js` — this is an extraction/relocation, not a rewrite. `kiosk.js`'s copies (including the discount) are the canonical source to lift into `kiosk-core.js`.
- Existing kiosk test suite is the behaviour-preservation harness (must pass unchanged, no weakening).

### Established Patterns
- ES5 IIFE modules, `'use strict'`, global function/var style; no framework, no bundler. Lint now enforces `ecmaVersion: 5` on `js/` (Phase 53) — `kiosk-core.js` must be ES5-clean.
- Build: `npm run build` concatenates `js/modules/*` → `main.js` → `main.min.js` for the main site, and separately minifies `kiosk.js`→`kiosk.min.js`, `admin.js`→`admin.min.js`. Cache-bust `?v=` stamps in HTML are regenerated by the build.

### Integration Points
- `admin.html` mounts the embedded kiosk under `#tab-kiosk`; `kiosk.html` hosts the standalone kiosk. Both must load `kiosk-core.js` before their respective consumer script.
- `kioskMwUrl` / `kioskMode` globals indicate the environment differences that D-02 says must be *injected*, not branched-on inside core.

### Research Hints (for gsd-phase-researcher)
- **Build wiring is the key open mechanic:** `kiosk.js` and `admin.js` are separate bundles, so `kiosk-core.js` must be made available to both — either its own `<script src="js/kiosk-core.min.js">` before each consumer on `kiosk.html`/`admin.html`, or prepended into each bundle at build time. Research the cleanest option and whether `package.json` build scripts need a new minify target.
- **Diff the two current copies** of the `kiosk*` symbols in `kiosk.js` vs `admin.js` to enumerate exactly which ~34 functions are shared, where they've drifted, and which drift is the accidental fork to unify (D-02).
</code_context>

<specifics>
## Specific Ideas

- Namespace name: `window.KioskCore` (D-01). Keep it a plain object of functions + an `init(env)`-style entry that receives `{ mwUrl, mode, roots }`.
- Parity test should assert *identical fetch payloads* for the same cart across both surfaces — the concrete SC#2 acceptance.
</specifics>

<deferred>
## Deferred Ideas

- **`window.SV` namespace adoption** — folding `KioskCore` (and eventually cart/checkout modules) under a single `window.SV.*` namespace is a PROJECT.md future direction, but it's a broader refactor than this de-fork. Defer to its own phase; `KioskCore` is designed to rehome under it later without rework.
- **Kiosk adopting `money-path.js` primitives** — the synchronous void-on-failure hardening is Phase 50 (MONEY-02), explicitly enabled by this de-fork but out of scope here.
</deferred>
