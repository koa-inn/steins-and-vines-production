# Technology Stack

**Analysis Date:** 2026-04-27

## Languages

**Primary:**
- JavaScript (ES5 style with `var`) - Frontend (browser), all files in `js/modules/`, `js/lib/`, `js/admin.js`, `js/kiosk.js`, `js/brewpad.js`, `js/batch.js`
- JavaScript (Node.js, mix of ES5 `var` and selective `async/await`) - Middleware in `zoho-middleware/`
- Google Apps Script - Batch tracking and admin API in `apps-script/adminApi.gs`, `apps-script/trackEvent.gs`, `apps-script/onFormSubmit.gs`, `apps-script/backup.gs`

**Secondary:**
- HTML5 - Static pages at project root (`index.html`, `products.html`, `admin.html`, etc.)
- CSS3 - Stylesheets in `css/styles.css`, `css/admin.css`, `css/batch.css`, `css/kiosk.css`, `css/brewpad.css`
- JSON - Content data in `content/*.json`, configuration in `js/sheets-config.js`
- CSV - Fallback product data in `content/*.csv`

## Runtime

**Frontend:**
- Static HTML/JS/CSS served via GitHub Pages (no server-side rendering)
- Service worker `sw.js` (currently self-unregistering -- clears caches on activate)
- PWA manifest at `manifest.json`

**Backend:**
- Node.js 20 (CI enforced via `.github/workflows/tests.yml` `node-version: '20'`)
- Express.js application entry: `zoho-middleware/server.js`
- Production deployed on Railway

**Package Manager:**
- npm
- Lockfile: `package-lock.json` present at root and in `zoho-middleware/`

## Frameworks

**Core:**
- Express `^4.21.2` - HTTP server framework (`zoho-middleware/server.js`)
- Vanilla JS (no frontend framework) - All client-side code is plain ES5 JavaScript

**Testing:**
- Jest `^29.7.0` - Unit tests for both frontend (jsdom) and middleware (node)
- Playwright `^1.58.2` - E2E tests against staging site
- jest-environment-jsdom `^29.7.0` - Browser DOM simulation for frontend tests

**Build/Dev:**
- terser `^5.31.0` - JS minification (`js/main.js` -> `js/main.min.js`)
- clean-css-cli `^5.6.3` - CSS minification (`css/styles.css` -> `css/styles.min.css`)
- ESLint `^9.39.4` - Linting (flat config at `eslint.config.js` and `zoho-middleware/eslint.config.js`)
- sharp `^0.33.0` - Image optimization (`scripts/optimize-images.js`)

**Monitoring:**
- Sentry `@sentry/node ^10.42.0` - Error tracking (middleware only, conditional on `SENTRY_DSN`)

## Key Dependencies

### Frontend (root `package.json` devDependencies)

| Package | Version | Purpose |
|---------|---------|---------|
| `@playwright/test` | `^1.58.2` | E2E testing framework |
| `clean-css-cli` | `^5.6.3` | CSS minification |
| `eslint` | `^9.39.4` | JavaScript linting |
| `jest` | `^29.7.0` | Unit test runner |
| `jest-environment-jsdom` | `^29.7.0` | DOM simulation for frontend tests |
| `sharp` | `^0.33.0` | Image optimization |
| `terser` | `^5.31.0` | JS minification |

### Middleware (`zoho-middleware/package.json`)

**Production dependencies:**

| Package | Version | Purpose |
|---------|---------|---------|
| `@sentry/node` | `^10.42.0` | Error tracking and performance monitoring |
| `axios` | `^1.13.5` | HTTP client for Zoho and Helcim API calls |
| `cors` | `^2.8.5` | CORS middleware with origin whitelist |
| `dotenv` | `^16.4.7` | Environment variable loading from `.env` |
| `express` | `^4.21.2` | HTTP server framework |
| `express-rate-limit` | `^8.2.1` | Rate limiting with Redis-backed store |
| `globalpayments-api` | `^3.10.10` | Global Payments SDK (legacy, Helcim is active) |
| `helmet` | `^8.1.0` | Security headers |
| `node-cron` | `^3.0.3` | Scheduled cache warm-up (5 AM and 1 PM UTC) |
| `nodemailer` | `^8.0.1` | Email sending (contact form, order notifications, void alerts) |
| `redis` | `^5.10.0` | Redis client for caching, rate limiting, auth tokens, inventory ledger |

**Dev dependencies:**

| Package | Version | Purpose |
|---------|---------|---------|
| `eslint` | `^9.39.4` | JavaScript linting |
| `jest` | `^29.7.0` | Unit test runner |

## Build System

**Build command:** `npm run build`

**Build pipeline (sequential):**
1. `stamp` - Updates `BUILD_TIMESTAMP` in `js/admin.js`
2. `stamp:admin` - Cache-busts `admin.html` asset references
3. `stamp:kiosk` - Cache-busts `kiosk.html` asset references
4. `stamp:brewpad` - Cache-busts `brewpad.html` asset references
5. `stamp:index` - Cache-busts `index.html` asset references
6. `stamp:pages` - Cache-busts all public page asset references
7. `minify:css` - Minifies 5 CSS files via clean-css-cli
8. `minify:js` - Concatenates 15 JS modules into `js/main.js`, then minifies via terser (also minifies admin, batch, kiosk, brewpad)

**JS concatenation order** (defined in `concat:js` script):
```
js/lib/constants.js -> js/modules/01-config.js -> 02-utils.js -> 03-events.js ->
04-label-cards.js -> 05-catalog-view.js -> 06-featured.js -> 07-catalog-kits.js ->
08-catalog-ingredients.js -> 09-catalog-services.js -> 10-tabs.js -> 11-cart.js ->
12a-checkout-validation.js -> 12c-checkout-scheduling.js -> 12-checkout.js ->
13-init.js  =>  js/main.js  =>  js/main.min.js
```

**Build artifacts (never edit directly):**
- `js/main.js` - Concatenated bundle
- `js/main.min.js` - Minified bundle
- `js/admin.min.js`, `js/batch.min.js`, `js/kiosk.min.js`, `js/brewpad.min.js`
- `css/styles.min.css`, `css/admin.min.css`, `css/batch.min.css`, `css/kiosk.min.css`, `css/brewpad.min.css`

## Configuration

**Frontend config (semi-public):**
- `js/sheets-config.js` - Google Sheets IDs, OAuth client ID, middleware URL, API key, reCAPTCHA site key, published CSV URLs, Apps Script endpoints
- `js/modules/01-config.js` - Payment flag (`PAYMENT_DISABLED`), reads `MW_API_KEY` and `RECAPTCHA_SITE_KEY` from `SHEETS_CONFIG`
- `js/lib/constants.js` - Cart keys, item types, product tabs, kit categories

**Middleware config:**
- `.env` file (never committed) - All secrets and configuration
- `zoho-middleware/lib/validateEnv.js` - Validates 4 required + ~40 optional env vars at startup

**Required env vars (middleware fails to start without these):**
- `ZOHO_CLIENT_ID` - Zoho OAuth client ID
- `ZOHO_CLIENT_SECRET` - Zoho OAuth client secret
- `ZOHO_ORG_ID` - Zoho organization ID
- `API_SECRET_KEY` (or `MW_API_KEY` alias) - Shared secret for authenticated endpoints

**Content system:**
- `content/shared.json` - Shared content values loaded on all pages
- `content/{page}.json` - Page-specific content (e.g., `content/home.json`)
- `content/zoho-snapshot.json` - Offline product snapshot (fallback)
- `content/*.csv` - Published Google Sheets CSV fallbacks

## Platform Requirements

**Development:**
- Node.js 20+
- npm
- Redis (optional -- middleware degrades gracefully without it)
- Access to Google Cloud project for OAuth client ID
- Zoho OAuth credentials for middleware authentication

**Production - Frontend:**
- GitHub Pages (two repos: staging and production)
- Custom domains: `steinsandvines.ca` (production), `staging.steinsandvines.ca` (staging)
- `CNAME` file at project root controls which domain GitHub Pages serves

**Production - Middleware:**
- Railway (PaaS)
- Redis service on Railway
- Build command: `cd zoho-middleware && npm install --production`
- Start command: `cd zoho-middleware && node server.js`
- Config: `railway.toml` at project root

## CI/CD

**GitHub Actions:** `.github/workflows/tests.yml`

**Jobs:**
1. `test-middleware` - Install, test, lint, and audit `zoho-middleware/`
2. `test-frontend` - Install, test, lint, and audit root project
3. `test-e2e` - Playwright against staging (push to main only, after unit tests pass)

**Triggers:** Push to `main`, pull requests

**Deployment:**
- Staging: `git push origin main` -> GitHub Pages at `staging.steinsandvines.ca`
- Production: `git push production main` -> GitHub Pages at `steinsandvines.ca`
- Middleware: Railway auto-deploys from `production` remote

---

*Stack analysis: 2026-04-27*
