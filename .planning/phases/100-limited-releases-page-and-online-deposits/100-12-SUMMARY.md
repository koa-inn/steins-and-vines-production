---
phase: 100-limited-releases-page-and-online-deposits
plan: 12
subsystem: frontend
tags: [limited-releases, helcim, payment, confirmation]
requires: ["100-02", "100-11"]
provides: ["payment state machine and in-page confirmation in js/modules/18-limited-releases.js"]
key-files:
  created: [tests/frontend/limited-releases-payment.test.js]
  modified: [js/modules/18-limited-releases.js, js/modules/18-limited-releases.min.js]
metrics:
  completed: 2026-10-29
---

# Phase 100 Plan 12: Payment flow and confirmation Summary

Pay button now runs validate, reCAPTCHA, POST /api/preorder/initialize, HelcimPay iframe, POST /api/preorder/deposit, with honest "not charged" copy and an in-page confirmation listing every SO.

## Commits
- 4acce403: payment state machine, validation, postMessage handling, deposit call, 21 tests
- second commit "feat(100): limited-releases payment flow and in-page confirmation": full D-11 confirmation, rebuilt min.js, 7 more tests

## What was built
- Gate: LV11 "propagates: yes" per the orchestrator environment notes; plan executed.
- States: ready, starting, iframe, verifying, unknown, success. Controls locked and sticky bar hidden outside ready; beforeunload only in iframe and verifying. `lrUpdatePay` defers to the state machine while a payment is in progress.
- postMessage: origin allowlist (secure.helcim.app, myhelcim.com) and eventName bound to this session's checkoutToken or secretToken; transaction id extraction replicated locally.
- "Not charged" copy only for cancel, decline, pre-payment failure/400/503, and deposit `voided:true`. Any other post-approval outcome (voided:false, timeout via 60 s AbortController, network error, non-JSON, unreadable txn id) keeps pay disabled, shows call-us and the Reference; tests assert the phrases are absent.
- Transaction id is retained until a `voided:true` response or a cancel/decline; newsletter is a strict boolean.
- Confirmation uses createElement/textContent only; SVG checkmark in final state under reduced motion; focus moves to the h2.
- Exports added for tests: submitPayment, submitDeposit, handleHelcimMessage, setPaymentState.

## Verification
- Frontend 235 suites / 3276 tests, middleware 270 suites / 3839 tests, lint clean. Built min.js contains `/api/preorder/deposit`.

## Deviations from Plan
- Worktree base was behind the expected base; reset to 28259847 as the startup check prescribes.
- `npm run build` re-stamped unrelated pages, js/admin.* and limited-releases.html; all reverted, only plan files committed (limited-releases.html `?v=` tokens therefore not refreshed here).
- Decline detection is heuristic: an ABORTED event whose eventMessage contains "declin" is treated as a decline, else a user cancel (checkout has no distinct decline path to mirror). Needs confirmation against a live Helcim decline during staging UAT.
- A "Close secure payment" button (UI-SPEC) is included and behaves as cancel.

## Known Stubs
None.

## Self-Check: PASSED
