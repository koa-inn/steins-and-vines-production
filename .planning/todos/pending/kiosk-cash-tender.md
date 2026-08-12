---
title: Kiosk — cash tender (record a cash sale with no terminal charge)
status: pending
created: 2026-08-11
source: owner ticket (2026-08-11) — "ability to take cash payments … in the kiosk mode" (paired with the phone-order card request, tracked separately in kiosk-manual-card-entry-moto.md)
area: kiosk / money path
priority: medium
---

## What

A "Cash" tender option on the kiosk: staff ring the cart normally, take physical cash, and the
system books the sale — Zoho invoice created and marked paid by cash, stock decremented, batch
creation / BrewPad integration unchanged — with NO Helcim terminal interaction.

## Why it matters

Same reconciliation argument as the MOTO todo: cash sales handled off-system today bypass stock
decrement and batch creation. Unlike MOTO, cash has NO PCI implications — this is the easy half
of the owner's tender-types request.

## Design notes

- Reuse the `/api/kiosk/sale` pipeline (price anchoring, pre-charge total assertion, idempotency
  lock) but branch tender: `tender: 'cash'` skips `terminalPurchase`/poll entirely and books the
  Zoho customerpayment with mode "cash" instead of "creditcard".
- The Phase 49/50 doctrine ("never book a payment without proof of charge") is about CARD
  phantom-revenue; for cash the staff action IS the proof — but gate the tender behind the same
  staff-present auth tier as other kiosk money actions, and record who/when for the till count.
- Consider a change-due display (amount tendered → change) — cheap UX win at the till.
- Gift-card split-tender interaction: decide whether cash can combine with gift certs the way
  the terminal path does (probably yes — same clamping logic, no charge leg).
- Zoho: confirm the cash payment mode exists in the org's payment modes.

## Sequencing

Independent of Phase 50 (no new card path). Could ship before MOTO. Natural pairing: one
"kiosk tender types" phase covering cash now + MOTO once the Helcim Option A/B question
(see [[kiosk-manual-card-entry-moto]]) is answered with Helcim.
