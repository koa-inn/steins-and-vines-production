# Deployment Runbook — Steins & Vines

## Overview

The project uses a two-repository deployment model with mandatory staging-first workflow.

| Component | Staging | Production |
|-----------|---------|------------|
| Frontend (static) | `koa-inn/steins-and-vines-staging` → GitHub Pages | `koa-inn/steins-and-vines-production` → GitHub Pages |
| Middleware (Express) | Railway (staging environment) | Railway (production environment) |
| Domain | `staging.steinsandvines.ca` | `steinsandvines.ca` |

---

## Pre-Deploy Checklist

Before deploying anything, verify:

1. All changes are committed and pushed
2. CI passes — unit tests (middleware + frontend) and E2E must be green
3. No console errors on the pages you changed (check browser DevTools)
4. If changing env vars: confirm they're set in Railway dashboard before deploying
5. If changing middleware routes: verify the corresponding frontend calls still work

---

## Deploying to Staging

### Frontend (GitHub Pages)

1. Run the build to minify CSS/JS and stamp cache-busting versions:
   ```bash
   npm run build
   ```
2. Commit the built files:
   ```bash
   git add css/*.min.css js/main.min.js js/admin.min.js js/kiosk.min.js js/brewpad.min.js js/batch.min.js sw.js
   git add index.html products.html reservation.html about.html contact.html ingredients.html admin.html kiosk.html brewpad.html batch.html
   git commit -m "Build: <description of changes>"
   ```
3. Push to the staging repo's `main` branch:
   ```bash
   git push origin main
   ```
4. GitHub Pages deploys automatically. Changes are live at `staging.steinsandvines.ca` within 1–2 minutes.

### Middleware (Railway)

Railway auto-deploys on push to the connected branch. If changes include middleware updates:

1. Push to the staging repo (same push as above — the middleware directory is part of the repo)
2. Railway detects the push and redeploys the `zoho-middleware/` service
3. Monitor the deployment in the Railway dashboard — check logs for startup errors
4. Verify the health endpoint: `curl https://staging-api.steinsandvines.ca/health`

---

## Verifying Staging

After deploying to staging, verify:

1. **Health check:** `curl https://staging-api.steinsandvines.ca/health` — should return `status: ok`, `authenticated: true`, `redis: true`
2. **Product catalog:** Visit `staging.steinsandvines.ca/products.html` — products should load
3. **Booking flow:** Visit `staging.steinsandvines.ca/reservation.html` — date picker should work
4. **Cart:** Add a product to cart → verify cart sidebar updates
5. **Checkout (if changed):** Use GP sandbox test card to complete a test checkout
6. **Run E2E tests:** `npm run test:e2e` (these hit the staging site automatically)

---

## Promoting to Production

Once staging is verified:

1. Add the production remote (if not already configured):
   ```bash
   git remote add production https://github.com/koa-inn/steins-and-vines-production.git
   ```
2. Push staging to production:
   ```bash
   git push production main --force
   ```
3. The `deploy-production.yml` GitHub Actions workflow builds and deploys the site. This workflow filters out pages that should be hidden on production (e.g., hops.html) before publishing.
4. The `enforce-cname.yml` workflow runs on every push and auto-corrects the custom domain if it drifts.
5. If middleware changes are involved: update Railway production environment to deploy the same commit.
6. Verify production health: `curl https://api.steinsandvines.ca/health`
7. Spot-check the live site: `steinsandvines.ca`

---

## Rolling Back

### Frontend Rollback

1. Identify the last known good commit:
   ```bash
   git log --oneline -10
   ```
2. Revert to that commit:
   ```bash
   git revert HEAD          # If reverting a single bad commit
   # OR
   git revert HEAD~N..HEAD  # If reverting multiple commits
   ```
3. Push the revert:
   ```bash
   git push origin main                # Staging
   git push production main --force    # Production (if promoted)
   ```

**Do not use `git reset --hard` or force-push** — this rewrites history and can cause issues for other collaborators.

### Middleware Rollback

1. In the Railway dashboard, go to the service's Deployments tab
2. Click on the previous successful deployment
3. Click "Redeploy" to restore the last working version
4. Alternatively, revert the code and push (same as frontend rollback)

---

## Custom Domain Management

Custom domains for GitHub Pages are managed via **GitHub Pages settings**, not a CNAME file.

- `CNAME` is in `.gitignore` — it is never committed or swapped during deploys.
- Each repo's domain is set once in its GitHub Pages settings:
  - **Staging:** `staging.steinsandvines.ca`
  - **Production:** `steinsandvines.ca`
- The `enforce-cname.yml` workflow runs on every push to either repo and auto-corrects the domain if it drifts.
- The domain `steinsandvines.ca` is verified under the `koa-inn` GitHub account (DNS TXT record: `_github-pages-challenge-koa-inn`).

### Production Page Filtering

The production repo uses Actions-based Pages deployment (`deploy-production.yml`) instead of legacy builds. This workflow removes pages that should not be public on production before publishing. To hide or unhide a page, edit the "Remove hidden pages" step in `.github/workflows/deploy-production.yml`.

Staging uses legacy GitHub Pages builds and publishes all pages as-is.

---

## Environment Variables

Environment variables are managed in the Railway dashboard. Never commit `.env` files.

When adding a new env var:
1. Add it to Railway staging first
2. Add a descriptive entry to `zoho-middleware/.env.example`
3. Deploy to staging and verify
4. Add the same var to Railway production when promoting

For a complete list of environment variables with descriptions, see `zoho-middleware/.env.example`.

---

## Cache Management

The middleware uses Redis caching for product catalogs, rate limiting, and idempotency keys.

- **Product cache:** Pre-warmed on startup and refreshed at 5 AM and 1 PM UTC daily via cron
- **Manual cache refresh:** Restart the Railway service (this triggers a fresh pre-warm on startup)
- **Rate limit counters:** Auto-expire based on window size (typically 60 seconds)
- **Idempotency keys:** Expire after 5 minutes

If Redis goes down, the middleware continues to function — rate limiting falls back to per-process memory, and catalog requests hit Zoho directly (slower, but functional).

---

## Monitoring

- **Sentry:** Errors and performance traces are sent to Sentry (if `SENTRY_DSN` is configured)
- **Railway logs:** Structured JSON logs with request ID, method, path, status, and latency
- **Health endpoint:** `GET /health` returns Zoho auth status, Redis connectivity, and uptime

---

## Common Issues

**"Not authenticated" errors after deploy:** The Zoho OAuth tokens are stored encrypted on disk. After a fresh Railway deploy, if the token file doesn't persist, visit `/auth/zoho` to re-authenticate.

**Products not loading:** Check if the Zoho rate limit was hit. The middleware logs `[cron]` messages for cache warm-up results. A 429 response triggers a 90-second cooldown.

**E2E tests failing after deploy:** E2E tests run against staging. If staging was just deployed, wait 1–2 minutes for GitHub Pages propagation, then re-run.

**Cache-busting not working:** Run `npm run build` locally — the stamp scripts update `?v=` query parameters on CSS/JS references in HTML files. Commit and push these changes.
