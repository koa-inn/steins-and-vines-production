# Staging Middleware — Setup Scope

**Status:** proposal / not yet built · **Author:** scoped 2026-08-18

## Why this exists

There is currently **no staging middleware**. The Railway service `sv-middleware`
(env `production`, `svmiddleware-production.up.railway.app`) is the *only* middleware,
and **both** frontends point at it:

- `js/sheets-config.js` → `MIDDLEWARE_URL` (public pages)
- `js/admin-config.js` → `ADMIN_API_URL` (kiosk / BrewPad / admin)

Both are committed with the production URL, so `staging.steinsandvines.ca` calls the
production middleware. That middleware auto-deploys from the **production** repo's
`main` (currently commit `a4aec80`, **phase 68**), and has historically been shipped
via manual `railway up` (auto-deploy is flaky). Consequences:

- **Client-only** frontend changes can be staged (GitHub Pages on `staging.…`).
- **Middleware** changes cannot — they only run once on production. Phases **70**
  (cash/MOTO) and **71** (collect) middleware have therefore **never been deployed
  anywhere**, which is why cash/MOTO failed when tested on staging (staging frontend
  hit the phase-68 middleware).

**Goal:** a real staging middleware so `git push origin main` deploys *both* the
staging frontend and a staging middleware running the same code, letting us verify
money-path changes before production.

## Architecture

```
git push origin main      → staging.steinsandvines.ca (GH Pages)  +  sv-middleware / STAGING env (Railway)
git push production main   → steinsandvines.ca (GH Pages)          +  sv-middleware / production env (Railway)
```

- Add a **`staging` environment** to the existing Railway `sv-middleware` project
  (Railway supports multiple environments per project; each has its own service
  instance, variables, and domain).
- Point the staging environment's deploy source at the **staging repo (`origin`) `main`**
  (or a dedicated `staging` branch), watching `zoho-middleware/**`.
- Staging domain, e.g. `svmiddleware-staging.up.railway.app`.

## The three decisions that actually matter

### 1. Zoho data isolation (biggest one)

| Option | Isolation | Cost / effort | Notes |
|---|---|---|---|
| **A. Separate Zoho org** (test org) | Full — staging never touches live books | High: new OAuth app + re-create items, taxes, accounts, custom fields, KIOSK_CONTACT_ID, gift-card accounts | The "correct" answer; heavy one-time setup |
| **B. Same live org + test-data convention** (recommended default) | Partial — real invoices created, then voided | Low: reuse all config | Matches how 70/71 UAT already works ("reverse the invoice afterward"). Use a `STAGING-` reference prefix for easy find/void. Risk: forgotten test data pollutes financials |
| **C. Dry-run mode** (log-only, no Zoho write) | Full | Low code change | Weakest — proves call-shape, not real reconciliation (the exact gap 71-03 was meant to close). Useful as an extra toggle, not the primary |

**Recommendation:** start with **B** + a strict `STAGING-` tag + post-test void
checklist; move to **A** if/when test volume or risk warrants true isolation.

### 2. Helcim / physical terminal

Feasibility of staging each phase-70/71 flow:

| Flow | Stageable on staging middleware? | How |
|---|---|---|
| **Cash tender** (70) | ✅ Fully | Cash skips the terminal — needs only Zoho. Clean staging win |
| **MOTO / HelcimPay** (70) | ⚠️ Mostly | Hosted iframe card-not-present; needs `HELCIM_API_TOKEN`. Use Helcim test mode if available, else a small **refundable** real charge |
| **Card terminal sale** | ❌ Hard | Needs the physical Smart Terminal (one device, live Helcim account) + the terminal webhook |
| **SO collect** (71) | ❌ Hard | Same — depends on the terminal webhook (`/api/webhooks/terminal`) |

**Terminal-webhook constraint:** Helcim delivers the terminal webhook to **one** URL,
currently production. Staging can't receive live terminal webhooks without either
(a) Helcim supporting a second webhook endpoint, (b) temporarily repointing it
(disrupts prod), or (c) **replaying a captured webhook payload** at the staging
`/api/webhooks/terminal` (best option — lets us verify collect/terminal *server logic*
without the physical device). Recommend building a tiny webhook-replay helper.

### 3. Secrets — staging needs the FULL prod set

The `validateEnv` **D-02 guard** refuses to boot fail-open when `RAILWAY_ENVIRONMENT`
is set but `NODE_ENV !== production`. So the staging service must run
`NODE_ENV=production`, which triggers `REQUIRED_IN_PROD` — staging needs **all** money-path/
security secrets, not a relaxed subset:

- Required: `ZOHO_CLIENT_ID/SECRET/ORG_ID`, `API_SECRET_KEY` (or `MW_API_KEY`)
- Required-in-prod: `RECAPTCHA_SECRET_KEY`, `HELCIM_WEBHOOK_SECRET`, `CALCOM_WEBHOOK_SECRET`,
  `REDIS_ENCRYPTION_KEY`, `SENTRY_DSN`, `HELCIM_API_TOKEN`, `STAFF_EMAILS`,
  `KIOSK_DEVICE_TOKEN`, `SHEETS_CLIENT_ID`
- Plus the ~30 optional config vars (taxes, custom fields, item ids, `KIOSK_CONTACT_ID`,
  gift-card account, Apps Script, `REDIS_URL`, `ZOHO_REDIRECT_URI`, …)

*(Alternative: add a `NODE_ENV=staging` branch to the D-02 guard that still enforces
the prod-secret set — a small code change so logs/Sentry can distinguish envs.)*

## Component checklist

- [ ] Railway: add `staging` environment to `sv-middleware`; set deploy source = `origin/main`, watch `zoho-middleware/**`
- [ ] Railway: provision a **separate Redis** for staging (own `REDIS_URL`) so pending-charges/locks/idempotency don't collide with prod
- [ ] Copy all env vars to staging (with staging-specific `ZOHO_REDIRECT_URI`, `SENTRY` env tag, own `API_SECRET_KEY`/`KIOSK_DEVICE_TOKEN`); decide Zoho org per Decision 1
- [ ] Zoho OAuth: register the staging `/auth/zoho` redirect URI; run the OAuth flow once to seed the staging refresh token
- [ ] Google OAuth (`SHEETS_CLIENT_ID`): allowlist the staging origin for staff sign-in
- [ ] Frontend: make `MIDDLEWARE_URL` (sheets-config.js) **and** `ADMIN_API_URL` (admin-config.js) hostname-aware — `staging.steinsandvines.ca` → staging middleware, else production. One committed file, runtime branch
- [ ] Resolve the `railway.toml` ambiguity (root `./railway.toml` vs `./zoho-middleware/railway.toml`; deployment meta references `/railway.toml` with `watchPatterns: ["zoho-middleware/**"]`, but repo `zoho-middleware/railway.toml` says `["**"]`)
- [ ] Webhooks: staging `HELCIM_WEBHOOK_SECRET` / `CALCOM_WEBHOOK_SECRET`; build a webhook-replay helper for terminal/collect testing
- [ ] Docs: update CLAUDE.md deploy section — `git push origin main` now deploys staging middleware too

## Effort estimate

- Railway staging env + Redis + var copy: **~2–4 h**
- Frontend hostname switch (both config files) + test: **~1 h**
- Zoho: **0** (Option B) or **~1 day** (Option A, new org build-out)
- Webhook-replay helper: **~2–3 h**
- D-02 `staging` NODE_ENV branch (optional): **~30 min**

**Total ~1 day** for Option B (same Zoho org), **~2 days** for Option A.

## Recommended phased rollout

1. **Phase 1 (unblocks 70/71 cash/MOTO):** Railway staging env + Redis + Option B Zoho +
   hostname config switch. Verifies cash end-to-end and MOTO server path immediately.
2. **Phase 2:** webhook-replay helper → verify SO-collect (71) and terminal-sale server
   logic without the physical device.
3. **Phase 3 (optional):** separate Zoho test org (Option A) if test volume grows.

## Phase 1 execution (Zoho Option B) — status & runbook

**Chosen:** Option B (same live Zoho org + Helcim account; tag/void staging test data).

### Done (in-repo)
- **Frontend hostname switch** — `js/sheets-config.js` picks the middleware by hostname;
  `staging.steinsandvines.ca` → `svmiddleware-staging.up.railway.app`, everything else
  fails safe to production. Test: `tests/frontend/middleware-url-routing.test.js`.
  **Parked on branch `feat/staging-mw-frontend-switch`** — merge to `main` only AFTER the
  staging middleware is live (otherwise `staging.steinsandvines.ca` points at a dead host).

### Railway staging middleware — DONE via CLI (2026-08-18)
- **Environment `staging`** created by duplicating `production` → all **71 vars copied
  internally** (incl. secrets, Option B) + its **own Redis instance** (`Redis-3jZb`, separate
  from prod — private networking is per-environment).
- **Domain:** `https://svmiddleware-staging.up.railway.app` (auto-generated, matches the
  frontend switch — no frontend change needed).
- **Vars adjusted for staging:** `NODE_ENV=production` (copied; satisfies D-02), added
  `SENTRY_ENVIRONMENT=staging`, `ZOHO_REDIRECT_URI` → `…svmiddleware-staging…/auth/zoho/callback`,
  **deleted `HELCIM_DEVICE_CODE`** so staging never drives the physical terminal.
- Staging middleware **boots and serves `/health`** (currently running phase-69 code from the
  prod repo; `authenticated:false`, `redis:false` — see remaining steps).
- Production verified **untouched** (uptime unbroken; CLI re-linked to production).

### Remaining — owner (Railway dashboard + Zoho), all quick
1. **Deploy source repo (the important one):** staging `sv_middleware` still deploys from the
   **production** repo (inherited from the duplicate). Change its Source to
   **`koa-inn/steins-and-vines-staging`**, branch `main`, so `git push origin main` deploys the
   staging middleware with phase 70/71 + the collect fix. *(Dashboard-only — CLI can't re-point an
   existing service's repo.)*
2. **Fix Redis wiring:** `REDIS_URL` was copied from prod as a literal string and reports
   `redis:false`. In staging `sv_middleware` → Variables, set `REDIS_URL` to **reference the
   staging Redis** (variable-reference dropdown → `Redis-3jZb`'s URL), then redeploy. Confirm
   `/health` shows `"redis":true`.
3. **Zoho OAuth seed:** register `https://svmiddleware-staging.up.railway.app/auth/zoho/callback`
   in the Zoho OAuth app's redirect URIs, then visit
   `https://svmiddleware-staging.up.railway.app/auth/zoho` (staff-auth) to seed staging's Redis
   token. Confirm `/auth/status` → `{"authenticated":true}`.
4. **Ping me** → I merge `feat/staging-mw-frontend-switch` → `main` → `git push origin main`, then
   we verify a cash sale end-to-end on `staging.steinsandvines.ca/kiosk.html`.

### After staging middleware is live
- **Merge the frontend branch:** I merge `feat/staging-mw-frontend-switch` → `main` → `git push origin main`.
  Now `staging.steinsandvines.ca/kiosk.html` talks to the staging middleware.
- **Verify cash tender** end-to-end on staging (the first real staging win). Then MOTO.
- **Test-data hygiene (Option B):** staging kiosk sales land in the live Zoho org with normal
  `KIOSK-…` references, so **void each test invoice right after**. *Optional hardening:* a
  `STAGING_MODE=true` env flag that makes the middleware prefix invoice notes/references
  (e.g. `STAGING-…`) for easy identification — small follow-up if manual voiding proves fiddly.

### Verification status (2026-08-19)
- **Cash tender (70): ✅ VERIFIED** end-to-end on staging.
- **MOTO / Phone Order (70): ✅ VERIFIED end-to-end.** On `staging.steinsandvines.ca/kiosk.html`,
  a $0.22 Phone Order ("Corks 1 1/2" + tax) confirmed:
  - `POST /api/kiosk/sale` (tender `moto`) → **HTTP 202** with a HelcimPay `checkout_token`.
  - HelcimPay iframe initializes (`helcim-pay-initializing`→`helcim-pay-initialized`) with the
    correct merchant + exact amount ($0.22 CAD).
  - **Decline/abort handling is correct:** on an ABORTED postMessage the kiosk returns cleanly
    to tender selection ("Payment cancelled — choose a tender to try again"), **no charge, no
    Zoho invoice, no orphan** (the WR-01 MOTO pending-charge record just TTL-expires).
  - **Success leg (verified 2026-08-19 with a real refundable card):** approved capture (Helcim
    txn `53442110`, APPROVED, $0.22 CAD) → `/api/kiosk/sale/confirm` → **HTTP 201** → Zoho
    **INV-000173** booked **status `paid`, total $0.22, balance $0** (payment #174, creditcard,
    ref = Helcim txn id). Captured-amount verify passed; **no underpayment** (tax path clean).
  - **Post-test cleanup (owner):** reverse/refund Helcim txn `53442110` in Helcim Hub, and
    delete payment #174 + void/delete INV-000173 in Zoho (Option B hygiene).
- **Helcim test-mode question RESOLVED (answers the open question below): NO.** Staging's
  `HELCIM_API_TOKEN` is the **live prod token** (Option B), and the live Helcim account has no
  sandbox mode. The documented sandbox card `4124 9399 9999 9990` is rejected:
  `"Transaction declined. INVALID CARD"`. Sandbox test cards from `docs/HELCIM-MIGRATION.md`
  only work against a real Helcim **sandbox account** (never provisioned).
- **To finish MOTO success-leg verification, pick one:**
  1. Run a **real** small refundable charge ($0.22) → verify Zoho booking → refund via Helcim
     `payment/refund` + void the invoice (owner declined this on 2026-08-19).
  2. Provision a separate Helcim **sandbox account** (per HELCIM-MIGRATION Phase 0) and point
     staging's `HELCIM_API_TOKEN` at it — then sandbox cards work with no real money.

## Open questions for the owner

- Zoho: separate test org (A) or same-org-with-cleanup (B)?
- ~~Does the Helcim plan allow a second webhook endpoint / a test mode for HelcimPay?~~
  **RESOLVED 2026-08-19 (test mode): NO** — staging's live `HELCIM_API_TOKEN` rejects sandbox
  cards ("INVALID CARD"). Second-webhook question (for terminal/collect) still open → Phase 2.
- OK to run staging on the same Helcim account (MOTO test charges → refunded), or get a
  Helcim test account? *(Owner declined a real refundable charge on 2026-08-19; a Helcim
  sandbox account is the clean path to finish the MOTO success-leg test.)*
