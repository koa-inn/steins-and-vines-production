---
phase: 11-producer-brand-visibility
plan: "01"
subsystem: middleware/catalog
tags: [enrichment, manufacturer, zoho-api, catalog, pipeline]
dependency_graph:
  requires: []
  provides: [manufacturer-field-in-api-response]
  affects: [zoho-middleware/routes/catalog.js, zoho-middleware/__tests__/catalog.test.js]
tech_stack:
  added: []
  patterns: [zoho-enrichment-pattern, brand-field-analog]
key_files:
  created: []
  modified:
    - zoho-middleware/routes/catalog.js
    - zoho-middleware/__tests__/catalog.test.js
decisions:
  - "Used detail.manufacturer_name (Zoho field with _name suffix) per PLAN.md D-05/D-06, not detail.manufacturer as suggested in PATTERNS.md — plan is authoritative"
  - "Added brand to kiosk inline return object alongside manufacturer, as both were missing per PATTERNS.md observation"
metrics:
  duration: "~10 minutes"
  completed: "2026-05-06T21:28:26Z"
  tasks_completed: 2
  tasks_total: 2
  files_modified: 2
---

# Phase 11 Plan 01: Manufacturer Enrichment Pipeline Summary

**One-liner:** Manufacturer field (`detail.manufacturer_name` -> `item.manufacturer` -> API response) piped through all 3 catalog enrichment paths and `shapeProduct()` following exact brand pattern.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Add manufacturer to catalog enrichment pipeline and shapeProduct | 7c5f6e9 | zoho-middleware/routes/catalog.js |
| 2 | Add middleware tests for manufacturer enrichment | b3512c8 | zoho-middleware/__tests__/catalog.test.js |

## What Was Built

### Task 1: catalog.js enrichment (4 locations)

**Location 1 — Products enrichment** (`/api/products`, line ~177):
```javascript
item.manufacturer = detail.manufacturer_name || '';
```

**Location 2 — Ingredients enrichment** (`/api/ingredients`, line ~545):
```javascript
item.manufacturer = detail.manufacturer_name || '';
```

**Location 3 — Kiosk enrichment inline object** (`/api/kiosk/products`, lines ~749-750):
```javascript
brand:         detail.brand || item.brand || '',
manufacturer:  detail.manufacturer_name || item.manufacturer || '',
```

**Location 4 — shapeProduct()** (`/api/snapshot`, line ~820):
```javascript
manufacturer:   z.manufacturer || '',
```

### Task 2: catalog.test.js tests (3 new tests added to existing describe blocks)

- `enriches manufacturer from detail.manufacturer_name field` — products enrichment, verifies RJS Craft Winemaking flows through
- `manufacturer defaults to empty string when manufacturer_name absent from detail` — fallback behavior, verifies `''` not `undefined`
- `enriches manufacturer from detail.manufacturer_name in kiosk product response` — kiosk path, verifies Winexpert flows through

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical Field] Added brand to kiosk inline return object**
- **Found during:** Task 1, while adding manufacturer to the kiosk inline object
- **Issue:** PATTERNS.md observation (line 57) confirmed `brand` was NOT present in the kiosk inline return object (lines 738-755), only `image_name` and other fields. The kiosk path would have returned `brand: undefined` on all items, breaking the `zohoKitMap` used by the admin panel producer column (Phase 11 Plan 05).
- **Fix:** Added `brand: detail.brand || item.brand || ''` alongside `manufacturer` in the kiosk inline return object
- **Files modified:** zoho-middleware/routes/catalog.js
- **Commit:** 7c5f6e9

## Verification Results

```
grep -c 'manufacturer' zoho-middleware/routes/catalog.js  -> 4 (meets >= 4 requirement)
grep -c 'manufacturer' zoho-middleware/__tests__/catalog.test.js -> 8 (meets >= 2 requirement)
cd zoho-middleware && npm test -> 460 tests, 0 failures (was 457 before new tests)
```

## Known Stubs

None. The manufacturer field flows from Zoho API through middleware enrichment to the API response. However, until a Zoho item has `manufacturer_name` set, all products will show `manufacturer: ''` — this is expected fallback behavior (D-11: hide producer line when blank).

**Field name risk (A1 from RESEARCH.md):** The plan uses `detail.manufacturer_name` per user decisions D-05/D-06. If the Zoho `/itemdetails` bulk endpoint returns `manufacturer` instead of `manufacturer_name`, all products will silently return `manufacturer: ''`. The `|| ''` fallback prevents any regression — the feature simply won't display until verified against a live Zoho item with manufacturer set.

## Threat Surface Scan

No new security surface introduced. The `manufacturer` field:
- Flows from Zoho (trusted data source) through middleware
- Uses `|| ''` fallback preventing null/undefined propagation
- Is a string field in the API response (public product metadata, not PII)
- Matches the existing `brand` field security posture exactly

## Self-Check: PASSED

- [x] `zoho-middleware/routes/catalog.js` modified with 4 manufacturer locations
- [x] `zoho-middleware/__tests__/catalog.test.js` modified with 3 new tests
- [x] Commit 7c5f6e9 exists: `feat(11-01): add manufacturer enrichment to catalog pipeline`
- [x] Commit b3512c8 exists: `test(11-01): add manufacturer enrichment tests to catalog test suite`
- [x] All 460 middleware tests pass
- [x] ESLint: 0 errors (79 pre-existing warnings, unchanged)
