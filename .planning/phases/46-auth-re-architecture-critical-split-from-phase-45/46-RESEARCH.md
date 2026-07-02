# Phase 46: Auth Re-Architecture (CRITICAL — split from Phase 45) - Research

**Researched:** 2026-07-02
**Domain:** Server-side auth migration (Express/Node middleware) — Google OAuth2 token verification, Redis-backed sessions, device-credential scoping, CORS-credentialed cookies
**Confidence:** HIGH (all findings verified directly against this repo's code + Context7-sourced official docs; no unverified ecosystem claims)

## Summary

This phase removes a single shared secret (`MW_API_KEY`/`API_SECRET_KEY`) that today gates almost every mutating `/api/*` route in `zoho-middleware/server.js`, and replaces it with three credential types living side-by-side during a short dual-accept window: (1) a typed-in **kiosk device token** scoped to POS operations, (2) a **Redis-backed session cookie** issued after the server independently verifies a Google credential against a Railway-env staff allowlist (for `admin.html`/`brewpad.html`), and (3) the **old shared key**, kept alive only until the owner rotates it.

The codebase already has every primitive this phase needs except the two genuinely net-new pieces: server-side Google token verification and cookie-based sessions. The CORS layer (`cors({ origin: allowlist, credentials: true })`) already supports credentialed cross-origin requests — no CORS restructuring needed, only `SameSite=None; Secure` cookies plus (recommended) `cookie-parser`. The existing GIS wiring (`js/lib/auth.js`) already requests the `userinfo.email` scope and can be reused **completely unchanged on the frontend** — the mandatory research question about ID tokens vs. access tokens resolves cleanly: `google-auth-library`'s `OAuth2Client.getTokenInfo(accessToken)` (Context7-verified) returns `email`, `email_verified`, and `aud` directly from Google, given the scope already requested. No frontend GIS flow change (no switch to `google.accounts.id`/ID-token flow) is required — only the server-side call changes, which is the smallest-blast-radius option and keeps `js/lib/auth.js` a pure reuse.

The single biggest miscalibration risk for planning is `kiosk.js` (standalone kiosk): it **already implements a full per-staff Google sign-in flow today** (`initGoogleAuth`/`tokenClient`/`accessToken`/`kioskCheckAuthorization` calling Apps Script `check_auth`), gating the same PIN lock-screen this phase's device token is meant to replace. D-46-01/D-46-02 mean this Google-auth plumbing must be **removed from `kiosk.js`**, not layered under — this is a bigger surgical change to that file than "add a device token header," and the planner must budget for it explicitly. The PIN lock-screen UI itself (already built, already tested, already the right UX) is reusable almost as-is; only what unlocks it changes (device-token-present-and-valid instead of Google-session-present-and-valid).

The sweep of public bundles for `x-api-key` stragglers (mandatory item #1) found **more than the one line CONTEXT.md flagged**: `js/modules/12-checkout.js` sends the key to three distinct endpoints (`/api/bookings`, `/api/contacts`, `/api/payment/initialize`), each called twice (dual-cart and single-cart code paths) — six call sites, three endpoints. Two more files (`16-catalog-subpage.js`, `17-search-overlay.js`) send the key on **GET** requests, which the guard already exempts unconditionally — those are pure leak-removal with zero server-side guard change needed.

**Primary recommendation:** Reuse the existing access-token GIS flow unchanged; verify it server-side with `google-auth-library`'s `getTokenInfo()` + a manual `aud` check against `CLIENT_ID`; issue an opaque, Redis-backed session ID as an httpOnly `SameSite=None; Secure` cookie using a hand-rolled thin session layer on top of the existing `lib/cache.js` (matching this codebase's established pattern of hand-rolled Redis-backed primitives with in-process fallback, e.g. `apiKey.js`, `makeRedisStore`); restructure the global `/api` guard in `server.js` into three credential checks (legacy key / kiosk device token+scope / session+allowlist) that all remain valid simultaneously until the owner rotates `API_SECRET_KEY`.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Kiosk device-token issuance & storage | Browser / Client (localStorage) | API / Backend (env-var comparison) | Token is entered once client-side; validity check is a constant-time server comparison, mirroring `lib/apiKey.js` |
| Kiosk device-token request authorization | API / Backend | — | Express guard on kiosk-scoped routes only |
| Admin/BrewPad Google sign-in (obtaining the access token) | Browser / Client | — | Unchanged — `js/lib/auth.js` GIS wiring stays frontend-only |
| Google token verification (identity truth) | API / Backend | — | NET-NEW: `google-auth-library` `getTokenInfo()` call; must never trust client-reported email |
| Staff allowlist enforcement | API / Backend | — | Railway env var (`STAFF_EMAILS`), replaces today's Apps-Script Config-sheet check |
| Session issuance & storage | API / Backend | Database / Storage (Redis) | Opaque session ID in Redis; cookie carries only the ID |
| Session validation on each request | API / Backend | Database / Storage (Redis, w/ in-process fallback) | Must survive brief Redis blips per Phase 45 D-06 norm |
| Cookie transport | Browser / Client ↔ API / Backend | — | Cross-site (`steinsandvines.ca` → `*.up.railway.app`) requires `SameSite=None; Secure` + already-present CORS `credentials:true` |
| Legacy shared-key acceptance (dual-accept window) | API / Backend | — | Time-boxed; removed/neutralized at owner-driven rotation |
| Kiosk PIN gate | Browser / Client (UI) + API / Backend (verify-pin) | — | Unchanged mechanism (`KIOSK_PIN`), now gates "device unlocked for a sale" instead of "Google session unlocked" |

## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-46-01 Kiosk device credential mechanism: typed-in device token.** Long random token, generated by the owner, stored server-side as a Railway env var. Entered ONCE on the iPad via a hidden settings prompt on `kiosk.html`, persisted in `localStorage`, sent as a request header. No pairing flow, no client certs. Existing `KIOSK_PIN` continues to gate staff actions on top of the device credential.
- **D-46-02 Scope: kiosk-only.** Device token authorizes kiosk endpoints (sale/confirm/status, products, gift-card lookup + redeem tender, custom lines) but NOT admin-grade routes (consignment reports, gift-card VOID, batch admin, PII list endpoints beyond what the kiosk needs). Planner derives the exact endpoint split from what `kiosk.js` actually calls.
- **D-46-03 Recovery: re-enter from password manager.** No break-glass flow built.
- **D-46-04 Lifetime: until manually rotated.** No expiry.
- **D-46-05 Google login everywhere, including the store iPad.** Any `admin.html` action requires a per-user Google session. The device token never unlocks admin routes.
- **D-46-06 Session model: server session cookie, ~7-day idle expiry.** Middleware verifies the Google ID token once at sign-in (server-side verifier is NET-NEW), then issues its own httpOnly session cookie backed by Redis. Server-side revocation possible. Frontend GIS wiring (`js/lib/auth.js`) reused for the sign-in step only.
  - **Research correction to carry into planning:** the frontend flow (`initTokenClient`) yields an **access token**, not an ID token — see Mandatory Research Finding #7 below. The functional intent of D-46-06 (independent server-side verification of a Google credential + allowlist + session issuance) is unaffected; only the literal phrase "ID token" needs updating to "access token verified via `getTokenInfo`" when the planner writes tasks.
- **D-46-07 Staff allowlist: Railway env var** (comma-separated emails, STAFF_EMAILS-style). Server-side enforcement; any client-side allowlist becomes cosmetic only.
- **D-46-08 Privilege tiers: everyone equal.** One allowlist, one level.
- **D-46-09 BrewPad migrates in this phase, same session model as admin.** `brewpad.js` ships the key today; points its existing Google sign-in at the new server session and drops the key.
- **D-46-10 Public pages go keyless.** Public bundles stop sending `x-api-key`. GETs and `/checkout` + `/promo/validate` + webhooks are already exempt from the key guard. **Researcher finding: the actual public-bundle POST surface sending `x-api-key` is larger than the single line originally flagged — see Mandatory Research Finding #1.**
- **D-46-11 Dual-accept window.** New auth deploys alongside the old key (both accepted). Surfaces migrate one at a time.
- **D-46-12 Window target: days, not weeks.** Rotate within ~2–3 business days of go-live.
- **D-46-13 D-05 interim IP allowlist: SKIPPED (confirmed).** Closed, not needed.

### Claude's Discretion

- Exact endpoint split for the kiosk-scoped token (from actual `kiosk.js` call inventory) — see Mandatory Research Finding #2 for the full inventory and one open item (discount-preset CRUD) not explicitly bucketed by CONTEXT.md.
- Header name / storage key naming for the device token; settings-prompt UX details.
- Session store implementation details (Redis key shape, TTL refresh semantics), sign-out affordance, and unauthenticated-visitor UX on `admin.html`/`brewpad.html`.
- Old-key canary logging after rotation (log any request still presenting the rotated key) — recommended but planner's call.
- Treatment of the public POSTs identified in Finding #1 (three endpoints, not one).

### Deferred Ideas (OUT OF SCOPE)

- **Owner privilege tier** (OWNER_EMAILS gating voids/payouts) — declined for now (D-46-08).
- **Break-glass pairing/recovery code for the kiosk** — declined (D-46-03).
- **Scheduled token rotation** — declined (D-46-04).
- **Old-key canary logging** — Claude's discretion (cheap, recommended).
- **Gift-card lookup GET unauthenticated + enumerable** (audit Low, `routes/gift-cards.js:59`) — scoped to phases 47+ unless free to fold in.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| Audit CRITICAL (D-46-01..D-46-13, carried from Phase 45 D-01..D-05) | Eliminate the shared-secret browser auth model closing `AUDIT-2026-06-29.md` §2 Critical row, without locking out the kiosk | This document: full endpoint inventory (Findings #1, #2), CORS/cookie feasibility (#3), Google verification approach (#4, #7), Redis session design + fallback (#5), dual-accept guard mechanics (#6), plus the kiosk-Google-removal finding not explicitly called out in CONTEXT.md |

## Mandatory Research Findings (from CONTEXT.md's research directive)

### Finding #1 — `12-checkout.js:1512` and the full public-bundle `x-api-key` sweep

**The single line CONTEXT.md flagged is one of six call sites across three distinct endpoints**, all in `js/modules/12-checkout.js`, all currently blocked by the global `/api` guard unless keyed:

| Endpoint | Call sites (line #s) | What it does | Currently gated by |
|----------|----------------------|---------------|---------------------|
| `POST /api/bookings` | 1512, 2088 (dual-cart + single-cart paths) | Books a Cal.com reservation timeslot for the ferment order | Global key guard + `apiLimiter` (60/min) + `requireAllowedReferer` (not in its exemption list) |
| `POST /api/contacts` | 1928, 2086 | Finds/creates the customer's Zoho Books contact before submitting the order | Same as above |
| `POST /api/payment/initialize` | 1974, 2054 | Requests a Helcim Pay.js checkout token for the amount about to be charged | Global key guard + `paymentLimiter` (10/min, already mounted on `/api/payment/**` in `server.js`) + `requireAllowedReferer` |

**Recommended keyless treatment [VERIFIED: repo read, server.js:257-270 + 66-87]:** add `/bookings`, `/contacts`, and `/payment/initialize` to the same two exemption lists that already carry `/checkout` and `/promo/validate` (the global key guard at `server.js:257-270`, and `requireAllowedReferer`'s path check at `server.js:73-87`). This exactly mirrors the existing precedent — `/promo/validate` is already keyless, referer-checked-only, with no recaptcha of its own, so `/api/contacts` and `/api/bookings` moving to that same bar is not a new risk class for this codebase. `/api/payment/initialize` keeps its existing `paymentLimiter` regardless of the key removal.

**Residual gap to flag for the planner (not blocking, but real):** unlike `/api/checkout` (which is recaptcha-verified inside `routes/checkout.js` before any money moves), neither `/api/bookings` nor `/api/contacts` independently verifies a recaptcha token today — the recaptcha token collected in the checkout flow is only forwarded to `/api/checkout`. Removing the key from `/bookings`/`/contacts` drops their protection to referer-check (bypassable by simply omitting a Referer header, e.g. via curl) + rate-limit. This matches `/promo/validate`'s existing risk profile exactly, so it is a **known, already-accepted pattern in this codebase**, not a regression — but it's the kind of thing the audit trail should note explicitly rather than silently inherit.

**GET-only stragglers (zero guard-logic change needed):** `js/modules/16-catalog-subpage.js:145` and `js/modules/17-search-overlay.js:218,252` send `x-api-key` on `GET /api/ingredients` and `GET /api/products`. Both routes are GET, and the global guard already exempts all GETs (`server.js`: `if (req.method === 'GET') return next();`) — the header is currently sent but never checked. Removing it is pure leak-removal with no server-side risk.

**Confidence:** HIGH — verified by direct grep of every `.js` file under `js/modules/`, `js/lib/`, and the three staff bundles; cross-referenced against `server.js`'s actual guard/exemption logic.

### Finding #2 — Kiosk endpoint inventory (device-token scope)

Full list of endpoints called by the **standalone kiosk** (`js/kiosk.js`), derived by grepping every `/api/...` literal in the file:

```
/api/contacts                         (GET search + POST create — see scope caveat below)
/api/ingredients, /api/recipes(/:id)  (catalog reads — already GET-exempt)
/api/kiosk/products
/api/kiosk/discounts (GET, POST, PUT /:id, DELETE /:id)
/api/kiosk/gift-card/lookup, /next-number
/api/kiosk/recipe-quote, /recipe-sale, /recipe-sale/confirm
/api/kiosk/sale, /sale/confirm, /sale/status
/api/kiosk/salesorder-create, /salesorder-update, /salesorder-pay
/api/kiosk/salesorders, /salesorder/:id
/api/kiosk/verify-pin
/api/pos/cancel, /api/pos/status
```

The **admin-embedded kiosk** (`admin.html` `#tab-kiosk`, implemented in `js/admin.js` lines ~9825–12900) calls a subset **plus one admin-only route absent from the standalone kiosk**: `/api/kiosk/gift-card/void`. This is a clean, real signal (not an assumption) that the admin-embedded kiosk should ride the existing admin Google session — confirming the CONTEXT.md open question ("admin-embedded kiosk rides the admin session? — planner decides") in favor of **yes, it rides the admin session**, because the one capability it has beyond the standalone kiosk (void) is explicitly admin-grade per D-46-02.

**One genuine gray area not enumerated in D-46-02's in/out list:** `kiosk.js` contains a full discount-**preset management** UI (`kioskShowDiscountMgmt`, `kioskRenderDiscountMgmtList`, lines ~5220-5432) that creates/edits/deletes store-wide discount presets via `POST/PUT/DELETE /api/kiosk/discounts(/:id)`. D-46-02's exclusion list (consignment reports, gift-card VOID, batch admin, PII lists) does not mention discount CRUD, and it is genuinely present on the standalone kiosk today (not gated behind Google auth even now). **Recommendation:** treat discount-preset CRUD as kiosk-scoped (device token + PIN), consistent with it already living on the trusted shared terminal and carrying no PII/refund capability — but flag this explicitly for the planner/owner to confirm rather than silently assuming, since CONTEXT.md's Claude's-Discretion note only mentions "exact endpoint split," not this specific ambiguity.

**A real scope leak worth fixing, not just documenting:** `kiosk.js`'s three customer-search call sites (lines 3311, 4738, 5553) call `GET /api/contacts?search=...`, which resolves to `routes/items.js:87` — the **same exact-match `/api/contacts` route that is in the `PII_GET_ROUTES` admin-key-gated list** (`server.js:457`) and returns the full raw Zoho contact object (all `contact_persons`, emails, phones). There is a **separate, purpose-built, already-narrower endpoint** for exactly this use case: `GET /api/contacts/search` (`routes/pos.js:2553`), already independently guarded by `apiKeyGuard.matches()`, and already returns a slim `{contact_id, contact_name, email, phone}` shape only. **Recommendation:** migrate `kiosk.js`'s three search call-sites from `/api/contacts?search=` to `/api/contacts/search?q=` (the existing pos.js route) as part of this phase. This lets the kiosk device-token scope simply include `/api/contacts/search` (small, purpose-built, no PII list capability) while `/api/contacts` (full contact dump) stays in the admin-grade `PII_GET_ROUTES` bucket, with **zero scope ambiguity** — instead of having to explain why the device token can reach a "PII list endpoint" that D-46-02 says it explicitly should not. `POST /api/contacts` (`routes/bookings.js:391`, contact create/find-by-email) is unrelated to this and stays kiosk-scoped as-is (kiosk genuinely needs to create walk-in contacts).

**BrewPad's own endpoint list** (`js/brewpad.js`), for completeness — all of these move to session-cookie auth per D-46-09:
```
/api/batch/bottling-invite, /bulk-create, /customer-by-number,
/reassign-customer, /scan-invoices, /search-invoices, /sync-zoho
/api/contacts, /api/contacts/search, /api/ingredients, /api/products
/api/recipes(/:id)
```

**Confidence:** HIGH — every endpoint listed was found via direct grep of the actual source files, not inferred.

### Finding #3 — CORS + cookie feasibility

**Already in place, no restructuring needed** [VERIFIED: `zoho-middleware/server.js:47-64`]:
```js
var allowedOrigins = [
  'https://steinsandvines.ca', 'https://staging.steinsandvines.ca',
  'http://localhost:3001', 'http://localhost:8080'
];
app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.indexOf(origin) !== -1) callback(null, true);
    else callback(new Error('CORS: origin not allowed: ' + origin));
  },
  credentials: true
}));
```
This is already an explicit-whitelist (`credentials:true` is illegal alongside a wildcard origin, and this code correctly never returns `*`) — the one precondition credentialed cross-origin cookies require. `app.set('trust proxy', 1)` is already set (`server.js`), which is required for Express to correctly detect `req.secure` behind Railway's proxy — needed so a `secure: true` cookie option behaves correctly in production.

**What's genuinely missing:** nothing in the CORS layer itself. The only new requirement is the cookie's own attributes: `Set-Cookie: sv_session=<id>; HttpOnly; Secure; SameSite=None; Path=/`. `SameSite=None` is mandatory because the site (`steinsandvines.ca`) and the API (`*.up.railway.app`) are different registrable domains — this is a genuinely cross-site request in the modern cookie sense, not just cross-origin.

**Pitfall to flag:** `SameSite=None` cookies **require** `Secure`, which most browsers will silently refuse to set over plain HTTP. Local dev at `http://localhost:3001`/`:8080` (already in `allowedOrigins`) will not receive the cookie unless dev also runs HTTPS, or the session logic falls back to `SameSite=Lax`/no-`Secure` when `NODE_ENV !== 'production'`. Recommend an explicit `isProd` branch on cookie options (this codebase already has an `isProd`-style pattern in `validateEnv.js`'s `RAILWAY_ENVIRONMENT` check to model from).

**Confidence:** HIGH — CORS config read directly; cookie attribute requirements are standard, uncontroversial web-platform behavior (no external verification needed beyond what's already common knowledge, but cross-checked against MDN-level understanding of `SameSite=None`).

### Finding #4 / #7 — Server-side Google verification approach (combined; the two questions resolve together)

**What `js/lib/auth.js` provides today** [VERIFIED: repo read]: `waitForGoogleIdentity`, `gsiInitTokenClient` (thin wrapper over `google.accounts.oauth2.initTokenClient`), and `fetchGoogleUserInfo(token)` (calls `/oauth2/v3/userinfo` client-side). `admin.js` and `brewpad.js` (and, today, `kiosk.js`) all call `initTokenClient({ client_id, scope: SHEETS_CONFIG.SCOPES + ' https://www.googleapis.com/auth/userinfo.email', callback: onTokenResponse })`, and `onTokenResponse` reads `response.access_token` — **this is the OAuth2 implicit/token flow. It returns an access token, never an ID token.** `checkAuthorization()` today POSTs this access token to a Google **Apps Script** endpoint (`SHEETS_CONFIG.ADMIN_API_URL?action=check_auth&token=...`), which is unrelated to the leaked middleware key and unrelated to the Express middleware entirely — it's a parallel, pre-existing authorization path this phase's staff allowlist supersedes.

**The resolution, Context7-verified against `google-auth-library` (official Google Node.js client, in continuous maintenance since 2015):**
- `OAuth2Client.verifyIdToken({ idToken, audience })` is for **ID tokens** (JWTs) — not applicable, since GIS's token client doesn't produce one without switching to a different frontend flow (`google.accounts.id` One Tap/Sign-In-With-Google, or `initCodeClient` + a server-side code exchange).
- `OAuth2Client.getTokenInfo(accessToken)` is for **access tokens** — exactly what the frontend already has. [CITED: github.com/googleapis/google-auth-library-nodejs, `_autodocs/api-reference-oauth2client.md`] It returns `{ aud, user_id, scopes, expiry_date, sub, azp, access_type, email, email_verified }` directly from Google's tokeninfo endpoint — **no separate call to `/oauth2/v3/userinfo` is needed**, because the token already carries the `userinfo.email` scope the frontend requests today.

**Recommendation: do not change the frontend GIS flow at all.** POST the existing `access_token` to a new middleware endpoint (e.g. `POST /auth/google`); server calls `getTokenInfo(accessToken)`, and **must explicitly verify `tokenInfo.aud === CLIENT_ID` itself** (`getTokenInfo`, unlike `verifyIdToken`, does not take an `audience` parameter and does not check it for you) plus `tokenInfo.email_verified === true`, then checks `tokenInfo.email` (lowercased) against the `STAFF_EMAILS` allowlist, then issues the session cookie. This is the smallest possible change: zero frontend rework, `js/lib/auth.js` untouched, `admin.js`/`brewpad.js` only need to swap what they call at the "check_auth" step and what they attach to subsequent fetches (`credentials:'include'` instead of `x-api-key`).

**Pitfall — do not skip the `aud` check.** Skipping it would let *any* valid Google access token (issued to a completely different Google Cloud project/app, e.g. a token a user has lying around from an unrelated site) with a matching, verified email pass the allowlist check. This is the single most important thing to get right in the net-new verifier and is exactly the kind of gap `getTokenInfo`'s API shape invites (it feels like it "validates" the token, but the audience check is the caller's job).

**Note on the existing "silent refresh" UX (`prompt:''`, periodic `requestAccessToken` on a ~50min timer):** once the server-side session cookie exists (7-day idle expiry per D-46-06), the frontend no longer needs to keep the Google access token fresh for *authorizing API calls* — the cookie does that. The existing silent-refresh machinery becomes useful only for **re-establishing** the cookie once it expires or is revoked, without forcing a full interactive Google popup (call `tokenClient.requestAccessToken({ prompt: '', login_hint: savedEmail })` again, then re-POST to `/auth/google`). Recommend keeping the refresh timer but re-scoping its purpose in comments/tests: "keep the cookie alive," not "keep the access token usable directly."

**Version verified:** `google-auth-library@10.9.0` (npm, published 2026-06-24, actively maintained, official `googleapis` GitHub org, first published 2015) [VERIFIED: npm registry + Context7 official docs]. `cookie-parser@1.4.7` (npm, Express org, first published 2014) [VERIFIED: npm registry]. Both passed `slopcheck` with `[OK]` verdicts (see Package Legitimacy Audit below).

**Confidence:** HIGH — Context7-sourced official API docs for the exact methods in question, cross-checked against the actual frontend code already in the repo.

### Finding #5 — Session issuance backed by Redis, with a fallback that doesn't sign everyone out mid-day

**No session infrastructure exists today** [VERIFIED: grep of `zoho-middleware/` for `cookie`/`session` returns nothing outside `routes/auth.js`'s unrelated Zoho OAuth-state cache keys]. `lib/cache.js`'s existing shape (`get/set/del/acquireLock/releaseLock/isConnected`) is the right foundation, and its Phase 45 D-06 in-process-lock fallback pattern (`inProcessLocks` Map, consulted only when `!connected`) is the pattern to mirror — **not** `express-session` + `connect-redis`, which don't have this codebase's specific single-Railway-instance in-process fallback semantics built in, and would be a second, differently-shaped fallback model living alongside the existing one.

**Recommendation:** a small new `lib/session.js` (mirrors `lib/apiKey.js`'s and `lib/cache.js`'s existing style):
- `createSession(email)` → `crypto.randomBytes(32).toString('hex')` as the opaque session ID (high-entropy; the ID itself is the credential, same trust model as the device token — no HMAC signing needed), `cache.set('session:' + id, { email: email, createdAt: Date.now() }, 7 * 24 * 3600)`, **plus** write-through to a small in-process `Map` (mirrors `inProcessLocks`) so an in-flight Redis blip doesn't immediately invalidate a session that was already validated once this process lifetime.
- `getSession(id)` → try `cache.get`; if Redis is disconnected (`cache.isConnected() === false`), fall back to the in-process `Map` entry if present and not expired. This satisfies the exact Phase 45 D-06 norm CONTEXT.md flags ("a Redis blip must not sign everyone out mid-day") using the same "single Railway instance ⇒ per-process coverage is adequate" reasoning already accepted for locks and rate limits.
- `destroySession(id)` → `cache.del` + remove from the in-process Map (sign-out).
- Sliding expiry: re-`cache.set` (same TTL) on each successful validated request, OR only refresh every N minutes to reduce Redis writes — planner's call, either is reasonable.

**Confidence:** HIGH for the fallback *pattern* (directly modeled on already-shipped, already-tested code in this exact repo); MEDIUM for the specific TTL-refresh cadence recommendation (a reasonable engineering choice, not something with one universally-correct answer).

### Finding #6 — Dual-accept window mechanics

**Key realization: the "dual-accept window" is about accepting multiple *credential types* simultaneously, not about having two valid *values* of the same key.** The guard at `server.js:257-270` currently does one thing: compare `x-api-key` against one value. It needs to become a small dispatcher that, per route-tier, accepts:
- **Legacy tier:** `apiKeyGuard.matches(req.headers['x-api-key'])` (unchanged `lib/apiKey.js`, unchanged env var) — this branch is what naturally "ends" the window: once the owner rotates `API_SECRET_KEY`'s *value* on Railway, any caller still sending the old value stops matching, with no separate feature flag needed.
- **Kiosk tier (new):** a new small module (e.g. `lib/deviceToken.js`, same `crypto.timingSafeEqual` constant-time pattern as `lib/apiKey.js`, reading a new `KIOSK_DEVICE_TOKEN` env var) checked only on the kiosk-scoped route list from Finding #2, mounted the same way `PII_GET_ROUTES.forEach(...)` mounts `requirePiiApiKey` today (`server.js:464`) — i.e., an explicit route allowlist, not a path-prefix guess.
- **Session tier (new):** `lib/session.js`'s `getSession(cookie value)` lookup, checked on admin-grade + BrewPad routes.

**Recommended structure:** keep the single global `/api` mounting point in `server.js`, but replace the current one-branch `if (apiKeyGuard.matches(...)) return next();` with an explicit per-route-tier check (kiosk tier for the Finding #2 list, session tier for everything else currently behind the key, legacy tier accepted everywhere as a fallback during the window). This avoids scattering ad hoc guards across route files and keeps the "single source of truth" property `lib/apiKey.js`'s own comments call out as the reason it exists.

**Canary logging (Claude's discretion, recommended):** add an optional `API_SECRET_KEY_PREVIOUS` env var, populated by the owner immediately after rotation with the just-retired value, purely for logging ("still-in-use legacy key detected from origin=X, path=Y") — mirrors the existing `log.warn('[api-key] Forbidden: ...')` pattern at `server.js:270-276`, not a new architecture.

**Confidence:** HIGH — this is a direct extension of code patterns already shipped and tested in this exact repo (`PII_GET_ROUTES` explicit-list pattern, `lib/apiKey.js`'s constant-time compare, `makeRedisStore`'s fallback style).

### The kiosk-Google-removal finding (not one of the seven numbered items, but load-bearing for planning)

`js/kiosk.js` (standalone) **today requires a real per-staff Google sign-in** before the PIN pad ever appears: `initGoogleAuth()` (lines ~111-150) inits the same GIS token client as admin/BrewPad, `onTokenResponse` → `kioskCheckAuthorization()` → `adminApiGet('check_auth')` (Apps Script, not the middleware) → `showKioskApp()`. The PIN lock-screen (`showLockScreen`/`pinSubmit`/`unlockAfterPin`) only re-locks/unlocks an *already-Google-authenticated* session (`isSessionValidForPin` checks a 24h `SESSION_MAX_AGE` window off the same Google session, not a separate credential).

D-46-01 replaces this entire Google-gate with the device token; D-46-05's "Google login everywhere, **including the store iPad**" is about `admin.html` opened *on* that iPad, not about `kiosk.html` itself. **This means Phase 46 removes, not adds to, a meaningful chunk of `kiosk.js`'s existing auth code** — `initGoogleAuth`, `showSignInButton`, `onTokenResponse`, `kioskCheckAuthorization`, `showKioskApp`'s Google-specific pieces (periodic `tokenClient.requestAccessToken` refresh timer, `google.accounts.oauth2.revoke` on sign-out), and `handleUnauthorized`. The PIN pad DOM/CSS and its handlers (`pinEntry`/`pinSubmit`/`pinBackspace`) are reusable close to as-is; what changes is *what state they gate* (device-token-present vs. Google-session-present) and where the "first run" prompt appears (a new hidden settings entry point for the device token, replacing `showSignInButton`'s Google button).

**Confidence:** HIGH — read directly from `js/kiosk.js` lines 1-520.

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|---------------|
| `google-auth-library` | 10.9.0 [VERIFIED: npm registry + Context7 official docs, checked 2026-07-02] | `OAuth2Client.getTokenInfo()` server-side access-token verification | Google's own officially-maintained Node.js auth client (`googleapis` org, first published 2015); the only correct way to verify a Google-issued token without hand-rolling calls to Google's tokeninfo endpoint |
| `cookie-parser` | 1.4.7 [VERIFIED: npm registry, checked 2026-07-02] | Parse the session cookie off incoming requests | Express-org-maintained (first published 2014), the de facto standard for this in an Express app; avoids hand-rolling `Cookie` header parsing |

### Supporting (hand-rolled, matching existing codebase conventions — not a library)

| Component | Purpose | When to Use |
|-----------|---------|-------------|
| `lib/session.js` (new) | Opaque Redis-backed session issuance/lookup with in-process fallback | All admin/BrewPad session auth — see Finding #5 |
| `lib/deviceToken.js` (new, mirrors `lib/apiKey.js`) | Constant-time device-token comparison, kiosk-scoped route guard | Kiosk-only routes — see Finding #6 |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Hand-rolled `lib/session.js` on top of `lib/cache.js` | `express-session` + `connect-redis` | Ecosystem-standard, more battle-tested edge cases (rolling sessions, touch semantics) but introduces a *second, differently-shaped* Redis-fallback model alongside the one already established in this repo (`lib/cache.js`'s in-process lock fallback); would need its own MemoryStore fallback wiring to match the "Redis blip ≠ mass sign-out" requirement. Given the small session shape needed here (just an email + timestamp), the hand-rolled version is less code and reuses what's already proven in this codebase. |
| Access-token + `getTokenInfo()` verification | Switch frontend to `google.accounts.id` (GSI Sign-In-With-Google) + `verifyIdToken()` | The "textbook" GIS pattern and literally what D-46-06's wording says ("ID token") — but requires reworking `js/lib/auth.js`'s consumers in `admin.js`/`brewpad.js` (different init call, different button rendering, different/weaker silent-reauth story via One Tap) across three staff pages, for a security property (`getTokenInfo` + explicit `aud` check) that's equivalent once the `aud` check is present. Recommended only if the planner/owner explicitly wants standard GIS-recommended flow over minimal-diff. |
| Manual JWKS verification of a hypothetical ID token | Roll your own JWT signature check against Google's public keys | Never do this — `google-auth-library` exists precisely so nobody hand-verifies Google JWTs; explicitly a Don't-Hand-Roll item below. |

**Installation (in `zoho-middleware/`, NOT the frontend root — verified during research the root `package.json` must never receive these):**
```bash
cd zoho-middleware && npm install google-auth-library cookie-parser
```

**Version verification performed:** `npm view google-auth-library version` → `10.9.0`, published 2026-06-24 (`npm view google-auth-library time.modified`). `npm view cookie-parser version` → `1.4.7`. Both cross-checked as officially-maintained (Google's own `googleapis` org for the former, Express org for the latter) via Context7/GitHub metadata, not training-data assumption.

## Package Legitimacy Audit

| Package | Registry | Age | Source Repo | slopcheck | Disposition |
|---------|----------|-----|--------------|-----------|-------------|
| `google-auth-library` | npm | ~11 yrs (first published 2015) | github.com/googleapis/google-auth-library-nodejs | `[OK]` | Approved |
| `cookie-parser` | npm | ~12 yrs (first published 2014) | github.com/expressjs/cookie-parser | `[OK]` | Approved |

**Packages removed due to slopcheck `[SLOP]` verdict:** none.
**Packages flagged as suspicious `[SUS]`:** none.

*Note on how this check was run:* `slopcheck install <pkg> <pkg>` performs the registry check **and immediately installs the packages via `npm install`** in the current working directory — it is not a dry-run/check-only command. Running it once landed the two packages in the frontend root `package.json` by accident (wrong directory); this was reverted (`git checkout -- package.json && npm install` to prune `node_modules`/lockfile back to the prior state) and re-run correctly from inside `zoho-middleware/`, then reverted there too so this research session leaves no dependency changes in either `package.json`. **The planner/executor must run the actual `npm install` themselves inside `zoho-middleware/` when implementing** — this research only verified legitimacy, it did not leave the packages installed.

## Architecture Patterns

### System Architecture Diagram

```
                    ┌─── kiosk.html (in-store iPad) ───┐
                    │  1. First boot: settings prompt   │
                    │     → typed device token          │
                    │     → localStorage                │
                    │  2. PIN pad gates "unlocked" state │
                    └──────────────┬─────────────────────┘
                                   │ x-device-token header
                                   ▼
   ┌─── admin.html / brewpad.html (off-site) ───┐   ┌─────────────────────────────┐
   │ 1. Google sign-in (GIS token client,        │   │  Express /api guard         │
   │    UNCHANGED — js/lib/auth.js)              │   │  (server.js, 3 tiers)       │
   │ 2. POST access_token → /auth/google         │──▶│                              │
   │ 3. Server sets httpOnly session cookie      │   │  ┌─ legacy key tier ────┐   │
   │ 4. All further calls: credentials:'include' │   │  │ apiKeyGuard.matches() │   │
   └──────────────────────────────────────────────┘   │  │ (dies at rotation)    │   │
                                   │ session cookie      │  └───────────────────────┘   │
                                   ▼                     │  ┌─ kiosk tier ──────────┐   │
                          ┌─────────────────┐            │  │ deviceToken.matches() │◀──┼── kiosk-scoped routes
                          │  Session lookup │            │  │ + explicit route list │   │   (Finding #2)
                          │  lib/session.js │            │  └───────────────────────┘   │
                          │  Redis primary  │            │  ┌─ session tier ────────┐   │
                          │  in-proc fallback│           │  │ session.getSession()   │◀──┼── admin/BrewPad routes
                          └────────┬────────┘            │  └───────────────────────┘   │
                                   │                      └──────────────┬───────────────┘
                                   ▼                                     ▼
                          Redis (lib/cache.js)              Zoho Books/Inventory + Apps Script
                                                             (unchanged downstream integrations)

   Public pages (index/products/contact/404) ──── keyless GET + 3 exempted POSTs
   (/bookings, /contacts, /payment/initialize — Finding #1) ──▶ same guard, no-key branch
```

### Recommended Project Structure (new/changed files only)

```
zoho-middleware/
├── lib/
│   ├── apiKey.js            # UNCHANGED — legacy tier, dies naturally at rotation
│   ├── deviceToken.js        # NEW — mirrors apiKey.js's constant-time pattern
│   ├── session.js            # NEW — Redis-backed opaque session + in-process fallback (Finding #5)
│   └── googleVerify.js       # NEW — thin wrapper: getTokenInfo() + aud/email_verified/allowlist check
├── routes/
│   └── auth.js               # ADD: POST /auth/google (verify + issue session), POST /auth/logout
├── server.js                 # CHANGE: /api guard becomes 3-tier dispatch (Finding #6);
│                              #         add /bookings, /contacts, /payment/initialize to
│                              #         both exemption lists (Finding #1); mount cookie-parser
├── __tests__/
│   ├── device-token-guard.test.js   # NEW — mirrors api-key-guard.test.js's supertest style
│   ├── session.test.js              # NEW
│   └── google-verify.test.js        # NEW — mock getTokenInfo, test aud-mismatch rejection explicitly

js/
├── lib/auth.js                # UNCHANGED (Finding #4/#7 — no frontend flow change)
├── kiosk.js                   # LARGE CHANGE — remove Google-auth plumbing (see kiosk-Google-removal
│                              #   finding), add device-token settings prompt + header on kiosk calls
├── admin.js                   # CHANGE — checkAuthorization() calls /auth/google instead of Apps
│                              #   Script check_auth; staff fetches use credentials:'include' not x-api-key
├── brewpad.js                 # Same shape of change as admin.js (D-46-09)
├── sheets-config.js           # REMOVE MW_API_KEY (D-03)
└── modules/
    ├── 12-checkout.js          # REMOVE x-api-key from 6 call sites (Finding #1)
    ├── 16-catalog-subpage.js   # REMOVE x-api-key header (GET-only, no guard change needed)
    └── 17-search-overlay.js    # REMOVE x-api-key header (GET-only, no guard change needed)
```

### Pattern 1: Constant-time credential comparison (already established — replicate, don't reinvent)
**What:** `lib/apiKey.js`'s pattern — check length first (not secret), then `crypto.timingSafeEqual` on equal-length buffers.
**When to use:** the new `lib/deviceToken.js`.
**Example:**
```js
// Source: zoho-middleware/lib/apiKey.js (existing code in this repo, verbatim pattern to replicate)
function matches(sent) {
  var key = getKey();
  if (!key || typeof sent !== 'string') return false;
  var a = Buffer.from(sent);
  var b = Buffer.from(key);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
```

### Pattern 2: Redis-with-in-process-fallback (already established — replicate for sessions)
**What:** `lib/cache.js`'s `acquireLock`/`acquireInProcessLock` pair — Redis primary, an in-process `Map` fallback consulted only when `!connected`, justified because the middleware runs as a single Railway instance.
**When to use:** the new `lib/session.js`'s `getSession`.
**Example:**
```js
// Source: zoho-middleware/lib/cache.js (existing code, the pattern lib/session.js should mirror)
function acquireLock(key, ttlSeconds) {
  if (!connected) return Promise.resolve(acquireInProcessLock(key, ttlSeconds));
  return getClient().then(function (c) {
    return c.set('lock:' + key, '1', { NX: true, EX: ttlSeconds });
  }).then(function (result) {
    return result !== null;
  }).catch(function () {
    return acquireInProcessLock(key, ttlSeconds); // Redis mid-op error fallback
  });
}
```

### Pattern 3: Explicit route allowlist for a targeted guard (already established — replicate for kiosk/session tiers)
**What:** `PII_GET_ROUTES.forEach(function (p) { app.get(p, requirePiiApiKey); })` — an explicit array of exact paths, not a prefix guess.
**When to use:** mounting the kiosk-device-token guard on exactly the Finding #2 route list, and the session guard on exactly the admin/BrewPad route list.
**Example:**
```js
// Source: zoho-middleware/server.js:457-464 (existing code, the pattern to replicate for the new tiers)
var PII_GET_ROUTES = ['/api/contacts', '/api/invoices', '/api/items/inspect', '/api/snapshot'];
function requirePiiApiKey(req, res, next) {
  if (apiKeyGuard.matches(req.headers['x-api-key'])) return next();
  return res.status(403).json({ error: 'Forbidden' });
}
PII_GET_ROUTES.forEach(function (p) { app.get(p, requirePiiApiKey); });
```

### Pattern 4: Google access-token server verification (net-new — Context7-sourced)
**What:** verify an access token server-side, get identity, without a second network call.
**Example:**
```js
// Source: Context7 /googleapis/google-auth-library-nodejs (README.md + api-reference-oauth2client.md)
var { OAuth2Client } = require('google-auth-library');
var client = new OAuth2Client();

function verifyStaffAccessToken(accessToken) {
  return client.getTokenInfo(accessToken).then(function (tokenInfo) {
    // getTokenInfo does NOT check audience for you — this repo's own responsibility:
    if (tokenInfo.aud !== process.env.SHEETS_CLIENT_ID) {
      throw new Error('Token audience mismatch');
    }
    if (!tokenInfo.email_verified) {
      throw new Error('Email not verified');
    }
    return tokenInfo.email.toLowerCase();
  });
}
```

### Anti-Patterns to Avoid
- **Trusting the client-reported email** (as today's `fetchGoogleUserInfo` result, cached in `localStorage`, is implicitly trusted by Apps Script's `check_auth`): the server must independently derive the email from `getTokenInfo`, never from a value the client POSTs alongside the token.
- **Skipping the `aud` check** on `getTokenInfo` results (see Finding #4/#7 pitfall) — this is the one place a "looks verified" call isn't actually fully verified without an extra line of code.
- **A path-prefix guard for the kiosk tier** (e.g. "anything under `/api/kiosk/*`") instead of an explicit list — `/api/kiosk/gift-card/void` and `/api/kiosk/discounts` writes are both under that prefix and have different intended tiers (see Finding #2); prefix-matching would either over- or under-scope.
- **Signing the session cookie with a hand-rolled HMAC**: unnecessary — a `crypto.randomBytes(32)` opaque ID looked up server-side has no forgeable structure to sign in the first place (same reasoning as the device token).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|--------------|-----|
| Verifying a Google-issued token is genuine and unexpired | Manual JWKS fetch + signature verification, or a raw HTTPS call to `https://oauth2.googleapis.com/tokeninfo` parsed by hand | `google-auth-library`'s `OAuth2Client.getTokenInfo()` | Handles Google's key rotation, endpoint versioning, and error-shape parsing; hand-rolling this is exactly the kind of thing that silently breaks when Google changes an internal detail |
| Cookie header parsing/writing edge cases (`Max-Age` vs `Expires`, `SameSite` casing, multiple cookies) | Manual `req.headers.cookie` string splitting | `cookie-parser` | Trivial to get subtly wrong (e.g. cookie values containing `;` or `=`); this is exactly what the library exists to handle correctly once and for all |
| Session store with correct Redis-outage behavior | A bespoke solution built from scratch under deadline pressure | The exact `lib/cache.js` fallback pattern already shipped, tested, and load-bearing elsewhere in this repo (Pattern 2 above) | Reinventing this pattern under this phase's time pressure risks a subtly different (and unverified) fallback behavior than the one already proven correct in Phase 45 |

**Key insight:** this phase's net-new pieces (Google token verification, cookie sessions) both have obvious "hand-roll" traps that Google's own library and Express's own ecosystem already solve correctly — but the *fallback/resilience* pieces (Redis-blip tolerance, constant-time comparison) should deliberately **replicate this repo's own already-proven code**, not reach for a different ecosystem library, because this repo's single-Railway-instance topology and its established conventions are exactly what those already-shipped patterns were built and tested for.

## Common Pitfalls

### Pitfall 1: Forgetting the `aud` check on `getTokenInfo()`
**What goes wrong:** any valid Google access token (from any Google app) with a matching, verified staff email would pass allowlist checks.
**Why it happens:** `getTokenInfo()`'s name and shape ("get info about *the* token") makes it easy to assume it validates provenance the way `verifyIdToken(audience)` explicitly does.
**How to avoid:** always compare `tokenInfo.aud === process.env.SHEETS_CLIENT_ID` (or `azp`) explicitly before trusting `tokenInfo.email`.
**Warning signs:** a test that only checks "valid token → authorized" without a companion "valid-but-wrong-audience token → rejected" test.

### Pitfall 2: `SameSite=None` cookies silently failing in local dev
**What goes wrong:** the session cookie never gets set/sent when developing against `http://localhost:*`, because `SameSite=None` requires `Secure`, and browsers refuse `Secure` cookies over plain HTTP.
**Why it happens:** production (`https://steinsandvines.ca` ↔ `https://*.up.railway.app`) is HTTPS-only, but the existing `allowedOrigins` list explicitly includes `http://localhost:3001`/`:8080` for dev.
**How to avoid:** branch cookie options on an `isProd`-style check (mirroring `validateEnv.js`'s existing `RAILWAY_ENVIRONMENT` pattern) — relax to `SameSite=Lax`, no `Secure`, in non-production.
**Warning signs:** "sign-in succeeds but every subsequent call comes back unauthorized" — classic symptom of a cookie that was never actually stored by the browser.

### Pitfall 3: Treating `kiosk.js`'s existing Google auth as something to layer under, rather than remove
**What goes wrong:** the planner scopes this as purely additive ("add a device token check"), leaving `kiosk.js`'s Google sign-in gate in place — the iPad continues requiring a real staff Google login just to reach the PIN pad, defeating the "single managed in-store iPad, trusted shared terminal" intent of D-46-01, and leaving the exact Apps-Script `check_auth` dependency this phase is meant to reduce.
**Why it happens:** CONTEXT.md's phrasing ("D-46-05 Google login everywhere, including the store iPad") reads, out of context, as if it applies to `kiosk.html` too — it's actually about `admin.html` opened on that same physical device, a distinct HTML page/JS bundle.
**How to avoid:** explicitly scope a task to remove `initGoogleAuth`/`showSignInButton`/`onTokenResponse`/`kioskCheckAuthorization`/the Google-specific parts of `showKioskApp`/`handleUnauthorized` from `js/kiosk.js`, replacing the entry gate with the device-token settings prompt, while keeping the PIN pad DOM/handlers intact.
**Warning signs:** a plan/task list for this phase that never mentions deleting code from `kiosk.js`, only adding to it.

### Pitfall 4: Assuming "remove `MW_API_KEY` from public bundles" is a one-line fix
**What goes wrong:** only `12-checkout.js:1512` gets fixed (per the CONTEXT.md-flagged line), leaving five other call sites across the same file plus two other files still sending the key (harmless post-rotation, since the key becomes invalid, but the header-sending code and its unused `MW_API_KEY` module-scope variable in `01-config.js` remain as dead/misleading code, and the *server-side* exemptions for `/bookings`, `/contacts`, `/payment/initialize` never get added, so those three endpoints keep 403ing for public visitors once the key really is removed from `sheets-config.js`).
**Why it happens:** the CONTEXT.md canonical ref only pointed at one representative line as an example, not an exhaustive list, and said explicitly to "sweep ALL public bundles for any other stragglers" — this is easy to under-scope if the sweep isn't actually run.
**How to avoid:** use Finding #1's full six-call-site, three-endpoint table directly when writing tasks; verify server-side exemptions are added for all three endpoints, not just deleting client-side headers.
**Warning signs:** after "removing the key," public checkout of a ferment order (which hits `/bookings`) or the contact-creation step (`/contacts`) starts returning 403 in staging.

## Code Examples

### Session-tier guard middleware (composed from Findings #4-#6)
```js
// Illustrative — combines Pattern 2 (session.js) + Pattern 3 (explicit route list) + Pattern 4 (getTokenInfo)
var session = require('./lib/session');

function requireStaffSession(req, res, next) {
  var sid = req.cookies && req.cookies.sv_session;
  if (!sid) return res.status(401).json({ error: 'Not signed in' });
  session.getSession(sid).then(function (s) {
    if (!s) return res.status(401).json({ error: 'Session expired' });
    req.staffEmail = s.email;
    next();
  });
}
```

### Google sign-in exchange endpoint
```js
// Illustrative — POST /auth/google, called once by admin.js/brewpad.js/(kiosk.js's admin modal)
// after the existing (unchanged) GIS token-client callback fires.
router.post('/auth/google', function (req, res) {
  var accessToken = req.body && req.body.access_token;
  if (!accessToken) return res.status(400).json({ error: 'Missing access_token' });

  verifyStaffAccessToken(accessToken) // Pattern 4, includes the aud check
    .then(function (email) {
      var allowlist = (process.env.STAFF_EMAILS || '').split(',').map(function (e) { return e.trim().toLowerCase(); });
      if (allowlist.indexOf(email) === -1) {
        return res.status(403).json({ authorized: false });
      }
      return session.createSession(email).then(function (sid) {
        res.cookie('sv_session', sid, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
          maxAge: 7 * 24 * 60 * 60 * 1000
        });
        res.json({ authorized: true, email: email });
      });
    })
    .catch(function (err) {
      log.warn('[auth/google] verification failed: ' + err.message);
      res.status(401).json({ authorized: false });
    });
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|---------------|-------------------|----------------|--------|
| Single shared secret (`MW_API_KEY`) in a public `<script>`-loaded config file, gating almost every mutating route | Per-surface credential (device token / session / legacy-during-window) with server-independent identity verification | This phase | Closes the audit's CRITICAL finding; the shared secret can no longer be read off the public site to fully compromise the auth model |
| Apps-Script-based `check_auth` (validates a client-fetched userinfo email against a Google-Sheet `Config!staff_emails` row) | Express-middleware-based verification (`getTokenInfo` + `STAFF_EMAILS` Railway env) | This phase | Moves the allowlist's source of truth off a spreadsheet the client could theoretically influence indirectly, onto a server-only env var; also removes a dependency on Apps Script being reachable for every sign-in |
| `kiosk.js` requiring full per-staff Google sign-in before the PIN pad | Device token (once, at provisioning) + PIN (per shift) | This phase | Matches the "single managed in-store trusted terminal" reality — staff no longer need a Google account to operate the register at all |

**Deprecated/outdated:** the OAuth2 *implicit* token flow (`initTokenClient`) itself is a legacy pattern by modern OAuth2 standards (the industry has broadly moved to Authorization Code + PKCE), but Google's GIS library still fully supports and documents it, and switching away from it is explicitly **not** required to close this phase's audit finding — see the "Alternatives Considered" note on `google.accounts.id`/`initCodeClient`. Recommend not conflating "modernize the OAuth flow" with "fix the leaked-secret auth model" — they're separable concerns, and this phase's mandate is the latter.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Discount-preset CRUD (`/api/kiosk/discounts*`) should be kiosk-scoped (device token), not admin-scoped (session) | Finding #2 | If wrong, a stolen/shared iPad token could alter store-wide pricing rules without staff attribution — planner/owner should explicitly confirm this bucket assignment, since CONTEXT.md's exclusion list doesn't name it either way |
| A2 | Migrating kiosk's 3 customer-search call sites from `/api/contacts?search=` to the existing `/api/contacts/search` route is in-scope for this phase (rather than leaving the scope leak and just widening kiosk-token access to full `/api/contacts`) | Finding #2 | If the planner instead grants the device token access to full `/api/contacts`, the kiosk token's blast radius on theft grows to a full customer PII dump — worth an explicit owner sign-off either way |
| A3 | Removing `/bookings`, `/contacts`, `/payment/initialize` from the key/referer guards (mirroring `/checkout`/`/promo/validate`'s existing keyless-plus-referer-only bar) is an acceptable residual risk profile, consistent with this codebase's own precedent | Finding #1 | If the owner considers this insufficient, these three routes may need their own recaptcha verification added as part of this phase rather than deferred — a scope-size decision, not a technical unknown |
| A4 | A hand-rolled `lib/session.js` (not `express-session`) is the right call for this codebase | Standard Stack / Alternatives Considered | If the team would rather have the ecosystem-standard session middleware for its edge-case maturity, this is a reasonable, defensible alternative — flagged as a real choice, not a certainty |

## Open Questions

1. **[RESOLVED in planning — 46-03 assumption A1: kiosk-scoped]** **Should discount-preset CRUD (`/api/kiosk/discounts*`) be kiosk-scoped or admin-scoped?** Resolved: classified kiosk-scoped in 46-03 `KIOSK_ROUTES` (matches current reality, no PII/refund); surfaced for owner re-bucketing at the 46-10 cutover review.
   - What we know: it lives on the standalone kiosk today, ungated by Google auth even now; it has real (if modest) financial-policy impact.
   - What's unclear: CONTEXT.md's explicit exclusion list doesn't mention it either way.
   - Recommendation: default to kiosk-scoped (matches current reality), but have the planner surface this explicitly to the owner during plan review rather than deciding silently.

2. **[RESOLVED in planning — 46-03 assumption A3 / 46-08: inherit /promo/validate bar]** **Should `/api/bookings`, `/api/contacts`, `/api/payment/initialize` get their own recaptcha check as part of this phase, or inherit the existing referer+rate-limit-only bar that `/promo/validate` already has?** Resolved: inherit the existing bar (accepted residual, recorded in 46-03 threat model T-46-06 and the 46-10 audit-trail note); added-recaptcha is out-of-scope-unless-owner-requests.
   - What we know: `/checkout` alone is recaptcha-verified today; the other two are not, and never have been.
   - What's unclear: whether "eliminate the shared-secret model" is meant to also close this adjacent, pre-existing gap, or whether that's separate hardening work.
   - Recommendation: treat as out-of-scope-unless-free (same framing CONTEXT.md already uses for the gift-card-lookup-GET item), but name it explicitly in the phase's audit-trail notes so it isn't silently swept under "done."

3. **[RESOLVED in planning — 46-01 Task 3: coarse hourly refresh]** **Exact session TTL-refresh cadence (refresh Redis TTL on every request vs. every N minutes)?** Resolved: `touchSession` re-sets the 7-day TTL only when >1h since last refresh (sliding idle expiry, minimal Redis writes).
   - What we know: D-46-06 specifies a ~7-day *idle* expiry, meaning it must be sliding, not fixed-at-issuance.
   - What's unclear: whether refreshing Redis on literally every authenticated request is an acceptable write-volume increase, or whether a coarser refresh (e.g. only if >1hr since last refresh) is preferred.
   - Recommendation: coarser refresh (e.g. hourly) — negligible UX difference at a 7-day scale, meaningfully less Redis write volume; planner's call to confirm.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|--------------|-----------|---------|----------|
| Node.js | Middleware runtime | ✓ | v20.17.0 (local); Railway managed | — |
| `google-auth-library` | Server-side token verification | Not yet installed (net-new dependency, verified installable) | 10.9.0 available on npm | — |
| `cookie-parser` | Session cookie parsing | Not yet installed (net-new dependency, verified installable) | 1.4.7 available on npm | — |
| Redis | Session store | ✓ (existing `REDIS_URL`, already required for rate-limit/locks per Phase 45) | — | In-process Map fallback (Finding #5) — must not sign everyone out on a blip |
| Railway env var management | `STAFF_EMAILS`, `KIOSK_DEVICE_TOKEN`, rotated `API_SECRET_KEY`, optional `API_SECRET_KEY_PREVIOUS` | ✓ (owner has Railway dashboard access, already used for existing secrets) | — | — |

**Missing dependencies with no fallback:** none — both net-new npm packages are readily installable and verified legitimate.
**Missing dependencies with fallback:** Redis outage during session lookups — see Finding #5's in-process fallback design.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|-----------------|---------|--------------------|
| V2 Authentication | Yes | Server-side verification of the Google access token via `getTokenInfo` + explicit `aud` check (Finding #4/#7); constant-time device-token comparison (Pattern 1) |
| V3 Session Management | Yes | Opaque, high-entropy, server-generated session ID; httpOnly + Secure + SameSite=None cookie; server-side revocation via `destroySession`; sliding idle expiry |
| V4 Access Control | Yes | Three-tier route guard (legacy/kiosk/session) with explicit per-route allowlists (Finding #6, Pattern 3) — no path-prefix guessing |
| V5 Input Validation | Partial | `STAFF_EMAILS` parsing (trim/lowercase/split), device-token header presence/length checks before `timingSafeEqual` (mirrors existing `lib/apiKey.js`/PIN pattern) |
| V6 Cryptography | Yes | `crypto.randomBytes(32)` for session IDs and (owner-generated) device token; `crypto.timingSafeEqual` for all secret comparisons — never hand-rolled JWT/signature verification (`google-auth-library` owns that entirely) |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|-----------------------|
| Token substitution — presenting a valid Google access token issued to a *different* application, with a matching staff email | Spoofing | Explicit `tokenInfo.aud === CLIENT_ID` check on every `getTokenInfo()` result (Finding #4/#7 pitfall) |
| Session fixation / cookie theft via XSS | Spoofing / Elevation of Privilege | `httpOnly` cookie (unreadable to JS), `Secure` (HTTPS-only transport), server-side revocation on sign-out |
| CSRF against session-cookie-authenticated mutating routes | Tampering | `SameSite=None` intentionally weakens the CSRF-via-SameSite protection (a cross-site requirement given the two different registrable domains) — the existing `requireAllowedReferer` check (`server.js:73-87`) is the actual CSRF mitigation already in place for `/api/*`, and should be verified to still run for session-tier routes, not accidentally bypassed by the guard restructuring in Finding #6 |
| Device-token theft (stolen/lost iPad) | Spoofing | D-46-02's scope-limiting (kiosk-only routes, no admin-grade capability) is the primary mitigation — a stolen token can ring up sales but not dump PII or void certificates; D-46-04's owner-rotation-on-suspected-leak is the recovery path |
| Legacy-key stragglers surviving past intended rotation | Repudiation (untracked access) | Optional `API_SECRET_KEY_PREVIOUS` canary logging (Finding #6) to detect and attribute any caller still presenting the retired key |

## Sources

### Primary (HIGH confidence)
- Context7 `/googleapis/google-auth-library-nodejs` — `verifyIdToken`, `getTokenInfo` API reference (`_autodocs/api-reference-oauth2client.md`, `README.md`)
- Direct repo reads: `zoho-middleware/server.js`, `zoho-middleware/lib/apiKey.js`, `zoho-middleware/lib/cache.js`, `zoho-middleware/routes/{auth,bookings,pos,items,gift-cards}.js`, `zoho-middleware/package.json`, `zoho-middleware/jest.config.js`/`jest.setup.js`, `js/lib/auth.js`, `js/kiosk.js`, `js/admin.js`, `js/brewpad.js`, `js/sheets-config.js`, `js/modules/{12-checkout,16-catalog-subpage,17-search-overlay,01-config}.js`, `AUDIT-2026-06-29.md`
- `npm view google-auth-library version` / `time.modified`, `npm view cookie-parser version` — registry-verified 2026-07-02
- `slopcheck install google-auth-library cookie-parser` — both `[OK]`, run 2026-07-02

### Secondary (MEDIUM confidence)
- developers.google.com backend-auth / verify-google-id-token guides (via WebSearch, cross-checked against Context7's official library docs — not relied on alone)

### Tertiary (LOW confidence)
- none — every claim in this document traces to a repo read, Context7 doc, or registry check

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — both new packages are long-established, officially-maintained, Context7/registry-verified
- Architecture: HIGH — every pattern recommended is a direct extension of code already shipped and tested in this exact repository
- Pitfalls: HIGH — each pitfall traces to a specific, cited line of existing code or a documented library API behavior (the `getTokenInfo` audience gap in particular is Context7-confirmed, not inferred)

**Research date:** 2026-07-02
**Valid until:** 30 days (stable domain — Google's OAuth2/GIS APIs and this repo's own established patterns are not fast-moving; re-verify npm versions if planning is delayed past this window)
