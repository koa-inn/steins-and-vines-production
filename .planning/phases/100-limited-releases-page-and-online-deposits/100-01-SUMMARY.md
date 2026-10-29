---
phase: 100-limited-releases-page-and-online-deposits
plan: 01
subsystem: content
tags: [limited-releases, policy, assets]
requires: []
provides:
  - committed supplier assets and content JSON (unchanged)
  - final deposit terms in JSON, refunds.html and terms.html
affects: [100 later plans, owner sign-off in Plan 13]
key-files:
  created: [images/limited-releases/ (25 files), content/limited-releases-2026-27.json, HANDOFF-limited-releases-deposits.md, HANDOFF-limited-releases-assets.md]
  modified: [content/limited-releases-2026-27.json, refunds.html, terms.html]
decisions:
  - D-05/D-06/D-07 wording recorded in JSON and both policy pages
metrics:
  tasks: 2
  completed: 2026-10-29
---

# Phase 100 Plan 01: Assets and deposit terms Summary

Supplier assets and content JSON landed unchanged in their own commit, then 60-day hold and staff-handled switching terms were added to the JSON and to new Limited Release deposit sections in refunds.html and terms.html.

## Commits
- 12c82028 chore: 25 assets + content JSON (26 files, unchanged)
- c9259de8 docs: the two limited-release handoffs
- 90877293 content: deposit_terms now 6 entries; open_decisions_for_owner removed
- 0ae8993e docs: policy sections

## Policy wording for owner approval
refunds.html section D (re-lettered following sections E-I, ids unchanged; pointer added in section A "(Limited Release wine kits are different: see section D.)"):
- Reserving a Limited Release wine kit takes a $50 deposit per kit, paid online when you reserve.
- The deposit is non-refundable. It comes off the kit price when you start your batch.
- If a supplier cannot deliver a kit you have reserved, we refund that deposit in full to the original card.
- We hold your kit for 60 days after it arrives. If you have not started your batch by then, the deposit is forfeited.
- Before your kit's release month, you can ask us to move your deposit to another limited release kit, subject to availability. Call or email us and our staff will make the change.
- Link to terms.html#limited-release-deposits.

terms.html section 9 (later sections renumbered 10-15, ids unchanged):
"A Limited Release kit reservation is formed when your $50 per kit deposit payment is approved. The deposit is non-refundable and comes off the kit price when you start your batch. If a supplier cannot deliver a kit you have reserved, we refund that deposit in full. We hold your kit for 60 days after it arrives; if you have not started your batch by then, the deposit is forfeited. Before the kit's release month you can ask us to move your deposit to another limited release kit, subject to availability, and our staff will make the change. Release months are set by suppliers and may change. See also our Refund, Return & Cancellation Policy." (links to refunds.html#limited-release-deposits)

## Deviations from Plan
None to the work. Note: the "reservation formed when payment approved" and "release months may change" sentences in terms.html were specified by the plan; the 60-day figure was the suggestion in the JSON open decisions, adopted per D-06.

## Deferred / pre-existing issues
- zoho-middleware `__tests__/vancouver-timezone.test.js` fails locally (2 tests) because local Node is v20.20.2 with old tzdata (known issue; prod runs Node 24). Unrelated to this plan; all other middleware suites pass. Frontend 3206 tests and lint pass.
- The first-task "missing path" check flagged two prose strings in the JSON notes (not file paths); all real image paths exist.

## Self-Check: PASSED
