---
phase: 08-first-batch-promo
plan: 06
subsystem: checkout
tags: [assessment, dual-cart, cart-merge, architecture, documentation]
dependency_graph:
  requires: [08-02, 08-04, 08-05]
  provides: [cart merge feasibility assessment, implementation roadmap for cart unification]
  affects: []
tech_stack:
  added: []
  patterns: []
key_files:
  created:
    - .planning/phases/08-first-batch-promo/08-cart-merge-assessment.md
  modified: []
decisions:
  - "Cart merge is feasible: ~900 lines of production code can be deleted across 4 implementation phases"
  - "All business rules (promo, Maker's Fee, milling, timeslot) are already item_type-based and survive the merge without logic changes"
  - "Staff validation required before Phase C server-side unification: whether two separate Zoho SOs per transaction is a hard operational requirement"
  - "Dual-cart void guard (routes/checkout.js:629-668) and replay suffix are the only server-side complexity, both deletable with single-cart"
  - "Untested code (submitDualCart, showDualCartConfirmation, void guard, replay suffix) gets deleted not migrated — no new tests needed for deleted code"
metrics:
  duration: 25min
  completed_date: "2026-05-04"
  tasks_completed: 1
  files_changed: 1
---

# Phase 08 Plan 06: Cart Merge Feasibility Assessment Summary

**One-liner:** Comprehensive impact analysis for merging sv-cart-ferment + sv-cart-ingredients into single sv-cart, cataloging ~900 lines of deletable code across 6 files and proposing a 4-phase implementation roadmap.

## What Was Built

### Task 1: Analysis and assessment document

Produced `.planning/phases/08-first-batch-promo/08-cart-merge-assessment.md` (476 lines, 45 section headings).

**Section coverage:**

**Section 1 — Current Architecture:** Documented two localStorage keys, `getCartKey` routing logic by item_type, dual-cart activation in `initReservationPage`, checkout URL logic, and 5 business rules distinguishing kit vs ingredient behavior.

**Section 2 — Code Impact Matrix:** Per-file analysis of all 6 affected files:
- `js/lib/constants.js` — 5 lines affected; add `CART_KEYS.UNIFIED`
- `js/modules/11-cart.js` (1,243 lines) — 14 functions cataloged; ~150 lines simplified/deleted; net -120 lines
- `js/modules/12-checkout.js` (2,066 lines) — 5 functions to delete entirely (~560 lines), 7 functions with dual-cart branches to simplify (~220 lines); total ~780 lines removed (38% of file)
- `js/modules/07-catalog-kits.js` — 3 lines affected (scoped qty lookup)
- `js/modules/13-init.js` — 5 lines affected
- `zoho-middleware/routes/checkout.js` (857 lines) — ~55 lines simplified/deleted

**Section 3 — Behavioral Changes:** 8-row table of user-facing changes; confirmed all business rules (promo, Maker's Fee, milling) survive on item_type logic without modification.

**Section 4 — Migration Strategy:** Concrete `migrateToUnifiedCart` function pseudocode; no-conflict analysis; URL param backward compatibility; backup key strategy for rollback.

**Section 5 — Server-Side Impact:** Single SO recommendation; replay guard simplification from suffix-keyed to plain; booking API trigger change; Helcim payment path unchanged.

**Section 6 — Risk Assessment:** 6 identified risks with severity and mitigation; test coverage gap analysis (confirmed: `submitDualCart`, void guard, replay suffix have zero test coverage in middleware); rollback strategy.

**Section 7 — Implementation Phases:** 4 sub-plans (A: cart storage, B: checkout UX, C: server-side, D: test cleanup) with file lists, context cost estimates, prerequisites, and pitfall callouts.

## Task Commits

1. **Task 1: Cart merge feasibility assessment** — `dc93e2d` (docs)

## Files Created/Modified

- `.planning/phases/08-first-batch-promo/08-cart-merge-assessment.md` — 476-line assessment with 7 top-level sections

## Decisions Made

- Cart merge is architecturally straightforward: the dual-cart system adds complexity but no irreplaceable behavior
- All 5 business rule distinctions (promo, Maker's Fee, milling, timeslot, separate SO) can be preserved via item_type checks — only the "separate Zoho SO" rule has an external dependency requiring human validation
- Recommended single Zoho SO for merged cart (simplest path); if operations requires separate SOs, Phase C becomes a server-side split by item_type rather than a simplification

## Deviations from Plan

None — plan executed exactly as written. The assessment covers all 7 required sections and all 6 specified files with exact line numbers.

## Known Stubs

None — this is a documentation-only plan.

## Threat Surface Scan

No trust boundaries introduced. Documentation-only plan; no code changes.

## Self-Check: PASSED

- `.planning/phases/08-first-batch-promo/08-cart-merge-assessment.md` — EXISTS, 476 lines
- `wc -l` returns 476 (exceeds 100-line minimum)
- `grep -c "^##"` returns 45 (exceeds 7 section heading minimum)
- Commit `dc93e2d` — EXISTS
- All 7 required sections present: Current Architecture, Code Impact Matrix, Behavioral Changes, Migration Strategy, Server-Side Impact, Risk Assessment, Recommended Implementation Phases
- All 6 specified files covered with function names and line numbers
- Migration strategy includes concrete pseudocode and conflict handling
- Implementation phases include file lists, context cost estimates, and prerequisites
