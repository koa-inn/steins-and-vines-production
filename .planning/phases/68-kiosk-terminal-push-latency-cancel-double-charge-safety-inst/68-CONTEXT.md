# Phase 68: Kiosk Terminal-Push Latency + Cancel Double-Charge Safety - Context

**Gathered:** 2026-08-11
**Status:** Ready for planning
**Source:** Owner ticket 2026-08-11 ("card reader isn't picking up the transaction request and then does when I cancel — see if anything is bogging it down") + orchestrator code recon (see `.planning/todos/pending/kiosk-terminal-charge-lag.md`).

<domain>
## Phase Boundary

Two linked problems on the kiosk card-present sale path:

1. **Latency (the reported symptom):** the kiosk shows "Tap, insert, or swipe card on terminal..." immediately (kiosk-core.js:2857), but the actual device push (`helcimLib.terminalPurchase`, helcim.js:200) only fires after the full `/api/kiosk/sale` server pipeline: idempotency lock → catalog cache read (a COLD cache runs `rebuildKioskCatalog`, a multi-second sequential Zoho refetch) → tax + pre-charge assertion → gift-card real-balance Apps Script lookup (up to 12s timeout, only when a GC is applied) → THEN `terminalPurchase` (pos.js:726). During that window the reader is idle while staff have been told to tap. "Works when I cancel" = the slow push lands ~when they cancel and they retry against a now-warm cache.

2. **Cancel is unsafe (the money bug found while diagnosing):** `/api/pos/cancel` → `helcimLib.cancelTerminal()` is a **no-op** (helcim.js:405 — logs, returns `{ device_cancel_required: true }`, cancels nothing on the device or server). The client cancel handler (kiosk-core.js:2843) sets `cancelled = true`, fires that no-op, and navigates to browse. If a slow `terminalPurchase` already reached the device, the reader is live with NO client polling `/api/kiosk/sale/status` and NO `/api/kiosk/sale/confirm` ever sent → if the customer taps, the card is charged but no invoice is created = **orphan charge** (money taken, no invoice) — the exact worst-class failure the money-path work exists to prevent.

**This phase's job:** (a) instrument the sale pipeline so the real bottleneck is captured from a live slow-case instead of guessed, and (b) close the cancel/orphan window so a cancelled-but-charged sale can never silently take money. The concrete latency *reduction* (pipeline reorder / cache pre-warm) is DEFERRED to a data-driven follow-up once telemetry identifies the dominant stage — reordering a money pipeline on a hypothesis is the mistake this repo has made before (see the kiosk-refresh guess-fix history).

In scope: `zoho-middleware/routes/pos.js` (sale pipeline instrumentation + cancel safety), `zoho-middleware/lib/helcim.js` (`cancelTerminal`), `js/kiosk-core.js` (client push-latency measurement + cancel behavior + "tap card" truthfulness), middleware + frontend regression tests.
Out of scope (deferred): the latency root-cause fix (reorder push earlier / pre-warm catalog before the reader prompt) — a follow-up phase driven by 68's telemetry.
</domain>

<decisions>
## Implementation Decisions

### Instrumentation (capture, don't guess)
- Add timestamped stage markers across `/api/kiosk/sale` → `processSale`/`processSaleWithPrices`: lock acquired, catalog read (record hit vs miss-and-rebuild — the rebuild is the prime suspect), tax+assertion done, gc-lookup start/end (with duration), `terminalPurchase` sent, 202 returned. Emit via the existing logging/telemetry path (reuse the `kiosk.*` beacon/`log.error`/event infra already used for `kiosk.total_mismatch`, 57-03 beacon findings) — do NOT invent a new channel. Durations must be greppable in Railway logs and/or land as a structured event.
- Client side (`kiosk-core.js`): measure and report wall-time from "proceed to terminal" (push shown) to the 202 response, via the existing `_kcReportClientError`/beacon path (repurpose or add a sibling `kiosk.terminal_push_latency` event). This is what correlates the owner's perceived "dead reader" duration to server stage timings.
- No PII / no PAN in any telemetry (existing redaction rules apply).

### Cancel / orphan-charge safety (fix now — money path)
- `cancelTerminal()` being a no-op is the root defect. Fix so a cancel is actually SAFE, not necessarily so it aborts the device (the device may not support remote cancel — confirm what Helcim offers). Acceptable approaches, planner to choose the smallest correct one grounded in the code:
  - **Mark-and-void:** record a server-side "cancelled" flag for the ref so that when the terminal result arrives (webhook/poll) for a cancelled sale, it is routed through the existing `moneyPath.voidWithTimeout` (the single void path — raw `voidTransaction` is forbidden outside it) instead of being dropped.
  - **Keep the safety net intact:** verify the 45-08 reconciliation backstop (pending-charge record written at pos.js:733 after `terminalPurchase`) actually reconciles a charge whose sale was client-cancelled and never confirmed — if there's a gap (e.g. the pending-charge record is only written on the confirm path, or the backstop assumes an eventual confirm), close it.
  - Do NOT introduce a new void path or bypass `moneyPath` primitives (audit H5/L18).
- Regression tests (money-path critical): "cancel fired, then terminal APPROVES the charge" → the charge is either booked to a valid invoice OR voided via `moneyPath.voidWithTimeout` — NEVER left as an orphan; and "cancel before any push" stays a clean no-charge return.

### Client "tap card" truthfulness (low-risk UX win, include if cheap)
- Consider not showing "Tap, insert, or swipe card..." until the server returns 202 (push actually sent) — directly addresses the "reader isn't picking up" perception without touching the money pipeline order. Planner's discretion; keep it a separate task/commit so it can ship even if the deeper work iterates.

### Claude's Discretion
- Exact telemetry event names/shape; log line format; whether client latency rides the existing beacon or a new sibling event; the precise cancel-safety mechanism (mark-and-void vs backstop-gap-closure) chosen after reading the reconcile code; whether to gate the "tap card" message on 202.

### Explicitly deferred (follow-up phase, telemetry-driven)
- Reordering the pipeline to push to the terminal earlier (before gc-lookup / after a guaranteed-warm catalog), catalog pre-warm on the kiosk, or moving the gc-lookup off the critical path. Requires 68's real slow-case data first. Record as a deferred item; do NOT implement on hypothesis.
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Ticket + diagnosis
- `.planning/todos/pending/kiosk-terminal-charge-lag.md` — owner ticket + triage

### Code under change / investigation
- `zoho-middleware/routes/pos.js` — `/api/kiosk/sale` pipeline (`processSale` ~300, `processSaleWithPrices`), stage order: lock ~327, catalog/rebuild ~429, assertion ~608, gc-lookup ~662-687, `terminalPurchase` ~726, pending-charge record ~733; `/api/pos/cancel` ~1586; `/api/kiosk/sale/status` ~793
- `zoho-middleware/lib/helcim.js` — `terminalPurchase` ~200, `pollTerminalResult` ~239, `cancelTerminal` ~405 (the no-op), webhook/pending-invoice correlation
- `js/kiosk-core.js` — payment screen + cancel wiring ~2600-2854, `_kioskPushToTerminal` ~2815, sale POST + poll loop ~2860-2974, `_kcReportClientError` beacon path

### Doctrine (money path)
- `lib/money-path.js` primitives — `acquireIdempotencyLock`, `voidWithTimeout` (single void path), pending-charge/reconcile contract (45-07/45-08, D-12/D-13)
- Phase 49/50/52/67 money-path summaries — void-on-failure, fail-closed, no-orphan-charge invariant
- `CLAUDE.md` — regression-test-first, one-logical-change-per-commit, both test suites, never hand-edit min.js

</canonical_refs>

<specifics>
## Specific Ideas

- Owner quote: "Sometimes the card reader isn't picking up the transaction request and then does when I cancel. Can we look into the process and see if anything is bogging it down?"
- Confirmed no-op: `cancelTerminal()` returns `{ ok: false, device_cancel_required: true }` without contacting Helcim.
- Prime latency suspect: cold-cache `rebuildKioskCatalog` (a full sequential Zoho item refetch) sitting in front of `terminalPurchase`; secondary: the 12s-timeout gift-card balance lookup when a GC is applied.
- A pending-charge record IS written after `terminalPurchase` (pos.js:733) for the 45-08 backstop — verify it covers the cancelled-never-confirmed case.
</specifics>

<deferred>
## Deferred Ideas

- Latency root-cause reduction (pipeline reorder / catalog pre-warm / gc-lookup off critical path) — a follow-up phase using 68's telemetry.
- Whether Helcim supports a genuine remote device-cancel API (research question for the cancel-safety work; if it exists, a real cancel could supersede mark-and-void).
</deferred>

---

*Phase: 68-kiosk-terminal-push-latency-cancel-double-charge-safety*
*Context gathered: 2026-08-11 via owner ticket + orchestrator code recon*
