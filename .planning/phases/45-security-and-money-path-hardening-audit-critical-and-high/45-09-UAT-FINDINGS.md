# 45-09 Live-Card UAT — Findings

**Date:** 2026-06-30 (live controlled session, store closed)
**Surface:** standalone kiosk (kiosk.js) on the in-store iPad → prod Railway middleware → live Helcim terminal + Zoho
**Deploys made during the session:**
- `41f6462` — money-path waves (45-03/05/06/07/08 + FIX1/FIX2) to prod (image `sha256:4af2280c`)
- `51f3c64` — F1 fix (`current_balance`) to prod (image `sha256:b2c84eee`)

Test cert: **GC-000001** (paper). Test invoices: **INV-000127, INV-000128, INV-000129**.

---

## Findings

### F1 — Gift-card balance validation read the wrong field → 503 blocked ALL redemptions  ✅ FIXED
- **Severity:** High (money-path, prod-blocking)
- **Symptom (live):** every "Apply Gift Card" lookup at checkout returned `503 Gift card validation temporarily unavailable`.
- **Root cause:** 45-07 split-tender validation read `r.data.balance` from Apps Script `lookup_gift_card`, but the real response key is `r.data.current_balance` (proven by `gift-cards.test.js` and the live cert lookup). Lookup resolved to `state:'unavailable'` → prod fail-closed. The 45-07 unit mocks used the same fictional `balance` key, so code+tests agreed on a shape that never occurs in prod.
- **Locations:** `routes/pos.js:501` (sale), `:929` (confirm).
- **Fix:** commit **`51f3c64`** — read `current_balance` in both paths; added `T-FIELD` regression (RED→GREEN); corrected mis-mocked tests (`pos-giftcard.test.js` T1/T3/T2, `pos-money-defects.test.js` CR-02-C). Suite 1117 green, lint 0 errors. **Deployed + verified live** (redeem lookup now works).

### F2 — Auto-confirm did not recognize a successful terminal payment → forced manual-confirm (orphan-charge path)
- **Severity:** High (money-path) — UNRESOLVED
- **Symptom (live):** during the partial-redeem (Step 4a), the card **was charged** on the terminal, but the kiosk **did not auto-recognize** the approval. No invoice and no gift redemption were recorded — a live orphaned charge (real money taken, nothing booked). Recovered via the "Confirm Manually" fallback.
- **Backend state at the moment of the orphan (verified):** no new invoice; cert still $15 (redemption not yet recorded).
- **Recovery:** manual confirm (`confirmSale('manual-confirm')`, kiosk.js:3764 → `/api/kiosk/sale/confirm` with `transaction_id:'manual-confirm'`) created INV-000129 and redeemed the cert. Manual confirm is **books-only, no re-charge** (verified safe; idempotency hardening prevents a late auto-confirm from double-booking).
- **Open questions:** why did auto-confirm not surface the approval? terminal-polling/webhook timing, or a regression in the just-deployed money-path? Frequency unknown. The reconciliation backstop (45-08) would eventually sweep such an orphan, but it had not yet.
- **Note:** `transaction_id` was recorded as the literal `"manual-confirm"`, so the Zoho payment does NOT carry the real Helcim txn id — reconciliation cosmetic gap.

### F3 — Exempt custom line is default-taxed by Zoho (no zero-rate exemption sent) → phantom GST + partial-paid invoice  ✅ FIXED
- **Severity:** High (accounting integrity, GST mis-statement) — ✅ FIXED commit `97e8124`, deployed (image `sha256:5ec14723`); `ZOHO_TAX_ZERO_ID=109900000000014433` set in Railway. Definitive end-to-end check = next exempt custom-line sale books `tax_total:0` (verify on UAT resume).
- **Symptom (live):** a custom line marked **tax-exempt** (no tax shown on the kiosk) produced **INV-000129 = $10.50** (line booked taxable, GST $0.50), while only **$10.00** was tendered ($5 gift + $5 card) → invoice left **`partially_paid`, balance $0.50**. The customer's money was correct ($10 for an intended $10 exempt item); Zoho added GST that should not exist.
- **Proven (arithmetic):** `/sale` treated the line **exempt** (card $5 = `grandTotal − gift`; `grandTotal = subtotal + taxTotal`, pos.js:445; gift $5 ⇒ grandTotal $10 ⇒ taxTotal 0). So `/sale` received and honored `taxable:false`.
- **ROOT CAUSE (confirmed by code):** the kiosk sends the **same `items` array** to both calls (`standardSaleBody.items = items` at kiosk.js:3527 and `confirmSale` sends `items: items` at 3630), so `taxable:false` reaches `/confirm` too. `/confirm` builds the exempt custom line as `{ custom, description, rate, quantity, tax_percentage: 0 }` with **NO `tax_id` and NO `tax_exemption_id`** (pos.js:797-806; `tax_id` is set *only* when taxable). A custom line has **no backing Zoho item**, so — unlike gift-cert lines, which ride `KIOSK_GIFT_CARD_ITEM_ID` and inherit its EXEMPT setting (decision 44-01) — there is nothing telling Zoho the line is zero-rated. **Zoho applies the org's default GST** to the un-tagged line. The middleware's internal sale math is exempt (terminal charge correct), but the Zoho *invoice* is default-taxed.
  - The codebase already has the intended mechanism — env `ZOHO_TAX_ZERO_ID` (zero-rate tax) — but it is **never applied to custom lines** (`grep ZOHO_TAX_ZERO_ID routes/pos.js` → none) **and is not set in the prod `.env`**. The available EXEMPT exemption id (seen on gift-cert lines) is `109900000000014414`.
- **Blast radius:** **ALL exempt custom-line sales** (both auto-confirm and manual-confirm use the same `/confirm` line builder) — NOT manual-confirm-only, and **independent of F2**. Every exempt custom-line invoice is left partially-paid and **overstates GST collected**.
- **Pre-existing:** this is a **Phase 43 custom-line defect** (exempt path never wired a Zoho exemption), surfaced by this UAT — **not** a Phase 45 regression.
- **Fix direction:** for `taxable === false` custom lines, send an explicit zero-rate to Zoho — either `tax_id: ZOHO_TAX_ZERO_ID` (set the env to the org's 0% tax) or attach the EXEMPT `tax_exemption_id`. Add a confirm-path regression asserting an exempt custom line books `tax_total: 0`. Confirm against live Zoho with one throwaway probe invoice before/after.

### F4 — Cart inventory re-sync forces staff out of the payment screen on (nearly) every sale  📝 UX (owner-reported)
- **Severity:** Medium (UX friction, reported as "happens pretty much every sale")
- **Symptom:** going to pay, an error appears requiring the cart "reload" button (appears to be an inventory/catalog sync); staff must leave the payment screen, return to cart, wait for a slow reload, and redo all the steps to payment.
- **Pointer:** `js/kiosk.js:1388 kioskLoadProducts(forceRefresh)` + catalog cache (`_kioskCatalogLoaded`, line 756/928).
- **Asks:** preload/refresh the catalog ahead of checkout, allow pay without a blocking re-sync, or otherwise streamline this sticking point.
- **Status:** ✅ filed as **issue #108** (https://github.com/koa-inn/steins-and-vines-staging/issues/108), labels `type:ux` + `type:performance`. (Env `GH_TOKEN` in ~/.zshrc:16 is invalid and shadows valid keychain creds — used `env -u GH_TOKEN gh` per the existing `sv-issues` workaround. Consider removing/refreshing the stale token in ~/.zshrc.)

---

## UAT step status

| Step | What | Result |
|------|------|--------|
| 1 | Issue cert (cart+terminal) | ✅ PASS — INV-000127 $10, Gift Card Sales liability, **no tax at sale**, cert active |
| 2 | Balance lookup | ✅ PASS — $10 (and surfaced the read path works) |
| 3 | Reload (cart+terminal) | ✅ PASS — INV-000128 $5, liability, no tax, balance $10→$15 |
| 4a | Partial redeem (split tender) | ⚠️ Redemption booked (cert $15→$10, $5 redeemed) BUT surfaced **F2** (orphan/manual-confirm) and **F3** (exempt→taxable, $0.50 phantom) |
| 4b | Full redeem (terminal skipped) | ⏸️ NOT RUN |
| 5 | Void certificate | ⏸️ NOT RUN |
| 6 | Over-balance clamp | ⏸️ NOT RUN |
| 7 | Redeem-failure → needs_manual_review | ⏸️ NOT RUN (unit-test covered) |
| 8 | Double-tap idempotency | ⏸️ NOT RUN |

**Session paused after 4a** to fix/triage F2/F3 before re-charging the card.

---

## Cleanup owed (test transactions on owner's own card)

- **Cert GC-000001** currently **$10** balance, active. (Issued $10 + reloaded $5 − redeemed $5.)
- **INV-000127** $10 paid (issue), **INV-000128** $5 paid (reload), **INV-000129** $10.50 partially_paid (**$0.50 phantom GST balance — F3**).
- Real card charges to refund/void: issue $10, reload $5, redeem $5 (= $20). Void the cert and reverse the invoices/payments when wrapping up; the F3 $0.50 phantom balance disappears with the INV-000129 reversal.

---

## Disposition

- **F1:** done (fixed, deployed, verified).
- **F3:** ✅ FIXED + deployed (`97e8124`). Exempt custom lines now tagged with the Zero Rate `tax_id` (`ZOHO_TAX_ZERO_ID` set in Railway) in both sale + confirm builders; F3 regression added (pos-tax.test.js, RED→GREEN). Verify end-to-end on UAT resume (exempt custom line → `tax_total:0`). Pre-existing Phase 43; affected all exempt custom-line sales.
- **F2:** still needs investigation — why auto-confirm didn't surface the terminal approval (terminal poll/webhook vs deploy regression); reconciliation-backstop timing. Needs a logged repro of the sale→poll path.
- **F2 & F3 are independent** (earlier "possibly correlated" was wrong — F3 is server-side Zoho tagging, hits all exempt custom sales).
- **F4:** file as GitHub issue once `gh` auth is restored.
- Re-run UAT steps 4b/5/6/7/8 after F2/F3 fixes.
