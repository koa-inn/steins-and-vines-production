# Steins & Vines

E-commerce website for Steins & Vines — a Canadian ferment-in-store winery and brewing supplies retailer. Customers can browse products, book fermentation appointments, and check out online with card payments.

## Tech Stack

**Frontend:** Static HTML, vanilla JavaScript (ES5), CSS — served via GitHub Pages

**Middleware:** Express.js on Railway — bridges the frontend to Zoho APIs and handles payments

**Integrations:** Zoho Books + Inventory + Bookings, Helcim (online checkout + Smart Terminal), Redis (caching, rate limiting, idempotency), Sentry (error tracking), Google Apps Script (event analytics, Sheets)

## Project Structure

```
steins-and-vines/
├── index.html                  # Homepage
├── products.html               # Product catalog
├── reservation.html            # Booking / fermentation appointments
├── contact.html                # Contact form
├── ingredients.html            # Brewing ingredients catalog
├── about.html                  # About page
├── admin.html                  # Internal admin panel
├── kiosk.html                  # In-store POS kiosk
├── brewpad.html                # Brew day tracking tool
├── batch.html                  # Public batch tracker
├── 404.html                    # Error page
│
├── products/                   # Product-specific landing pages
│   ├── ferment-in-store.html
│   └── ingredients-supplies.html
│
├── scripts/                    # Build and maintenance scripts (optimize-images, etc.)
├── content/                    # Static JSON content files (products, services, home, etc.)
├── apps-script/                # Google Apps Script source files (.gs)
│
├── js/
│   ├── modules/                # Modular frontend JS (01-config through 13-init)
│   │   ├── 01-config.js        # API base URL, feature flags
│   │   ├── 02-utils.js         # escapeHTML, parseCSVLine, helpers
│   │   ├── 03-events.js        # Anonymous analytics via sendBeacon
│   │   ├── 04-label-cards.js   # Product card rendering
│   │   ├── 05-catalog-view.js  # Grid/list view toggle
│   │   ├── 06-featured.js      # Featured products section
│   │   ├── 07-catalog-kits.js  # Fermentation kit catalog
│   │   ├── 08-catalog-ingredients.js  # Ingredients catalog
│   │   ├── 09-catalog-services.js     # Services catalog
│   │   ├── 10-tabs.js          # Tab switching logic
│   │   ├── 11-cart.js          # Cart management (localStorage)
│   │   ├── 12-checkout.js      # Checkout flow (orchestrator)
│   │   ├── 12a-checkout-validation.js  # Checkout input validation helpers
│   │   ├── 12c-checkout-scheduling.js  # Scheduling / timeslot helpers
│   │   └── 13-init.js          # App initialization
│   ├── main.js                 # Concatenated bundle (built)
│   ├── main.min.js             # Minified bundle (built)
│   ├── admin.js                # Admin panel logic
│   ├── admin-config.js         # Admin panel configuration constants
│   ├── kiosk.js                # POS kiosk logic
│   ├── brewpad.js              # Brew tracking logic
│   ├── batch.js                # Batch tracker logic
│   ├── sentry-init.js          # Sentry browser SDK init
│   ├── sheets-config.js        # Google Sheets integration config
│   ├── sheets-config.example.js  # Example Sheets config (template)
│   ├── lib/                    # Shared frontend utilities (pre-pended to build)
│   │   ├── constants.js        # App-wide constants (cart keys, config)
│   │   ├── utils.js            # Shared utility helpers
│   │   └── auth.js             # Auth helpers (kiosk/admin API key)
│   └── vendor/                 # Third-party JS libraries
│
├── css/                        # Stylesheets (source + minified)
├── images/                     # Product and brand images
├── sw.js                       # Service worker (offline caching)
│
├── zoho-middleware/             # Express API server
│   ├── server.js               # App entry point, middleware chain, route mounting
│   ├── routes/
│   │   ├── auth.js             # Zoho OAuth + payment config
│   │   ├── bookings.js         # Appointment availability + booking creation
│   │   ├── catalog.js          # Product/ingredient/service catalog (cached)
│   │   ├── checkout.js         # Checkout flow (reCAPTCHA, price anchoring, charge)
│   │   ├── collect.js          # Collect payment on existing SO via terminal (Deluge-triggered)
│   │   ├── consignment.js      # Consignment sales report (artisan payout aggregation)
│   │   ├── discounts.js        # Kiosk discount preset CRUD (stored in Redis)
│   │   ├── items.js            # Zoho item CRUD + image proxy
│   │   ├── payments.js         # Payment void + refund
│   │   ├── pos.js              # Kiosk + POS terminal sale + salesorder endpoints
│   │   ├── promo.js            # Promo code validation + per-email redemption tracking
│   │   ├── purchaseorders.js   # Purchase order management
│   │   ├── requests.js         # Product request form
│   │   ├── taxes.js            # Tax classification + Zoho tax rules
│   │   └── webhooks.js         # Helcim webhook receiver
│   ├── client/                 # Client-side helpers (Helcim integration, React hooks)
│   ├── lib/
│   │   ├── brewpad-integration.js  # Brew day batch creation triggered by kit sales
│   │   ├── cache.js            # Redis wrapper (connect, get, set, del)
│   │   ├── checkRedis.js       # Redis health check helper
│   │   ├── checkout-helpers.js # Checkout/booking HTTP helpers (services snapshot, timeslot fetch)
│   │   ├── constants.js        # Shared cache keys + config constants
│   │   ├── eventLog.js         # Lightweight event audit logger
│   │   ├── gp.js               # Global Payments SDK init (CNP + terminal)
│   │   ├── helcim.js           # Helcim API client + webhook verification
│   │   ├── inventory-ledger.js # In-memory inventory adjustment ledger
│   │   ├── logger.js           # Structured logging wrapper
│   │   ├── mailer.js           # Nodemailer (order + reservation + void alerts)
│   │   ├── pricing.js          # Server-side price anchoring helpers
│   │   ├── validate.js         # Input validation helpers
│   │   ├── validateEnv.js      # Startup env var validation
│   │   ├── zoho-api.js         # Zoho API helpers with retry + pagination
│   │   └── zohoAuth.js         # Zoho OAuth2 flow, token encryption, auto-refresh
│   ├── openapi.yaml            # OpenAPI 3.0 spec for the middleware API
│   └── __tests__/              # Middleware unit tests
│
├── tests/
│   ├── frontend/               # Frontend unit tests (Jest + jsdom)
│   └── e2e/                    # End-to-end tests (Playwright)
│
├── .github/workflows/
│   ├── tests.yml               # CI pipeline (unit + E2E tests)
│   └── update-snapshot.yml     # Scheduled catalog snapshot export
├── style_guide.md              # Brand style guide (827 lines)
├── TESTING.md                  # Testing SOP + campaign tracker
├── jest.config.js              # Frontend test config
├── playwright.config.js        # E2E test config
└── package.json                # Build scripts + devDependencies
```

## Local Setup

### Prerequisites

- Node.js 20+
- Redis (for middleware caching and rate limiting)
- A Zoho Books/Inventory account with API credentials
- Helcim sandbox credentials (for payment testing)

### Frontend

The frontend is static HTML — no build step needed for development. Open any `.html` file directly or serve with any static server:

```bash
# Using Python
python3 -m http.server 8080

# Using Node
npx serve -p 8080
```

The frontend expects the middleware at the URL configured in `js/modules/01-config.js`.

### Middleware

```bash
cd zoho-middleware
cp .env.example .env          # Fill in your credentials (see .env.example)
npm install
npm run dev                    # Starts with --watch for auto-reload
```

The middleware starts on port 3001 by default. Visit `http://localhost:3001/health` to verify it's running, then connect Zoho at `http://localhost:3001/auth/zoho`.

## Building

The build process handles cache-busting timestamps, CSS/JS minification, and service worker versioning:

```bash
npm run build
```

This runs (in order): timestamp stamping for all HTML pages → CSS minification via clean-css → JS concatenation (modules → main.js) → JS minification via terser.

Individual build steps are available as separate npm scripts (see `package.json`).

## Running Tests

```bash
# Frontend unit tests
npm test

# Frontend with coverage
npm run test:coverage

# Middleware unit tests
cd zoho-middleware && npm test

# Middleware with coverage
cd zoho-middleware && npm run test:coverage

# E2E tests (requires staging to be deployed)
npm run test:e2e

# E2E headed (visible browser)
npm run test:e2e:headed
```

CI runs automatically on push to `main` — two parallel unit test jobs followed by E2E against staging. See `.github/workflows/tests.yml`.

For the full testing SOP, campaign progress, and pattern reference, see [TESTING.md](TESTING.md).

## Deployment

The project uses a two-repository workflow:

- **Staging:** `koa-inn/steins-and-vines-staging` — deploy here first, always
- **Production:** `koa-inn/steins-and-vines-production` — promote from staging after verification

The frontend deploys to GitHub Pages. The middleware deploys to Railway.

For detailed deployment procedures, see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Other Documentation

- [Brand Style Guide](style_guide.md) — colors, typography, voice & tone, Canadian ad compliance
- [Testing SOP](TESTING.md) — testing campaigns, adding tests, pattern reference
- [API Reference](docs/API.md) — middleware endpoint documentation
- [Deployment Runbook](docs/DEPLOYMENT.md) — staging/production workflow, rollback procedures
