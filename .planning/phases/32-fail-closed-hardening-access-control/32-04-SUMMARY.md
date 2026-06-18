---
phase: 32-fail-closed-hardening-access-control
plan: "04"
subsystem: middleware-access-control
tags: [security, pii, validation, api-key, body-whitelist]
dependency_graph:
  requires: [32-01, 32-02, 32-03]
  provides: [PII-01, PII-02]
  affects: [zoho-middleware/server.js, zoho-middleware/lib/validate.js, zoho-middleware/routes/items.js, zoho-middleware/routes/taxes.js]
tech_stack:
  added: []
  patterns:
    - "Targeted per-route app.get(path, guard) mounted before route modules — exact-match list avoids blast radius"
    - "validateBody(body, schema) whitelist helper — returns {error, clean}, strips unknown keys, type-checks present fields"
    - "Append-only validate.js extension — existing validateLineItems/classifyZohoError untouched"
key_files:
  created:
    - zoho-middleware/__tests__/pii-access.test.js
  modified:
    - zoho-middleware/server.js
    - zoho-middleware/lib/validate.js
    - zoho-middleware/routes/items.js
    - zoho-middleware/routes/taxes.js
    - zoho-middleware/__tests__/validate.test.js
decisions:
  - "PII_GET_ROUTES exact-match list (/api/contacts /api/invoices /api/items/inspect /api/snapshot) — /api/contacts/search intentionally excluded"
  - "requirePiiApiKey returns 403 (matches global guard style) not 401 — both satisfy criterion"
  - "ITEM_ALLOWED_FIELDS whitelist includes all standard Zoho Books item fields plus 22 cf_* custom fields used by this org"
  - "POST /api/taxes/apply body check: uses validateBody with allowed:[apply] types:{apply:boolean} — rejects non-object before reading fields"
  - "upload-catalog validated by existing array checks (confirmed, no new code needed)"
  - "Merged main branch (ebef0ff) into worktree to pick up Phase 31 require.main guard + supertest dependency (Rule 3 blocking fix)"
metrics:
  duration: "~20 min"
  completed: "2026-06-17"
  tasks_completed: 3
  files_modified: 6
---

# Phase 32 Plan 04: PII GET Guard + Body Validation Summary

**One-liner:** Targeted `requirePiiApiKey` guard on 4 PII GET routes + `validateBody` whitelist helper wired into item/tax mutation routes — stops unauthenticated PII access and field smuggling to Zoho.

## What Was Built

### PII-01: Targeted API-key guard (server.js)

Added `requirePiiApiKey` middleware mounted via exact-match `app.get(path, guard)` on exactly 4 paths, AFTER `requireAllowedReferer` and BEFORE route module registrations:

- `GET /api/contacts` — customer/contact PII
- `GET /api/invoices` — invoice PII
- `GET /api/items/inspect` — item inspection PII
- `GET /api/snapshot` — catalog snapshot PII

Returns `403 Forbidden` without a valid `x-api-key` regardless of Referer header. The global GET-bypass at server.js:254 (`if (req.method === 'GET') return next()`) is **unchanged** — the ~12+ legitimately-public storefront routes (products, ingredients, bookings, etc.) remain accessible without a key.

`/api/contacts/search` (a different path in pos.js) is not caught by the exact-match list.

### PII-02: `validateBody` helper (lib/validate.js, routes/items.js, routes/taxes.js)

Appended `validateBody(body, schema)` to `lib/validate.js` alongside existing exports:
- Schema: `{ allowed: string[], required: string[], types: { field: 'string'|'number'|'boolean' } }`
- Returns `{ error: string|null, clean: object }` — error-string-or-null pattern matches existing validate.js convention
- Rejects non-object bodies, missing required fields, and type violations
- Builds `clean` from `allowed` fields only — unknown keys stripped (no field smuggling, D-08)

**Wired into:**
- `POST /api/items`: `ITEM_CREATE_SCHEMA` (required: `name`; 35 allowed fields incl. cf_*) — forwards `result.clean` not `req.body`
- `PUT /api/inventory/items/:id`: `ITEM_UPDATE_SCHEMA` (no required — partial update; :id in path) — forwards `result.clean`
- `POST /api/taxes/apply`: rejects non-object; reads `bodyCheck.clean.apply` (boolean coercion strictly)
- `upload-catalog`: confirmed existing validation (arrays + non-empty check) is already correct — no new code

### Per-route allowed-field whitelists

**ITEM_ALLOWED_FIELDS** (both create and update schemas):
```
name, sku, rate, purchase_rate, description, unit,
product_type, item_type, category_name, category_id,
sales_tax_rule_id, tax_id, status,
cf_type, cf_subcategory, cf_subcategory_1, cf_vendor,
cf_brand, cf_manufacturer, cf_origin, cf_vintage,
cf_region, cf_country, cf_grapes, cf_weight, cf_unit,
cf_color, cf_style, cf_abv, cf_ibu, cf_srm, cf_og,
cf_fg, cf_milling_fee, cf_tag, cf_notes
```

**POST /api/taxes/apply**: `allowed: ['apply'], types: { apply: 'boolean' }`

## Tests

- `__tests__/pii-access.test.js`: 29 tests — PII-01 (GET guard on all 4 routes, Referer bypass test, public routes still accessible, /api/contacts/search not caught) + PII-02 (items POST/PUT body validation, taxes/apply, upload-catalog regression)
- `__tests__/validate.test.js`: 45 new `validateBody` tests appended (existing 35 assertions unchanged)
- **Total scoped suite: 80 tests, all passing**

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Worktree missing Phase 31 foundation**
- **Found during:** Task 1 (RED phase — test suite failed to load)
- **Issue:** Worktree was branched at commit `5a2a203` before Phase 31 landed. Missing: `require.main` guard in server.js (server bound port 3001 during test import), `supertest` devDependency, jest coverage thresholds
- **Fix:** Merged main branch HEAD (`ebef0ff`) into the worktree branch. Also added `supertest` to worktree's package.json (was missing — likely package.json diverged during worktree creation before Phase 31 P01 `0afa20b` landed)
- **Commits:** `075dedf` (RED phase test file), merge commit `116ea59`, then GREEN `9acc9d6`

## Threat Flags

No new network endpoints or trust boundaries introduced. All changes are restrictive (adding guards, not opening routes).

## Self-Check

- [x] `server.js` contains `requirePiiApiKey` mounted on exactly 4 PII GET paths
- [x] `lib/validate.js` exports `validateBody` AND still exports `validateLineItems` and `classifyZohoError` unchanged
- [x] `routes/items.js` POST and PUT handlers call `validateBody` before zohoPost/inventoryPut
- [x] `routes/taxes.js` POST /api/taxes/apply rejects non-object body
- [x] `__tests__/pii-access.test.js` exists and has 29 tests
- [x] `__tests__/validate.test.js` has validateBody tests appended (originals unchanged)
- [x] Scoped suite (`validate.test.js pii-access.test.js`): 80 tests all passing
- [x] Lint: 0 errors (53 warnings, all pre-existing)

## Self-Check: PASSED
