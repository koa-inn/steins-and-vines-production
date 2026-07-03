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
