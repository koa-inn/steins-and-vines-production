# Requirements: Steins & Vines — v4.4 Audit Remediation

**Defined:** 2026-06-26
**Core Value:** Customers can discover, select, or co-create fermentation recipes and purchase them as a complete package — with ingredient inventory, pricing, and batch tracking handled automatically by the system.
**Source:** Remaining open/partial HIGH-priority items from `PROJECT_ASSESSMENT.md` (2026-06-10). Excludes #17 (hero subtitle — owner handling separately).

## v1 Requirements

Requirements for this milestone. Each maps to exactly one roadmap phase.

### Kiosk POS Integrity

- [ ] **KIOSK-01** (audit #14): The kiosk POS logic exists in a single shared implementation (`js/kiosk-core.js`) consumed by both the standalone kiosk (`kiosk.js`) and the admin-embedded kiosk (`admin.js`), so the cart and payment/checkout paths can no longer diverge. The de-fork is behaviour-preserving: existing kiosk money-path behaviour (terminal charge, Zoho invoice/payment, void-on-failure, dual-cart) is unchanged and verified by the existing kiosk tests plus an admin-vs-kiosk parity check; the kiosk product-type discount feature is available identically on both surfaces.

### Cart Correctness

- [ ] **CART-01** (audit #15): Adding the same product from the catalog page and from the cross-category search overlay produces one merged cart line keyed by SKU — no duplicate lines and the displayed quantity is correct — across both the ferment and ingredients carts.

### Repo Hygiene

- [ ] **HYGIENE-01** (audit #6): `.planning/` is listed in `.gitignore`, and the internal planning directory is confirmed absent from the published GitHub Pages artifact on **both** the staging and production deploys (not publicly served).

### Deploy Safety

- [ ] **DEPLOY-04** (audit #10): The nightly Zoho snapshot is actually published to the live production static fallback — the snapshot commit no longer carries `[skip ci]` that suppresses the Pages publish, and a subsequent production force-push does not erase it (pull/rebase or `workflow_dispatch` trigger in place). Verified by the prod static `zoho-snapshot.json` being fresh after a nightly run.

### Asset Performance

- [ ] **ASSET-01** (audit #18): Facility/about imagery is served as `webp` with `srcset` and intrinsic `width`/`height`, removing the multi-MB JPEG payload from the homepage (no single facility image over ~500 KB on the homepage path; the existing product image pipeline is extended rather than duplicated).

## v2 Requirements

Deferred audit items, tracked but not in this milestone's roadmap.

### Code Structure

- **STRUCT-01** (audit §2): Decompose the 774-line `processCheckout()` into testable `lib/checkout-helpers.js` stages.
- **STRUCT-02** (audit §1): Introduce a `window.SV` namespace and break the `11-cart.js ↔ 12-checkout.js` circular dependency.
- **STRUCT-03** (audit §2): Finish the async/await conversion of `pos.js`/`catalog.js` and extract the 3×-duplicated invoice→submit→payment and tax-rule-enrichment blocks.

### Accessibility

- **A11Y-01** (audit §3): Make the cart drawer and min-qty overlay accessible dialogs (role, focus trap/return, Escape).

## Out of Scope

| Item | Reason |
|------|--------|
| #17 Hero subtitle (`content/home.json`) | Owner is handling the homepage copy separately |
| Decompose `processCheckout()` / `window.SV` namespace / async conversion | Larger refactors; deferred to a code-structure milestone (v2 above) |
| Accessible cart dialog, MEDIUM/LOW a11y items | Deferred to an accessibility-focused milestone (v2 above) |
| Dead-content cleanup (`content/*.csv`, stale CLAUDE.md) | Low-risk housekeeping; bundle into a future hygiene pass |
| Enable Redis AOF (#96) | Railway dashboard toggle, not a code change |

## Traceability

Confirmed by the roadmapper (2026-06-26). Phases risk-ordered: low-risk infra/hygiene first, money-path kiosk de-fork last.

| Requirement | Phase | Status |
|-------------|-------|--------|
| HYGIENE-01 | Phase 38 | Pending |
| DEPLOY-04 | Phase 39 | Pending |
| ASSET-01 | Phase 40 | Pending |
| CART-01 | Phase 41 | Pending |
| KIOSK-01 | Phase 42 | Pending |

**Coverage:**
- v1 requirements: 5 total
- Mapped to phases: 5 (one requirement per phase, no duplicates) ✓
- Unmapped: 0 ✓

---
*Requirements defined: 2026-06-26*
*Last updated: 2026-06-26 — traceability finalized by roadmapper (Phases 38-42)*
