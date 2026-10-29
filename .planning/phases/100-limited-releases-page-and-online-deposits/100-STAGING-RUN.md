# Phase 100 — Staging run (Plan 13 Task 2)

**Date:** 2026-10-29 (UTC evening; Pacific afternoon)
**Environment:** staging site `staging.steinsandvines.ca`, staging middleware `sv_middleware` (NODE_ENV=production, SENTRY_ENVIRONMENT=staging) — LIVE Zoho org, LIVE Helcim account and live Smart Terminal XT21 ("Option B", D-16).
**Kill switch:** `PREORDER_DEPOSITS_ENABLED=true` on staging only; not set on production.
**Deployed commits:** `d87afd12` (Plan 13 Task 1 deploy), then `7de27d49` + `fb6882ca` (kiosk card fix found in Step 4, below).

No card data and no customer PII beyond the owner's own pre-existing test contact ("test", CUS-00052) is recorded here.

---

## Step 1 — Page walk-through

- **Expected:** ten kits, scene bands, logos, brochures, calendar Nov–Apr, steppers, sticky bar, pay disabled until consent.
- **Observed:** owner confirmed the page loads and "looks good"; deposit flow works end to end.
- **Owner feedback (follow-up, not blocking the money path):** the page needs "a significant polish on the UI and page formatting to make everything look intentional and slick". Concrete defects seen in screenshots:
  - Confirmation panel: "SO SO-000085" duplicated prefix (also in both emails).
  - Confirmation panel: "Deposit paid" line and "We have emailed…" line are offset/centred oddly; the "What happens next" ordered list hangs outside the card padding; heading sizes inconsistent.
  - General page formatting pass requested.
  → Recorded as a pre-launch follow-up (see "Follow-ups").

## Step 2 — 1-kit deposit ($50)

- **Observed:** in-page confirmation with **SO-000085** (Amici · April 2027). Customer email and staff email both received (staff email lists the Helcim txn).
- **Zoho (read-only check):** SO-000085, status draft, reference `LIMITED-2026-27`, lines `G010404` @ 220 (0%) + `MAKERS-FEE` @ 45 (5%) + `MAT-FEE` @ 5 (12%), total 272.85; notes contain consent text (324 chars); no invoice. Customer payment #252 = $50, unused $50, description `LIMITED-2026-27 deposit SO-000085 (Helcim 57433619)`, reference `57433619`.
- **Helcim:** txn **57433619** APPROVED, purchase, $50, invoiceNumber `LR-5735cfae196a1a9f` (nonce round-trip confirmed again on a real deposit).
- **Redis:** `preorder:pending:57433619` gone; `preorder:nonce:LR-5735cfae196a1a9f` gone; `preorder:idem:57433619` holds the cached 201 body.
- **BrewPad:** no batch for SO-000085.
- **Result:** PASS.

## Step 3 — 3-kit deposit across both collections ($150)

- **Observed:** confirmation with **SO-000086** (Connexion White · Jan 2027), **SO-000087** (Milagro · Feb 2027), **SO-000088** (Terre · Mar 2027); one Helcim charge.
- **Zoho:** three draft SOs, reference `LIMITED-2026-27`, each with its kit line + both fees and consent notes; three $50 payments (#253/#254/#255), each unused $50, each description naming its own SO and `Helcim 57433921`.
- **Helcim:** txn **57433921** APPROVED, purchase, **$150**, invoiceNumber `LR-656ba8ff96f0ec1c`.
- **BrewPad:** no batches for SO-000086..088.
- **Result:** PASS.

## Step 4 — Brew day on the staging kiosk (LV12 / D-02) — live terminal payment

- **Defect found first:** the kiosk SO card showed the full SO total (**"Collect $252.85"**) for SO-000086, and offered **Import to Cart** (the cart path is not deposit-aware and would charge full price). Collect pushes straight to the terminal, so the card is the only amount staff see first. Owner stopped before paying (no charge taken).
- **Fix (owner chose "fix first, then test"):**
  - `7de27d49` fix(100): kiosk SO list carries the deposit-aware remainder for limited-release SOs (middleware; new test `kiosk-salesorders-limited-due.test.js`).
  - `fb6882ca` fix(100): kiosk SO card shows the remainder and hides Import to Cart for limited releases (kiosk-core + kiosk.css; new test `kiosk-limited-release-card.test.js`).
  - Full suites green (frontend 3284, middleware 3865, lint), pushed to staging, Railway deploy `1cc413a5` SUCCESS; the "Deploy Production (filtered)" workflow on the staging repo skipped its deploy job.
- **Live run after fix:** owner opened SO-000086 on the staging kiosk; terminal asked for **$202.85**; owner paid with a real card.
- **Zoho after payment:** SO-000086 → status invoiced, paid; invoice **INV-000255** total 252.85, status **paid** (payment_made 252.85 = $50 deposit + $202.85 terminal). Deposit payment #253: unused **0**, applied `INV-000255:50` (advance applied via `/invoices/{id}/credits`). Terminal payment #256 = $202.85, reference `57435083`.
- **BrewPad:** exactly **one** batch, **SV-B-000249** (SO-000086, `G010408`, pending).
- **Result:** PASS (live; D-02 proven end to end). No "D-02 OPEN RISK" line applies.

## Step 5 — Cleanup

Run from the staging container with a dry-run first (the dry run listed exactly the records below and "otherPaymentsToday: 0"), then `--apply`.

### Cleanup ledger

| Kind | Id | Outcome |
|------|----|---------|
| Helcim void | 57433619 ($50, Step 2) | voided (ok) |
| Helcim void | 57433921 ($150, Step 3) | voided (ok) |
| Helcim void | 57435083 ($202.85, Step 4 terminal) | voided (ok) |
| Zoho payment | #256 109900000001746208 ($202.85) | deleted |
| Zoho payment | #255 109900000001746144 (deposit SO-000088) | deleted |
| Zoho payment | #254 109900000001746134 (deposit SO-000087) | deleted |
| Zoho payment | #253 109900000001746124 (deposit SO-000086) | deleted |
| Zoho payment | #252 109900000001746114 (deposit SO-000085) | deleted |
| Zoho invoice | INV-000255 109900000001748172 | voided, then deleted |
| Zoho SO | SO-000085 | deleted |
| Zoho SO | SO-000086 | deleted |
| Zoho SO | SO-000087 | deleted |
| Zoho SO | SO-000088 | deleted |
| BrewPad batch | SV-B-000249 | deleted (`Batch SV-B-000249 deleted`) |
| Redis | kiosk SO list cache | cleared |
| Zoho contact | "test" (CUS-00052) | kept — pre-existing owner test contact, not created by this run |

No open rows. Numbering gaps left in Zoho: SO-000085..088, INV-000255, payment numbers 252–256.

## Step 6 — Policy wording and legal review

- Wording reviewed: page `copy.deposit_terms` (6 bullets) and checkbox label in `content/limited-releases-2026-27.json`, `refunds.html` §D, `terms.html` §9 (text as quoted in 100-01-SUMMARY.md).
- **Owner decision:** approved as written (no changes).
- **Legal review of "non-refundable" (BC future-performance rules, RESEARCH A10):** owner chose **no lawyer review — launch as is** (owner accepts the risk).

---

## Owner sign-off

**Owner sign-off (2026-10-29):** staging run approved — Steps 1–5 passed live (including the live brew-day terminal payment after the kiosk card fix); deposit wording approved as written; legal review of "non-refundable" declined, launching as is (owner-accepted risk).

## Follow-ups (before or alongside launch)

1. **UI polish pass on `limited-releases.html`** (owner request): confirmation panel alignment/padding, heading scale, "SO SO-" duplicate (page + both emails), general "intentional and slick" formatting. Owner to decide whether this gates Plan 14.
2. Kiosk badge relies on `reference_number` being present in Zoho SO list rows. The owner confirmed the terminal amount ($202.85) but did not explicitly report the badge/deposit line on the card — glance at it on the next kiosk use.
3. Decline detection in the page payment flow (ABORTED + "declin") was not exercised live — no decline was attempted.
