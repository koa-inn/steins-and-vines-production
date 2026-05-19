---
phase: 19-hop-inventory-catalog
plan: "02"
subsystem: frontend
tags: [hops, catalog, svg-radar, accordion, cart-integration, es5, standalone-module]
dependency_graph:
  requires:
    - js/main.min.js (globals: formatCurrency, renderReserveControl, renderWeightControl, hasWeightConfig, setReservationQty, trackEvent, Fuse, equalizeCardHeights, injectProductSchema, handleDeepLinkedItem)
    - /api/ingredients (middleware endpoint)
    - /content/zoho-snapshot.json (fallback)
  provides:
    - js/modules/15-hops.js (standalone hop catalog module)
    - tests/frontend/15-hops.test.js (unit tests for pure functions)
  affects:
    - hops.html (Plan 01 — loads 15-hops.min.js)
tech_stack:
  added: []
  patterns:
    - Standalone ES5 module (not in concat:js, like 14-labels.js)
    - notes-wrap/notes-toggle/notes-body accordion pattern from 04-label-cards.js
    - loadIngredients data loading pattern from 08-catalog-ingredients.js
    - hasWeightConfig-driven renderer selection from 11-cart.js
    - createElementNS for all SVG elements (SVG namespace requirement)
    - CJS export block for Jest test compatibility
key_files:
  created:
    - js/modules/15-hops.js
    - tests/frontend/15-hops.test.js
  modified: []
decisions:
  - "groupHopsByVariant strips trailing size suffix (regex /\\s*[-–]\\s*\\d+\\s*oz\\s*$/i) to group SKUs by hop name stem"
  - "buildHopRadarChart draws 5 concentric hexagonal web rings (not just one background ring) matching the plan spec"
  - "When all 6 sensory scores are zero, show .hop-radar-placeholder text instead of empty SVG polygon"
  - "Size toggle only renders when group.variants.length >= 2; single-SKU hops show cart control directly"
  - "T-19-06 prototype pollution guard: reject __proto__/constructor/prototype custom field keys during flattening"
metrics:
  duration: "~5 minutes"
  completed_date: "2026-05-19"
  tasks_completed: 1
  tasks_total: 1
  files_created: 2
  files_modified: 0
  tests_added: 19
  tests_passing: 400
---

# Phase 19 Plan 02: Hop Catalog JS Module Summary

Standalone ES5 module implementing the complete hop catalog data-to-UI pipeline: middleware fetch with localStorage cache and snapshot fallback, size-variant SKU grouping, 6-axis inline SVG radar chart renderer, accordion expand card, flavor filter/search/sort controls, and ingredients cart integration.

## What Was Built

### js/modules/15-hops.js (748 lines)

A standalone module following the `14-labels.js` pattern — NOT in `concat:js`, loads after `main.min.js` so all shared globals are available.

**Pure functions (exported for tests):**
- `groupHopsByVariant(items)` — strips trailing size suffix regex to group 1oz/4oz SKUs into `{name, variants:[]}` pairs, sorts variants by price ascending
- `getTopFlavorTags(item, count)` — reads 6 flavor axis properties, returns top N non-zero entries as `{label, value}` objects sorted descending
- `getDominantFlavor(item)` — returns the label of the highest-scoring axis (first-wins tie-break), null if all zeros
- `buildHopRadarChart(item)` — constructs inline SVG (200x200 viewBox) with 5 concentric hexagonal web rings, 6 axis lines, 6 labeled text elements, and a score polygon when any score > 0

**Data pipeline:**
- `loadHops(callback)` — tries localStorage cache (1hr TTL), falls back to `/api/ingredients` middleware, falls back to snapshot. Custom field flattening identical to `08-catalog-ingredients.js` with T-19-06 prototype pollution guard. Filters to items with "hop" and "pellet" in name and price > 0.

**UI:**
- `buildHopCard(group)` — builds collapsed card (name h4, alpha acid, top 3 flavor tags, price) plus notes-wrap accordion expand (radar or placeholder, origin, notes, optional size toggle, cart reserve wrap)
- `buildHopFilters()` — derives dominant-flavor buttons from data, renders into filter row
- `wireHopEvents()` — debounced search (180ms) + sort select
- `renderHops()` — filter by flavor (OR logic), search via Fuse.js, sort (name/alpha-acid/price), render to `#hops-catalog`

### tests/frontend/15-hops.test.js (146 lines)

19 unit tests covering all 4 exported pure functions: grouping, flavor tag extraction, dominant flavor detection, and SVG radar chart structure (class, role, aria-label, web rings, axes, labels, fill polygon presence/absence).

## TDD Gate Compliance

- RED: `test(19-02)` commit `7f60aa5` — tests written first, failed with "Cannot find module"
- GREEN: `feat(19-02)` commit `7d9b653` — implementation passes all 19 tests
- REFACTOR: not needed (implementation was clean on first pass)

## Verification Results

```
Tests:       19 passed, 19 total  (15-hops.test.js)
Test Suites: 22 passed, 22 total  (full suite)
Tests:       400 passed, 400 total (full suite)
```

Acceptance criteria:
- [x] var-only ES5 (133 var declarations, 0 const/let/arrow functions)
- [x] createElementNS for all 5 SVG element creations
- [x] .textContent for all Zoho strings (innerHTML only for container clearing and hardcoded chevron HTML)
- [x] _item_type: 'ingredient' on cart objects
- [x] notes-wrap/notes-toggle/notes-body/hop-notes-body classes present
- [x] CJS export block with all 4 functions
- [x] DOMContentLoaded init

## Deviations from Plan

None — plan executed exactly as specified. The implementation matches all acceptance criteria and behavioral contracts.

## Known Stubs

None. All functionality is fully implemented. Sensory data shows gracefully degraded placeholder text when Zoho custom fields are not yet populated — this is intentional design, not a stub.

## Threat Flags

None beyond what was in the plan's threat model. T-19-04, T-19-06 mitigations applied as specified.

## Self-Check: PASSED

- FOUND: js/modules/15-hops.js
- FOUND: tests/frontend/15-hops.test.js
- FOUND: .planning/phases/19-hop-inventory-catalog/19-02-SUMMARY.md
- FOUND: test commit 7f60aa5
- FOUND: feat commit 7d9b653
