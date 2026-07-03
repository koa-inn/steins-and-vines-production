---
gsd_state_version: 1.0
milestone: v4.5
milestone_name: Security & Money-Path Closeout
status: planning
last_updated: "2026-07-03T03:11:53.894Z"
last_activity: 2026-07-03
progress:
  total_phases: 0
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-06-19)

**Core value:** Customers can discover, select, or co-create fermentation recipes and purchase them as a complete package — with ingredient inventory, pricing, and batch tracking handled automatically by the system.
**Current focus:** Phase 46 — auth-re-architecture-critical-split-from-phase-45

## Current Position

Milestone: v4.5 Security & Money-Path Closeout — roadmap set (Phases 46–53). Phases 47 + 49-01 code landed; owner deploys/UAT pending.
Status: Executing — Phase 49 (MONEY-01) code done; Phase 47 (SEC-01) closed on staging; Phase 46 (SEC-02) cutover pending.
Last activity: 2026-07-03 — Phase 49-01 landed (captured-amount verification, H2 fix, suite green).

**Phase 49 / MONEY-01 (H2) — 49-01 code done, merged to main.** `/api/checkout` now reads back the captured amount (`helcimLib.getCardTransactionById`) and verifies it covers the invoice total (±$0.01) BEFORE side-effects/customerpayments; short/unverifiable → tagged throw routed through the existing `moneyPath.voidWithTimeout` (single void path) → 402. RED→GREEN commits + 13-test regression `checkout-captured-amount.test.js`; full middleware suite 62/1187 green; lint clean. **Pending: 49-02** live-card UAT (checkpoint) — needs the new code deployed (no staging middleware; rides a prod deploy / Phase 46 cutover): confirm a legit order still books paid (no false-void) + a tamper attempt is voided.

**Carryover — SEC-02 / Phase 46 (auth re-architecture):** code-complete + verified; **owner production cutover (46-10) is the immediate open work** — pending off-hours coupled deploy + `API_SECRET_KEY` rotation. Full runbook: `docs/RUNBOOK.md` § Phase 46 Auth Cutover. Resume with "let's do the cutover". Prod currently runs the OLD code with the OLD key restored (stable/working).

**Phase 47 / SEC-01 (H1) — ✅ CLOSED on staging (2026-07-03).** Audit doc untracked+gitignored+excluded (`065ed99`); Actions-based `deploy-staging.yml` strips `.planning/`+audit docs (`7116801`); owner flipped staging Pages source → GitHub Actions; fixed a concurrency-group collision that had cancelled the deploy (`b9ac218`). Verified live: `.planning/` + audit docs → 404, `.well-known/security.txt` + site → 200. **Prod:** audit-doc removal rides the next prod deploy (Phase 46 cutover); prod `.planning/` already stripped pre-existing. Note: `Tests` CI is red on a pre-existing dev-only `form-data` advisory (v4.5 OBS-01 scope).

## Performance Metrics

**Velocity:**

- Total plans completed: 47 (prior milestone v4.1) + 11 (v4.2)
- Average duration: 3 min
- Total execution time: ~3 hrs

## Accumulated Context

### Roadmap Evolution

- Phase 45 added (2026-06-29): Security & Money-Path Hardening (audit CRITICAL + HIGH). Source: `AUDIT-2026-06-29.md` — 7-lead multi-agent audit, 1 critical + 7 high verified (0 refuted). Headline: admin API key (= Railway `API_SECRET_KEY`) is published in git-tracked, publicly-served `js/sheets-config.js` → re-architect staff auth to server-side Google OAuth (no browser-shipped secret) + rotate. Plus: unguarded PII kiosk GETs, Redis-outage fail-open (rate-limit/locks/idempotency), kiosk `pos.js` re-implements `checkout.js` WITHOUT its safety guards (extract shared primitives — atomic lock, error-propagating payment recording, void-on-failure, timeout reconciliation; closes 4 highs incl. orphan-charge class), CI artifact-drift check, + quick-wins (deploy committed #2 e8b81ce/#10 7c68f05, KIOSK_PIN length-check, gitignore dump.rdb). Out of scope → phases 46+ (mediums/lows: mobile a11y, coverage floors/lint gate, webhook dedup, Sentry money-path, deps). Coordinate with un-started Phase 42 (kiosk de-fork) which overlaps the money-path work.
- Phase 44 added (2026-06-27): Kiosk gift card/certificate full lifecycle (GIFTCARD-01, owner-requested). Captured pre-discussion: full lifecycle (sell/redeem/balance/partial/reload); paper certificate w/ manually-assigned number (no barcode/digital v1); both forked surfaces. CRITICAL: gift-card sale is NOT taxed at sale (tax at redemption) + is a LIABILITY not revenue (Zoho deferred account) — NOT a custom line item. Redemption = tender path. Depends on Phase 43; plan after 43 ships. Interim stopgap: tax-exempt custom line can sell a certificate (no liability accounting).
- Phase 43 added (2026-06-26): Kiosk manual/custom line item with notes (KIOSK-02, owner-requested mid-milestone; independent of Phase 42). Locked decisions: tax = GST 5% default + per-line exempt toggle; price allows negative + large but UI confirms over $2k/negative; taxable custom line needs a GST tax_id (KIOSK_GST_TAX_ID env or catalog auto-discover) else fail-closed so terminal charge == Zoho invoice tax.

### Decisions

- [45-07]: D-12: balance lookup wraps axios.post in Promise.resolve() — fail-open even when Apps Script is unreachable; clamps gcApplied to min(realBalance, grandTotal) in both kiosk/sale and confirm paths before Helcim terminal / Zoho gift-card payment
- [45-07]: D-13: KIOSK_PENDING_CHARGE_PREFIX='kiosk:pending-charge:' (7-day TTL); written after every kiosk/sale terminal push and on salesorder-pay timeout (reference_number, amount, salesorder_id, idempotency_key, created_at); 45-08 reconciliation backstop consumes it
- [44-08 UAT]: Issue+reload money-in flow is DEFECTIVE as shipped — records a creditcard customerpayment (invoice→paid) with no real Helcim charge (phantom revenue). Owner-chosen fix model: **Cart + terminal checkout** — issue/reload add a gift-cert line to the kiosk cart, paid via the normal terminal flow, cert activated on payment SUCCESS (one cart invoice; no standalone pre-paid invoice). Gap G-44-01 in 44-08-UAT.md. Redeem path is correct (already charges terminal).
- [44-07]: GC panel gates terminal push on both surfaces — staff must Skip or Apply+Proceed before terminal starts (prevents accidental charges)
- [44-07]: gift_card_only path (202+pending:false, gift_card_only:true) → immediate /confirm with gift_card, no transaction_id; terminal skipped for full-coverage redemptions
- [44-07]: Management modal (admin-only): kgcm-* IDs; void sub-view is mode-switch within openModal; reason required; 409 = already voided
- [44-05]: Reload ordering asymmetry: reload_gift_card increments balance FIRST before Zoho invoice/payment (protects customer value); Zoho failure logs CRITICAL + needs_manual_review (no auto-reversal, T-44-20 accepted). Void is status-only (no Zoho money movement).
- [44-03]: Issue route void-on-Zoho-failure: void_gift_card(reason:'zoho_invoice_failed') called fire-and-forget when zohoPost throws after Sheets row created (T-44-12 atomic safety). All Apps Script gift-card actions use axios.post (doPost server_token dispatch).
- [44-01]: ZOHO_TAX_ZERO_ID not required for gift-card invoice lines — item's own 0%/EXEMPT setting is sufficient (live Probe B in S&V Zoho). 44-03 and 44-05 must NOT pass a tax_id on gift-card lines.
- [44-01]: payment_mode:'others' accepted by Zoho but defaults to Undeposited Funds (account_id=109900000000000316) — 44-04 must pass explicit account_id for 'Gift Cards Sold' liability when recording gift redemption payment.
- [44-01]: D-04 deferral journal: monthly Dr 'Gift Card Sales' (Income) Cr 'Gift Cards Sold' (Liability) for unredeemed balance from GiftCards sheet; manual bookkeeper cadence, NOT code in v1.
- [44-01]: Confirmed live IDs: KIOSK_GIFT_CARD_ITEM_ID=109900000000873211, Gift Card Sales account_id=109900000000873209.
- [v4.4 Roadmap]: Phases are risk-ordered — low-risk infra/hygiene first (38 `.planning` gitignore, 39 snapshot publish), then 40 facility images (build/asset, no money path), then 41 SKU cart key (public cart, has frontend tests), then 42 kiosk de-fork LAST (highest-risk money-path refactor)
- [v4.4 Roadmap]: Each of the 5 v1 requirements maps to exactly one phase (HYGIENE-01→38, DEPLOY-04→39, ASSET-01→40, CART-01→41, KIOSK-01→42); phases are independent, sequencing is risk-ordering not hard dependency
- [v4.4 Roadmap]: Phase 42 (KIOSK-01) is a behaviour-PRESERVING de-fork — must not weaken the v4.2-hardened money path (terminal charge → Zoho invoice/payment → void-on-failure → dual-cart); success requires existing kiosk tests passing + a new admin-vs-standalone parity check
- [v4.4 Roadmap]: Phase 42 must resolve the existing drift where the kiosk product-type discount feature lives only in kiosk.js — after de-fork it is identical on both the standalone and admin-embedded kiosk surfaces
- [v4.4 Roadmap]: Phase 38 — staging is served directly from the repo (no deploy-strip workflow), so `.gitignore` + `git rm -r --cached .planning` is the actual fix for staging; the prod deploy-strip step stays as defense-in-depth
- [v4.4 Roadmap]: Phase 40 extends the existing product image pipeline (which is complete, 0 missing webp) to facility/about — not a duplicated script
- [v4.3 Roadmap]: Phase 34 (server enrichment) must ship before Phase 35 (scaling) — `cf_type` unit field drives weight-vs-pcs rounding logic
- [v4.3 Roadmap]: Phase 37 (BrewPad Recipe Manager) depends only on Phase 34, not 35/36 — it is independent of the money path and can be sequenced separately if needed
- [v4.3 Roadmap]: SCALE-03/04 and MOD-02 must flow through `pos-recipe.js` / `lib/pricing.js` — never client-trusted pricing
- [v4.3 Roadmap]: Scale factor = target_volume_l ÷ recipe.batch_size_l; linear for weight (kg/g), Math.ceil for pcs/unit
- [v4.3 Roadmap]: Locked-price recipes scale ingredient-cost portion proportionally; service/materials fees stay fixed; dynamic recipes price from scaled ingredient costs
- [v4.3 Roadmap]: Apps Script schema changes (if any in Phase 35/37) require manual redeploy — flag as human-action checkpoint in plans
- [v4.2 Roadmap]: No separate staging middleware — middleware changes deploy to the prod Railway instance; staging site calls prod middleware
- [Phase ?]: D-06 global fee-inclusive: locked recipes now charge locked_price * scale_factor + service_fee + materials_fee at ALL scale factors (even 1x)
- [Phase ?]: SCALE-04: recipe_snapshot now contains scaledIngredients + target_volume_l + scale_factor, enabling batch creation from scaled sale data
- [35-06]: Server-quote approach chosen — client fetches /api/kiosk/recipe-quote (dry-run) to guarantee displayed price === charged price with no client-side drift
- [Phase ?]: 36-01 complete
- [36-02]: detectRecipeSale now forwards target_volume_l + scale_factor onto batch payload from server-built snapshot (T-36-04 mitigated)
- [36-03]: computeRecipeQuote extended with modifiedIngredients 5th param; all three money-path entry points (quote/sale/confirm) price via computeModifiedRecipeTotal; confirm snapshot freezes modified_base_ingredients + is_modified (MOD-02)
- [Phase ?]: No save-as-new affordance on kiosk surface — UI-SPEC §2 confirmed (36-05)
- [Phase ?]: GAP-4: kioskFetchRecipeQuote write paths ungated; server total written to #kiosk-recipe-summary-price (D-06)
- [Phase ?]: GAP-5: .kiosk-recipe-prompt-view toggled on admin #kiosk-recipe-prompt for bounded scroll; Add-to-Cart sticky bottom:0
- [Phase ?]: GAP-6: #tab-kiosk .admin-input + .kiosk-volume-input font-size:1rem prevents iOS auto-zoom; admin bundle rebuilt via npm run build
- [Phase ?]: GAP-7: #kiosk-recipe-price-preview standalone card outside modify-wrap; save-as-new below Add-to-Cart; .btn-secondary 44px targets; .kiosk-modify-group-header td CSS class
- [36-18]: GAP-8: kioskFetchRecipeQuote drops sale-type gate; uses in-store preview default; re-renders #kiosk-recipe-ingredients from scaled quote.ingredients on both admin + kiosk surfaces
- [36-20]: handleCardTransaction must resolve invoice+status via getCardTransactionById API primary path — Helcim minimal webhook payload never includes event.data fields; device-pending fallback caches APPROVED only when Redis has a pending invoice (no false positives)
- [Phase ?]: 36-21: BrewPad session fast path — valid stored token bypasses Google silent-refresh; checkAuthorization fallback on error not authorized:false
- [36-22]: afterBatchWrite opts.listAffecting=false for plato/task writes (no list card impact); refreshOpenDetail async-safe via _selectedBatchId guard; task toggles use task.batch_id not _selectedBatchId
- [Phase ?]: 44-02: balance-write column resolution is runtime (headers.indexOf) in all handlers except issueGiftCard appendRow — robust to column reordering
- [Phase ?]: 44-02: updateGiftCardInvoice has no LockService — invoice number overwrite is idempotent and safe without a mutex
- [Phase ?]: 44-02: get_gift_cards routed to Google OAuth doGet (admin panel), not server_token — follows existing batch-tracking list pattern
- [Phase ?]: giftCardActivationFailed closure preferred over promise rejection — invoice is paid; must not propagate to outer catch (void trigger)
- [Phase ?]: runConfirm() extracted from router.post callback to allow confirm-level Redis idempotency check to wrap full confirm body (mirrors sale handler pattern)
- [Phase ?]: resolveDiscount gift_cert exclusion (Rule 2): discounting a gift cert face value is semantically wrong; all three discount scope loops exclude gift_cert lines
- [44-10]: alert() used for gift_card_activation_failed (blocking native dialog on both kiosk.js + admin.js D-08 parity); cert number(s) shown; staff cannot skip before cleanup
- [44-10]: gift_cert cart line adds certificate to kiosk cart on both surfaces (D-08 parity); activated post-payment by 44-09 confirm chain; _kioskGiftCertCounter separate from _kioskCustomCounter to avoid key collisions
- [45-05]: D-11 complete — shared lib/money-path.js created (acquireIdempotencyLock, assertTxnNotReplayed, markTxnUsed, rejectWithVoid, voidWithTimeout); checkout.js refactored to consume it (zero behaviour change); pos.js adoption in 45-06/07/08. When wiring pos.js: pass module-scope helcimLib/mailer/eventLog as explicit deps to rejectWithVoid and voidWithTimeout calls for Jest-safe mock behavior

### Pending Todos

None.

### Blockers/Concerns

- **[45 plan] Decision-coverage override (approved 2026-06-29):** Phase 45 plans intentionally do NOT cover D-01..D-05 (auth re-architecture — the CRITICAL key exposure). These are **split to Phase 46** (owner-approved). Decision-coverage gate is 10/15 by design; the 5 uncovered are the deferred set. verify-phase should treat their absence as expected, not a gap. Interim containment for the CRITICAL ships in Phase 45 Wave 1 (PII guards) + the audit's rotate-now option; residual key-validity-until-cutover risk documented (D-04).
- **[45-02 deploy ordering — plan-checker warning]:** 45-02 ships Wave-1 containments to prod, but 45-05 (checkout→money-path refactor, behaviorally inert) commits in Wave 1 first. Pin 45-02's `railway up` to the 45-01 commit (or gate 45-06/07/08 commits behind 45-02) so un-UAT'd kiosk money-path hardening (45-06/07/08) does NOT reach prod before the 45-09 live-card UAT (D-16/D-17).
- BEER_SALES_ENABLED is now `true` in Railway production (confirmed live 2026-06-26, intentionally enabled) — kiosk recipe sales + recipe discounts are active. (Was previously held false pending the federal brewing licence; ensure the licence status supports live beer sales at the kiosk POS.)
- Apps Script changes require manual redeploy (not in CI) — plan authors must flag this
- 36-02 BLOCKED: Apps Script create_batch handler must accept + persist target_volume_l and scale_factor; manual redeploy needed before SEL-02 is fully closed

## Session Continuity

Last session: 2026-07-02T19:42:45.815Z
Stopped at: Phase 46 context gathered (auth re-arch: kiosk typed-in device token kiosk-scoped, admin/BrewPad Google OAuth + 7d server session, dual-accept cutover rotate in days, D-05 skipped)
Session summary:

  - Deployed F2 (d8bf965+e029108) via staging push 211ad6e + prod force-push; Railway auto-deployed (NOTE: Railway watches koa-inn/steins-and-vines-production zoho-middleware/** — a prod force-push IS a middleware deploy; `railway up` redundant).
  - F2 LIVE-VERIFIED all 3 paths: auto-confirm ~12s real id (INV-000131); no-charge manual-confirm → 409 nothing booked; slow-customer manual-confirm → server verified via pollTerminalResult, booked real id 50915774 (INV-000134).
  - F3 LIVE-VERIFIED: INV-000131 exempt custom line booked Zero Rate tax_id, tax_total:0.
  - Steps 4b/6/8 PASS (gift_card_only skip-terminal; $20→$8 server clamp + $2 card split; idempotent replay in 15ms on same-key duplicate POST).
  - **F7 found + FIXED f057094 + live-verified:** admin gift-card mgmt modal was dead (SHEETS_CONFIG.MW_URL nonexistent → relative fetch; response read too shallow; `balance` vs `current_balance`). Regression tests/frontend/admin-gift-card-mgmt.test.js; fe suite 931 green. Step 5 void then PASSED (GC-000001 voided).
  - F5 (observability): Helcim refund webhooks look identical to purchases in logs — owner's dashboard refunds caused a false orphan-charge scare. F6 (UX): double-tap falls through to control underneath → issue #109.
  - Accounting spot-check consistent with D-04 manual-deferral design (Gift Card Sales income $15; Gift Card Redemptions clearing $15).

Cleanup owed (owner): refund $3 remaining card charges (txn 50914850 $2, txn 50915774 $1; June-30 $20 + Test-1 $1 already refunded); Zoho reverse INV-000127/128/129/131/132/133/134 + their payments; dismiss reconcile needs_manual_review flag for KIOSK-1783016597951 (false alarm); remove stale GH_TOKEN ~/.zshrc:16.
Follow-ups (non-blocking, in findings §Follow-ups): F6 tap-shield (#109), webhook type logging, invoice-note wording, gift-card-only txnId label, void 409 mapping, cancel-aware reconcile sweep.
Next: mark 45-09 UAT-approved in the phase flow (executor resume-signal was "approved") → 45-09 SUMMARY + phase-45 verification/wrap-up. Build churn from `npm run build` still in working tree (about.html/brewpad/products/* + zoho-middleware/ingredients-cache.json); stash@{0}/stash@{1} still pending reconcile.
Resume file: .planning/phases/46-auth-re-architecture-critical-split-from-phase-45/46-CONTEXT.md
