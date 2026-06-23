---
phase: 36-cross-surface-selection-recipe-modification
plan: 12
status: superseded
completed: 2026-06-22
superseded_by: 36-17
---

# 36-12 Summary — Round-1 re-UAT (SUPERSEDED by 36-17)

## Outcome

**Superseded — folded into 36-17.** Owner decision (2026-06-22): rather than run a
separate round-1 UAT sign-off, the round-1 re-tests (GAP-1/2/3) are re-confirmed inside
the single combined **Third-pass UAT** in plan 36-17, which also covers the round-2
GAP-4/5/6/7 fixes and the still-pending original items (#1–#8). Running 36-12 as its own
checkpoint would have required a redundant second staging deploy and a duplicate owner
sign-off for items that 36-17 re-verifies anyway.

36-17's own plan explicitly states it "supersedes/extends the 36-12 UAT checkpoint," so
this is consistent with the plan set as authored.

## What actually happened under 36-12

- The round-1 gap-closure code (36-08..36-11: GAP-1 autocomplete fix, GAP-2 polish, GAP-3
  synced ×factor) was deployed to staging and the re-UAT items were recorded in
  36-HUMAN-UAT.md (commit `74ed966`, "deployed to staging, awaiting sign-off").
- Before the owner signed off, a second-pass UAT surfaced follow-on issues GAP-4/5/6/7,
  which spawned the round-2 plan set (36-13..36-17). Round-1 sign-off was therefore never
  taken in isolation — it rolls into the third pass.

## Disposition of 36-12's must-haves

- "Three gap-closure surface changes deployed to staging for re-UAT" → satisfied; the same
  changes (plus round-2 fixes) are now live on staging via the 36-13..36-16 deploy
  (`7082e06..8e2f593`, PUSH_CONFIRMED).
- "Human re-verifies GAP-1/2/3" → carried into the Third-pass UAT (TP-1..TP-10 re-confirm
  the GAP-3 ×factor, the modify autocomplete, and layout polish across all surfaces).
- "displayed==charged holds; BrewPad never charges (D-10)" → re-verified by TP-1/TP-5/TP-7.

## Self-Check: PASSED (as superseded)

No code work owed by this plan. The deploy + human re-verification it called for are
delivered by 36-17. Marking complete (superseded) so the phase's gap set converges on a
single sign-off.
</content>
</invoke>
