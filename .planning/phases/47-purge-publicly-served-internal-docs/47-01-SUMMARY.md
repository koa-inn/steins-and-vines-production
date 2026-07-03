# Summary: 47-01 — Purge publicly-served internal docs (SEC-01 / H1)

**Status:** Code complete (Tasks 1–2). Task 3 = owner-coordinated deploy + verification, PENDING.

## What was built

Closes audit finding **H1 / SEC-01** — the internal `.planning/` tree and `AUDIT-2026-06-29.md` were
served publicly on staging (verified HTTP 200), leaking the admin key value + a file:line exploit map.
Chosen fix: **Option B — workflow strip** (owner, 2026-07-03), keeping raw no-Jekyll serving.

### Task 1 — untrack + exclude the audit doc (`065ed99`)
- `git rm --cached AUDIT-2026-06-29.md` — untracked, **local working copy kept** for reference.
- `.gitignore`: added `AUDIT-*.md` beside `PROJECT_ASSESSMENT.md`.
- `_config.yml`: added `"AUDIT-*.md"` to `exclude:` (defense-in-depth).
- Effect: no longer tracked at HEAD → removed from the served branch → 404s on staging on next push,
  **without any Pages-source change** (classic Pages simply stops serving a file that's gone from the branch).

### Task 2 — Actions-based staging deploy that strips internal docs (`7116801`)
- New `.github/workflows/deploy-staging.yml`: mirrors `deploy-production.yml`; `check-repo` job guards it to
  the `-staging` repo (no-ops on prod, symmetric with the prod workflow's `-production` guard); strip step
  `rm -rf .planning` + `rm -f AUDIT-*.md PROJECT_ASSESSMENT.md`; `upload-pages-artifact path: .` → `deploy-pages`.
- Extended `deploy-production.yml`'s strip with the same audit-doc removal (belt-and-suspenders).
- Both workflows validated as parseable YAML.
- Keeps `.planning/` **tracked** in git (D-01) — only stripped from what's published.
- Raw serving preserved: `upload-pages-artifact` auto-injects `.nojekyll`, so inline JS/JSON-LD is untouched
  and `.well-known/security.txt` still serves. CNAME in the artifact is `staging.steinsandvines.ca` (verified).

## Task 3 — owner-coordinated deploy + verification (PENDING checkpoint)

1. **Push to staging** (`git push origin main`) — Task-1's audit-doc removal takes effect on classic Pages immediately.
2. **Owner:** staging repo → Settings → Pages → Source: switch **"Deploy from a branch" → "GitHub Actions"**;
   confirm custom domain stays `staging.steinsandvines.ca`. (Brief window until the first Actions deploy lands.)
   - Note: pushing before the source flip triggers `deploy-staging.yml`, whose `deploy-pages` step fails until
     the source is "GitHub Actions" — harmless (classic Pages keeps serving), just a red run. Flip, then re-run/push.
3. **Verify** after the Actions deploy:
   - `curl https://staging.steinsandvines.ca/.planning/STATE.md` → **404**
   - `curl https://staging.steinsandvines.ca/AUDIT-2026-06-29.md` → **404**
   - `curl https://staging.steinsandvines.ca/.well-known/security.txt` → **200**
   - staging site still renders (spot-check a page)

## Notes / follow-ups
- **Prod:** the audit-doc leak closes on prod at the **next production deploy** (the Phase 46 cutover push)
  via the untracking + extended strip — no separate prod action here. (Audit rated prod exposure
  edge-inconclusive — Cloudflare returned 403 to the automated fetch.)
- **Not history rewriting:** `AUDIT-2026-06-29.md` and the key value remain in git *history*; purging history
  is out of scope. The leaked key is neutralized by the Phase 46 rotation, not by this phase.
- `.planning/reports/AUDIT.md` (the newer whole-repo audit) is already untracked and under `.planning/`, so it's
  covered by both the strip and the gitignore — no action needed.

## Self-Check: PASSED (code portion)
- Audit doc untracked at HEAD ✓, gitignored ✓, excluded ✓, local copy preserved ✓
- `deploy-staging.yml` present, repo-guarded, strips `.planning` + audit docs ✓; prod strip extended ✓
- Both workflow YAMLs parse ✓
- Deploy-time verification (Task 3) deferred to the owner-coordinated push + Pages-source flip.
