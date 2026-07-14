---
title: Consolidated Owner UAT Run-Sheet
created: 2026-07-13
updated: 2026-07-14
status: open
covers: [49-02, 56-01, 55-01, kiosk-catalog-recovery]
closed: ["§0 — Phase 49 online captured-amount readback (2026-07-14, owner-run probe: amount=127.85, APPROVED)"]
---

# Owner UAT Run-Sheet — v4.5 outstanding checkpoints

Everything here needs a human: a physical card, an iPad, a Google console login, or a
token you have and Claude does not. Ordered by **risk**, not phase number.

> **§0 is CLOSED (2026-07-14).** The Phase 49 online readback works — `amount` comes back
> populated and correct, so legitimate online orders book as paid and are not being voided.
> The urgent item on this sheet is resolved; nothing here is now an active outage risk.

---

## §0 — ✅ CLOSED 2026-07-14: the Phase 49 online readback WORKS. No outage.

**The risk that was raised.** Phase 49's captured-amount check is **fail-closed**: in
`routes/checkout.js`, if the Helcim readback throws or `amount` is missing, `captured` becomes
`NaN` and the code **voids the charge and returns 402**. That check landed in `main` on
2026-07-02 (`d0471d64`), rode the Phase 46 cutover to **production around 2026-07-08** — and
plan 49-02 had been written to de-risk it on staging *before* production, an ordering that
reality had already overtaken.

Worse, **no online order had ever exercised it**: every Zoho invoice since the deploy is
`KIOSK-*` (card-present, via `pos.js`, which does not run this check). Online orders go through
`/api/checkout`; the last one was INV-000078 on 2026-06-01. So if `getCardTransactionById` did
not populate `amount` for an **online HelcimPay** transaction the way it does for a terminal
one, every legitimate online order was being charged, voided and rejected — a silent revenue
outage on a channel that sees roughly one order a month.

**How it was settled — no card, no money, 30 seconds.** Replayed the readback against a real
historical *online* transaction (INV-000078, txn `49332865`, $127.85):

```bash
curl -s -H "api-token: $HELCIM_API_TOKEN" -H "Accept: application/json" \
  https://api.helcim.com/v2/card-transactions/49332865
```

**Result (owner-run, 2026-07-14):**

```json
{"transactionId":49332865,"dateCreated":"2026-06-01 16:48:37","status":"APPROVED",
 "type":"purchase","amount":127.85,"currency":"CAD","cardType":"MC", ...}
```

`amount` is present, numeric, and matches the invoice total exactly. `parseFloat()` in
`checkout.js` resolves it to `127.85`, which covers the invoice total — so a legitimate online
order **verifies and books as paid**. It is not voided.

### Verdict

- ✅ **The online sales channel is healthy.** No orders were ever silently reversed, and the
  next online customer will not be either.
- ✅ **Phase 49-02's legit-path half is closed by evidence** — the half that could have been an
  outage. What remains of 49-02 (the TAMPER test, §1 below) is a *security assurance* that the
  guard catches an attacker. It is no longer protecting against a revenue outage, and can be
  run whenever convenient.
- ✅ **Plan 50-03 is materially de-risked.** It relies on the same `getCardTransactionById`
  readback, and its check is fail-closed on *every kiosk sale* — i.e. it could have taken the
  till down. That specific fear is now much smaller. (50-03 still opens with its own read-only
  probe, which is correct: this probe proved the **card-not-present/online** shape; the
  card-present shape is what 50-03 depends on.)

### Residual — known, accepted, not a bug

The check also fails closed when the readback **errors** (Helcim API timeout, network blip):
`captured` → `NaN` → void + 402. So a Helcim hiccup mid-checkout **costs the sale** — the
customer is not charged (money is safe), they just see a failure. This is the correct direction
to fail for a money path, but it means a Helcim outage reads as a checkout outage. Worth knowing
before an incident rather than discovering it during one.

Sentry already fires on this path (`captureExceptionSafe` on readback failure) — worth
confirming `[checkout] MONEY-01/H2` errors route to a channel someone actually reads.

---

## §1 — Phase 49-02: live-card TAMPER test (`/api/checkout`)

**Downgraded from urgent by §0.** The legit-path half is closed by evidence. What is left is
proving the guard *catches* a tamper — a security assurance, not an outage risk. Run it when
you are next at the terminal with a card.

Note the scope change: this was written as a pre-production gate. The code is already in
production and §0 proved the legit path is safe, so this is now a **post-production security
confirmation** of the one thing §0 could not prove — that a tamper is actually caught.

Uses a real card on **staging** (which calls the prod middleware — real money; refund
afterwards).

1. **TAMPER** (the only genuinely unproven half) — `POST /api/payment/initialize` with
   `{amount: 0.01}`, complete the HelcimPay charge for that $0.01, then submit `/api/checkout`
   for the real, larger cart using that `transaction_id`.
   - Expect: `402`; **no** customerpayment recorded; invoice **not** marked paid; a
     `moneyPath.voidWithTimeout` void fires; the $0.01 shows reversed in Helcim.
   - Record: txn id + void outcome.

2. **(Optional) LEGIT** — a small normal order paid in full. §0 already proves this books
   correctly, so this is belt-and-braces. Expect `201`, invoice marked paid, no void.

3. Refund/reverse the test charges. Record the outcome — plus the §0 probe result — in
   `.planning/phases/49-online-captured-amount-verification/49-02-UAT.md`.

---

## §2 — Phase 56 / 55: GTM, GA4 and the Ads landmine

Most of 56-01 is already done (T1–T7a were audited as complete on 2026-07-12). What's left:

### ⚠️ Before you run any test order — read this

`purchase` is **both** a GA4 key event **and** wired to a Google Ads conversion tag
(`AW-18091171314`) in the **shared** GTM container `GTM-NHRCGLC5`. The GA4 internal-traffic
filter excludes staging from *GA4 reports* — **it does not protect Google Ads.** A staging test
order can therefore book a **phantom conversion in Google Ads** and quietly corrupt your bid
optimisation.

Pick one before testing:

- **(a) Safest:** in GTM, add a trigger *exception* on the Ads conversion tag for hostname
  `staging.steinsandvines.ca`. Leave the GA4 tags alone so DebugView still works.
- **(b) Accept it:** run the test, then exclude/adjust the conversion in the Google Ads UI
  afterwards. More cleanup, and easy to forget.

I'd do (a) — it's a two-minute change and it's permanent.

### Then:

1. **T7 — add a second GTM admin.** Single-admin lockout is the standing risk (T-56-05).
   Owner-only; takes a minute.
2. **T8 — the Phase 55 `purchase` UAT.** One real test order on staging → confirm exactly
   **one** `purchase` event in GA4 **DebugView** with correct `transaction_id`, `value`,
   `currency: "CAD"`, `items`; and that a success-path replay produces **no second** `purchase`.
3. **T8 step 3 is already done** — the plan says "promote `c86b5b3` to production", but
   `c86b5b3` is already an ancestor of production HEAD. Phase 55's code is live. Just tick it.

---

## §3 — Kiosk catalog recovery (iPad soak test)

From the 2026-07-11 fix (`7cbf856`). This is the **one change from that session inferred from
symptoms rather than reproduced** — the exact error was never captured, so it deserves a real
soak.

- Leave the kiosk iPad idle long enough to sleep / drop the network.
- Come back. **Expect:** the product grid recovers on its own (it now retries on
  `visibilitychange` and `online`), or shows a **Retry** button that works.
- **Fail condition:** you still have to reload the page. If so, grab the Safari console error —
  that's the detail we never had.

Also worth eyeballing: **the next multi-kit sale**. A sale of N units of one kit must now
produce **N batches** in BrewPad, not 1. That's the real-world proof of `d3e32f4`.

---

## §4 — Bookkeeping (I can do these; no owner action)

Flagged so they don't masquerade as open work:

- **48-06** — Phase 48 is marked `[x]` complete in ROADMAP ("5/6 plans + human UAT gate
  satisfied", standalone-kiosk-only per your own scoping decision). The missing
  `48-06-SUMMARY.md` is bookkeeping. Its `.continue-here.md` is **stale** — dated 2026-07-08,
  it describes Phase 48 as unpushed, which shipped days ago.
- **36-07** — genuine inconsistency: **Phase 36 is marked complete (2026-06-24), but its human
  UAT gate never ran** (`36-HUMAN-UAT.md` still says `status: partial / awaiting human testing`).
  SEL-01/02 and MOD-01/02/03 were closed on code, not on verification. Aging, low-urgency, but
  it should be either run or consciously written off — not left ambiguous.
- Stale `.continue-here.md` files in phases 36, 45, 48 and the `.planning/` root.
- `GH_TOKEN` in `~/.zshrc:16` is stale and shadows your good keyring token — every `gh` and
  `git push` needs `env -u GH_TOKEN` until it's removed.
- Historical batch rows still carry mangled customer names (`SV-B-000173` → firstname
  `"Gamba,"`). The `splitCustomerName` fix is forward-only.
