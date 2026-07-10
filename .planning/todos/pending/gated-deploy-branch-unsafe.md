---
title: gated-deploy.yml is main-only — fails after force-pushing to production when run from a branch
status: pending
created: 2026-07-10
source: discovered during the 2026-07-10 break-glass hotfix (Fix 1)
area: CI / deploy
priority: medium
---

## What

`gated-deploy.yml` is a `workflow_dispatch` workflow, so GitHub lets it be dispatched
against **any** branch. But step (h) "Append deploy history to RUNBOOK.md" ends with:

```bash
git push origin main
```

`actions/checkout` checks out the dispatched ref as a local branch of the same name, so
when the workflow runs from `hotfix/foo` there is **no local `main` ref** and that push
fails with `src refspec main does not match any`.

## Why it matters

The failure lands *after* step (d) has already force-pushed to the production repo. So a
branch dispatch:

1. Ships the code to production (Railway redeploys — real, irreversible)
2. Pushes the `prod-*` tag (step g)
3. **Fails** at the RUNBOOK append → workflow goes red
4. **Skips** the `/health` smoke-check (step i), because it is gated on the failed step

Net effect: production is deployed, unrecorded, and unverified. The red workflow reads
like "the deploy failed" when it actually succeeded.

There is also a latent worse case: if a local `main` ref ever *does* exist in the runner
(e.g. a future checkout tweak), `git push origin main` would push the hotfix branch's HEAD
onto staging `main` and clobber history.

## Desired behaviour

Pick one:

- **Fail fast (simplest):** add a guard as the FIRST step — `if [ "${{ github.ref_name }}" != "main" ]; then exit 1; fi`. Documents the real contract: this workflow only deploys `main`.
- **Make it branch-safe:** replace `git push origin main` with `git push origin HEAD:${{ github.ref_name }}` and confirm the tag/runbook semantics still make sense off `main`.

Prefer the guard unless there is a real need to deploy non-`main` refs through the blessed
path. The 2026-07-10 hotfix went out via the break-glass path instead (see
`docs/RUNBOOK.md` Deploy History), which is what the RUNBOOK already prescribes for
"something is actively broken".

## Notes

- Whichever fix is chosen, add the missing counterpart: the break-glass path writes no
  RUNBOOK row and no tag, so both had to be done by hand this time. A small
  `scripts/record-deploy.sh` would make that reproducible.
