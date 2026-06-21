---
phase: 35-batch-scaling-engine
plan: 04
subsystem: ui
tags: [kiosk, admin, scaling, recipe-sale, es5]

requires:
  - phase: 35-batch-scaling-engine
    provides: server scaling engine (35-02) + wired pos-recipe routes (35-03) + INGREDIENTS_ALL stock fix (35-05) + recipe-quote endpoint (35-06)
provides:
  - "Admin Kiosk Sale recipe-scaling UI: target-volume input, live factor readout, scaled price + cart quantities (via server quote), 409 manager-override"
affects: [36-cross-surface-selection]

tech-stack:
  added: []
  patterns: ["Client previews server-authoritative scaled price via a read-only quote endpoint (no client-side pricing drift)"]

key-files:
  created: []
  modified:
    - admin.html
    - js/admin.js

key-decisions:
  - "UAT surfaced two defects that became gap-closures: 35-05 (internal-only ingredient stock invisible) and 35-06 (client cart/price not scaling) — both fixed, tested, deployed, and re-verified live"
  - "D-06 locked-price increase NOT live-verified: the only live recipe (Dangerous Bunny) is dynamic-priced. Locked-pricing scaling is covered by 35-03 unit tests (locked 1.5x = $342.50). Recorded as a human-UAT follow-up."

patterns-established:
  - "Server-quote pattern: GET /api/kiosk/recipe-quote dry-runs the exact sale computation so displayed price == charged price"

requirements-completed: [SCALE-01, SCALE-05]

duration: ~UAT cycle across 2026-06-20
completed: 2026-06-21
---

# Phase 35: Batch Scaling Engine — Plan 04 Summary

**Admin Kiosk Sale recipe-scaling UI shipped and owner-approved on staging: target-volume input + live factor readout, server-quote-driven scaled price and cart quantities, and the 409 manager-override path — with two UAT-surfaced defects fixed as gap-closures (35-05, 35-06).**

## Performance
- **Tasks:** 4 (3 auto + 1 blocking human-verify UAT, approved by owner)
- **Files modified:** admin.html, js/admin.js (+ bundle rebuild)
- **Completed:** 2026-06-21

## Accomplishments
- Added the "Target volume (L)" input + live "Nx base M L" factor readout inside `#kiosk-recipe-prompt` (SCALE-01, D-10), with the no-base-size disable state (D-11).
- Sent `target_volume_l` + `override` in both the recipe-sale and confirm request bodies (RESEARCH Pitfall 2 mitigated — present on confirm too).
- Wired the 409 stock-conflict surface + "Manager Override — Proceed Anyway" button (SCALE-05, D-08).
- Rebuilt the JS bundle; deployed to staging.

## Task Commits
1. **Task 1: admin.html markup** — `9692cba`
2. **Task 2: js/admin.js wiring + build** — `2063790`
3. **Task 3: tests + lint gate** — covered by build/commit above; staging deploy by orchestrator (`2063790`)
4. **Task 4: staging UAT (human-verify)** — owner approved (see below)

## UAT Outcome (owner, staging)

**Approved.** Verified live by the owner on `admin.html?tab=kiosk`:
- **SCALE-01** — target-volume input pre-fills at the base (60 L), factor readout updates live, and (after the 35-06 fix) the **Add-to-Cart price scales** (60 L → $112.20, 360 L → $407.17).
- **SCALE-02** — the **cart line quantities scale** (e.g. Gambrinus Pale Malt 9.3 → 55.8 kg at 6x). Owner confirmation: "the price is increasing now and putting the proper amount in the carts… this step is approved."

### Two defects surfaced during UAT → fixed as gap-closures
1. **35-05** — recipe stock/pricing checks read the purchasable-only `INGREDIENTS` catalog, hiding internal-only ingredients (Gypsum Bulk, in stock 20.83 kg) → false `cannot_brew`. Fixed to read `INGREDIENTS_ALL` across stock, availability, grouping, dynamic pricing, and post-sale cache bust. Verified live (availability flipped `cannot_brew` → `all_ok`).
2. **35-06** — the client cart/price showed base/1x values while the server charged the scaled amount. Fixed with a read-only `GET /api/kiosk/recipe-quote` (shares the sale compute, no side effects) driving the displayed price + cart quantities. Verified live (quote returns scaled totals; 6x flags the Gambrinus stock conflict).

## Human-UAT follow-ups (not live-verified; tracked)
- **D-06 locked-price increase** — not testable live: the only existing recipe is dynamic-priced. Needs a locked-price recipe (set Dangerous Bunny to locked pricing, or create one). Locked scaling math is covered by 35-03 unit tests.
- **Full end-to-end completed sale** — the owner verified the price/cart display but did not push a real terminal charge → scaled Zoho invoice + frozen `recipe_snapshot` (SCALE-04). Server behavior is covered by `pos-recipe.test.js` (scaled invoice line items + enriched snapshot), but a live completed sale has not been run.
- **D-08 manager override** — the server 409 was confirmed live (6x oversells Gambrinus); the override button is wired + unit-tested, but the owner did not exercise the full override-to-completion flow live.

## Deviations from Plan
The plan assumed the client only previews the factor while the server charges the scaled total. UAT showed that produces a misleading display (screen $109.20 vs terminal ~$650). Resolved via the 35-06 server-quote gap-closure so the display matches the charge.

## Next Phase Readiness
- Phase 36 (cross-surface selection) can reuse the `recipe-quote` endpoint to bring the same scaled display to the standalone kiosk + BrewPad surfaces.

---
*Phase: 35-batch-scaling-engine*
*Completed: 2026-06-21*
