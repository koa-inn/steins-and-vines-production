---
phase: 46-auth-re-architecture-critical-split-from-phase-45
plan: 02
subsystem: zoho-middleware/lib + routes (auth)
tags: [auth, security, google-oauth, session, tdd]
requires:
  - zoho-middleware/lib/session.js (createSession, destroySession) — 46-01
  - google-auth-library@10.9.0 (installed in 46-01)
provides:
  - zoho-middleware/lib/googleVerify.js (verifyStaffAccessToken)
  - "POST /auth/google (routes/auth.js)"
  - "POST /auth/logout (routes/auth.js)"
affects:
  - 46-03 (three-tier guard — will mount cookie-parser + requireStaffSession consuming sv_session)
  - 46-06/46-07 (admin/BrewPad already consume POST /auth/google contract — confirmed matching in this plan, no changes needed)
tech-stack:
  added: []
  patterns:
    - "Explicit tokenInfo.aud check on getTokenInfo() results (google-auth-library does not validate audience itself)"
    - "Server-derived-identity-only exchange endpoint (never reads email from req.body)"
key-files:
  created:
    - zoho-middleware/lib/googleVerify.js
    - zoho-middleware/__tests__/google-verify.test.js
    - zoho-middleware/__tests__/auth-google-route.test.js
  modified:
    - zoho-middleware/routes/auth.js
decisions:
  - "logout route reads req.cookies defensively (req.cookies && req.cookies.sv_session) since cookie-parser isn't mounted until 46-03 — route is safe to exist pre-guard-wiring, degrades to a no-op destroy + cookie clear until then"
metrics:
  duration: "~15 min"
  completed: "2026-07-03"
---

# Phase 46 Plan 02: Google Identity Verification + Sign-in/Sign-out Endpoints Summary

Built the server-side identity truth-source for admin/BrewPad staff auth: `lib/googleVerify.js` calls `google-auth-library`'s `getTokenInfo()` and enforces the mandatory explicit `aud` check the library does not perform itself, plus an `email_verified` check, returning only the lowercased Google-attested email — never a client-supplied one. `routes/auth.js` gained `POST /auth/google` (verify → STAFF_EMAILS allowlist → issue `sv_session` httpOnly cookie) and `POST /auth/logout` (destroy session + clear cookie).

## What Was Built

**Task 1 — `lib/googleVerify.js` (TDD RED → GREEN):** `verifyStaffAccessToken(accessToken)` calls a module-scope `new OAuth2Client()`'s `getTokenInfo(accessToken)`, then throws `Error('Token audience mismatch')` unless `tokenInfo.aud === process.env.SHEETS_CLIENT_ID` (T-46-02 — the mandatory audience-confusion mitigation), throws `Error('Email not verified')` unless `tokenInfo.email_verified` (T-46-15), and otherwise resolves the lowercased `tokenInfo.email`. `google-verify.test.js` mocks `google-auth-library`'s `getTokenInfo` with fixtures mirroring the real response shape (`aud`/`email`/`email_verified`/`scopes`/`expiry_date`/`sub`/`azp`) and covers the mandatory companion pair (matching-aud accept / wrong-aud reject), plus `email_verified: false` and a rejected `getTokenInfo` call. RED commit confirmed the test fails on `Cannot find module '../lib/googleVerify'` before the implementation existed; GREEN commit made all 4 tests pass.

**Task 2 — `POST /auth/google` + `POST /auth/logout`:** Added `googleVerify` and `session` requires to `routes/auth.js`. `/auth/google` reads only `req.body.access_token` (400 if missing), calls `verifyStaffAccessToken`, parses the `STAFF_EMAILS` allowlist (split/trim/lowercase), responds 403 `{authorized:false}` for verified-but-non-allowlisted emails, otherwise creates a session and sets the `sv_session` cookie (httpOnly, `secure`/`sameSite` prod-branched, 7-day maxAge, `path:'/'`), responding 200 `{authorized:true, email}`. Verification failures (wrong-aud, unverified, expired token) are caught, logged via `log.warn`, and mapped to 401 `{authorized:false}` — no internal error detail is ever exposed to the client (T-46-16, accepted-risk mitigation already satisfied by this generic-error design). `/auth/logout` reads `req.cookies && req.cookies.sv_session`, destroys the session if present, always clears the cookie, and responds 200 `{ok:true}`. `auth-google-route.test.js` (supertest, full mock roster mirroring `__tests__/api-key-guard.test.js`/`pii-access.test.js`, with `../lib/googleVerify` and `../lib/session` additionally mocked) covers: missing `access_token` → 400; non-allowlisted verified email → 403; allowlisted verified email → 200 + `Set-Cookie sv_session` (HttpOnly asserted); verify-throws → 401; and logout → 200 + cookie clear.

**Cross-check against already-merged consumers:** Wave-1 plans 46-05/46-06/46-07 (already merged to this branch from sibling worktrees) modified frontend code (`js/lib/auth.js`, BrewPad/admin session-cookie init) to call `POST /auth/google` with `{access_token}` and expect `{authorized: true}` (see commit `1c855f9`, `brewpad-auth-init.test.js`). This plan's implementation matches that contract exactly — no frontend changes were needed and none were made.

## Deviations from Plan

None — plan executed exactly as written. `google-auth-library` and `cookie-parser` were already installed under `zoho-middleware/package.json` by 46-01; no new dependency work was needed here.

### Environment note (not a plan deviation)

The worktree had no `node_modules` at either repo root or `zoho-middleware/` (fresh worktree checkout, `node_modules` is gitignored and not created automatically). Verified `package.json` is byte-identical to the main repo checkout at both levels (`diff` exit 0) and symlinked both `node_modules` directories from the main repo into the worktree to run tests without a redundant `npm install`. Symlinks are untracked and excluded by `.gitignore` (`node_modules/`) — no git-tracked changes result from this.

## Verification

- `cd zoho-middleware && npx jest __tests__/google-verify.test.js __tests__/auth-google-route.test.js --coverage=false` → 2 suites, 9 tests, all pass
- `grep -n "aud !== process.env.SHEETS_CLIENT_ID" zoho-middleware/lib/googleVerify.js` → present
- `grep -n "req.body" zoho-middleware/routes/auth.js` → only `req.body.access_token` (no email read from body)
- Full middleware suite: `cd zoho-middleware && npm test` → 59 suites, 1153 tests, all pass
- Full frontend suite: `npm test` (repo root) → 53 suites, 947 tests, all pass
- `cd zoho-middleware && npm run lint` → 0 errors (60 pre-existing warnings across the repo, none introduced by this plan; `routes/auth.js`'s 2 warnings for `crypto`/`axios` unused-vars predate this plan's changes)

## Self-Check

Files:
- FOUND: zoho-middleware/lib/googleVerify.js
- FOUND: zoho-middleware/__tests__/google-verify.test.js
- FOUND: zoho-middleware/__tests__/auth-google-route.test.js
- FOUND: zoho-middleware/routes/auth.js (modified)

Commits:
- d9aac77 test(46-02): add failing test for server-side Google token verification
- 2e90dfb feat(46-02): add lib/googleVerify.js with mandatory aud check
- 7b9c6ef feat(46-02): add POST /auth/google and POST /auth/logout routes

## Self-Check: PASSED
