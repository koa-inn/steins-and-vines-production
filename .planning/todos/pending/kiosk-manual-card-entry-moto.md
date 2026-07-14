---
title: Kiosk — manual card entry (MOTO) so staff can take a payment over the phone
status: pending
created: 2026-07-14
source: owner request (2026-07-14) — "in case someone wants to pay over the phone"
area: kiosk / money path
priority: medium
blocked_by: Phase 50 (Kiosk Money-Path Defect Closeout) — see "Sequencing" below
---

## What

Staff need a way to take a card payment on the kiosk when the customer is **not physically
present** — typically a phone order. Today every kiosk tender path assumes a card-present tap
on the Helcim terminal (`terminalPurchase` → `pollTerminalResult`). There is no keyed /
card-not-present option.

This is a **MOTO** transaction (Mail Order / Telephone Order) — the industry term. Worth using
that word when talking to Helcim, because it is a distinct transaction type with its own
enablement, pricing and liability rules.

## ⚠️ The thing that must not be got wrong: PCI scope

**Do NOT build a card-number form in `kiosk-core.js`.** The moment our own page collects a raw
PAN, `kiosk.html` and the middleware are dragged into PCI-DSS scope (SAQ A-EP or worse) — a
completely different compliance regime, annual scanning obligations, and liability. It would be
the single most expensive line of code in this repo.

The PAN must never touch our DOM or our server. Three viable routes, cheapest first:

### Option A — the terminal's own manual-entry mode (probably zero code)
Helcim card terminals generally support keying a card number **on the device keypad**. If ours
does, staff key it into the terminal and the existing `/api/kiosk/sale` flow works **completely
unchanged** — the terminal handles the PAN, exactly as it does for a tap.
**→ CHECK THIS FIRST.** It may need nothing but a Helcim account setting and a staff note. It
would be daft to build software for a problem the hardware already solves.

### Option B — HelcimPay.js hosted iframe as a kiosk tender option (small code)
We already do this for the public website: `/api/payment/initialize` → HelcimPay iframe →
`/api/checkout` verifies the captured amount via `getCardTransactionById`. The PAN is captured
inside **Helcim's** iframe, tokenized, and never enters our code — so we stay in SAQ A.
Add a "Card not present / phone order" tender button on the kiosk that runs the cart through
that same hosted flow instead of the terminal.
**This is the right answer if Option A does not exist.** It reuses a money path that is already
hardened and, as of 2026-07-14, is *proven* to read back captured amounts correctly on the
online path (see `.planning/UAT-RUNSHEET.md` §0).

### Option C — our own card form → **REJECTED, do not do this**
Recorded only so nobody rediscovers it as a "simple" idea. See PCI scope above.

## Sequencing — do this AFTER Phase 50

The audit's #1 systemic theme is **"two-tier money path maturity"**: `checkout.js` is the gold
standard and the kiosk re-implemented the same flow *without* its guards, which is where nearly
every High money finding came from. Adding a **fourth** payment path before Phase 50 lands would
repeat that mistake by hand.

A MOTO path must adopt, not re-implement:
- `moneyPath.acquireIdempotencyLock` (no double-charge on a double-tap)
- the captured-amount verification (charged == invoiced)
- `moneyPath.voidWithTimeout` (the single void path — audit H5/L18 forbids raw `voidTransaction`
  calls outside it)
- the pending-charge record + reconcile contract

Phase 50 is what makes those uniform across the kiosk. Build on top of it, not beside it.

## Business facts to confirm with Helcim before building

- **MOTO may need enabling** on the merchant account; it is not always on by default.
- **Different interchange** — card-not-present typically costs more per transaction than a tap.
- **Liability shifts to the merchant.** A card-present EMV tap carries chargeback protection; a
  keyed MOTO transaction does **not**. If the card is stolen, S&V eats the chargeback. This is a
  business decision, not a technical one — the owner should know it before the button exists.
- Consider requiring a **note / reference** on MOTO sales (who took the call) for dispute
  evidence, mirroring the custom-line `note` field added in Phase 43.

## Why it matters

Real revenue currently gets turned away or handled off-system (a manual Zoho invoice + a payment
link), which means the sale bypasses the kiosk's stock decrement, batch creation and BrewPad
integration — the exact reconciliation gap the money-path work exists to close.

## Next step

`/gsd:discuss-phase` this once Phase 50 is executed. **First action costs nothing:** ask Helcim
(or just try the terminal) whether Option A already works. If it does, this whole item collapses
to a staff-training note.
