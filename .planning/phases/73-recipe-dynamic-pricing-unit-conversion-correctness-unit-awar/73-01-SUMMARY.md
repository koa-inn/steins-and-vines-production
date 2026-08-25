---
phase: 73-recipe-dynamic-pricing-unit-conversion-correctness-unit-awar
plan: 01
subsystem: api
tags: [recipe-pricing, unit-conversion, zoho, jest]

requires: []
provides:
  - "ingredientLineCost(item, line) + classifyUnit(raw) pure unit-conversion helpers in lib/recipe-scaling.js"
  - "computeScaledRecipeTotal / computeModifiedRecipeTotal wired to the shared helper (fail-closed on non-convertible units)"
affects: [73-02, 73-03, 73-04, 73-05, "pos-recipe.js sale/quote paths", "recipes.js read-path enrichment"]

tech-stack:
  added: []
  patterns:
    - "Discriminated-result pure helper (ok:true/false) mirroring resolveGstTaxId fail-closed precedent (pos.js)"
    - "Typed thrown Error (RecipeLineUnitError) for aggregate-sum fail-closed propagation, callers translate to HTTP in later plans"

key-files:
  created: []
  modified:
    - zoho-middleware/lib/recipe-scaling.js
    - zoho-middleware/__tests__/recipe-scaling.test.js

key-decisions:
  - "D-06 imperial scope: live audit of all 8 recipes (91 ingredient lines) found only kg/g/L/pcs on cost lines, zero imperial units — helper ships mass/volume/count families only; imperial fails closed (named-line error), no imperial factors added"

patterns-established:
  - "ingredientLineCost/classifyUnit: pure, no-I/O helper — callers pass in item/line, rate read only from item.rate (T-36-01)"

requirements-completed: [AC-01, D-06]

duration: TBDmin
completed: 2026-08-25
---

# Phase 73 Plan 01: Unit-Aware Ingredient Cost Helper Summary

**Added `ingredientLineCost`/`classifyUnit` pure helpers to `lib/recipe-scaling.js` and wired both in-file aggregate sum-sites to them, closing the ~1000x unit-mismatch overcharge bug at its foundation.**

## Task 1: D-06 Imperial-Scope Audit (from live data)

**Method:** Queried the deployed middleware directly (`https://svmiddleware-production.up.railway.app`) — `GET /api/recipes` (all 8 recipes, read-only, no data modified) followed by `GET /api/recipes/:id` for each of `SV-R-000001` through `SV-R-000008`.

**Distinct cost-line units observed across all 91 ingredient lines (8 recipes):**

| Unit | Line count | Example items |
|------|-----------|----------------|
| `kg`  | 48 | Gambrinus Pale Malt, Weyermann Floor-Malted Bohemian Pilsner |
| `g`   | 21 | Magnum Bulk, GR Hallertau Mittelfruh Bulk, Calcium Chloride (Bulk) |
| `L`   | 13 | Lactic Acid 88%, Whirlfloc Tablets (25 pack) |
| `pcs` | 9  | Irish moss 1 oz (unit is `pcs`, not `oz` — the imperial token is only in the item *name*), Fermentis SafAle S-04/SafLager W-34/70 |

**Zero recipe-line units are imperial** (no `oz`/`lb`/`tsp`/`tbsp`/`cup`/`pt`/`qt`/`gal`/`floz` token appears in any `ingredient.unit` field). The one apparent imperial signal — "Irish moss **1 oz**" — is the item's display name; its actual `unit` field is `pcs` (a packet), which needs no conversion.

**D-06 decision:** Per the decision rule ("if NO live recipe uses an imperial unit on a cost line, ship the helper with only mass/volume/count families — imperial then fails closed"), Task 2's conversion table includes **only mass (`g`↔`kg`) and volume (`ml`↔`L`) plus count pass-through**. No imperial→metric factors were added. An imperial recipe-line unit (should one ever be entered) will fail closed with the named-line error, matching D-02's fail-closed spirit — this is documented as intentional, not a gap.

**Read-only confirmation (D-04):** all requests were `GET`; no recipe data was created, updated, or deleted during the audit.

## Task 2 & 3

(Filled in below after implementation.)
