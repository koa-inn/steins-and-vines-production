# Docs Validation Report — Steins & Vines

**Date:** 2026-04-27  
**Run type:** Automated weekly validation

---

## Summary

| File | Status | Notes |
|------|--------|-------|
| `README.md` | ⚠️ Fixed | 2 issues auto-fixed |
| `docs/API.md` | ⚠️ Fixed | 5 undocumented endpoints added |
| `zoho-middleware/.env.example` | ⚠️ Fixed | 2 missing env vars added |
| `TESTING.md` | ⚠️ Fixed | 2 missing campaign entries added |
| `docs/DEPLOYMENT.md` | ✅ Pass | No drift detected |
| `docs/ARCHITECTURE.md` | ❌ Needs Manual Review | GP→Helcim migration not reflected in diagrams |

---

## Auto-Fixed Items

### 1. README.md — Missing route files in project structure tree

**Before:** `consignment.js` and `discounts.js` were absent from the `zoho-middleware/routes/` section of the project tree.

**After:** Added:
```
│   │   ├── consignment.js      # Consignment sales report (artisan payout aggregation)
│   │   ├── discounts.js        # Kiosk discount preset CRUD (stored in Redis)
```

Both files exist on disk (`zoho-middleware/routes/consignment.js`, `zoho-middleware/routes/discounts.js`) and are mounted in `server.js` at lines 355–356.

---

### 2. README.md — Stale payment provider in Local Setup prerequisites

**Before:** `- Global Payments sandbox credentials (for payment testing)`

**After:** `- Helcim sandbox credentials (for payment testing)`

Verified against `zoho-middleware/routes/checkout.js` and `zoho-middleware/routes/payments.js` — both exclusively use `helcimLib`. GP is present only as a legacy commented-out block in `.env.example` ("No longer used for new checkouts").

---

### 3. docs/API.md — Missing Consignment Report endpoint

Added new section **Consignment** documenting `GET /api/admin/consignment-report`. Source: `zoho-middleware/routes/consignment.js`. Auth: `MW_API_KEY` header. Returns artisan payout aggregation by month with Redis caching (5 min TTL).

---

### 4. docs/API.md — Missing Kiosk Discounts endpoints

Added new section **Kiosk Discounts** documenting all four CRUD endpoints from `zoho-middleware/routes/discounts.js`:
- `GET /api/kiosk/discounts`
- `POST /api/kiosk/discounts`
- `PUT /api/kiosk/discounts/:id`
- `DELETE /api/kiosk/discounts/:id`

Presets are stored in Redis with a 30-day TTL.

---

### 5. zoho-middleware/.env.example — Missing consignment custom field env vars

Two env vars referenced in source code were not documented in `.env.example`:

| Variable | Used In | Purpose |
|----------|---------|---------|
| `ZOHO_CF_CONSIGNMENT_DETAILS` | `routes/consignment.js` | API name of invoice custom field holding JSON artisan payout data |
| `ZOHO_CF_CONSIGNMENT_SALE` | `routes/pos.js` (lines 282, 284, 606, 607) | API name of boolean custom field marking a sale as consignment |

Both added as optional commented-out entries with descriptive comments.

---

### 6. TESTING.md — Missing campaign progress entries

Two test files exist in `zoho-middleware/__tests__/` that were not reflected in the campaign progress table:
- `consignment.test.js`
- `discounts.test.js`

Added both to the campaign table with estimated coverage targets (85% and 90% respectively, based on visual inspection of test file completeness relative to route complexity).

---

## Items Requiring Manual Review

### A. docs/ARCHITECTURE.md — Payment provider mismatch throughout (Global Payments → Helcim)

**Severity:** Medium — documentation is factually incorrect but does not affect runtime behaviour.

The architecture document still describes Global Payments (GP) as the primary payment provider in all three places:

1. **System Overview diagram** (`graph TB`) — references `GP[Global Payments<br/>Card-Not-Present<br/>+ Terminal]` as the single payments node. The actual system now uses Helcim for both online checkout (HelcimPay.js iframe) and the Smart Terminal.

2. **Customer Checkout sequence diagram** — references `GP_JS`, `GP_API`, "Tokenize card (client-side)" via a GP JS SDK. Actual flow: HelcimPay.js iframe handles tokenization, the middleware receives a Helcim transaction ID after the iframe completes.

3. **Kiosk POS Sale sequence diagram** — references `GP_TERM as GP Terminal`. Actual flow uses the Helcim Smart Terminal via `lib/helcim.js`.

4. **Narrative descriptions** — "GP card charge", "voids the GP transaction", "Rather than having the frontend call Zoho and GP APIs directly…" all reference GP.

**Recommended fix:** Update all three mermaid diagrams and the surrounding narrative to replace `GP`/`Global Payments` with `Helcim`. The checkout sequence diagram requires the most care — the Helcim flow differs from the old GP flow (payment is processed inside the HelcimPay.js iframe before the form submits; the middleware receives the result via `postMessage`/the submitted `payment_token` field rather than charging a tokenized card server-side). The `POST /api/checkout` description in `API.md` has a parallel inaccuracy: "GP card charge, Zoho Sales Order creation" should read "Helcim void-if-needed + SO creation (card was pre-charged in iframe)".

**Suggested GitHub Issue:**

| Title | Labels | Priority | Description |
|-------|--------|----------|-------------|
| Update ARCHITECTURE.md and API.md checkout description for Helcim migration | `documentation`, `tech-debt` | Medium | ARCHITECTURE.md still documents Global Payments as the payment provider in all three mermaid diagrams and narrative text. API.md `POST /api/checkout` description also says "GP card charge". All references should be updated to Helcim, noting the HelcimPay.js iframe pre-charge model. |

---

## Checks That Passed

**docs/DEPLOYMENT.md:**
- Two-repository model (staging + production) matches `.github/workflows/tests.yml` and `CLAUDE.md`.
- All referenced npm scripts (`npm run build`, `npm run test:e2e`) exist in root `package.json`.
- Environment variable guidance is consistent with `.env.example`.
- Cache management section matches cron schedule documented in `server.js`.

**TESTING.md:**
- All npm test commands (`npm test`, `npm run test:coverage`, `cd zoho-middleware && npm test`) verified against root and middleware `package.json` scripts.
- Coverage thresholds documented ("middleware ≥35% lines, frontend ≥5% lines") match `jest.config.js` (`coverageThreshold: { global: { lines: 5 } }`) and `zoho-middleware/jest.config.js` (`coverageThreshold: { global: { lines: 35 } }`).
- Campaign progress entries for previously completed work still match actual test files in `zoho-middleware/__tests__/` and `tests/frontend/`.

**zoho-middleware/.env.example — existing entries:**
- All non-GP env vars referenced in source code are documented.
- Removed vars (`ZOHO_CF_DEPOSIT`, `ZOHO_CF_BALANCE`, `GP_DEPOSIT_AMOUNT`) are correctly commented out with "Removed Apr 2026" notes.
- GP credentials are correctly marked as legacy / commented out.

**README.md — npm scripts:**
- All scripts in root `package.json` (`test`, `test:coverage`, `lint`, `build`, `test:e2e`, `test:e2e:headed`) match what's documented in the README.
- All scripts in `zoho-middleware/package.json` (`npm test`, `npm run test:coverage`, `npm run dev`) match the README middleware setup section.

**README.md — tech stack:**
- Frontend: static HTML / vanilla JS (ES5) / CSS on GitHub Pages — correct.
- Middleware: Express.js on Railway — confirmed via `railway.toml` and `zoho-middleware/package.json`.
- Integrations: Zoho, Helcim, Redis, Sentry, Google Apps Script — all confirmed present in `zoho-middleware/package.json` dependencies and source.

---

*Generated by automated weekly docs validation task.*
