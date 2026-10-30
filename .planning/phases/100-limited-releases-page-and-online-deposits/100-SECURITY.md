---
phase: 100
slug: limited-releases-page-and-online-deposits
status: verified
threats_open: 0
asvs_level: 1
created: 2026-10-30
---

# Phase 100 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.
> Register authored at plan time (all 15 plans carry a `<threat_model>`). Verified by three parallel gsd-security-auditor runs (plans 01–05+15, 06–07, 08–14) on 2026-10-30. Line numbers are paths in `zoho-middleware/` unless stated.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| repo → public site | Static content, policy text, supplier images | Public marketing / policy text |
| browser → /api/preorder/* | Fully untrusted public input (keyless, reCAPTCHA + rate-limited) | Name, email, phone, basket, Helcim txn id (PII) |
| Helcim iframe → page (postMessage) | Cross-origin transaction result | Txn id / status |
| middleware → Helcim API | Initialize checkout; readback is source of truth; void | Amounts, nonce invoiceNumber, txn ids |
| middleware → Zoho Books | Creates SOs, advances (customer payments), deletes on cleanup | Customer contact, money records |
| middleware → Redis | Nonce, per-txn lock, replay marks, idempotent response, pending sentinel | Txn ids, counts, totals |
| middleware → Resend | Customer strings into staff/customer email | PII (staff channel only) |
| kiosk device → /api/kiosk/salesorder-pay, salesorder-due | Device-token tier; client sends only salesorder_id | SO id → amounts |
| middleware → Helcim terminal | Real card charge on brew day | Amount |
| staging → live Zoho / Helcim | Spike + rehearsal against production books and real cards | Test records, real $ charges |
| repo main → production | Production push + kill switch (`PREORDER_DEPOSITS_ENABLED`) | All staged code |

---

## Threat Register

| Threat ID | Category | Component | Disposition | Mitigation / Evidence | Status |
|-----------|----------|-----------|-------------|------------|--------|
| T-100-01 | Repudiation | refunds.html / terms.html wording | mitigate | `refunds.html:140-142`, `terms.html:144` (non-refundable, 60-day hold, switching, supplier-failure refund); owner approved `100-STAGING-RUN.md:81,88`. Switching appears in terms only. | closed |
| T-100-02 | Info disclosure | images/limited-releases | accept | See Accepted Risks AR-01 | closed |
| T-100-03 | Tampering | content JSON | accept | See AR-02; server uses own `ALLOWLIST` in `lib/limited-releases.js` | closed |
| T-100-04 | Tampering | spike script vs production | mitigate | `scripts/spike-limited-release-advance.js:21-23` refuses unless `SENTRY_ENVIRONMENT === 'staging'` | closed |
| T-100-05 | Repudiation | orphaned spike records | mitigate | Promise-chain cleanup (ES5 finally-equivalent) `spike…js:244-250`, ledger L292, `LIMITED-SPIKE` / `ZZ Spike LR` markers | closed |
| T-100-06 | Tampering | --helcim-void on real charge | mitigate | `spike…js:329-330` requires `LR-SPIKE-` prefix or `--force` | closed |
| T-100-07 | Info disclosure | spike output | mitigate | Throwaway contact `spike…js:169`; no email/phone/card logging | closed |
| T-100-08 | Info disclosure | harness HTML | accept | See AR-03; not tracked in git | closed |
| T-100-09 | Tampering | retry duplicating money creates | mitigate | `lib/zoho-api.js:133-146` `zohoPostOnce` retries:0; used at `lib/limited-releases-deposit.js:119,203`; test `zoho-api-delete-postonce.test.js:72-73` | closed |
| T-100-10 | Tampering | zohoDelete misuse | mitigate | Only caller `limited-releases-deposit.js:243,252` with ids from `created[]` | closed |
| T-100-11 | Spoofing | contact attachment | mitigate | `routes/checkout.js:74,259-263` → `helpers.resolveOrCreateContact`; no client `customer_id` | closed |
| T-100-12 | Tampering | /api/checkout extraction regression | mitigate | No checkout test files modified in phase (git history) | closed |
| T-100-13 | Info disclosure | logging in new helpers | mitigate | `limited-releases-deposit.js:247,258` ids/txn only | closed |
| T-100-14 | Tampering | basket item_id/qty | mitigate | `lib/limited-releases.js:61-91` `validateBasket`: hasOwnProperty allowlist, `Number.isInteger`, 1–10/line, ≤10 total, dup-line reject (L80, test `limited-releases-config.test.js:72`) | closed |
| T-100-15 | Tampering | prototype keys as item_id | mitigate | `has()` via `Object.prototype.hasOwnProperty.call`; `limited-releases-config.test.js:49` covers `__proto__`, `constructor` | closed |
| T-100-16 | Tampering | email header injection | mitigate | `lib/mailer.js:514-516` `flattenText`; test `mailer-preorder.test.js:59-68` (`\r\nBcc:`) | closed |
| T-100-17 | DoS | huge baskets | mitigate | `MAX_KITS_PER_ORDER = 10` `limited-releases.js:18,63,86` | closed |
| T-100-18 | Info disclosure | staff email PII | accept | See AR-04 | closed |
| T-100-19 | Tampering | kit price | mitigate | `limited-releases-deposit.js:36-56` `getKitRate` allowlist-only, fail closed on missing/inactive/≤0 | closed |
| T-100-20 | Tampering | salesorders_to_apply spread | mitigate | Guard test `salesorders-to-apply-guard.test.js:18,31,40` | closed |
| T-100-21 | Repudiation | partial SO/payment sets | mitigate | `limited-releases-deposit.js:176,223,234-262` created[], possibleOrphan, cleanupDepositSet payments→SOs, leftovers | closed |
| T-100-22 | Tampering | duplicate SOs from retry | mitigate | `zohoPostOnce` for both creates (L119, L203) | closed |
| T-100-23 | Info disclosure | cleanup logs | mitigate | ids + txn only (L247, L258) | closed |
| T-100-24 | Tampering | fee ids from snapshot SKUs | mitigate | `/^\d+$/` guard `limited-releases-deposit.js:75` | closed |
| T-100-25 | Tampering / DoS | void of someone else's charge (HIGH) | mitigate | `routes/preorder.js`: readback L372 → ownership `invoiceNumber` check L392 (400, no void, no lock) → lock L405 → all voids after L392; `NONCE_RE ^LR-[0-9a-f]{16}$` L37; nonce `crypto.randomBytes(8)` L285; test `preorder-deposit-verify.test.js:164` | closed |
| T-100-26 | Tampering | client-chosen amount | mitigate | Server-side at initialize L284; integer-cent equality vs basket AND nonce record L460-464; tests L311/L320 (±1¢) | closed |
| T-100-27 | Spoofing | cross-route txn reuse | mitigate | `REPLAY_SUFFIXES` L40 (4 suffixes), check L418-424, `type === 'purchase'` L398, marks L123-125 | closed |
| T-100-28 | Tampering | basket swapped after payment | mitigate | `sameLines(record.lines, basket.lines)` L455; test L306 | closed |
| T-100-29 | DoS | bots / card testing | mitigate | reCAPTCHA fail-closed in prod at both routes (L268-282, L429-441, `checkout-helpers.js:51`); `paymentLimiter` `server.js:809`; Referer guard `server.js` ~L801 | closed |
| T-100-30 | Repudiation | Zoho offline after charge | mitigate | `/preorder/deposit` in `OFFLINE_CAPABLE_POSTS` `server.js:470`; void + 503 `preorder.js:467-469` | closed |
| T-100-30a | Repudiation | Redis fail-closed after capture | mitigate | Voids on lock/replay/nonce failclosed (L412-414, L425-427, L451-454); readback alert L379-387; tests L195/L240/L260/L269 | closed |
| T-100-30b | DoS | staff-alert spam | mitigate | Alert only if live nonce and not 404 (L376-379); tests L204, L212 | closed |
| T-100-30c | Tampering | LV11 binding unproven | mitigate | `100-SPIKE-RESULTS.md:80-93` LV11 = yes (txn 57428079); `lib/helcim.js:127-132` | closed |
| T-100-31 | Info disclosure | PII in logs | mitigate | txnId/counts/totals only; spy test `preorder-deposit-verify.test.js:378` | closed |
| T-100-32 | EoP | keyless bypass too broad | mitigate | Exact-path `KEYLESS_POSTS` `server.js:513,527`; test initialize L168 | closed |
| T-100-33a | EoP | deposits on prod before sign-off | mitigate | `PREORDER_DEPOSITS_ENABLED !== 'true'` → 503 `preorder.js:258`; test L94 | closed |
| T-100-33 | Tampering | nonce reuse | mitigate | Bound to one Helcim checkout; lock (900s), replay marks, nonce deleted L126 | closed |
| T-100-34 | Repudiation | captured card with no Zoho record | mitigate | `failAfterCapture` cleanup → void (L203) → alert (L215-224); sentinel kept unless clean (L226). Void-timeout email gap → AR-08 | closed |
| T-100-35 | Tampering | duplicate SO sets on retry | mitigate | Lock L405 + 24h cached response L122/L406-408; test booking L212 | closed |
| T-100-36 | Spoofing | contact hijack | mitigate | `resolveOrCreateContact({name,email,phone})` L77-81 only | closed |
| T-100-37 | Info disclosure | PII in logs/events/sentinel | mitigate | Sentinel L69-74 ids/counts; `maskEmail`; tests booking L173/L239 | closed |
| T-100-38 | Tampering | batch/stock side effects | mitigate | No brewpad/ledger/notifyAdminPanel imports; test booking L277 | closed |
| T-100-39 | Repudiation | newsletter consent | mitigate | Strict boolean L340, L153, L486; tests booking L250-268 | closed |
| T-100-40 | Tampering | brew-day charge amount | mitigate | `routes/pos.js:2690-2720` `computeSalesOrderAmountDue` from Zoho; body only `salesorder_id`/idempotency key | closed |
| T-100-41 | Tampering | consuming unrelated credits | mitigate | `limited-releases-deposit.js:130-131` `LIMITED-` prefix; L142-167 description marker + same customer | closed |
| T-100-42 | Repudiation | charging before deposit known | mitigate | Lookup failure → 502 before terminal push; `kiosk-salesorder-advance.test.js` | closed |
| T-100-43 | Tampering | SO-pay regression | mitigate | Non-LIMITED path `pos.js:2697`; `kiosk-salesorder-advance.test.js:192,203`, `money-path-advance.test.js:57` | closed |
| T-100-44 | Repudiation | finalize failure after charge | mitigate | Existing void-on-failure catch intact (`voidWithTimeout`, `needs_manual_review`) | closed |
| T-100-45 | Info disclosure | salesorder-due preview | mitigate | `pos.js:2660-2664` tiers + `/^\d+$/`; amounts only | closed |
| T-100-46 | Tampering | client trusting preview | mitigate | Pay route recomputes (T-100-40); `js/kiosk-core.js:5540` display-only | closed |
| T-100-47 | EoP | route missing from tier list | mitigate | `lib/authTiers.js:62-64,85-87`; 401 test `kiosk-salesorder-due.test.js:152` | closed |
| T-100-48 | DoS | preview failure blocks sale | mitigate | `kiosk-core.js:5549-5562` catch → continues to pay | closed |
| T-100-49 | Tampering | script injection on payment page | mitigate | CSP meta byte-identical to `reservation.html` | closed |
| T-100-50 | Info disclosure | premature public launch | mitigate | Hold-back gate operated; deliberately lifted at launch in `fac670b6` (Plan 14) | closed |
| T-100-51 | Repudiation | CASL wording | mitigate | `limited-releases.html:214-216` matches reservation.html, unticked | closed |
| T-100-52 | Spoofing | clickjacking | accept | See AR-05 | closed |
| T-100-53 | Tampering | DOM XSS via JSON | mitigate | No `innerHTML` in `js/modules/18-limited-releases.js`; test `limited-releases-payment.test.js:448-452` | closed |
| T-100-54 | Tampering | client total manipulation | accept | See AR-06 | closed |
| T-100-55 | Spoofing | scarcity claims | mitigate | `tests/frontend/limited-releases.test.js:241` | closed |
| T-100-56 | Spoofing | forged postMessage | mitigate | Origin allowlist `18-limited-releases.js:784` (same as `12-checkout.js:1829`), `:1057-1063` eventName bound to session tokens; server readback | closed |
| T-100-57 | Repudiation | "not charged" when charged | mitigate | Copy only on cancel/decline/pre-payment/voided; test `limited-releases-payment.test.js:324,337-363` | closed |
| T-100-58 | Tampering | double payment | mitigate | `_lrSubmitting` `:1025/1030`; `_lrTxnId` retained; server idempotency | closed |
| T-100-59 | Tampering | XSS in confirmation | mitigate | textContent only; test `:448-452` | closed |
| T-100-60 | Repudiation | newsletter consent | mitigate | `18-limited-releases.js:1100` `!!(nl && nl.checked)` | closed |
| T-100-61 | Repudiation | staging records left behind | mitigate | `100-STAGING-RUN.md:62-67` ledger all closed; sign-off :88 | closed |
| T-100-62 | EoP | kill switch on prod early | mitigate | `100-14-SUMMARY.md:31`; RUNBOOK prod-20261030-2 (deposits off, 503) | closed |
| T-100-63 | Info disclosure | PII in run notes | mitigate | `100-STAGING-RUN.md:8` owner test contact + ids only | closed |
| T-100-64 | Repudiation | unclear policy | mitigate | Owner approved wording `100-STAGING-RUN.md:88`; legal review declined → AR-09 | closed |
| T-100-64a | Tampering | LV11 fails live | mitigate | `100-STAGING-RUN.md:25` first deposit verified first (SO-000085, payment #252) | closed |
| T-100-64b | Repudiation | brew-day path unproven | mitigate | `100-STAGING-RUN.md:46-49` live $202.85 terminal payment, INV-000255 | closed |
| T-100-65 | EoP | unreviewed changes in prod push | mitigate | Gates recorded (FE 3304 / MW 3967 tests, lint, build) and owner "Push now"; diff review not logged → AR-07 | closed |
| T-100-66 | Repudiation | prod test deposit left in books | mitigate | No prod test deposit made (owner chose free checks; UAT test 9); initialize-only session, no charge — nothing to clean | closed |
| T-100-67 | DoS | prod failure after opening | mitigate | Kill switch documented `100-14-SUMMARY.md:49` + RUNBOOK; 503 proven while unset | closed |
| T-100-68 | Tampering | CSP drift in nav edit | mitigate | `git show fac670b6` has 0 CSP line changes | closed |
| T-100-15a | Integrity | CSS leak to other pages | mitigate | Page CSS scoped. Deviation: `e1c39e26` added 112 lines to `css/styles.css` under new `.lr-home-feature*` classes only (additive, unique prefix) | closed |
| T-100-15b | Integrity | render change breaks hooks | mitigate | ids/classes kept. Deviation: `fdae1080` edited 2 assertions in `limited-releases-payment.test.js` for the owner-requested SO label fix (label only) | closed |
| T-100-15c | Info disclosure | email label change | accept | See AR-10 | closed |

*Status: open · closed*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-01 | T-100-02 | Supplier marketing files intended for retailer web use; no other pack files added | Plan 01 threat model | 2026-10-30 |
| AR-02 | T-100-03 | Content JSON is display-only; server never reads it | Plan 01 threat model | 2026-10-30 |
| AR-03 | T-100-08 | Spike harness HTML kept in scratchpad, never committed; card entry inside Helcim iframe | Plan 02 threat model | 2026-10-30 |
| AR-04 | T-100-18 | PII in staff email sent only to `staffTo()`, the established staff channel | Plan 04 threat model | 2026-10-30 |
| AR-05 | T-100-52 | Clickjacking: same posture as reservation.html; meta CSP cannot set frame-ancestors on GitHub Pages | Plan 10 threat model | 2026-10-30 |
| AR-06 | T-100-54 | Client total is display only; server recomputes and verifies | Plan 11 threat model | 2026-10-30 |
| AR-07 | T-100-65 | No record that `git log production/main..main` was shown before the prod-20261030-3 push. Deploy gates and owner approval are recorded. | Owner | 2026-10-30 |
| AR-08 | T-100-34 | `moneyPath.voidWithTimeout` timeout branch logs + Sentry only (no staff email), matching existing checkout.js convention; `preorder:pending` sentinel retained for reconciliation | Owner (via secure-phase) | 2026-10-30 |
| AR-09 | T-100-64 / T-100-01 | Owner declined legal review of "non-refundable" deposit wording (`100-STAGING-RUN.md:88`) | Owner | 2026-10-30 |
| AR-10 | T-100-15c | Email label format change only; no new PII fields | Plan 15 threat model | 2026-10-30 |

*Accepted risks do not resurface in future audit runs.*

---

## Unregistered Flags (informational, not in register)

- `salesorder-pay` validates `salesorder_id` only as a string (not `/^\d+$/` like `salesorder-due`) before interpolating into `/salesorders/<id>`. Device-tier gated, so low severity. Worth a one-line fix for consistency.
- `js/kiosk-core.js:5545-5546` builds the deposit rows with `innerHTML +=` (constant labels + `kioskFmt` numbers). Low risk, but avoid the pattern.
- Origin allowlist flag (`secure.myhelcim.com` vs allowlist): dismissed. It matches the production checkout list, and real staging deposits succeeded.
- Residual live-proof items (not security gaps): first real prod deposit (UAT test 9), live decline detection, kiosk deposit badge.

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-10-30 | 77 | 77 | 0 | gsd-security-auditor ×3 (sonnet) + orchestrator; T-100-65 accepted by owner |

## Security Audit 2026-10-30
| Metric | Count |
|--------|-------|
| Threats found | 77 |
| Closed | 77 (69 verified mitigations, 8 closed by acceptance incl. T-100-65) |
| Open | 0 |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-10-30
