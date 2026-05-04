# Documentation Validation Report — Steins & Vines

**Run date:** 2026-05-04 (automated weekly task)

---

## Summary

| File | Status | Notes |
|------|--------|-------|
| `README.md` | ⚠️ Fixed | 3 missing entries in project structure tree |
| `docs/API.md` | ⚠️ Fixed | `promo.js` routes entirely undocumented |
| `zoho-middleware/.env.example` | ⚠️ Fixed | `KIOSK_PIN` missing |
| `docs/DEPLOYMENT.md` | ✅ Pass | Accurate; no changes needed |
| `docs/ARCHITECTURE.md` | 🔴 Manual review | Checkout flow diagrams reference GP; Helcim is active provider |
| `TESTING.md` | ⚠️ Minor drift | 2 tested modules not in campaign tracker |
| `style_guide.md` | ✅ Pass | Not codebase-dependent; no audit needed |

---

## Auto-Fixed Items

### 1. `README.md` — Missing project structure entries

Three files exist in the codebase but were absent from the project tree in `README.md`.

**Added:**
- `zoho-middleware/routes/promo.js` — Promo code validation + per-email redemption tracking
- `zoho-middleware/lib/brewpad-integration.js` — Brew day batch creation triggered by kit sales
- `zoho-middleware/openapi.yaml` — OpenAPI 3.0 spec for the middleware API

### 2. `docs/API.md` — Undocumented promo endpoints

`zoho-middleware/routes/promo.js` is mounted in `server.js` and has 3 active routes, none of which appeared anywhere in `API.md`.

**Added a new "Promo Codes" section** documenting:
- `POST /api/promo/validate` — Public. Validates the `FIRSTBATCH` code and checks per-email redemption via Redis. Fails open on Redis unavailability.
- `DELETE /api/promo/redemption/:email` — API Key. Clears a redemption record so a customer can redeem again.
- `POST /api/promo/seed-kiosk` — API Key. Seeds the `FIRSTBATCH` preset into the kiosk discount store. Idempotent.

### 3. `zoho-middleware/.env.example` — Missing `KIOSK_PIN`

`KIOSK_PIN` is referenced in `zoho-middleware/lib/validateEnv.js` (startup validation) and `zoho-middleware/routes/pos.js` (timing-safe comparison for kiosk PIN verification), but was absent from `.env.example`.

**Added** under the `── Kiosk ──` section:
```
# KIOSK_PIN=                               # Four-digit PIN for kiosk access verification (POST /api/pos/verify-pin)
```

---

## Items Requiring Manual Review

### 1. `docs/ARCHITECTURE.md` — Payment provider diagrams are out of date 🔴

**Priority: High**

The architecture diagrams in `ARCHITECTURE.md` show **Global Payments (GP)** as the payment provider throughout:
- System overview diagram: `GP[Global Payments Card-Not-Present + Terminal]`
- Checkout data flow: shows `GP JS SDK → GP API` for tokenization and charging
- Kiosk POS flow: shows `GP Terminal` for in-store payment

However, based on the current codebase:
- `zoho-middleware/.env.example` marks all GP credentials as commented out with the note *"Legacy CNP payment provider. No longer used for new checkouts."*
- `docs/API.md` documents `POST /api/payment/initialize` as a **HelcimPay.js** checkout session
- `POST /api/kiosk/salesorder-pay` and `POST /api/pos/collect` both describe Helcim Smart Terminal flows
- `zoho-middleware/lib/helcim.js` is the active payment client

`ARCHITECTURE.md` needs its three Mermaid diagrams and the "Key Architectural Decisions" prose updated to reflect Helcim as the current payment provider. The void-on-failure description still refers to voiding "the GP transaction."

Note: `zoho-middleware/openapi.yaml` also still describes payment tags as "Global Payments card tokenization, charging, and voiding" — this should be updated at the same time.

**Suggested GitHub Issue:**

| Title | Labels | Priority | Description |
|-------|--------|----------|-------------|
| Update ARCHITECTURE.md + openapi.yaml: replace GP with Helcim as primary payment provider | `documentation`, `technical-debt` | High | All three Mermaid diagrams and the key decisions section still reference Global Payments. Helcim is now the active provider for both online checkout (HelcimPay.js) and in-store terminal (Helcim Smart Terminal). Update diagrams and prose. Also update the openapi.yaml `payments`/`pos` tag descriptions. |

### 2. `TESTING.md` — Campaign tracker missing two recently-tested modules ⚠️

**Priority: Low**

Two test files exist in `zoho-middleware/__tests__/` for modules that are not mentioned anywhere in the TESTING.md campaign tracker:

- `brewpad-integration.test.js` → tests `zoho-middleware/lib/brewpad-integration.js`
- `promo.test.js` → tests `zoho-middleware/routes/promo.js`

These appear to have been written and merged without a corresponding TESTING.md update. Consider adding them to a completed campaign row to keep the tracker accurate.

---

## Checks That Passed

**README.md npm scripts** — All scripts listed in the README (`npm test`, `npm run test:coverage`, `npm run lint`, `npm run build`, `cd zoho-middleware && npm test`, `npm run test:e2e`) are present in `package.json` and `zoho-middleware/package.json`. ✅

**TESTING.md coverage thresholds** — TESTING.md documents middleware ≥35% lines and frontend ≥5% lines. Both match the values in `jest.config.js` (root: `{ global: { lines: 5 } }`) and `zoho-middleware/jest.config.js` (`{ global: { lines: 35 } }`). ✅

**TESTING.md test commands** — All described commands map to real `package.json` scripts. ✅

**DEPLOYMENT.md structure** — Two-repository model, Railway middleware deployment, and `git push production main` workflow are accurate. Pre-deploy checklist and rollback steps match the current repo structure. ✅

**DEPLOYMENT.md env var references** — Environment variable handling advice (Railway dashboard, `.env.example`) is accurate. ✅

**API.md rate limits** — The rate limit table in API.md (general 60 req/min, payment/checkout 10 req/min, product requests 10 req/min, contact form 5 req/min) matches the `rateLimit` configurations in `zoho-middleware/server.js`. ✅

**API.md endpoints vs route files** — All other route files (`auth.js`, `bookings.js`, `catalog.js`, `checkout.js`, `collect.js`, `consignment.js`, `discounts.js`, `items.js`, `payments.js`, `pos.js`, `purchaseorders.js`, `requests.js`, `taxes.js`, `webhooks.js`) have corresponding sections in `API.md`. ✅

**`.env.example` completeness (remaining vars)** — All other project-specific `process.env.*` references in `zoho-middleware/` are documented in `.env.example` (either as active entries or commented-out optional vars). ✅

**ARCHITECTURE.md file references** — All referenced lib files, route files, and directories mentioned in the architecture description exist at their documented paths. ✅
