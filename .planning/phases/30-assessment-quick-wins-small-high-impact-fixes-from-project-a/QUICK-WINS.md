# Phase 30 Source: Quick Wins from PROJECT_ASSESSMENT.md (2026-06-10)

Source: `PROJECT_ASSESSMENT.md` at repo root (gitignored — do not commit/deploy; repo root serves publicly via GitHub Pages). This file is the committed copy of the Quick Wins list so planning agents can work without the gitignored source.

Each item is small (~under 30 minutes). Items 15 and 16 are human/dashboard actions, not code.

## User-facing fixes (live bugs)

1. **Fix H5 hero-subtitle regression** — `content/home.json:10` still has the old weak tagline `"Your brew. Your vintage. Right Here In Squamish."` which overwrites the strong HTML copy (`index.html:169`) at runtime via the content loader (`13-init.js:227-233`). Update or delete the JSON key.
2. **Beer waitlist form discards every signup** — posts to placeholder `YOUR_BEER_WAITLIST_FORM_ID` / `entry.YOUR_EMAIL_ENTRY_ID` (`js/modules/12-checkout.js:1693`, section at `index.html:227-231`), then shows fake success. Hide the section OR wire a real Google Form ID OR route through `/api/contact`.
3. **404.html breaks on nested URLs** — relative paths (`css/styles.css` line 20, `js/main.js` line 94, `index.html` links at 27/32/57) resolve wrong for e.g. `/products/anything-bad`. Switch to root-absolute paths AND switch to `styles.min.css`/`main.min.js`.
4. **Kiosk idle reset leaks carts between customers** — `initKioskAttractScreen()` (`13-init.js:488`) clears only legacy `RESERVATION_KEY`. Also clear `sv-cart-ferment`, `sv-cart-ingredients`, and `_milledItemKeys` state.
5. **Contrast fixes (H14 remainder)** — `#777` → `var(--color-muted)` in `css/labels.css:141,157,225`; remove `opacity:.9` from `.hero p` (`css/styles.css:737-744` AND the duplicated inline critical CSS in index.html ~line 59); waitlist placeholder `rgba(229,222,193,0.6)` (`styles.css:1435`) needs ≥4.5:1.
6. **Remove stray empty story paragraph** — `about.html:177` `<p data-content="story-text"></p>` renders empty because `content/about.json:4` `story-text` is `""`. Remove element or write the paragraph.

## Security fixes

7. **Escape contact-render XSS sinks** — wrap in `escapeHTML()`: `js/kiosk.js:2240-2241` and `:2342-2343`, `js/admin.js:9857` and `:9950-9953` (Zoho contact name/email into innerHTML — customer-controlled, executes in staff POS context). Rebuild minified bundles after.
8. **Fix weak escapeHTML shadowing** — delete local `escapeHTML` in `brewpad.js:6` (no apostrophe escaping, overrides canonical `js/lib/utils.js:6`); add `js/lib/utils.js` to the `concat:js` build script so main bundle gets the canonical version instead of `02-utils.js:97`'s weak copy; reconcile/remove the `02-utils.js` and `kiosk.js:526` copies. CAUTION: verify concat ordering doesn't double-define; run full frontend test suite.
9. **Prototype-pollution guard** — copy the 3-line `__proto__/constructor/prototype` guard from `17-search-overlay.js:176` (also in 16-catalog-subpage.js) into the custom-field flattening in `07-catalog-kits.js:87-93`.

## Dead weight removal

10. **Delete `images/products/unmatched/`** — 26 MB of unreferenced bottle mockups deployed publicly.
11. **Delete `test-subpage.html`** + remove it from the `stamp:pages` script in package.json. Also delete root `docs-validation-report.md` (diverged duplicate of `docs/archive/` copy, ships publicly).
12. **Delete `zoho-middleware/lib/gp.js`** (dead Global Payments lib, zero requires) + remove its mention from `zoho-middleware/jest.config.js:7`.
13. **Delete 9 dead `content/` files** — `products.csv`, `ingredients.csv`, `services.csv`, `admin.json`, `contact.json`, `ingredients.json`, `products.json`, `reservation.json`, `services.json` (verified zero references; live files are timeslots.csv, home.json, about.json, reviews.json, shared.json, email-templates.json, zoho-snapshot.json). Verify with grep before each delete.
14. **Delete `sw.js`** (self-destruct service worker) + its registration at `404.html:96` + the dead `stamp:sw` npm script (targets a CACHE_VERSION that no longer exists).

## Repo hygiene

15. **Untrack `.planning/`** — add to `.gitignore`, then `git rm -r --cached .planning` (323 internal files currently served publicly on staging AND prod). ⚠️ Decision needed: this conflicts with GSD's commit_docs=true convention — confirm with user whether to untrack or switch to a deploy-time strip.
16. **Untrack CNAME** — `git rm --cached CNAME` (already gitignored; enforce-cname.yml self-heals domains).

## Config / infra

17. **Verify Railway env vars** (human, dashboard): `REDIS_ENCRYPTION_KEY` (closes #106), `HELCIM_WEBHOOK_SECRET`, `RECAPTCHA_SECRET_KEY`, `SENTRY_DSN`.
18. **Uptime monitor** (human, external): point UptimeRobot/Better Stack at middleware `/health`; alert on `authenticated:false` or `redis:false`.
19. **Add `watchPatterns = ["zoho-middleware/**"]`** to root `railway.toml` (stops middleware rebuilds on frontend-only pushes).
20. **Upgrade node-cron** — `cd zoho-middleware && npm i node-cron@4.2.1` (clears the 2 moderate npm audit findings; semver-major — verify `cron.schedule()` options at `server.js:439-459` still valid, run middleware tests).

## Test config cleanup

21. **Remove stale `!lib/mailer.js` exclusion** from `zoho-middleware/jest.config.js` (mailer now has tests); fix the misleading header in `__tests__/checkout-fallback-email.test.js:4-5`.

## Constraints

- Staging-first workflow is MANDATORY: all changes → `git push origin main` → human approval on staging → prod.
- Frontend JS changes require `npm run build` (regenerates main.js/min bundles) — never edit `js/main.js` or `*.min.js` directly.
- Run both test suites before every commit (`npm test` + `cd zoho-middleware && npm test`).
- Items 7/8 touch payment-adjacent staff UI (kiosk/admin) — verify on staging kiosk after deploy.
