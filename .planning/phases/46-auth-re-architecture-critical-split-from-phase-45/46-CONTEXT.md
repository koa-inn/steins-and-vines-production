# Phase 46: Auth Re-Architecture (CRITICAL — split from Phase 45) - Context

**Gathered:** 2026-07-02
**Status:** Ready for planning

<domain>
## Phase Boundary

Eliminate the shared-secret browser auth model: stop shipping the admin API key (`MW_API_KEY` = Railway `API_SECRET_KEY`) in public git-tracked JS, move staff surfaces to server-side identity, and rotate the leaked key at cutover — closing the CRITICAL auth-model exposure from `AUDIT-2026-06-29.md` **without locking out the in-store kiosk**.

Three staff surfaces migrate: the kiosk (device-provisioned token), admin (per-user Google OAuth + server session), and BrewPad (same session model — it already Google-signs-in). Public pages (index/products/contact/subpages/404) go keyless.

Out of scope: money-path / Redis / CI work (done in Phase 45); medium/low/info audit findings (phases 47+); Phase 42 kiosk de-fork (coordinate only — frontend auth gating overlaps it).

**The roadmap's pre-planning gate is satisfied:** the kiosk device-credential mechanism is decided below (D-46-01).
</domain>

<decisions>
## Implementation Decisions

### Kiosk device credential (the pre-planning gate — owner signed off 2026-07-02)
- **D-46-01 Mechanism: typed-in device token.** Owner generates a long random token (stored server-side as an env var alongside the rotated key). It is entered ONCE on the iPad via a small hidden settings prompt on `kiosk.html`, persisted in `localStorage`, and sent as a request header. No pairing flow, no client certs. The existing staff PIN (`KIOSK_PIN`) continues to gate staff actions on top of the device credential.
- **D-46-02 Scope: kiosk-only.** The device token authorizes kiosk endpoints (sale/confirm/status, products, gift-card lookup + redeem tender, custom lines) but NOT admin-grade routes (consignment reports, gift-card VOID, batch admin, PII list endpoints beyond what the kiosk needs). A stolen iPad token can ring up sales but cannot dump reports or void certificates. Planner: derive the exact endpoint split from what `kiosk.js` actually calls.
- **D-46-03 Recovery: re-enter from password manager.** The token lives in the owner's password manager + Railway env. If Safari storage is cleared / iPad replaced, trusted staff (or owner by phone) re-enters it via the settings prompt in ~30s. No break-glass flow built.
- **D-46-04 Lifetime: until manually rotated.** No expiry. Rotation (staff departure, suspected leak) = update Railway env + re-enter on iPad.

### Admin login & sessions
- **D-46-05 Google login everywhere, including the store iPad.** Any `admin.html` action requires a per-user Google session — voids and reports are attributable to a person. The device token never unlocks admin routes (consistent with D-46-02).
- **D-46-06 Session model: server session cookie, ~7-day idle expiry.** The middleware verifies the Google ID token once at sign-in (server-side verifier is NET-NEW — see canonical refs), then issues its own httpOnly session cookie backed by Redis. Server-side revocation possible. Frontend GIS wiring (`js/lib/auth.js`) is reused for the sign-in step only.
- **D-46-07 Staff allowlist: Railway env var** (comma-separated emails, STAFF_EMAILS-style). Changes are a Railway edit — rare event. Server-side enforcement; any client-side allowlist becomes cosmetic only.
- **D-46-08 Privilege tiers: everyone equal.** One allowlist, one level. No owner tier; attribution via the Google identity is sufficient for the small trusted team.

### Staff surface coverage
- **D-46-09 BrewPad migrates in this phase, same session model as admin.** Rotation breaks anything still sending the old key, and `brewpad.js` ships it today — so BrewPad points its existing Google sign-in at the new server session and drops the key. One auth system across all staff surfaces.
- **D-46-10 Public pages go keyless.** Public bundles simply stop sending `x-api-key` — server-side, GETs and `/checkout` + `/promo/validate` + webhooks are already exempt from the key guard. Researcher MUST verify the one public-bundle POST at `js/modules/12-checkout.js:1512` (and sweep for stragglers) and the planner wires an exemption/alternative if a public POST genuinely needs one.

### Cutover & rotation logistics
- **D-46-11 Dual-accept window.** New auth deploys alongside the old key (both accepted). Surfaces migrate one at a time — provision the iPad, sign in on admin/BrewPad, verify — then the owner rotates `API_SECRET_KEY` to end the window.
- **D-46-12 Window target: days, not weeks.** Rotate within ~2–3 business days of the new auth going live — enough for a couple of normal store days' soak, short enough the leaked key doesn't linger. Plan rotation as a scheduled owner action with a checklist.
- **D-46-13 D-05 interim IP allowlist: SKIPPED (confirmed).** Phase 45 Wave-1 containment already shipped, cutover is days away once this phase executes, and the store IP may be dynamic. D-05 is closed as "not needed".

### Claude's Discretion
- Exact endpoint split for the kiosk-scoped token (from actual `kiosk.js` call inventory).
- Header name / storage key naming for the device token; settings-prompt UX details.
- Session store implementation details (Redis key shape, TTL refresh semantics), sign-out affordance, and unauthenticated-visitor UX on `admin.html`/`brewpad.html` (login gate before content).
- Old-key canary logging after rotation (log any request still presenting the rotated key) — recommended but planner's call.
- Treatment of the public POST at `12-checkout.js:1512` once research identifies what it calls.
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Audit source (the CRITICAL this phase closes)
- `AUDIT-2026-06-29.md` — §2 Critical row: admin API key published in git-tracked, publicly-served JS; §5 systemic themes. Every Phase 46 requirement traces here.

### Prior decisions (carried forward)
- `.planning/phases/45-security-and-money-path-hardening-audit-critical-and-high/45-CONTEXT.md` — D-01..D-05 origin (kiosk = trusted shared terminal; admin = per-user OAuth; no secret on public pages; rotate at cutover; D-05 now closed by D-46-13).

### Exposure + guard surface (the code being re-architected)
- `js/sheets-config.js:65` — the leaked `MW_API_KEY` (remove). Loaded by `kiosk.html`, `admin.html`, `brewpad.html`, `index.html`, `products.html`, `contact.html`, `404.html`, product subpages.
- `zoho-middleware/server.js:257-270` — global `/api` guard: GETs exempt; `/checkout`, `/promo/validate`, `/webhooks/*` exempt; single `API_SECRET_KEY` for all other POSTs. This is where dual-accept + scoped credentials land.
- `zoho-middleware/lib/apiKey.js` — constant-time header-only key guard (`apiKeyGuard.matches()`); pattern to extend for the device token + dual-accept.
- `js/modules/12-checkout.js:1512` — the one public-bundle POST sending `x-api-key`; researcher must identify the endpoint and decide its keyless treatment (D-46-10).

### Existing auth building blocks (reuse vs net-new — do not confuse)
- `js/lib/auth.js` — frontend-only GIS helper (token client + `/oauth2/v3/userinfo` fetch). REUSE for the sign-in step.
- `zoho-middleware/routes/auth.js` + `zoho-middleware/lib/zohoAuth.js` — **Zoho** OAuth (server↔Zoho tokens), NOT Google staff auth. Do not build on top of it by name-confusion.
- **NET-NEW:** server-side Google ID-token verifier + staff allowlist + Redis-backed session issuance. Guard registration mirrors the existing pattern at `zoho-middleware/server.js:416-423` (`PII_GET_ROUTES` allowlist wiring).

### Coordination
- `PROJECT_ASSESSMENT.md` — Phase 42 kiosk de-fork context; frontend auth gating overlaps the de-fork (kiosk surface exists standalone in `kiosk.html`/`js/kiosk.js` AND embedded in `admin.html`/`js/admin.js` — the device-token entry + scoping must account for both until de-fork lands).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`lib/apiKey.js` guard pattern** — extend to a small credential registry (old key during dual-accept, kiosk device token with scope, session check) instead of scattering checks.
- **Frontend GIS wiring (`js/lib/auth.js`)** — BrewPad and admin already load Google Identity Services; sign-in UX exists, only the server exchange is new.
- **Redis (`lib/cache.js`)** — session store backing; in-process fallback semantics from Phase 45 D-06 apply (a Redis blip must not sign everyone out mid-day → planner should consider session-cache fallback behavior).
- **Phase 45's `PII_GET_ROUTES` + guard registration (`server.js:416-423`)** — the pattern for route-scoped enforcement the kiosk-scope split (D-46-02) will follow.
- **Per-file Jest env isolation (`zoho-middleware/jest.setup.js`)** — new auth tests inherit clean env.

### Established Patterns
- **Fail-closed-in-prod** for anything money/PII (Phase 45 norm) — applies to token/session verification failures.
- **ES5-only frontend**, build via `npm run build` (kiosk/admin/brewpad bundles all regenerate + cache-bust; never edit `.min.js`).
- **Staging-first frontend, middleware straight to prod Railway** — NOTE (discovered 2026-07-02): Railway auto-deploys from `koa-inn/steins-and-vines-production` on `zoho-middleware/**` changes; a prod force-push IS a middleware deploy.
- **Mock-mirrors-real-contract** test lesson (F1/F7): derive auth test fixtures from real Google ID-token / session shapes, not invented ones.

### Integration Points
- `js/sheets-config.js` (remove key) → all pages that load it.
- `kiosk.html`/`js/kiosk.js` + the admin-embedded kiosk (`admin.html` `#tab-kiosk` in `js/admin.js`) — device-token header on kiosk calls from BOTH surfaces; settings prompt on the standalone page (admin-embedded kiosk rides the admin session? — planner decides, but kiosk-on-iPad is the standalone page per D-01).
- `admin.html`/`js/admin.js`, `brewpad.html`/`js/brewpad.js` — replace `x-api-key` with session cookie (`credentials: 'include'`) on staff calls; CORS implications (middleware on Railway domain, pages on steinsandvines.ca) — cookie needs `SameSite=None; Secure` + CORS `Access-Control-Allow-Credentials`; planner must verify the existing CORS setup.
- Railway env: new vars (device token, staff allowlist, session secret) + the `API_SECRET_KEY` rotation itself (owner action ending the dual-accept window).
</code_context>

<specifics>
## Specific Ideas

- The kiosk settings prompt should be hidden/unobtrusive (e.g. reachable from the existing kiosk settings/PIN area), not a visible login screen — customers see this screen.
- Voids/reports must be attributable to a named staff member via the Google identity (a stated reason for D-46-05).
- Rotation day runs from a checklist: provision iPad → verify sale → sign in admin + BrewPad → verify void/report → rotate key → verify old key dead.
</specifics>

<deferred>
## Deferred Ideas

- **Owner privilege tier** (OWNER_EMAILS gating voids/payouts) — considered, declined for now (D-46-08); revisit if the team grows.
- **Break-glass pairing/recovery code for the kiosk** — declined (D-46-03); revisit if password-manager recovery proves painful.
- **Scheduled token rotation** — declined (D-46-04).
- **Old-key canary logging** — left to Claude's discretion in planning (cheap, recommended).
- Gift-card lookup GET is unauthenticated + enumerable (audit Low, `routes/gift-cards.js:59`) — adjacent to this phase's guard work but scoped to phases 47+ unless the planner finds it free to fold in.

### Reviewed Todos (not folded)
None — no pending GSD todos matched (`todo_count: 0`).
</deferred>

---

*Phase: 46-auth-re-architecture-critical-split-from-phase-45*
*Context gathered: 2026-07-02*
