---
phase: 24-seo-staging-deploy
plan: "02"
subsystem: build-deploy
tags: [build, deploy, staging, qa, content-loader, bugfix]
dependency_graph:
  requires: [BUILD-02]
  provides: [BUILD-02]
  affects:
    - js/modules/13-init.js
    - js/main.min.js
    - products/grains.html
    - products/yeast.html
    - products/additives.html
    - products/packaging.html
    - products/equipment.html
tech_stack:
  added: []
  patterns: [root-absolute content paths, page-content allowlist, GitHub Pages staging deploy]
key_files:
  created: []
  modified:
    - js/modules/13-init.js
    - js/main.js
    - js/main.min.js
    - "15 public HTML pages (cache-bust ?v= re-stamp via npm run build)"
decisions:
  - "Build + 3 mandatory pre-commit gates (frontend test, lint, middleware test) all run before push, per CLAUDE.md"
  - "Staging-only deploy (git push origin main); production deploy intentionally out of scope per STAGING-FIRST rule"
  - "Rebased Phase 24 work onto an automated 'chore: update Zoho snapshot' commit that landed on origin/main between local work and push — disjoint files, no conflict, linear history preserved"
  - "Content-loader 404 fix scoped into this phase (gap closure): pre-existing Phase 22 bug surfaced by criterion 3 (no console errors)"
gap_fix:
  problem: "js/modules/13-init.js fetched content JSON with relative paths (broke in /products/ subdir) and requested page JSON for pages that have none, logging console 404s"
  root_cause: "Relative 'content/shared.json' + 'content/<page>.json' fetch; pre-existing since Phase 22 (last touched 715d98b), live in production on hops/ferment-in-store/ingredients-supplies"
  fix: "Root-absolute /content/ paths (resolve from any directory depth) + PAGES_WITH_CONTENT allowlist gating page-specific fetch to the 7 pages that ship editorial JSON"
metrics:
  completed: "2026-06-02"
  tasks_completed: 2
  tasks_total: 2
  files_modified: 18
  frontend_tests: "432 passed"
  middleware_tests: "510 passed"
  lint: "0 errors (118 pre-existing warnings)"
---

# Plan 24-02 Summary — Build & Staging Deploy

## What was built

Built, gated, and deployed the SEO-enriched catalog subpages to **staging only**, then
verified them in-browser. During QA a console-404 regression was caught (criterion 3) and
fixed inline as gap closure.

### Task 1 — Build, gate, deploy to staging
- `npm run build` regenerated `?v=` cache-bust stamps across 15 public pages and re-minified
  CSS/JS artifacts.
- All three CLAUDE.md pre-commit gates green: frontend **432 passed**, lint **0 errors**,
  middleware **510 passed**.
- Committed build outputs and pushed to `origin/main` (staging). Rebased over an automated
  `chore: update Zoho snapshot [skip ci]` commit that landed on origin between local work and
  push (disjoint files — no conflict). Push confirmed: `git rev-parse HEAD == origin/main`.
- `CNAME` untouched (gitignored, auto-pinned by enforce-cname.yml). No `git push production`.

### Task 2 — Human visual QA (checkpoint)
- Human verified all 5 staging subpages.
- **Caught:** console 404s for `content/shared.json` and `content/yeast.json` on the subpages.

### Gap closure — content-loader 404 fix
- **Root cause:** `js/modules/13-init.js` fetched content JSON with relative paths (broke under
  `/products/`) and requested page-specific JSON for pages that have none. Pre-existing since
  Phase 22 (not introduced by this phase's SEO edits); already live in production on several pages.
- **Fix:** root-absolute `/content/` paths for `shared.json` and the site-wide promo-banner
  `home.json`; `PAGES_WITH_CONTENT` allowlist so only the 7 editorial pages request page JSON.
- Re-ran full suites (432 + 510 green, lint clean), rebuilt, redeployed to staging.
- **Re-verified:** `GET /content/shared.json` → 200, deployed bundle carries the fix, and human
  confirmed the console is clean.

## Verification against success criteria
1. ✅ Each subpage has unique title, meta description, og:* block, canonical, LocalBusiness JSON-LD
   (delivered in 24-01; spot-checked: 1 each, 5 unique titles, 0 staging-URL leaks)
2. ✅ sitemap.xml includes all 5 subpage URLs (confirmed already present from Phase 22 — verified, not duplicated)
3. ✅ All 5 subpages load on staging.steinsandvines.ca with **no console errors** (human-approved after the loader fix)

## Deviations
- **Scope:** the content-loader 404 fix widened this phase slightly beyond pure SEO. It was
  required to satisfy criterion 3 and also resolves a latent production bug.
- The fix to `js/modules/13-init.js` is a shared module affecting all pages; full frontend +
  middleware suites were re-run per CLAUDE.md rule 7. No regressions.

## Follow-ups
- **Production deploy** of Phase 24 (SEO + loader fix) is a separate, human-approved step — not done.
- The loader fix should reach production with the next prod deploy (it fixes live 404s on
  hops / ferment-in-store / ingredients-supplies).

## Commits
- `aa4d1fe` feat(24-01): add full SEO head to grains, yeast, and additives subpages
- `0e08bff` feat(24-01): add full SEO head to packaging and equipment subpages
- `bf26084` build(24-02): stamp + minify for SEO subpage staging deploy
- `7b17e6e` fix(24-02): resolve content-loader 404s on catalog subpages
