---
status: partial
phase: 68-kiosk-terminal-push-latency-cancel-double-charge-safety
source: [68-03-PLAN.md checkpoint (deferred by owner 2026-08-12)]
started: 2026-08-12T00:00:00Z
updated: 2026-08-12T00:00:00Z
---

## Current Test

[awaiting human testing on the live kiosk — code deployed to prod 2026-08-12 (main @ a4aec80a); middleware restart confirmed, /api/kiosk/telemetry live (403 to anon = auth-gated, route present)]

## Tests

### 1. Latency capture (stage timing)
expected: Hard-refresh the kiosk iPad, ring a normal card sale. Railway logs show `kiosk.sale_stage_timing` events for that ref identifying the dominant stage (expect catalog `cache: 'rebuild'` on a cold cache, or the gift-card lookup if a GC was applied); client `kiosk.terminal_push_latency` recorded. Ask Claude to pull the stage breakdown from the logs after the sale — it is the input for the deferred latency-reduction phase.
result: [pending]

### 2. Cancel/orphan safety proof (money path)
expected: Start a sale; on the terminal step, cancel from the kiosk; then complete the card tap on the reader anyway (simulating the reported "reader picks up when I cancel"). Confirm NO orphan — either no charge occurred, or a charge that occurred was voided (check Helcim for a void/reversal on that transaction and confirm no unmatched invoice). Void fires on the FIRST Helcim webhook, not the 10-minute reconcile backstop.
result: [pending]

### 3. Tap-prompt gating (UX)
expected: The "Tap, insert, or swipe card" prompt does not appear until the server returns 202 (push actually sent); before that a neutral "Contacting terminal…" state shows.
result: [pending]

### 4. Cleanup
expected: Refund/reverse any real test charges and reverse any test invoices per the existing kiosk test-order cleanup.
result: [pending]

## Summary

total: 4
passed: 0
issues: 0
pending: 4
skipped: 0
blocked: 0

## Gaps

Deferred follow-up seeded by this phase (not a gap): latency ROOT-CAUSE reduction (pipeline reorder / catalog pre-warm) — plan it once test #1 identifies the dominant stage. See `.planning/todos/pending/kiosk-terminal-charge-lag.md`.
