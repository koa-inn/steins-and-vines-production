---
phase: 20-zoho-data-foundation
plan: "01"
subsystem: zoho-middleware/scripts
tags: [zoho, inventory, subcategory, tagging, verification, cli-script]
dependency_graph:
  requires: []
  provides:
    - zoho-middleware/scripts/tag-subcategories.js
    - zoho-middleware/scripts/verify-subcategories.js
  affects:
    - Zoho Inventory item records (subcategory CF values written at runtime)
    - /api/ingredients response subcategory field (verified by verify script)
tech_stack:
  added: []
  patterns:
    - ES5 var style (no let/const/arrow functions)
    - import-vessels.js dry-run + error-collection pattern
    - sync-images.js rate-limiting + prefixed-log pattern
    - export-snapshot.js stdlib-http + .on('error') pattern
key_files:
  created:
    - zoho-middleware/scripts/tag-subcategories.js
    - zoho-middleware/scripts/verify-subcategories.js
  modified: []
decisions:
  - "Pre-flight CF label inspection added: fetches first item via inventoryGet, logs all CF labels, aborts if 'Subcategory' label not found — prevents 200+ silent no-op PUTs"
  - "RULES order: Hops → Cleaning → Equipment → Yeast → Grain → Additive → Packaging — Equipment before Grain avoids false positives on Monster Mill and Floating Thermometer"
  - "Yeastex exclusion applied inside guessSubcategory() at Yeast rule match — Kerry Yeastex 82 falls through to Additive"
  - "verify-subcategories.js hits /api/ingredients (not /api/snapshot) to validate full Zoho → flattenCF() → shaped output pipeline"
metrics:
  duration_seconds: 177
  completed: "2026-05-28"
  tasks_completed: 2
  tasks_total: 2
  files_created: 2
  files_modified: 0
---

# Phase 20 Plan 01: Zoho Subcategory Tagging Scripts Summary

Bulk subcategory tagger and read-only coverage verifier for Zoho Inventory ingredient items using keyword-based classification and middleware API verification.

## What Was Built

### Task 1: `zoho-middleware/scripts/tag-subcategories.js`

A standalone Node.js CLI script that auto-classifies ingredient items by name keywords and writes the "Subcategory" custom field via the Zoho Inventory API directly (no running middleware required for the write path).

Key features:
- Pre-flight CF label inspection: fetches first item via `inventoryGet`, logs all CF labels found, and aborts with clear error if no field labeled exactly "Subcategory" exists — prevents 200+ silent no-op PUT calls (T-20-03 mitigation)
- 7-category RULES array in false-positive-safe order: Hops, Cleaning, Equipment, Yeast, Grain, Additive, Packaging
- VALID_SUBCATEGORIES enum guard before every PUT call (T-20-01 mitigation)
- `--dry-run` flag skips all PUT calls and logs `WOULD TAG` for each item
- 700ms rate limiting between PUT calls (T-20-04 mitigation)
- Skips items that already have a non-empty Subcategory CF value
- Error collection with continue-on-failure
- MANUAL REVIEW REQUIRED summary with SKU + name for ambiguous items
- KIT_CATEGORIES filter (`wine`, `beer`, `cider`, `seltzer`) excludes kit products
- Yeastex exclusion: Kerry Yeastex 82 falls through from Yeast rule to Additive
- ES5 `var` style throughout; follows import-vessels.js + sync-images.js patterns

### Task 2: `zoho-middleware/scripts/verify-subcategories.js`

A read-only verification script that calls the local middleware `/api/ingredients` endpoint and reports subcategory coverage. Validates the full Zoho → `flattenCF()` → shaped ingredient output pipeline.

Key features:
- Stdlib `http` only — no dotenv, no axios, no zoho-api require
- Calls `/api/ingredients` (not `/api/snapshot`) to test the shaped output
- Reports: Total ingredients, Tagged count, Missing count, Coverage %
- Sorted per-subcategory breakdown
- Missing items list with SKU and name when gaps exist
- Exit 0 = 100% coverage; exit 1 = any gaps or errors
- `.on('error')` handler prints clear "Start the middleware" instructions on connection refused
- Zero-items guard warns if cache still warming
- JSDoc header with Prerequisites and Usage sections

## Verification Results

All acceptance criteria met:

| Check | Result |
|-------|--------|
| `node -c zoho-middleware/scripts/tag-subcategories.js` | PASSED |
| `node -c zoho-middleware/scripts/verify-subcategories.js` | PASSED |
| VALID_SUBCATEGORIES in tag script | FOUND (2 occurrences) |
| inventoryPut in tag script | FOUND (1 call) |
| dry-run flag in tag script | FOUND (3 occurrences) |
| DELAY_MS rate limiting | FOUND (2 occurrences) |
| MANUAL REVIEW section | FOUND (1 occurrence) |
| preflight check | FOUND (4 occurrences) |
| api/ingredients in verify script | FOUND (3 occurrences) |
| Coverage report | FOUND (4 occurrences) |
| process.exit in verify script | FOUND (6 occurrences — exit 0 and exit 1 paths) |
| `npm test` (frontend, 401 tests) | PASSED |
| `cd zoho-middleware && npm test` (510 tests) | PASSED |
| `npm run lint` | PASSED (0 errors, 102 pre-existing warnings in js/) |
| ES5 var style (no let/const) | CONFIRMED |

## Deviations from Plan

None — plan executed exactly as written.

Both scripts follow the established project patterns:
- tag-subcategories.js: import-vessels.js (dry-run, error-collection, summary) + sync-images.js (DELAY_MS, sleep, prefixed log)
- verify-subcategories.js: export-snapshot.js (JSDoc header, stdlib http, MIDDLEWARE_URL, body accumulation, .on('error'), exit codes)

## Known Stubs

None. These are operational CLI scripts with no UI rendering or data placeholders.

## Threat Flags

No new security surface introduced. Scripts are developer-only CLI tools:
- tag-subcategories.js: all mitigations from threat register implemented (T-20-01 VALID_SUBCATEGORIES guard, T-20-02 no credential logging, T-20-03 pre-flight CF inspection, T-20-04 700ms rate limiting)
- verify-subcategories.js: read-only, stdlib only, no credentials required

## Self-Check: PASSED

- FOUND: zoho-middleware/scripts/tag-subcategories.js
- FOUND: zoho-middleware/scripts/verify-subcategories.js
- FOUND commit: ad06c0e (feat(20-01): create bulk subcategory tagging script)
- FOUND commit: b708e33 (feat(20-01): create subcategory coverage verification script)
