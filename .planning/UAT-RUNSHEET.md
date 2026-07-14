---
title: Consolidated Owner UAT Run-Sheet
created: 2026-07-13
status: open
covers: [49-02, 56-01, 55-01, kiosk-catalog-recovery]
---

# Owner UAT Run-Sheet — v4.5 outstanding checkpoints

Everything here needs a human: a physical card, an iPad, a Google console login, or a
token you have and Claude does not. Ordered by **risk**, not phase number.

> ⚠️ Read §0 before anything else. It changes what "pending UAT" means for Phase 49.

---

## §0 — URGENT: the Phase 49 fail-closed check is ALREADY LIVE and UNVERIFIED

**What was assumed:** plan 49-02 was written as a gate to run on staging *before* the
captured-amount check reached production.

**What is actually true:**

- The check landed in `main` on **2026-07-02** (`d0471d64`) and rode the Phase 46 prod
  cutover to production around **2026-07-08**. It is on production HEAD (`1219ccbf`) today.
- Since that deploy, **every Zoho invoice has been `KIOSK-*`** — card-present terminal sales
  through `pos.js`, which does *not* run this check.
- Online orders go through `/api/checkout`, which stamps `reference_number = transactionId`
  (a bare Helcim id). The last one was **INV-000078, 2026-06-01, txn `49332865`, $127.85**.
- So: **zero online orders have exercised the new check.** The next real online customer is
  the first test of it.

**Why that matters.** The check fails *closed*. In `routes/checkout.js`, if the readback
throws or `amount` is missing, `captured` becomes `NaN` and the code **voids the charge and
returns 402**. If Helcim's `GET /card-transactions/{id}` does not populate `amount` for an
**online HelcimPay** transaction the way it does for a terminal one, then *every* legitimate
online order is charged, voided, and rejected. Money stays safe — but the online sales channel
silently stops working, and at roughly one online order a month, that could go unnoticed for
weeks.

### §0.1 — The no-card probe (do this first; 30 seconds, read-only, zero money)

This answers the whole question without a card, because it replays the readback against a
**real online transaction that already happened**.

Get `HELCIM_API_TOKEN` from Railway (middleware service → Variables), then:

```bash
curl -s -H "api-token: $HELCIM_API_TOKEN" -H "Accept: application/json" \
  https://api.helcim.com/v2/card-transactions/49332865
```

`49332865` is INV-000078 — a genuine **online HelcimPay** charge of **$127.85**.

| Result | Meaning | Action |
|---|---|---|
| `"amount": 127.85` (or `"127.85"`) | ✅ The readback works on the online path. The legit-order risk is disproven. | Phase 49's legit half is effectively closed — record it and skip straight to §0.2. |
| `amount` absent, `0`, `null`, or under a different key | 🔴 **Production is currently voiding every online order.** | STOP. Tell me the exact JSON; the fix is a small one (read the correct field, or scope the fail-open) and it ships same-day. |
| 404 / auth error | Inconclusive — token scope or txn age. | Tell me the response; we fall back to the live-card test in §1. |

Paste me the raw JSON either way — the field names are the whole point.

### §0.2 — Interim safety valve (worth 2 minutes regardless)

Until §0.1 comes back green, you have no alerting on this. If an online order *is* being
false-voided, the Sentry event is already being sent (`captureExceptionSafe` fires on readback
failure). Worth confirming you'd actually see it: check that Sentry is routing
`[checkout] MONEY-01/H2` errors to a channel you read.

---

## §1 — Phase 49-02: live-card UAT (`/api/checkout`)

**Run this only if §0.1 is green or inconclusive.** If §0.1 is red, the code changes first.

Note the scope change: this is no longer a pre-production gate — it is a **post-production
confirmation**, and the tamper half is still genuinely unproven.

Both scenarios use a real card on **staging** (which calls the prod middleware — real money;
refund afterwards).

1. **LEGIT** — place a small normal order, pay in full via the HelcimPay iframe.
   - Expect: `201`; Zoho invoice created **and marked paid**; no void.
   - Record: Helcim txn id + Zoho invoice number.
   - If this false-voids → you've caught in staging exactly what §0 warns about in prod.

2. **TAMPER** (this is the half §0 cannot prove) — `POST /api/payment/initialize` with
   `{amount: 0.01}`, complete the HelcimPay charge for that $0.01, then submit `/api/checkout`
   for the real, larger cart using that `transaction_id`.
   - Expect: `402`; **no** customerpayment recorded; invoice **not** marked paid; a
     `moneyPath.voidWithTimeout` void fires; the $0.01 shows reversed in Helcim.
   - Record: txn id + void outcome.

3. Refund/reverse the test charges. Record both outcomes in
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
