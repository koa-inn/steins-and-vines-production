# Directory Structure

**Analysis Date:** 2026-04-27

## Top-Level Layout

```
steins-and-vines-website/
├── .github/workflows/      # CI (tests.yml, update-snapshot.yml)
├── apps-script/             # Google Apps Script (batch tracking, admin API)
├── content/                 # JSON content files (CMS-like, loaded at runtime)
├── css/                     # Stylesheets (source + minified)
├── docs/                    # Project documentation, assessments, archive
├── images/                  # Static images and product photos
├── js/                      # Frontend JavaScript
│   ├── lib/                 # Shared utilities (constants, utils, auth)
│   ├── modules/             # Numbered modules (01-config → 13-init)
│   ├── vendor/              # Third-party libs (Fuse, jsPDF, QRCode, Sentry)
│   ├── admin.js             # Admin dashboard (IIFE, standalone)
│   ├── batch.js             # Public batch page (standalone)
│   ├── brewpad.js           # Brew pad interface (standalone)
│   ├── kiosk.js             # Kiosk POS (standalone)
│   ├── sheets-config.js     # API keys (MW_API_KEY, reCAPTCHA)
│   └── sentry-init.js       # Sentry error tracking bootstrap
├── products/                # SEO route aliases (ferment-in-store.html, ingredients-supplies.html)
├── scripts/                 # Build/utility scripts (generate-icons, optimize-images)
├── tests/
│   ├── frontend/            # Jest unit tests (jsdom)
│   └── e2e/                 # Playwright E2E tests
├── zoho-middleware/          # Express.js backend (separate package.json)
│   ├── __tests__/           # Jest unit tests (node)
│   ├── client/              # Client-side helpers (submitOrder)
│   ├── lib/                 # Shared libraries (pricing, cache, auth, helcim, etc.)
│   ├── routes/              # Express route handlers (14 route files)
│   ├── scripts/             # Utility scripts (sync-images, export-snapshot, etc.)
│   └── server.js            # Express app entry point
├── *.html                   # Public pages (12 HTML files at root)
├── sw.js                    # Service worker
├── manifest.json            # PWA manifest
├── CNAME                    # GitHub Pages domain config
├── package.json             # Frontend build & test config
└── eslint.config.js         # ESLint (flat config, ES2020)
```

## Key Locations

### Public Pages (root)
| File | Purpose |
|------|---------|
| `index.html` | Homepage — hero, featured products, how-it-works |
| `products.html` | Product catalog (kits, ingredients, services tabs) |
| `ingredients.html` | Alias for products page (ingredient tab) |
| `reservation.html` | Cart review / checkout |
| `about.html` | About the business |
| `contact.html` | Contact form |
| `admin.html` | Staff dashboard (noindex) |
| `kiosk.html` | In-store POS kiosk (noindex) |
| `batch.html` | Public batch tracking (token-auth) |
| `brewpad.html` | Brew pad management (noindex) |

### Frontend Modules (`js/modules/`)
Numbered for concatenation order — `npm run concat:js` joins them into `js/main.js`:

| Module | Lines | Responsibility |
|--------|-------|----------------|
| `01-config.js` | 11 | MW_API_KEY, reCAPTCHA key, payment flag |
| `02-utils.js` | 299 | DOM helpers, formatting, escaping |
| `03-events.js` | 34 | Custom event bus |
| `04-label-cards.js` | 155 | Wine/beer label card rendering |
| `05-catalog-view.js` | 93 | Catalog grid/list view toggle |
| `06-featured.js` | 864 | Homepage featured products |
| `07-catalog-kits.js` | 1465 | Kit product catalog (largest module) |
| `08-catalog-ingredients.js` | 812 | Ingredient catalog |
| `09-catalog-services.js` | 409 | Services catalog |
| `10-tabs.js` | 177 | Product tab switching |
| `11-cart.js` | 1243 | Dual cart system (ferment + ingredients) |
| `12-checkout.js` | 1800 | Checkout flow + Helcim payment |
| `12a-checkout-validation.js` | 121 | Pre-checkout validation |
| `12c-checkout-scheduling.js` | 191 | Booking timeslot scheduling |
| `13-init.js` | 808 | DOMContentLoaded bootstrap, content loader |

### Middleware Routes (`zoho-middleware/routes/`)
| Route | Lines | Responsibility |
|-------|-------|----------------|
| `catalog.js` | 1024 | Product catalog (Zoho Inventory enrichment) |
| `pos.js` | 1328 | Kiosk POS (Helcim terminal + Zoho invoice) |
| `taxes.js` | 852 | Tax rules and computation |
| `checkout.js` | 799 | Online checkout (payment + Zoho SO) |
| `bookings.js` | 313 | Timeslot booking management |
| `discounts.js` | 190 | Discount/promo code handling |
| `webhooks.js` | 178 | Helcim webhook receiver |
| `collect.js` | 152 | POS payment collection |
| `consignment.js` | 143 | Consignment tracking |
| `items.js` | 138 | Item CRUD |
| `payments.js` | 101 | Payment initialization (Helcim) |
| `purchaseorders.js` | 193 | Zoho PO management |
| `auth.js` | 75 | Zoho OAuth flow |
| `requests.js` | 66 | Generic Zoho API proxy |

### Content Files (`content/`)
JSON files loaded at runtime by `13-init.js`. Each `[data-content="KEY"]` element gets its value replaced:
- `shared.json` — global values (footer, contact info)
- `home.json` — homepage copy, promo news, featured SKUs
- `products.json`, `ingredients.json`, `services.json` — catalog page copy
- `zoho-snapshot.json` — cached Zoho product data (CSV fallback)

## Naming Conventions

- **Frontend modules:** numbered prefix for concat order (`07-catalog-kits.js`)
- **Sub-modules:** decimal numbering (`12a-checkout-validation.js`, `12c-checkout-scheduling.js`)
- **CSS:** one file per app (`styles.css`, `admin.css`, `batch.css`, `kiosk.css`, `brewpad.css`)
- **Minified:** `.min.js` / `.min.css` suffix (build artifacts, never edit directly)
- **Tests:** `*.test.js` for Jest, `*.spec.js` for Playwright
- **Middleware libs:** descriptive names in `lib/` (`pricing.js`, `checkout-helpers.js`)
- **Constants:** UPPER_SNAKE for objects (`CART_KEYS`, `ITEM_TYPES`), lower for properties

## Where to Add New Code

| Adding... | Location |
|-----------|----------|
| New public page | Root `*.html` + update `sitemap.xml`, `robots.txt` |
| Frontend feature for catalog | New module in `js/modules/` with next number |
| Shared frontend helper | `js/lib/` |
| New API endpoint | `zoho-middleware/routes/` + register in `server.js` |
| Middleware shared logic | `zoho-middleware/lib/` |
| Frontend unit test | `tests/frontend/*.test.js` |
| Middleware unit test | `zoho-middleware/__tests__/*.test.js` |
| E2E test | `tests/e2e/*.spec.js` |
| Page content/copy | `content/*.json` |
| Standalone app (staff) | New `*.html` + `js/*.js` + `css/*.css` (IIFE pattern) |
