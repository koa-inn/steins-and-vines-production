# Production Deploy Runbook — Phase 70/71 money-path

**Drafted 2026-08-19.** Ships the staging-verified money-path work to production.
Execute top-to-bottom. The **force-push** and **`railway up`** steps are
irreversible, outward-facing production actions — do them deliberately, ideally
during low store traffic.

## What's shipping (all verified on staging)

- **Phase 70 — cash + MOTO kiosk tenders** (verified end-to-end on staging; MOTO with a real refundable charge).
- **Phase 71 — collect money-path** (`/api/pos/collect`; correct but note: no frontend caller — dead route, harmless).
- **`/api/kiosk/salesorder-pay` fix** — the *live* kiosk "pay an existing SO" route; now books against a finalized invoice (was `salesorders_to_apply` + draft).
- **Shared helper** `moneyPath.finalizeSalesOrderInvoiceAndApplyPayment` — both SO-payment paths route through it (no drift).
- Staging-infra + docs ride along (harmless on prod — see "Staging-flavored inclusions").

`origin/main` HEAD is exactly what staging ran and we verified. Ship that tree unchanged — **do not rebuild** (staging already served the committed artifacts).

## Divergence facts (why this needs `--force`, and why it's safe)

- `production/main` is at **`883800a4`** (phase 69 + a prod-only kiosk poll-timeout **orphan hotfix**). Save this SHA — it's the rollback point.
- `origin/main` is **59 commits ahead**; the only prod-only commit is `883800a4`.
- `883800a4^` is an ancestor of `origin/main`, and **main already contains the orphan fix as `485d8eff`** — its `kiosk-core.js` changes are **byte-identical** to `883800a4`. So a force-push replaces the hotfix *commit* but **preserves its content**. ✅
- Prod middleware currently runs ~phase 68 (`a4aec80`, deployed via manual `railway up`) — older than even `production/main`'s repo state. So the middleware **must be actively deployed**, not just pushed.

## ⚠️ Sequencing: middleware BEFORE frontend

The new frontend calls `/api/kiosk/sale` with `tender:'cash'|'moto'`, which the **current prod middleware rejects** (no phase-70 support). If the GitHub Pages frontend goes live before the Railway middleware, cash/MOTO sales break during the gap. **Deploy the middleware first, verify it, then push the frontend.**

---

## Pre-flight checklist

- [ ] On `main`, working tree clean: `git status` → clean; `git rev-parse main` matches `origin/main`.
- [ ] Tests green: `cd zoho-middleware && npm test` (1403) ; `npm test` (frontend, 1095) ; `npm run lint` (both).
- [ ] Railway CLI authed as the owner: `railway whoami`.
- [ ] Record rollback SHA: **`883800a4`** (current `production/main`).
- [ ] Announce/choose a low-traffic window (kiosk not mid-sale).

## Step 1 — Deploy the middleware to production (Railway)

From the repo root on `main`:

```bash
# Deploy local main's middleware to the PRODUCTION Railway env (explicit --environment)
railway up --environment production --service sv_middleware
```

Verify it's live and running the new code:

```bash
curl -s https://svmiddleware-production.up.railway.app/health
#   expect: {"status":"ok","authenticated":true,"redis":true,"uptime":<small>}   (uptime reset = new deploy)
```

- [ ] `/health` → `authenticated:true`, `redis:true`, uptime reset.
- [ ] (optional sanity) tail logs: `railway logs --environment production --service sv_middleware` — no boot errors.

No new env vars or Zoho re-auth needed — production already has the full secret set + seeded Zoho token; the new code uses existing HELCIM/ZOHO config.

## Step 2 — Deploy the frontend (GitHub Pages)

```bash
git push production main --force            # or --force-with-lease
```

This updates the production repo's `main` → GitHub Pages rebuilds `steinsandvines.ca`; the `enforce-cname.yml` workflow re-asserts the domain. (It also nudges Railway, redundant with Step 1.)

- [ ] Push succeeded; GitHub Actions (Pages build + enforce-cname) green.
- [ ] `steinsandvines.ca/kiosk.html` loads; `enforce-cname` didn't flag a domain mismatch.

## Step 3 — Post-deploy verification (on the store's real hardware)

- [ ] **Cash sale** (safest — no card): kiosk → add cheap item → Charge → **Cash** → complete. Confirm a **paid** invoice appears in Zoho. (This exercises the phase-70 cash path on prod middleware.)
- [ ] **Card sale** (small, real): kiosk terminal sale → confirm paid invoice books; refund after if desired.
- [ ] **Pay an existing SO at the kiosk** (`salesorder-pay`, the key fix): create/pick a small test SO → pay at terminal → confirm the SO's invoice is **finalized + paid**, no draft/unapplied advance. (This is the path that was silently broken.)
- [ ] Reverse/void any real test charges + void the test Zoho records (Option-B hygiene).

## Rollback

**Frontend:** re-point production `main` to the pre-deploy SHA:
```bash
git push production 883800a4:main --force
```
**Middleware:** either redeploy the old code (`railway up` from a `883800a4` checkout) or use Railway's dashboard → the `sv_middleware` production service → **Rollback** to the previous deployment (Railway retains deploy history).

Do both if reverting — the frontend and middleware are independent systems.

## Staging-flavored inclusions (ride along; both harmless on prod)

- **`sheets-config.js` hostname switch** (`2fe74f2e`): routes by hostname — on the prod domain it resolves to the prod middleware (fail-safe default). No-op on prod; arguably good (keeps frontends identical).
- **CSP staging-origin** (`da63aca7`): adds `svmiddleware-staging.up.railway.app` to `connect-src` on all public pages, prod included. Additive (prod origin unchanged) — a minor CSP loosening, not a functional change. *Optional:* if you want a pure prod CSP, revert this one line on a follow-up commit (creates a small prod/staging frontend divergence).

## Open follow-ups (not blockers)

- Helcim refund of test txn `53442110` ($0.22) in Helcim Hub.
- `salesorder-pay` real-terminal path was not drivable on staging (terminal-gated); it rides the shared helper proven e2e via the collect replay + unit tests. Step 3's SO-pay check is its first real-terminal exercise — watch it.
- Consider deleting the dead `/api/pos/collect` route (or wiring the frontend to it) in a later cleanup — currently unused.
