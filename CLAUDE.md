# Steins & Vines — CLAUDE.md

## Tech Stack
- **Frontend:** Static HTML, vanilla JS (ES5), CSS — served via GitHub Pages
- **Middleware:** Express.js in `zoho-middleware/` — deployed on Railway
- **Integrations:** Zoho Books/Inventory/Bookings, Global Payments, Redis, Sentry, Google Apps Script

## Project Structure
- `js/modules/` — numbered modules `01-config` through `13-init`, concatenated into `js/main.js` by build
- `js/lib/` — shared utilities (`utils.js`, `constants.js`, `auth.js`)
- `zoho-middleware/` — separate Express app with its own `package.json` and `__tests__/`
- `tests/frontend/` — Jest unit tests (jsdom)
- `tests/e2e/` — Playwright end-to-end tests
- **Never edit `js/main.js` or `js/main.min.js` directly** — these are build artifacts

## Commands
```bash
# Frontend
npm test                          # Jest unit tests (jsdom)
npm run test:coverage             # Frontend coverage
npm run lint                      # ESLint
npm run build                     # Stamp + minify CSS/JS + concatenate modules

# Middleware (always cd first)
cd zoho-middleware && npm test
cd zoho-middleware && npm run test:coverage

# E2E
npm run test:e2e                  # Playwright
```

## Non-Negotiable Rules

### Before Every Commit
1. Run `npm test` AND `cd zoho-middleware && npm test` — never commit with failing tests
2. Run `npm run lint` — fix all lint errors before committing

### When Fixing Bugs
3. Write a regression test FIRST that reproduces the bug, then fix it
4. Make ONE logical change per commit

### Before Modifying Anything
5. Read the existing code and tests before touching anything
6. Use grep to find all usages before modifying any function
7. After changing any shared utility (`js/lib/*.js`, `zoho-middleware/lib/*.js`), run the FULL test suite for both frontend and middleware

### Build Artifacts
8. Never edit `js/main.js` or `js/main.min.js` directly — edit the source in `js/modules/`
9. After any JS module change, run `npm run build` to regenerate `main.js` and `main.min.js`

### Tests
10. Do NOT modify existing tests unless explicitly asked

### Security
11. Never commit `.env` files or API credentials
12. Every public HTML page has a CSP `<meta>` tag. When adding/removing any third-party or tracking service, update the CSP on **all** public pages — a missing domain silently blocks that service for every visitor (this broke Meta pixel tracking site-wide until 2026-07-22). New public pages must copy the CSP from a sibling page. See `docs/TRACKING.md`.

### Middleware
13. The middleware has its own `node_modules` — always `cd zoho-middleware` before running middleware commands

## Deployment
- **Staging:** `git push origin main` → `staging.steinsandvines.ca`
- **Production:** `git push production main --force` → `steinsandvines.ca`
- **ALL changes go to staging first** — never push directly to production without staging approval
- CNAME is in `.gitignore` — domains are managed via GitHub Pages settings, not the file
- `enforce-cname.yml` workflow auto-corrects the domain after every push to either repo

## Compact Instructions
When auto-compacting, preserve: current task from `docs/tasks.md`, all modified file paths, implementation plan, and which test suites need to run.
