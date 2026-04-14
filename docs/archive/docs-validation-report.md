# Documentation Validation Report — Steins & Vines

**Run date:** 2026-04-09
**Automated by:** weekly-docs-validation scheduled task

---

## Summary

| File | Checked | Result | Auto-Fixed | Manual Attention |
|------|---------|--------|------------|-----------------|
| `README.md` | ✅ | ⚠️ Issues found | 2 fixes applied | 1 item flagged |
| `docs/API.md` | ✅ | ⚠️ Issues found | 4 endpoints added | 0 |
| `docs/DEPLOYMENT.md` | ✅ | ✅ Pass | — | 0 |
| `docs/ARCHITECTURE.md` | ✅ | ⚠️ Issues found | 0 | 1 item flagged |
| `zoho-middleware/.env.example` | ✅ | ⚠️ Issues found | 0 | 2 items flagged |
| `TESTING.md` | ✅ | ⚠️ Issues found | 2 fixes applied | 1 item flagged |
| `style_guide.md` | ✅ | ✅ Pass | — | 0 |

**Total auto-fixes applied: 8**
**Total items requiring manual attention: 4**

---

## Auto-Fixed Items

### Fix 1 — README.md: Added `collect.js` to project structure tree

The route file `zoho-middleware/routes/collect.js` was present in the codebase and mounted in `server.js` (`app.use('/', require('./routes/collect'))`), but was absent from the README project structure tree.

**Before:**
```
│   │   ├── items.js            # Zoho item CRUD + image proxy
```

**After:**
```
│   │   ├── collect.js          # Collect payment on existing SO via terminal (Deluge-triggered)
│   │   ├── items.js            # Zoho item CRUD + image proxy
```

---

### Fix 2 — README.md: Added `zoho-middleware/client/` directory to project structure tree

A `client/` directory exists at `zoho-middleware/client/` containing `submitOrder.js` and a `hooks/` subdirectory (including `hooks/useInventory.js`). This directory was not documented in the README tree.

**Before:** `client/` not listed under `zoho-middleware/`

**After:**
```
│   ├── client/                 # Client-side helpers (Helcim integration, React hooks)
```

---

### Fix 3 — API.md: Added `POST /api/pos/collect` endpoint

`collect.js` registers `POST /api/pos/collect`, which is called by Zoho Inventory Deluge scripts to push a Sales Order balance to the Helcim terminal. This endpoint was entirely absent from `API.md`. Added full documentation including request body, response shape, and idempotency / error behavior.

---

### Fix 4 — API.md: Added three new kiosk salesorder endpoints

Three endpoints in `zoho-middleware/routes/pos.js` were not documented in `API.md`:

| Endpoint | Description |
|----------|-------------|
| `GET /api/kiosk/salesorders` | List open Sales Orders for kiosk pay-on-account flow |
| `POST /api/kiosk/salesorder-create` | Create a new Sales Order from the kiosk |
| `POST /api/kiosk/salesorder-pay` | Collect payment on existing SO via Helcim terminal (synchronous poll) |

All three were added to the `POS / Kiosk` section of `API.md`.

---

### Fix 5 — TESTING.md: Corrected coverage threshold values

The Architecture Notes section of `TESTING.md` claimed:
> Coverage thresholds: middleware ≥70% lines (global), frontend ≥80% lines (global) — CI fails below these

The actual `jest.config.js` files set:
- Frontend (`jest.config.js`): `{ global: { lines: 5 } }`
- Middleware (`zoho-middleware/jest.config.js`): `{ global: { lines: 35 } }`

These thresholds are intentionally low because coverage collection is scoped to only the files actively targeted by the current testing campaign. The TESTING.md documentation was aspirational and misleading about what actually gates CI. Updated to reflect actual configured values with explanatory context.

---

### Fix 6 — TESTING.md: Removed duplicate and misattributed Campaign Backlog entries

The Campaign Backlog contained "Campaign 5: E2E with Playwright against staging" twice, and "Campaign 4: `js/admin.js` IIFE — reservation status logic" was listed under both Campaign 4 and Campaign 5. Removed the duplicate entries; the surviving entries are correctly labeled.

**Before (backlog had 5 items with duplicates):**
```
- [ ] Campaign 5: js/admin.js IIFE — reservation status logic
- [ ] Campaign 5: E2E with Playwright against staging
- [ ] Campaign 4: js/brewpad.js IIFE — …
- [ ] Campaign 4: js/admin.js IIFE — reservation status logic
- [ ] Campaign 5: E2E with Playwright against staging
```

**After (3 items, no duplicates):**
```
- [ ] Campaign 4: js/brewpad.js IIFE — …
- [ ] Campaign 4: js/admin.js IIFE — reservation status logic
- [ ] Campaign 5: E2E with Playwright against staging
```

---

## Items Requiring Manual Attention

### ⚠️ MANUAL-1 — README.md + ARCHITECTURE.md: Tech stack lists "Global Payments" but Helcim is now the active payment provider

**Files affected:** `README.md` (Tech Stack section), `docs/ARCHITECTURE.md` (Mermaid system diagram)

**Detail:**
- `README.md` states: "Global Payments (card-not-present and terminal)" under Integrations
- `docs/ARCHITECTURE.md` Mermaid diagram shows `GP[Global Payments<br/>Card-Not-Present<br/>+ Terminal]` as an external service
- `zoho-middleware/.env.example` marks all GP variables as commented out with "Legacy CNP payment provider. No longer used for new checkouts."
- The active payment provider is **Helcim**: `HELCIM_API_TOKEN`, `HELCIM_DEVICE_CODE`, `HELCIM_WEBHOOK_SECRET` are all active env vars; `zoho-middleware/lib/helcim.js` handles all payments; the webhooks route receives Helcim events
- The `POST /api/payment/initialize` endpoint explicitly initializes a **HelcimPay.js** session

**Recommended action:**
1. Update `README.md` Integrations line to replace "Global Payments" with "Helcim (HelcimPay.js online checkout + Smart Terminal)" or note GP as legacy
2. Update `docs/ARCHITECTURE.md` Mermaid diagram: replace the `GP[Global Payments...]` node with `HELCIM[Helcim<br/>HelcimPay.js + Smart Terminal]`
3. Confirm whether `zoho-middleware/lib/gp.js` is still actively called in any production flow or can be marked deprecated

This is flagged for manual attention because it involves an architectural representation change that should be reviewed to ensure no active production flows still rely on the GP SDK.

---

### ⚠️ MANUAL-2 — .env.example: `ZOHO_WEBHOOK_SECRET` is documented but not referenced in any middleware code

**File:** `zoho-middleware/.env.example`

**Detail:**
A grep of all `process.env.*` references across `zoho-middleware/` (excluding `node_modules` and `__tests__`) found zero references to `process.env.ZOHO_WEBHOOK_SECRET`. The variable is in `.env.example` but appears unused. Webhook signature verification in `routes/webhooks.js` uses `HELCIM_WEBHOOK_SECRET`.

**Recommended action:** Confirm whether `ZOHO_WEBHOOK_SECRET` was for a planned Zoho webhook integration or a removed feature. If confirmed dead, comment it out in `.env.example` with a note. Do not remove from Railway environment variables without checking that no external Zoho workflows reference it.

---

### ⚠️ MANUAL-3 — .env.example: `REACT_APP_API_URL` referenced in `zoho-middleware/client/` but not documented

**Files:** `zoho-middleware/client/hooks/useInventory.js`, `zoho-middleware/client/submitOrder.js`

**Detail:**
Both files reference `process.env.REACT_APP_API_URL` (a Create React App convention for browser-side env injection). This variable is absent from `zoho-middleware/.env.example`. If the `client/` directory is ever built or deployed, developers will not know to set this variable.

**Recommended action:**
1. Clarify the purpose of `zoho-middleware/client/` — experimental React frontend, build artifact, or scaffolding
2. If it is actively used or built: add `REACT_APP_API_URL` to `.env.example` with a comment noting it is for the client bundle only
3. If it is a permanent addition, expand the `client/` README tree entry to describe its build process

---

### ⚠️ MANUAL-4 — TESTING.md: Campaign tracker does not reflect `collect.test.js` or `kiosk-salesorders.test.js`

**File:** `TESTING.md`

**Detail:**
The following test files exist in `zoho-middleware/__tests__/` but are not referenced in the Campaign Progress table or Backlog:
- `collect.test.js` — covers `routes/collect.js`
- `kiosk-salesorders.test.js` — covers the new kiosk SO endpoints in `routes/pos.js`

**Recommended action:** Run `cd zoho-middleware && npm run test:coverage` to confirm current coverage percentages for `collect.js` and the kiosk SO functions in `pos.js`, then add entries to the Campaign Progress table marking them Done (or In Progress) as appropriate.

---

## GitHub Issue Recommendations

| Title | Labels | Priority | Description |
|-------|--------|----------|-------------|
| Update README + ARCHITECTURE to reflect Helcim as active payment provider (GP is legacy) | `documentation`, `tech-debt` | Medium | README tech stack and ARCHITECTURE.md Mermaid diagram still reference Global Payments as the payment integration. Helcim is now active for both online checkout and terminal. Update both files and confirm gp.js is unused in production. |
| Remove or clarify dead `ZOHO_WEBHOOK_SECRET` in .env.example | `documentation`, `config` | Low | `ZOHO_WEBHOOK_SECRET` is in `.env.example` but not referenced anywhere in middleware code. Confirm and remove or annotate as legacy. |
| Document `zoho-middleware/client/` directory purpose and build process | `documentation` | Medium | A `client/` directory with React-style hooks and `REACT_APP_*` env vars exists under `zoho-middleware/` with no documentation. Clarify its role, whether it's built, and how to configure `REACT_APP_API_URL`. |
| Add collect.js and kiosk SO endpoint coverage to TESTING.md campaign tracker | `testing`, `documentation` | Low | `collect.test.js` and `kiosk-salesorders.test.js` exist but are absent from the TESTING.md campaign progress table. Run coverage and add entries. |

---

## Files Checked (No Changes Needed)

- **`docs/DEPLOYMENT.md`** — Two-repo deployment workflow, Railway auto-deploy, GitHub Pages, rollback procedures, cache management, and env var management all match the current codebase state. ✅
- **`docs/ARCHITECTURE.md`** — Core architecture (static frontend → Express middleware → Zoho/Redis/external services) is accurate. The only inaccuracy is the Global Payments reference flagged under MANUAL-1. Deployment topology, data flow diagrams, and security model table are all current. ✅ (except MANUAL-1)
- **`style_guide.md`** — Brand guide with no technical accuracy dependencies. Not audited for content correctness (brand decisions are out of scope). ✅

---

## Validation Methods

All findings were verified against source files before being flagged. No false positives were introduced:
- Route endpoints confirmed by reading actual route files, not inferred from filenames
- Missing env vars confirmed by grepping all `process.env.*` calls across `zoho-middleware/` (excluding `node_modules`, `__tests__`)
- Coverage thresholds confirmed by reading both `jest.config.js` files directly
- New files (`collect.js`, `client/`) confirmed present in the filesystem via `ls` and direct file reads
- npm scripts in `README.md` verified against both `package.json` files (root and `zoho-middleware/`)
- `zoho-middleware/lib/` file list cross-checked against README tree — all 14 lib files matched
