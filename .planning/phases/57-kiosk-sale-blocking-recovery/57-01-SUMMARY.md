---
phase: 57-kiosk-sale-blocking-recovery
plan: 01
status: complete
completed: 2026-07-15
requirements: [REVIEW-01]
commits: [3b094d28, bb1154c5, 5a7d3f11]
---

# 57-01 Summary — Kiosk client-error capture (the instrumentation)

## What shipped

The lens the whole phase depends on: a durable client-error capture path for the
kiosk, so the next failure is recorded instead of vanishing when staff tap Retry.
Built RED→GREEN, committed in three logical commits.

- **Middleware** (`3b094d28`) — `POST /api/kiosk/client-error` in `routes/pos.js`,
  device-token gated (added to `authTiers.js` KIOSK_ROUTES) + rate-limited
  (`clientErrorLimiter` in `server.js`, 60s/max20, Redis store + in-process
  fallback). Treats the body as hostile: reads only the six whitelisted fields,
  redacts any 13–19-digit run (PAN shape), strips C0/C1/DEL control chars
  (log-injection), caps message to 500 chars, coerces `http_status` to number|null,
  never crashes on malformed/absent body. Returns 204, no side-effect. Captures via
  the existing `captureExceptionSafe` (no new capture path, no new packages).
  Regression: `__tests__/pos-client-error.test.js` — 8 tests.
- **Frontend** (`bb1154c5`) — ES5 `_kcReportClientError(info)` in `js/kiosk-core.js`,
  wired into all FOUR failure catch sites: `kioskLoadProducts` → `/api/kiosk/products`,
  `kioskLoadRecipes` → `/api/recipes`, sale/confirm catch (2596) →
  `/api/kiosk/sale/confirm`, recipe-sale/confirm catch (2570) →
  `/api/kiosk/recipe-sale/confirm`. Body carries only the six whitelisted fields; the
  device token rides the auth header (never the body); `auth_state` is a derived
  label. Fire-and-forget, no recursion. Regression:
  `tests/frontend/kiosk-client-error-beacon.test.js` — 7 tests.
- **Artifacts** (`5a7d3f11`) — `npm run build`; beacon confirmed in
  `js/kiosk-core.min.js`.

## Verification

- `pos-client-error` 8/8, `kiosk-client-error-beacon` 7/7.
- Full suites green: **frontend 1002 (62 suites), middleware 1291 (81 suites)**.
  Middleware run required — `authTiers.js` (shared lib) changed.
- Both lints clean (frontend ES5-pinned; middleware).
- Existing `kiosk-load-recovery` / `kiosk-load-resilience` unchanged and green.

## Decisions / notes

- **Blocker fix carried through.** The plan-check blocker (beacon promised 3 surfaces
  but tested only catalog) is closed: coverage now spans catalog + recipe + both sale
  catches, with an objective `grep -c _kcReportClientError( >= 5` criterion (met: 5).
  This matters because hypothesis H3 is "the sale POST, not the catalog" — if H3 is
  the real cause, 57-02 will now actually capture it.
- **Two near-misses during execution, both caught and fixed:** (1) a control-char
  strip regex first embedded LITERAL control bytes into `pos.js` — rewritten with
  `\x00-\x1f\x7f-\x9f` hex escapes; (2) the middleware test first watched a stale
  jest mock (captured before `resetModules`) — harness fixed to re-grab the mock
  after reset. Both are the kind of thing that would have looked fine and been wrong.
- **Boundary stated in code:** a sale returning a non-ok HTTP status (401/403) goes
  through `.then(handleSaleResult)`, NOT the reject catches wired here. Instrumenting
  the auth-status-on-sale case is deferred to 57-03 IF 57-02 diagnoses H1 on the sale
  surface. 57-01 covers the network-reject catches only, by design.

## What this plan does NOT do

It does not diagnose or fix the bug. It builds the capture. **57-02 (blocking, live
iPad) looks through it; 57-03 fixes what it reveals.** SC#4 (live-iPad verification)
is explicitly 57-02's job — nothing here was verified on a real device.

## Next step

Deploy to staging→prod (no staging middleware exists, so the endpoint goes live on
the prod Railway instance), then **57-02**: force or await a real kiosk failure on the
iPad, read the captured occurrence, and record the confirmed cause in
`57-DIAGNOSIS.md`. 57-03 cannot start until that file exists.
