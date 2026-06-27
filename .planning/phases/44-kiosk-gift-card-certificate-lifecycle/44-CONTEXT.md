# Phase 44: Kiosk gift card / certificate lifecycle - Context

**Gathered:** 2026-06-27
**Status:** Ready for planning (research required — see Open Research Questions)

<domain>
## Phase Boundary

Full gift-card / gift-certificate lifecycle at the kiosk POS — **sell, redeem (as tender), balance lookup, partial redemption, reload** — for **paper certificates with manually-assigned numbers**, on both forked kiosk surfaces (`js/kiosk.js` + `js/admin.js`), with correct accounting (liability, not revenue) and tax (none at sale; tax applies to the underlying goods at redemption). This is a NEW capability, NOT an extension of the Phase 43 custom-line item, and must not weaken the v4.2-hardened money path.

**Out of scope (v1):** pre-printed barcoded cards; digital/emailed codes + generation; customer-facing balance lookup; physical card stock management; the Phase 42 kiosk de-fork.
</domain>

<decisions>
## Implementation Decisions

### Redemption UX (locked)
- **D-01:** **Assisted redemption.** Staff enter the certificate number; the system looks up and displays the live balance; staff enter the amount to apply to the current sale; any remainder is charged on the Helcim terminal. Partial redemption supported (applied amount ≤ min(balance, amount due)). Redemption is a **tender/payment path**, NOT a cart line item.

### Certificate numbers (locked)
- **D-02:** **System-suggested number + uniqueness check.** At sale the system proposes the next number (e.g. `GC-NNNNNN`); staff may override; the server **rejects duplicates** (a number already in use). Keeps the paper workflow while preventing collisions/typos.

### Tax & accounting (locked constraints — carried from capture)
- **D-03:** **No tax at sale.** Selling a certificate is zero-tax. Tax applies to the underlying goods/services at **redemption** — redemption just reduces the amount due on an already-taxed sale; it does not add or remove tax.
- **D-04:** A certificate sale is a **liability, not revenue** — it must post to an unredeemed-liability mechanism in Zoho, recognized as revenue only on redemption. Exact mechanism is an open research question (R-01).
- **D-05:** **Server-authoritative balances.** Balance reads/writes go through the middleware; partial redemption must decrement **atomically**; guard against double-spend / replay (reuse the kiosk idempotency/replay patterns from the v4.2 money path).

### Scope (locked — carried)
- **D-06:** Full lifecycle: sell / redeem / balance lookup / partial redemption / reload.
- **D-07:** Paper certificate, **manually-assigned number**; no barcode, digital, or email generation in v1.
- **D-08:** Build on **both** forked surfaces (`kiosk.js` + `admin.js`) until the Phase 42 de-fork — identical logic; modal mechanism differs per surface (kiosk.js inline overlay; admin.js `openModal`/`closeModal`).

### Claude's Discretion
- Cert-number format details (prefix/width), the exact "Add gift card" vs "Redeem gift card" UI affordances on the kiosk (likely mirroring the custom-item modal + a tender option in the payment view), receipt rendering of a sold/redeemed certificate.
- Validation specifics (amount bounds for a sale/reload, sane max balance), error copy.

</decisions>

<open_research_questions>
## Open Research Questions (MUST be resolved by gsd-phase-researcher before/at planning)

- **R-01 — Zoho accounting mechanism.** How should a gift-card sale post as a **liability** and convert to **revenue on redemption** in Zoho Books via the REST API? Investigate: native gift-card support (if any); customer **store credit / customer advance** (`/customerpayments` as advance, retainer invoices); a dedicated **liability account + manual journal**; or a liability **item**. Determine what is actually creatable/redeemable/queryable via the API the middleware already uses, and the correct GST treatment (no tax at sale). Bring a recommendation to lock at planning.
- **R-02 — Balance-of-record location (depends on R-01).** Where the authoritative balance lives: **Zoho** (if store-credit/advance is API-workable — cleanest accounting, ties to a contact), a **Google Sheets `GiftCards` tab** via Apps Script (mirrors the batch system; decoupled from a contact; staff-visible; reconcile to Zoho separately), or **Redis** (fast but poor money-of-record). Pick per R-01 outcome + atomicity/consistency needs. The owner leans on existing Sheets/Apps Script infra but deferred the choice to research.
- **R-03 — Redemption tax mechanics.** Confirm that applying a certificate as a tender on an already-taxed kiosk sale needs no special tax handling (it reduces amount due post-tax), and that the v4.2 terminal/void/idempotency path tolerates a "partial gift-card + remainder on terminal" split tender.
</open_research_questions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Money path & POS (server)
- `zoho-middleware/routes/pos.js` — kiosk sale + confirm + tender; the v4.2-hardened terminal charge → Zoho invoice/payment → void-on-failure → idempotency/replay path the redemption split-tender must integrate with without weakening.
- `zoho-middleware/lib/zoho-api.js` — `zohoGet/zohoPost/zohoPut` used for all Zoho Books REST calls (research R-01 against this surface).
- `zoho-middleware/lib/pricing.js` / `routes/pos-recipe.js` — server-authoritative pricing pattern (no client-trusted money) to mirror for balances.

### Existing analog infra (for R-02 / build)
- Batch Tracking System (Google Sheets + `adminApi.gs` Apps Script, `batch.html`/`js/batch.js`) — the closest analog for a Sheets-backed `GiftCards` tab with CRUD + token auth. See CLAUDE.md "Batch Tracking System" + `docs/APPS_SCRIPT.md`.
- `js/kiosk.js` + `js/admin.js` — forked kiosk surfaces; Phase 43 added the custom-item modal here (closest UI analog for an "issue gift card" modal + a redemption tender affordance in the payment view).

### Decisions / constraints
- `.planning/ROADMAP.md` Phase 44 entry — captured scope + the tax/liability/tender constraints.
- `.planning/PROJECT.md` — v4.2 money-path principles (server-authoritative, fail-closed); constraints (ES5/var, iPad Safari, Apps Script manual redeploy, staging-first).
- `.planning/.continue-here.md` (root) — **blocking** anti-patterns: kiosk fork (touch both files); never `sed` `|` on `.md` tables.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- Phase 43 custom-item modal (kiosk.js + admin.js) — pattern for an "issue gift card" modal (description/amount/number).
- Kiosk payment view + Helcim terminal flow — where a "redeem gift card" tender + remainder-on-terminal split belongs.
- Batch system (Sheets + Apps Script + token-authed CRUD) — direct analog if R-02 chooses a `GiftCards` sheet.
- Kiosk idempotency/replay + void-on-failure (pos.js) — reuse for atomic balance decrement + double-spend guard.

### Established Patterns
- Server-authoritative money (never client-trusted): balances + redemption amounts validated server-side.
- Forked kiosk (#14): duplicate identical logic into kiosk.js + admin.js until Phase 42.
- Apps Script schema changes require **manual redeploy** (not in CI) — flag as a human-action checkpoint in plans if a `GiftCards` sheet/handler is added.

### Integration Points
- New middleware routes (issue / lookup / redeem / reload) integrating with Zoho (R-01) and the balance store (R-02).
- Kiosk UI: issue modal (sale path) + redemption tender (payment path) on both surfaces.

</code_context>

<specifics>
## Specific Ideas
- Likely cert id scheme: `GC-NNNNNN` (mirrors `SV-B-NNNNNN` batch ids).
- Redemption as a split tender: gift card reduces amount due, Helcim terminal charges the rest in the same sale.
- Reload = add value to an existing cert number (same accounting as a sale: liability up, no tax).
</specifics>

<deferred>
## Deferred Ideas
- Pre-printed barcoded cards / scanning; digital + emailed codes with generation; customer-facing balance lookup; card-stock inventory — all post-v1.
- Phase 42 kiosk de-fork (would remove the duplicate-into-both-files burden).

None other — discussion stayed within phase scope.
</deferred>

---

*Phase: 44-kiosk-gift-card-certificate-lifecycle*
*Context gathered: 2026-06-27*
