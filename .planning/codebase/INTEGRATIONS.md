# External Integrations

**Analysis Date:** 2026-04-27

## APIs & External Services

### Zoho Suite (Primary Business Platform)

**Zoho Books (Accounting):**
- Purpose: Sales orders, customer payments, contacts, invoices, tax rules
- SDK/Client: `axios` via `zoho-middleware/lib/zoho-api.js` (`zohoGet`, `zohoPost`, `zohoPut`)
- API Base: `https://www.zohoapis.com/books/v3` (configurable by `ZOHO_DOMAIN`)
- Auth: OAuth 2.0 with refresh token auto-renewal (`zoho-middleware/lib/zohoAuth.js`)
- Auth env vars: `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_ORG_ID`, `ZOHO_REDIRECT_URI`
- Routes using it: `zoho-middleware/routes/checkout.js`, `zoho-middleware/routes/taxes.js`, `zoho-middleware/routes/items.js`, `zoho-middleware/routes/bookings.js`, `zoho-middleware/routes/collect.js`, `zoho-middleware/routes/consignment.js`, `zoho-middleware/routes/purchaseorders.js`
- Rate limit handling: Exponential backoff with retry in `zoho-api.js` `withRetry()`, special handling for Zoho error codes 44 (per-minute), 45 (daily quota), 1070 (concurrency)

**Zoho Inventory:**
- Purpose: Product catalog, stock levels, item details
- SDK/Client: Same `axios` wrapper (`inventoryGet`, `inventoryPost`, `inventoryPut`)
- API Base: `https://www.zohoapis.com/inventory/v1`
- Used by: `zoho-middleware/routes/catalog.js` (product listing/enrichment), `zoho-middleware/lib/zoho-api.js` (`fetchAllItems`, `fetchItemDetailsBulk`)
- Pagination: Auto-paginated up to 50 pages (10,000 items) via `fetchAllItems()`

**Zoho Bookings:**
- Purpose: Appointment scheduling (timeslots, availability)
- SDK/Client: Same `axios` wrapper (`bookingsGet`, `bookingsPost`)
- API Base: `https://www.zohoapis.com/bookings/v1/json`
- Used by: `zoho-middleware/routes/bookings.js`
- Env vars: `ZOHO_BOOKINGS_SERVICE_ID`, `ZOHO_BOOKINGS_STAFF_ID`

**Zoho OAuth Flow:**
- Implementation: `zoho-middleware/lib/zohoAuth.js`
- Routes: `/auth/zoho` (redirect to consent), `/auth/zoho/callback` (code exchange), `/auth/status`
- Token lifecycle: Access token refreshed ~5 min before expiry, refresh token stored encrypted in Redis (AES-256-GCM via `REDIS_ENCRYPTION_KEY`)
- Multi-instance: Distributed refresh lock in Redis prevents concurrent token refresh across Railway instances
- State: CSRF protection with `crypto.randomBytes(16)`, stored in Redis with 10-min TTL

### Helcim (Payment Processor -- Active)

**HelcimPay.js (Online Checkout):**
- Purpose: Accept online card payments via iframe
- SDK/Client: `axios` via `zoho-middleware/lib/helcim.js`
- API Base: `https://api.helcim.com/v2`
- Flow: Frontend calls `POST /api/payment/initialize` -> middleware gets `checkoutToken` -> frontend renders HelcimPay.js iframe -> payment result via `window.postMessage` -> frontend submits order with `transaction_id` to `POST /api/checkout`
- Route: `zoho-middleware/routes/payments.js` (`POST /api/payment/initialize`, `POST /api/payment/void`, `POST /api/payment/refund`)
- Env vars: `HELCIM_API_TOKEN`
- Idempotency: 25-char alphanumeric key generated per request

**Helcim Smart Terminal (In-Store Kiosk):**
- Purpose: Card-present payments on physical terminal
- API: `POST /v2/devices/{deviceCode}/payment/purchase`
- Flow: Kiosk initiates terminal purchase -> Helcim sends result via webhook -> kiosk polls for result
- Polling fallback: `GET /v2/card-transactions?invoiceNumber={ref}` (used when webhook is delayed)
- Env vars: `HELCIM_DEVICE_CODE`
- Used by: `zoho-middleware/routes/pos.js`, `zoho-middleware/routes/collect.js`

**Helcim Webhooks:**
- Endpoint: `POST /api/webhooks/helcim` (`zoho-middleware/routes/webhooks.js`)
- Events handled: `cardTransaction` (purchase/refund/void), `terminalCancel`
- Verification: HMAC-SHA256 with `HELCIM_WEBHOOK_SECRET` (fail-open if not configured)
- Terminal results cached in Redis for kiosk polling (5-min TTL)
- Collect flow: Webhook auto-records Zoho customer payment when terminal purchase for existing SO is approved

### Global Payments (Legacy -- Inactive)

- Purpose: Former payment processor (replaced by Helcim Apr 2026)
- SDK: `globalpayments-api ^3.10.10` - Still in `package.json` dependencies
- Implementation: `zoho-middleware/lib/gp.js`
- Status: Dependency present but Helcim is the active processor. GP contract locked until ~Jan 2027.
- Env vars (unused): `GP_ENVIRONMENT`, `GP_APP_ID`, `GP_APP_KEY`, `GP_MERCHANT_ID`, `GP_TERMINAL_ENABLED`, `GP_DEPOSIT_AMOUNT`

### Google Services

**Google Identity Services (OAuth 2.0 -- Staff Auth):**
- Purpose: Staff authentication for admin, kiosk, brewpad, batch pages
- Client: Google Identity Services library loaded via `<script>` tag on staff pages
- Implementation: `js/lib/auth.js` (`waitForGoogleIdentity`, `gsiInitTokenClient`, `fetchGoogleUserInfo`)
- OAuth Client ID: Configured in `js/sheets-config.js` (`SHEETS_CONFIG.CLIENT_ID`)
- Scope: `https://www.googleapis.com/auth/spreadsheets` (for Google Sheets read/write)
- Authorization: Server-side via Apps Script `Session.getActiveUser().getEmail()` checked against `Config` sheet staff_emails list

**Google Apps Script (Backend for Admin):**
- Purpose: Batch tracking CRUD, admin data management, event tracking
- Scripts: `apps-script/adminApi.gs` (admin API), `apps-script/trackEvent.gs` (product event tracking), `apps-script/onFormSubmit.gs`, `apps-script/backup.gs`
- Deployment: Web App ("Execute as: User accessing the web app")
- Endpoints:
  - `SHEETS_CONFIG.FEATURED_API_URL` - Public featured products endpoint
  - `SHEETS_CONFIG.TRACK_EVENTS_URL` - Anonymous product event tracking
  - `ADMIN_API_URL` (loaded from `js/admin-config.js`, staff pages only)
- Auth: `APPS_SCRIPT_SERVER_TOKEN` for server-to-server calls from middleware
- Data sheets: Batches, FermSchedules, BatchTasks, PlatoReadings, VesselHistory, Config, Reservations, Holds, Schedule, Homepage, Kits

**Google Sheets (Published CSV Fallback):**
- Purpose: Fallback product data when Zoho/middleware unavailable
- URLs configured in `js/sheets-config.js`:
  - `PUBLISHED_CSV_URL` - Kits tab
  - `PUBLISHED_INGREDIENTS_CSV_URL` - Ingredients tab
  - `PUBLISHED_SERVICES_CSV_URL` - Services tab
  - `PUBLISHED_SCHEDULE_CSV_URL` - Schedule tab
  - `PUBLISHED_HOMEPAGE_CSV_URL` - Homepage tab
- Spreadsheet ID: `10BzcANc_-dyS-Is_C4He7mMYHfJ2OSJS9V4p7D-1JrM`

**Google reCAPTCHA v3:**
- Purpose: Bot protection on checkout
- Client-side: `js/modules/12a-checkout-validation.js` (`getRecaptchaToken()`)
- Server-side: `zoho-middleware/lib/checkout-helpers.js` (`verifyRecaptcha()`)
- Env vars: `RECAPTCHA_SECRET_KEY` (server), `SHEETS_CONFIG.RECAPTCHA_SITE_KEY` (client)
- Behavior: Fail-open if `RECAPTCHA_SECRET_KEY` not set (startup warning logged)
- Site key: `6LerSH0sAAAAAGKtltFqN5fu2w8opPV5BStdzNDu`

**Google Tag Manager:**
- Purpose: Analytics and tracking
- Container ID: `GTM-NHRCGLC5`
- Installed on: 8 public pages (index, products, ingredients, reservation, about, contact, plus products/ subdirectory pages)
- Excluded from: admin.html, kiosk.html, batch.html, brewpad.html (staff pages)
- Implementation: Head snippet + body noscript fallback

## Data Storage

**Redis (Primary Cache Layer):**
- Client: `redis ^5.10.0` via `zoho-middleware/lib/cache.js`
- Connection: `REDIS_URL` env var (default: `redis://localhost:6379`)
- Reconnect strategy: Up to 10 retries with exponential backoff (500ms-5s)
- Graceful degradation: All cache operations are no-ops when Redis is unavailable; API calls fall through to Zoho directly

**Redis key namespaces** (defined in `zoho-middleware/lib/constants.js`):
| Prefix | Purpose | TTL |
|--------|---------|-----|
| `zoho:products` | Cached product catalog | Set by catalog.js |
| `zoho:ingredients` | Cached ingredient catalog | Set by catalog.js |
| `zoho:kiosk-products` | Kiosk product cache | 5 min |
| `zoho:services:v2` | Services catalog | Set by catalog.js |
| `zoho:refresh_token` | Encrypted Zoho refresh token | 90 days |
| `zoho:access-token` | Current Zoho access token | ~55 min |
| `zoho:oauth-state:*` | CSRF state for OAuth flow | 10 min |
| `zoho:contact:email:*` | Contact lookup cache | Set by checkout.js |
| `zoho:availability:*` | Booking availability per date | 5 min |
| `checkout:idem:*` | Checkout idempotency guard | 10 min |
| `kiosk:idem:*` | Kiosk sale idempotency | 10 min |
| `collect:idem:*` | Collect payment idempotency | Set by collect.js |
| `collect:pending:*` | Pending terminal collect context | Set by collect.js |
| `helcim:terminal:result:*` | Terminal payment results from webhook | 5 min |
| `inv:stock:*` | Inventory ledger shadow stock | 2 hours |
| `rl:*` | Rate limit counters | 60s |
| `lock:*` | Distributed locks (refresh, etc.) | 30s |

**Inventory Ledger** (`zoho-middleware/lib/inventory-ledger.js`):
- Purpose: Real-time Redis stock shadow layer, decrements immediately on checkout
- Feature flag: `INVENTORY_LEDGER_ENABLED=true` env var
- Reconciles with Zoho on every product fetch

**File Storage:**
- Product images: `images/products/{sku}.png` (local, synced via `zoho-middleware/scripts/sync-images.js`)
- Content JSON: `content/*.json` (committed to repo)
- Product snapshots: `content/zoho-snapshot.json` (generated by `npm run snapshot`)

**No external database** -- Zoho Books/Inventory is the system of record; Redis is cache-only; Google Sheets stores batch tracking and admin config data.

## Authentication & Identity

**Staff Authentication:**
- Provider: Google OAuth 2.0 via Google Identity Services
- Implementation: `js/lib/auth.js` (frontend), `apps-script/adminApi.gs` (server-side validation)
- Flow: Staff signs in with Google account -> token used to call Apps Script -> Apps Script checks email against `Config` sheet staff_emails list
- Pages requiring auth: `admin.html`, `kiosk.html`, `brewpad.html`, `batch.html`

**Zoho API Authentication:**
- Provider: Zoho OAuth 2.0
- Implementation: `zoho-middleware/lib/zohoAuth.js`
- Scopes: `ZohoBooks.fullaccess.all`, `ZohoInventory.fullaccess.all`, `zohobookings.data.CREATE`, `zohobookings.data.READ`
- Refresh token encrypted at rest (AES-256-GCM) when `REDIS_ENCRYPTION_KEY` is set
- Auto-refresh: Scheduled ~5 min before expiry, distributed lock prevents concurrent refresh

**Frontend-to-Middleware Auth:**
- API key: `MW_API_KEY` in `js/sheets-config.js` matches `API_SECRET_KEY` on Railway
- Sent as `x-api-key` header on mutating (POST/PUT/DELETE) requests
- CORS origin whitelist: `steinsandvines.ca`, `staging.steinsandvines.ca`, `localhost:3001`, `localhost:8080`
- Referer guard: `requireAllowedReferer()` in `zoho-middleware/server.js` (skipped for `/checkout` which uses reCAPTCHA instead)
- Public exception: `POST /api/checkout` protected by reCAPTCHA + rate limit instead of API key

**Kiosk Access:**
- PIN verification: `KIOSK_PIN` env var, rate limited to 5 attempts/min

**Batch Page (Public):**
- Token-based: 32-char hex token in URL query param (`batch.html?id=SV-B-000001&token=xxx`)

## Monitoring & Observability

**Error Tracking:**
- Sentry (`@sentry/node ^10.42.0`) - Middleware only
- Conditional: Only initialized when `SENTRY_DSN` env var is set
- Express error handler installed after routes in `zoho-middleware/server.js`
- Sample rate: 10% (`tracesSampleRate: 0.1`)

**Logging:**
- Custom structured logger: `zoho-middleware/lib/logger.js`
- Production: Newline-delimited JSON for Railway log aggregator (`{"ts":"...","level":"info","msg":"...",...}`)
- Development: Human-readable (`12:34:56.789 [INFO ] msg`)
- Event logging: `zoho-middleware/lib/eventLog.js` (`logEvent(type, data)`) -- zero PII policy
- Event types: `checkout.completed`, `helcim.webhook_received`, `helcim.card_transaction`, `helcim.terminal_cancel`, `collect.payment_recorded`, `collect.payment_declined`

**Health Check:**
- Endpoint: `GET /health` in `zoho-middleware/server.js`
- Returns: `{ status, authenticated, redis, uptime }`
- Used by: Railway health monitoring

## Email (SMTP)

**Provider:** Gmail SMTP (configurable)
- Implementation: `nodemailer` in `zoho-middleware/lib/mailer.js` and inline in `server.js` (contact form)
- Host: `SMTP_HOST` (default: `smtp.gmail.com`)
- Port: `SMTP_PORT` (default: `587`, STARTTLS)
- Auth: `SMTP_USER`, `SMTP_PASS` (Gmail App Password)
- Recipient: `CONTACT_TO` (default: `hello@steinsandvines.ca`)

**Email types:**
1. Contact form submissions (`POST /api/contact` in `server.js`)
2. Offline order notifications (`mailer.sendOfflineOrderNotification()` -- when Zoho is unavailable)
3. Online reservation confirmations (`mailer.sendReservationNotification()`)
4. Void failure alerts (`mailer.sendVoidFailureAlert()` -- requires manual action)

## CI/CD & Deployment

**Frontend Hosting:**
- Platform: GitHub Pages
- Two separate repositories, two domains:
  - `origin` -> `koa-inn/steins-and-vines-staging` -> `staging.steinsandvines.ca`
  - `production` -> `koa-inn/steins-and-vines-production` -> `steinsandvines.ca`
- Domain controlled by `CNAME` file at repo root

**Middleware Hosting:**
- Platform: Railway
- Config: `railway.toml` at project root
- Build: `cd zoho-middleware && npm install --production`
- Start: `cd zoho-middleware && node server.js`
- URL: `svmiddleware-production.up.railway.app`
- Services: Express app + Redis (separate Railway service)

**CI Pipeline:**
- GitHub Actions: `.github/workflows/tests.yml`
- Runs on push to `main` and pull requests
- Jobs: middleware tests + lint + audit, frontend tests + lint + audit, E2E (main only)
- Additional workflow: `.github/workflows/update-snapshot.yml`

## Scheduled Tasks

**Cache Warm-up (Cron):**
- Schedule: 5:00 AM and 1:00 PM UTC daily
- Implementation: `node-cron` in `zoho-middleware/server.js`
- Sequence: Products first, then ingredients 60s later (avoids Zoho rate-limit burst)
- Condition: Only runs if Zoho is authenticated

**Startup Pre-warm:**
- On server start (if Zoho authenticated): Products cache, then ingredients cache (sequential)

## Webhooks & Callbacks

**Incoming:**
- `POST /api/webhooks/helcim` - Helcim payment events (cardTransaction, terminalCancel)
  - HMAC-SHA256 signature verification via `HELCIM_WEBHOOK_SECRET`
  - Processes terminal results and collect-flow payment recording

**Outgoing:**
- Apps Script `notifyAdminPanel()` calls in `zoho-middleware/lib/checkout-helpers.js` -- notifies admin panel of new orders
- Product event tracking to `SHEETS_CONFIG.TRACK_EVENTS_URL` (anonymous, from frontend)

## OAuth Callbacks

- `/auth/zoho/callback` - Zoho OAuth code exchange after user grants access
  - CSRF: State param stored in Redis with 10-min TTL, validated on callback

## Environment Configuration

**Required env vars (fatal if missing):**
- `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_ORG_ID`
- `API_SECRET_KEY` (or `MW_API_KEY` alias)

**Critical optional env vars:**
- `REDIS_URL` - Redis connection (degrades to no cache without it)
- `HELCIM_API_TOKEN` - Payment processing (503 errors without it)
- `HELCIM_DEVICE_CODE` - In-store terminal (terminal disabled without it)
- `RECAPTCHA_SECRET_KEY` - Bot protection (fail-open without it)
- `SENTRY_DSN` - Error tracking (disabled without it)
- `SMTP_USER`, `SMTP_PASS` - Email notifications (email disabled without it)
- `REDIS_ENCRYPTION_KEY` - 64-char hex, encrypts Zoho refresh token at rest
- `ZOHO_REFRESH_TOKEN` - Can be set via `/auth/zoho` flow instead
- `APPS_SCRIPT_URL`, `APPS_SCRIPT_SERVER_TOKEN` - Admin panel integration

**Secrets location:**
- Railway environment variables (production)
- `.env` file (local development, never committed)
- `js/sheets-config.js` (semi-public keys: OAuth client ID, API key, reCAPTCHA site key)

---

*Integration audit: 2026-04-27*
