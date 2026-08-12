# Phase 70: Kiosk Tender Types — Cash + Phone-Order Card (MOTO via HelcimPay) - Context

**Gathered:** 2026-08-12
**Status:** Ready for research → planning
**Source:** Owner ticket 2026-08-11 ("ability to take cash payments and manually enter credit card numbers (for over the phone) in the kiosk mode") + owner decisions 2026-08-12 (build both; MOTO via HelcimPay hosted iframe; cash extras = change-due + gift-card split; card-not-present liability accepted). Todos: `.planning/todos/pending/kiosk-cash-tender.md`, `.planning/todos/pending/kiosk-manual-card-entry-moto.md`.

<domain>
## Phase Boundary

Add two new tender options to the kiosk sale flow (currently terminal-card-only):

1. **Cash tender** — staff take physical cash; the system books the sale (Zoho invoice + a cash customerpayment, stock decrement, batch creation) with NO Helcim interaction. Includes a change-due calculator (staff enter amount tendered → kiosk shows change) and the ability to combine cash with a gift certificate (split tender), reusing the existing gift-card clamping. No PCI implications.

2. **Phone-order card (MOTO)** — a "card not present / phone order" tender for when the customer is on the phone. The card is keyed into **Helcim's own hosted HelcimPay.js iframe** (rendered on the kiosk), so the PAN never touches our DOM or server — keeping us in PCI SAQ-A scope. Reuses the existing hardened HelcimPay path (`/api/payment/initialize` → iframe → captured-amount verification à la `/api/checkout`, Phase 49) rather than the terminal. The kiosk-specific booking (stock, batch creation, kiosk invoice) must still happen — the MOTO change swaps only the PAYMENT leg (terminal → HelcimPay iframe), not the rest of the kiosk pipeline.

Both are staff-present kiosk actions on the standalone kiosk surface (device-token tier).

In scope: `js/kiosk-core.js` (+ rebuilt min), `kiosk.html` (HelcimPay.js script + CSP for MOTO), `zoho-middleware/routes/pos.js` (cash tender branch + MOTO initialize/verify wiring), possibly `zoho-middleware/routes/payments.js`/`checkout.js` reuse, middleware + frontend tests. Out of scope: the physical-terminal keypad-entry option (Option A — a separate free owner check, documented below, needs no code); any card-number form in our own pages (Option C — REJECTED, PCI).
</domain>

<decisions>
## Implementation Decisions

### Cash tender
- New `tender: 'cash'` branch in the kiosk sale path. Reuse the EXISTING `/api/kiosk/sale` pipeline (price anchoring, the Phase 67 pre-charge total assertion, the idempotency lock) but the cash branch SKIPS `terminalPurchase`/poll entirely and books the Zoho customerpayment with `payment_mode: 'cash'` (confirm 'cash' is a valid mode in the org; the kiosk already books 'creditcard'/'debitcard'/'others' — see pos.js ~1384/1398/1828).
- Cash has no charge-capture risk (staff action IS the proof of payment), but the booking must be ATOMIC and IDEMPOTENT: reuse the existing kiosk idempotency lock so a double-tap can't double-book an invoice/payment. No orphan-charge class here (no terminal), but a partial-booking (invoice created, payment not) must be handled with the same care as the card path.
- **Change-due:** client-side UX only. Staff enter amount tendered; kiosk shows change owed. The change is NOT a payment line and is NOT sent to the server — only the sale total is booked. Guard: tendered ≥ total before allowing completion; change = tendered − total.
- **Cash + gift card (split tender):** reuse the existing gift-card split-tender clamping (Phase 44/45 — `gift_card.amount_applied` clamped to the real server-side balance via the Apps Script lookup, D-12). The gift-card leg is unchanged; cash simply covers the remaining post-gift-card balance instead of the terminal. Gift-card-only (full coverage) already exists; cash covers any remainder.
- Auth: same staff-present device-token tier as other kiosk money actions.

### Phone-order card (MOTO via HelcimPay hosted iframe)
- New "card not present / phone order" tender button on the kiosk. Flow: initialize a HelcimPay session for the cart total (`helcimLib.initializeCheckout` / `POST /api/payment/initialize`), render the HelcimPay.js iframe on the kiosk, staff key the customer's card into HELCIM'S iframe, Helcim charges, then the server VERIFIES the captured amount covers the invoice total (±$0.01, reuse the Phase 49 `getCardTransactionById` captured-amount readback) BEFORE booking — never book on trust (no phantom revenue).
- **The kiosk pipeline still runs:** MOTO must produce the same kiosk outcomes as a terminal sale (stock decrement, batch creation via brewpad-integration, kiosk invoice, gift-card split if applied) — only the payment leg differs. RESEARCH must determine the cleanest wiring: reuse `/api/kiosk/sale`/`confirm` with a HelcimPay-verified txn in place of the terminal txn, vs. a new MOTO endpoint that composes the kiosk booking with the HelcimPay verify. Do NOT fork the kiosk booking logic; adopt the money-path primitives (idempotency lock, captured-amount verify, void-on-failure via `moneyPath.voidWithTimeout`, pending-charge/reconcile) rather than re-implementing them.
- **PCI / security invariants (NON-NEGOTIABLE):** the PAN is entered ONLY inside Helcim's hosted iframe — never a form/field in our HTML/JS/DOM; our code and middleware never see, log, or store a card number; `kiosk.html` gets the HelcimPay.js script + the CSP entries it needs (update CSP on all relevant public pages per the CLAUDE.md rule); captured-amount verification before booking; client-supplied amounts never trusted.
- Card-not-present liability (chargebacks fall on the shop) is owner-accepted for this tender; consider recording the tender type on the Zoho payment for dispute traceability.

### Sequencing within the phase
- Cash tender is simpler and lower-risk — plan it as its own track/wave(s) so it can ship first even if MOTO iterates.
- MOTO is the larger, money-path, PCI-sensitive build — its own track after research, with a live-verify checkpoint (real hosted-iframe charge on the kiosk, refunded).

### Claude's Discretion
- Cash: exact change-due UI; how the cash tender button sits alongside the existing terminal/gift-card panel; the precise atomic booking mechanism (reuse confirm path with a synthetic non-terminal marker).
- MOTO: the exact endpoint composition (extend kiosk sale vs new MOTO endpoint) — RESEARCH decides; the iframe mount point on the kiosk; how the HelcimPay session token is passed.

### Owner side-check (no code — documented, not blocking)
- Ask Helcim (or test on the device) whether the physical terminal supports **manual keypad card entry** (MOTO Option A). If yes, staff can key a phone-order card directly on the terminal and the EXISTING terminal sale flow works unchanged — a zero-code alternative to the HelcimPay path. This phase builds the HelcimPay path (works regardless); the keypad option, if confirmed, is a bonus staff workflow, not a dependency. Also confirm MOTO is enabled on the Helcim merchant account and note the different interchange.
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Tickets
- `.planning/todos/pending/kiosk-cash-tender.md`
- `.planning/todos/pending/kiosk-manual-card-entry-moto.md` (esp. the PCI-scope section: Option A/B/C — B is what we build, C is forbidden)

### Code under change / reuse
- `zoho-middleware/routes/pos.js` — kiosk sale pipeline (`/api/kiosk/sale` ~237, `processSale`/`processSaleWithPrices`, confirm path ~950); customerpayment booking with `payment_mode` (~1384/1398/1828/2255); gift-card split-tender clamping (~677, D-12); the Phase 67 pre-charge assertion (~608); idempotency lock; pending-charge/reconcile (D-13, ~733)
- `zoho-middleware/routes/payments.js` — `POST /api/payment/initialize` → `helcimLib.initializeCheckout` (the HelcimPay session init to reuse for MOTO)
- `zoho-middleware/routes/checkout.js` — the hardened HelcimPay verify path (Phase 49 captured-amount readback via `getCardTransactionById` before booking) — the security pattern MOTO must mirror
- `zoho-middleware/lib/money-path.js` — `voidWithTimeout` (single void path), idempotency, captured-amount verify primitives
- `js/kiosk-core.js` — payment screen + tender panel (~2590-2990: gift-card panel injection, `_kioskPushToTerminal`, cancel/confirm); this is where cash + MOTO tender buttons and the HelcimPay iframe mount go
- `kiosk.html` — HelcimPay.js `<script>` + CSP `<meta>` (per CLAUDE.md rule 12, update CSP consistently)

### Doctrine
- `CLAUDE.md` — regression-test-first, min.js build rule, both test suites, CSP-on-all-pages rule (12), never commit secrets
- Phase 49 (captured-amount verification / no phantom revenue), Phase 44/45 (gift-card split-tender + money-path hardening), Phase 67 (pre-charge assertion) — the money-path patterns to adopt, not re-implement
</canonical_refs>

<specifics>
## Specific Ideas
- Kiosk already books Zoho customerpayments with a `payment_mode` string — cash = add `'cash'`; MOTO card = the HelcimPay-charged txn booked like the terminal path.
- HelcimPay hosted-iframe infra EXISTS and is hardened: `/api/payment/initialize` (payments.js) + the `/api/checkout` captured-amount verify (checkout.js) — reuse, don't rebuild.
- The public-website checkout proves HelcimPay reads back captured amounts correctly (Phase 49 / UAT-RUNSHEET §0).
- Off-system cash/phone sales today bypass stock decrement + batch creation — the reconciliation gap this closes.

## Research questions (for gsd-phase-researcher)
1. HelcimPay.js on a staff kiosk: can the hosted iframe be initialized + rendered for a staff-keyed (MOTO) charge the same way the public checkout does it, and what does HelcimPay.js need in `kiosk.html` (script src, CSP domains)?
2. Cleanest server composition for MOTO: extend `/api/kiosk/sale`+`confirm` (swap terminal txn for a HelcimPay-verified txn) vs a dedicated MOTO endpoint — while keeping ONE kiosk booking path (stock/batch/gift-card) and adopting the money-path primitives.
3. Zoho: confirm `payment_mode: 'cash'` is valid for the org and whether a MOTO card should book as `'creditcard'` with a note vs a distinct mode; any MOTO/CNP flag to record for dispute traceability.
4. Does HelcimPay support a MOTO/card-not-present transaction type distinct from a normal card-present sale, and does it need account-level enablement?
</specifics>

<deferred>
## Deferred Ideas
- MOTO Option A (terminal keypad entry) — owner side-check, zero code if it exists; not a dependency.
- Recording who-took-the-payment / a reference note (owner did not select the note extra) — revisit if the till-count audit needs it.
- Broader tender-type refactor (a unified tender abstraction) — only if the cash + MOTO additions make the payment screen unwieldy.
</deferred>

---

*Phase: 70-kiosk-tender-types*
*Context gathered: 2026-08-12 via owner ticket + owner decisions + code recon*
