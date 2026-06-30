# Phase 45: Security and Money-Path Hardening (audit critical and high) - Context

**Gathered:** 2026-06-29
**Status:** Ready for planning

<domain>
## Phase Boundary

Close the **verified CRITICAL + HIGH findings** from the 2026-06-29 multi-agent audit (`AUDIT-2026-06-29.md` — 1 critical, 7 high, 0 refuted) plus the safe quick-win containments, **without weakening the v4.2/v4.4-hardened online checkout money path** (existing money-path tests stay green).

In scope: the public-key/auth-model exposure, the unguarded PII kiosk GETs, Redis-outage fail-open, the kiosk `pos.js` money-path weaknesses (un-hardened re-impl of `checkout.js`), the CI artifact-drift gap, and the quick-win containments.

Out of scope (→ phases 46+): the 25 medium / 16 low / 3 info findings — mobile-responsive (iOS auto-zoom inputs, <44px touch targets, safe-area), testing/CI coverage floors + `--max-warnings 0` lint gate + ES5 lint rule + money-path E2E, webhook replay/dedup hardening, Sentry-on-money-path observability, dependency hygiene (`npm ci`, Node `engines` pin), and the frontend `kiosk.js` "Confirm Manually" phantom-payment finding (Medium — lands with Phase 42 de-fork).
</domain>

<decisions>
## Implementation Decisions

### Auth re-architecture (CRITICAL — the headline)
- **D-01:** The kiosk is a **single managed iPad that never leaves the store, on the store WiFi** → device/network trust is a legitimate boundary. Kiosk uses a **trusted shared terminal** model (one device-bound session/credential; no per-staff login mid-sale).
- **D-02:** The **admin panel (`admin.html`) is also opened from other devices** (laptop/phone/off-site) → admin MUST move to **real per-user Google OAuth** (reuse the existing v1.1 BrewPad OAuth: `routes/auth.js`, `js/lib/auth.js`). Admin is the more sensitive surface — do not leave it on shared-secret/device trust.
- **D-03:** The admin API key **must stop shipping in public, git-tracked JS**. Remove `MW_API_KEY` from `js/sheets-config.js`; **public pages (index/products/contact/404) carry no admin key at all** (they never needed it). The kiosk's credential becomes **device-provisioned** (entered/stored once on the iPad, not served to every visitor).
- **D-04:** **Rotate the leaked key at cutover** with the new auth (not before) — the iPad currently authenticates with it, so rotating early breaks the kiosk. The leaked key stays valid until cutover; acceptable because exploiting it still requires reaching the middleware, and an interim network containment (D-05) can front-run it.
- **D-05:** Store WiFi public IP **may be dynamic** — an IP allowlist is a *possible* fast interim but is fragile if the IP rotates. Prefer a **device-provisioned credential** as the durable kiosk mechanism; planner to confirm whether a network allowlist is worth standing up as a stopgap given the rotate-at-cutover decision (likely not needed if cutover is quick).

### Redis-outage policy (HIGH)
- **D-06:** During a Redis outage, **keep selling** — fall back to **in-process (per-process MemoryStore) limits/locks** rather than fail-closed. The middleware is a **single Railway instance**, so in-process fallback covers ALL traffic and is nearly as safe as Redis. Do NOT halt the money path on a cache blip.
- **D-07:** **PIN brute-force limiting is always-on in-process** regardless of Redis state (security-critical; a 4-digit PIN must never be unthrottled).
- **D-08:** Fix the **factually-wrong comments** claiming a MemoryStore fallback exists today (the current `skip: redisUnavailableSkip` bypasses the store entirely). The fix makes the comment true.

### Unguarded PII routes + CI (HIGH)
- **D-09:** Add `/api/kiosk/salesorders` and `/api/kiosk/salesorder/:id` to `PII_GET_ROUTES` (or inline `apiKeyGuard.matches()` like sibling routes) — closes unauthenticated read of the order book. Quick-win, first wave.
- **D-10:** Add a **CI artifact-drift check** that rebuilds and fails if the tracked `.min.js` GitHub Pages serves diverges from source — scoped to deterministic minify output (exclude `Date.now()` cache-buster stamps; the audit confirmed current artifacts are in sync, so this is drift-prevention).

### Money-path hardening (HIGH — backend only)
- **D-11:** **Extract `checkout.js` safety primitives into shared backend helpers** used by both checkout and kiosk paths: atomic `cache.acquireLock()` (409 on contention), error-propagating payment recording, void-on-failure, and terminal-timeout handling. Nearly every money High is "kiosk `pos.js` lacks what `checkout.js` already has" — fix the divergence structurally, not per-route.
- **D-12:** Specific closures: kiosk `sale`/`confirm` get atomic idempotency (no more non-atomic get-then-set; required `idempotency_key`; deterministic Helcim key); `confirm` must **propagate** payment-recording failures so the outer void fires (no more 201 `ok:true` on a swallowed failure); gift-card split-tender must **validate applied amount vs real balance** and set `needs_manual_review` on redeem failure.
- **D-13 (Claude's discretion — orphan defense depth):** Implement **synchronous void-on-failure everywhere PLUS a bounded Helcim↔Zoho reconciliation backstop** (periodic/webhook job that flags or auto-voids any charge with no matching Zoho order). Rationale: a real orphan charge already occurred; synchronous void cannot catch a *late* terminal approval after the 90s timeout. Plan the backstop as a **separable task** so it can be trimmed if planning shows it's too large for this phase. Absorbs the incident thread's #107/#8. Mirror the correct pending-charge pattern at `routes/collect.js:99`; reconcile via `lib/helcim.js` transaction lookup keyed by `reference_number`.
- **D-14 (Claude's discretion — Phase 42 coordination):** **Backend-first, independent of Phase 42.** The money findings are all server-side (`routes/pos.js` + shared `lib`); the Phase 42 de-fork is a frontend (`kiosk.js`/`admin.js`) concern. Phase 45 stays backend-only. The frontend "Confirm Manually" phantom-payment finding is deferred to 46+/Phase 42.

### Sequencing & deploy
- **D-15:** **First wave ships to prod now** (owner-approved): guard the 2 PII routes (D-09), deploy the already-committed `#2` (`e8b81ce`, API-key header-only) + `#10` (`7c68f05`, PII-log redaction) via `railway up`, `KIOSK_PIN` length-check before `timingSafeEqual` (a misconfig currently 500s every login → staff lockout), and gitignore + remove `dump.rdb`. Auth re-architecture and money-path hardening follow as **later waves**.
- **D-16:** **Bundle the gift-card split-tender fix verification with Phase 44's deferred live gift-card UAT** — one controlled real-card test session verifies both the deferred P44 behavior and the new balance-validation fix (avoid running the live gift-card test twice). See `44-08-UAT.md`.
- **D-17:** Standard cadence: staging-first for frontend; middleware deploys straight to the prod Railway instance (no staging middleware) after tests pass. Money-path waves get extra care given the live UAT dependency.

### Claude's Discretion
- D-13 (orphan-defense depth) and D-14 (P42 coordination) were explicitly delegated ("you decide") — decisions + rationale recorded above. Both are revisitable in planning if the reconciliation backstop proves too large (split candidate) or if a frontend money item must move earlier.

### Phase-size note (for planner)
This phase is large. The **auth re-architecture (D-01..D-05)** and the **reconciliation backstop (D-13)** are the two heaviest chunks and the natural split-out candidates if the phase becomes unwieldy. Wave the plan heavily: Wave 1 = quick-win containments (D-15, already partly committed); Wave 2 = PII routes + Redis-outage policy + CI drift; Wave 3 = money-path shared-primitive extraction + split-tender; Wave 4 = auth re-architecture (kiosk device cred + admin OAuth + key removal + rotate-at-cutover); reconciliation backstop as its own track.
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Audit source (primary — the findings, evidence, and recommendations)
- `AUDIT-2026-06-29.md` — full consolidated audit; every Phase 45 item traces to a finding here with `file:line` evidence. The §2 Critical & High table and §5 Systemic Themes are the spine of this phase.

### Money-path gold standard (the pattern to mirror)
- `zoho-middleware/routes/checkout.js` — the v4.2-hardened, server-authoritative flow: `cache.acquireLock()` (~line 166), transaction-id replay guard, fail-closed-in-prod, `rejectWithVoid`, dual-cart void guard. The shared primitives (D-11) are extracted FROM here.
- `zoho-middleware/routes/collect.js` (~line 99) — correct pending-charge/timeout pattern to mirror for terminal-timeout reconciliation (D-13).

### Already-landed this session (do NOT re-do; build on)
- `zoho-middleware/lib/apiKey.js` + commit `e8b81ce` (#2) — unified header-only constant-time key guard; reuse `apiKeyGuard.matches()` for D-09.
- `zoho-middleware/lib/redact.js` + commit `7c68f05` (#10) — email redaction; already deployed-pending (D-15).

### Existing auth to reuse (admin OAuth)
- `zoho-middleware/routes/auth.js`, `js/lib/auth.js`, `zoho-middleware/lib/zohoAuth.js` — existing Google OAuth staff identity (validated v1.1, used by BrewPad). Admin re-architecture (D-02) extends this, not a new build.

### Exposure + integration points
- `js/sheets-config.js:65` — where the leaked `MW_API_KEY` lives (remove). Loaded by `kiosk.html`, `admin.html`, `index.html`, `products.html`, `contact.html`, `404.html`.
- `zoho-middleware/server.js` — global `/api` guard (`~:265`), `PII_GET_ROUTES` allowlist (`~:416`), rate limiters + `redisUnavailableSkip`/`makeRedisStore` (`~:294-397`).
- `zoho-middleware/routes/pos.js` — kiosk money handlers (sale/confirm/salesorder-pay/redeem) to harden; the 2 unguarded PII GETs at `~:1303` and `~:2638`.
- `zoho-middleware/routes/webhooks.js` + `zoho-middleware/lib/helcim.js` — Helcim cardTransaction webhook + transaction lookup, the hook for the reconciliation backstop (D-13).

### Coordination
- `.planning/phases/44-kiosk-gift-card-certificate-lifecycle/44-08-UAT.md` — Phase 44 deferred live gift-card UAT; bundle the split-tender verification here (D-16).
- `PROJECT_ASSESSMENT.md` — referenced by PROJECT.md/ROADMAP for the Phase 42 de-fork (#14) context (D-14 coordination).
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`checkout.js` safety primitives** — `cache.acquireLock()`, replay guard, `rejectWithVoid`, error-propagating payment recording. Extract to a shared `lib` module (e.g. `lib/money-path.js`) consumed by both checkout and `pos.js` (D-11).
- **`lib/apiKey.js` `apiKeyGuard.matches()`** — drop-in for the PII-route guard (D-09).
- **`lib/redact.js`** — already in use; nothing further needed.
- **Existing Google OAuth stack** (`routes/auth.js`, `js/lib/auth.js`, `lib/zohoAuth.js`) — admin per-user identity (D-02).
- **`express-rate-limit` MemoryStore** — already a dependency; removing the `skip` lets it apply per-process (D-06).
- **`lib/helcim.js` transaction lookup** + **webhooks.js cardTransaction** — reconciliation backstop inputs (D-13).

### Established Patterns
- Money path is **server-authoritative + fail-closed-in-prod** (`checkout.js`). Phase 45 brings `pos.js` up to this bar without regressing checkout (existing money-path tests are the guardrail).
- **Gift-card balance is protected by Apps Script `LockService`** (Phase 44 D-44-02) — so split-tender loss is bounded to the shortfall, not full face value; the fix is validation + `needs_manual_review`, not a balance rewrite.
- **Per-file Jest env isolation** now exists (`zoho-middleware/jest.setup.js`) — new money/auth tests inherit clean key env.
- **Staging-first** (frontend) / **middleware → prod Railway** deploy; build artifacts via `npm run build`; ES5-only frontend.

### Integration Points
- Auth cutover touches: `js/sheets-config.js` (remove key), kiosk credential provisioning (new), `admin.html` OAuth gating, `server.js` guard/allowlist, and the Railway `API_SECRET_KEY` rotation (owner action at cutover).
- Money-path extraction touches: `routes/pos.js` handlers + new shared `lib` helper + `routes/checkout.js` (refactor to consume the shared helper without behavior change).
- Redis policy touches: `server.js` limiter/store wiring + `lib/cache.js` lock fallback.
</code_context>

<specifics>
## Specific Ideas

- Kiosk auth target: a **device-provisioned credential on the in-store iPad**, NOT a key in public JS — exact mechanism (long-lived device token vs client cert vs first-run provisioning) is for research/planning, but the constraint is "no shared secret reaches a public page."
- Admin must require **per-user Google login** before privileged actions, since it's used off the store network.
- Reconciliation backstop should key the Helcim↔Zoho match on **`reference_number` = Helcim transaction id** (same join the incident thread used to reconcile the orphan).
</specifics>

<deferred>
## Deferred Ideas

- **All 25 medium / 16 low / 3 info audit findings → phases 46+:** mobile-responsive (iOS auto-zoom on cart/customer-search inputs, <44px touch targets, safe-area/`:has()` fallbacks), testing/CI (per-file coverage floors for `pos.js`/`kiosk.js`, `--max-warnings 0` lint gate, ES5 `ecmaVersion` lint rule, money-path E2E), webhook replay/dedup hardening (timestamp-freshness + event-id dedup), Sentry `captureException` on money-path catches, dependency hygiene (`npm ci --omit=dev`, Node `engines` pin, `globals` devDep). Source rows in `AUDIT-2026-06-29.md` §3.
- **Frontend `kiosk.js` "Confirm Manually" phantom-payment (Medium)** — touches the kiosk fork; lands with Phase 42 de-fork, not Phase 45.
- **Split candidates if Phase 45 grows too large:** the auth re-architecture (D-01..D-05) and the reconciliation backstop (D-13) can each become their own phase.

### Reviewed Todos (not folded)
None — no pending GSD todos matched (`todo_count: 0`).
</deferred>

---

*Phase: 45-security-and-money-path-hardening-audit-critical-and-high*
*Context gathered: 2026-06-29*
