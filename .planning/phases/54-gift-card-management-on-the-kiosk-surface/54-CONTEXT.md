# Phase 54: Gift-Card Management on the Kiosk Surface - Context

**Gathered:** 2026-07-08
**Status:** Ready for planning

<domain>
## Phase Boundary

Deliver full gift-card **management** — balance **lookup** + **void** — on the staff-only standalone kiosk page (`kiosk.html`), authored kiosk-native. Today this capability exists only in the admin panel (`js/admin.js`, `kgcm-*` modal on admin's `openModal`/`closeModal`); the kiosk page has neither the modal system nor the management UI. The owner runs everything from the kiosk and never uses the admin-embedded kiosk for sales, so management must live where the work happens.

Two parts:
1. **Backend** — allow the kiosk device token to void a certificate (scope change in `zoho-middleware/lib/authTiers.js`).
2. **Frontend** — a kiosk-native lookup+void panel in `js/kiosk-core.js` + entry point in `kiosk.html`, rebuilt bundles, regression test.

**Depends on Phase 48** (kiosk de-fork). Phase 48 is on staging awaiting iPad UAT; **Phase 54 lands before that UAT** so both are verified in one iPad session.
</domain>

<decisions>
## Implementation Decisions

### Auth scope (the security decision)
- **D-54-GC:** Add `/api/kiosk/gift-card/void` to the `KIOSK_ROUTES` device-token allowlist in `lib/authTiers.js`. This **consciously SUPERSEDES D-46-02 / T-46-07** (which kept void session/admin-only). Owner-accepted residual risk: a leaked device token could void a certificate — but void is **status-only** (no cash movement, no Zoho money movement), a **non-empty reason is required**, and it is logged (`kiosk.gift_card_voided`). Device negative-scope coverage for PII/consignment/admin routes stays intact and unchanged.
- **D-54-GC-a:** The existing tests that assert `device→403` on `gift-card/void` (`__tests__/auth-tiers-guard.test.js` test (3), `__tests__/pos-auth-tier.test.js` test (3)) MUST be flipped to expect **not-403**, plus positive coverage added. This is an intended behavior change, not a broken test — planner should treat modifying these two tests as in-scope. The device→403 guarantee on *other* admin-grade routes remains asserted by the PII-GET / BrewPad-GET (`/api/batch/search-invoices`) / admin-GET (`/api/orders/recent`) tests in the same files — do not weaken those.

### Entry-point placement
- **D-54-01:** The "Gift Card Management" entry lives in the **hidden kiosk settings area** (behind the existing device-token / PIN settings gate), NOT on the main POS/sales toolbar. Rationale: management is low-frequency, staff-only, and void is money-destroying — keeping it off the sales screen prevents a mistap during a busy sale from reaching it.

### Void confirmation UX
- **D-54-02:** Keep the admin two-step flow: lookup → result card (cert #, status, face value, current balance) → **Void Certificate** button → **reason field (required)** → **Confirm Void** with a "this cannot be undone" label. No manager-PIN gate (owner declined). No type-the-cert-number-to-confirm friction — the two-step + required reason + irreversible-warning label is sufficient and matches what the server enforces. Mirror the admin flow's states so behavior is consistent across surfaces.

### Shared-code home & admin surface
- **D-54-03:** Author the panel in **`js/kiosk-core.js`** (shared module — where the `kgcr-` redeem UI already lives, 35 refs), using the injected **`buildAuthOptions()`** so it sends `x-device-token` on kiosk and `credentials:'include'` on admin. Wire only the **kiosk** entry button (`kiosk.html`) in this phase.
- **D-54-04:** **Leave admin's existing `kgcm-*` modal (`js/admin.js`) untouched.** Do not repoint admin to the shared panel in this phase (minimal scope; owner doesn't use admin). Because the shared panel is auth-injected, admin can adopt it later for near-free — noted as a follow-up, not this phase's work.

### Management scope
- **D-54-05:** "Management" = **balance lookup + void only.** No issue/reload UI — issue and reload already run through the kiosk cart + Helcim terminal (Phase 44, cart+terminal model). This phase adds no issue/reload surface.

### Modal container (implementation note, Claude's discretion)
- The kiosk page has **no** `openModal`/`closeModal` (0 in `kiosk.js`/`kiosk-core.js`). Mirror the existing **`kgcr-` redeem modal** pattern (kiosk-native class-based overlay) for the new `kgcm-` panel rather than porting admin's `openModal`. Reuse the shared `escapeHTML` / `kioskFmt` helpers already present in `kiosk-core.js`.

### Claude's Discretion
- Exact `kgcm-*` element IDs, overlay markup structure, and how the panel is dismissed — follow the `kgcr-` redeem pattern.
- Whether the regression test lives in a new file or extends an existing kiosk gift-card test — planner/executor choice, but it MUST assert the device-token lookup+void path and the void confirmation gating (reason required).
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Auth scope / backend
- `zoho-middleware/lib/authTiers.js` — `KIOSK_ROUTES` allowlist + `isKioskRoute`; the void scope change goes here. Read the T-46-07/D-46-02 comment block (lines ~20-27) — it must be rewritten to record the D-54-GC reversal.
- `zoho-middleware/routes/gift-cards.js` §`POST /api/kiosk/gift-card/void` (lines ~117-159) — void handler (relies on the global guard; no inline `requireTiers`). Also `GET /api/kiosk/gift-card/lookup` (~85-108, already device-scoped).
- `zoho-middleware/__tests__/auth-tiers-guard.test.js` — test (3) at line 118 (flip); PII-GET negative test (7a) at 157 (keep).
- `zoho-middleware/__tests__/pos-auth-tier.test.js` — test (3) at line 123 (flip); BrewPad (7b) 210 / admin-GET (8a) 223 negatives (keep).

### Frontend
- `js/admin.js` — `kioskShowAdminGiftCardMgmtModal()` (lines ~10096-~10320) is the reference implementation (lookup + void two-step). Do NOT modify; port its *behavior* to kiosk-core.
- `js/kiosk-core.js` — the `kgcr-` redeem modal pattern to mirror; `escapeHTML`/`kioskFmt` helpers; `buildAuthOptions()` injection point (`KioskCore.init`).
- `kiosk.html` — existing kiosk settings/PIN gate area (entry-point host) and class-based modal markup (`kiosk-discount-mgmt-modal` at ~427 is a structural example).

### Decision lineage
- `.planning/phases/46-.../46-CONTEXT.md` + `docs/RUNBOOK.md` §Phase 46 — the auth tiers and the D-46-02/T-46-07 stance being superseded.
- `.planning/ROADMAP.md` §Phase 54 — goal + D-54-GC record.
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `js/kiosk-core.js` `escapeHTML` (87 refs) + `kioskFmt` (49 refs) — reuse for the result card rendering (cert #, status, balance).
- `buildAuthOptions()` injected via `KioskCore.init` — the per-surface auth mechanism (verified Phase 48 truth #3: kiosk sends `x-device-token`, admin sends `credentials:'include'`). The new fetch calls MUST use it, never hard-code `credentials:'include'` (that's the admin-only bug pattern).
- The `kgcr-` redeem modal in kiosk-core (35 refs) — the closest kiosk-native modal analog to mirror.

### Established Patterns
- Backend: routes use `authTiers.requireTiers([...])` inline OR rely on the global guard + `isKioskRoute`. Void relies on the global guard, so the KIOSK_ROUTES membership change alone flips its scope (no route-handler edit needed for auth).
- Gift-card lookup contract (F7, 45-09): response payload nests under `data.data`; balance field is `current_balance`. The kiosk panel must consume the same contract the admin modal does.
- Bundles are built artifacts — after editing `js/kiosk-core.js`/`kiosk.html`, run `npm run build` (regenerates `kiosk-core.min.js` etc.). Never edit `.min.js` directly.

### Integration Points
- `kiosk.html` settings area → new "Gift Card Management" button → opens the kiosk-core `kgcm-` panel.
- Panel `fetch` → `GET /api/kiosk/gift-card/lookup` (already device-allowed) and `POST /api/kiosk/gift-card/void` (device-allowed after D-54-GC).
</code_context>

<specifics>
## Specific Ideas

- Behavior parity with the admin modal's two-step lookup→void flow is the explicit reference ("I want it like the admin one, on the kiosk").
- Void result card shows: cert #, status (color-coded), face value, current balance — same fields as admin's `kgcm-result-info`.
</specifics>

<deferred>
## Deferred Ideas

- **Retire admin's duplicate `kgcm-*` modal** by repointing `admin.html` to the shared kiosk-core panel — folds into Phase 48's already-disclosed admin-duplicate cleanup follow-up. Not this phase.
- **Manager-PIN gate on void** — owner declined for now; a small future hardening if the leaked-token-void risk is reconsidered (see D-54-GC).

### Reviewed Todos (not folded)
- *"Kiosk — auto-clear selected customer after a completed sale"* (`kiosk-customer-autoclear-after-sale.md`) — matched on keywords (kiosk/auth/shared) but is a distinct sales-flow feature, unrelated to gift-card management. Deferred to its own phase.
</deferred>

---

*Phase: 54-gift-card-management-on-the-kiosk-surface*
*Context gathered: 2026-07-08*
