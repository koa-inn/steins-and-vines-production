# Promote Steps — Phase 72 Beer & Cider Launch Pages

**Owner-facing runbook.** The executor stops at a committed, staging-ready feature
branch. **No production deploy is performed by the executor** — this is a locked
decision (see `72-03-PLAN.md` threat T-72-06). Everything below `## 5. Production
promotion` is the owner's action only.

---

## 1. What shipped (72-01 + 72-02)

- **`beer.html`** — "Now Brewing: Craft Beer" launch announcement page. Composite of
  the `about.html` shell (head/CSP/nav/footer/scripts) + `index.html` section
  primitives. Clean-URL canonical `/beer`. beer-specific `og:*`/`twitter:*` tags.
- **`cider.html`** — "Now Fermenting: 100% Okanagan Juice Cider" launch page, same
  structure. Clean-URL canonical `/cider`.
- **Site-wide nav** — Beer + Cider links added to all 17 public pages: `index.html`,
  `about.html`, `contact.html`, `custom-labels.html`, `hops.html`, `ingredients.html`,
  `products.html`, `reservation.html`, `404.html`, and all 8 `products/*.html` pages
  (`ferment-in-store`, `ingredients-supplies`, `hops`, `grains`, `yeast`, `additives`,
  `packaging`, `equipment`). Staff-only pages (admin/kiosk/brewpad/batch) untouched.
- **Homepage launch banners** — the stale "Beer Is Coming" waitlist `.beer-banner`
  was **repurposed** (not removed) into a live "Now Available" Beer banner linking to
  `beer.html`; a new second "Now Available" Cider banner (base `.beer-banner`, no
  `--green` modifier) was added linking to `cider.html`. See §3 for the disposition
  record and what needs your confirm/override.
- **`sitemap.xml`** — `/beer` and `/cider` entries added (monthly, priority 0.7).
- **`package.json`** — `beer.html`/`cider.html` added to the `stamp:pages` array so
  their `?v=` cache-bust token gets stamped by `npm run build`.
- **`content/home.json`** — `beer-title`/`beer-text` updated to match the new banner
  copy (was still saying "Beer Is Coming" — would have silently reverted the HTML at
  runtime via `js/modules/13-init.js`'s CMS-JSON override); `cider-title`/`cider-text`
  keys added for the new Cider banner.
- Orphaned `#beer-waitlist-iframe` removed (its form target no longer exists;
  `setupBeerWaitlistForm()` is null-guarded, no JS regression).
- Full build/lint/test gate green on every task: `npm run build`, `npm run lint`
  (`--max-warnings 0`), `npm test` (79/79 suites / 1095/1095 tests).

Task commits: `d616479e`, `c32c9961`, `d6ac6b93` (72-01); `a9cc6969`, `dee27ec5` (72-02).

---

## 2. FILL-BEFORE-PROMOTION checklist — every `[PLACEHOLDER: ...]` marker

**Do NOT guess these values.** The executor deliberately left these as placeholders —
real price, dates, and copy must come from you before production promotion.

### `beer.html`

| # | Placeholder | Location |
|---|---|---|
| 1 | `[PLACEHOLDER: CTA text — e.g. Reserve Your Kit]` | Hero CTA button (appears twice: hero + bottom CTA block) |
| 2 | `[PLACEHOLDER: what-it-is — beer]` | "What it is" one-liner |
| 3 | `[PLACEHOLDER: available-from]` | Availability/dates section |
| 4 | `[PLACEHOLDER: ready-in]` | Availability/dates section |
| 5 | `[PLACEHOLDER: seasonal note]` | Availability/dates section |
| 6 | `[PLACEHOLDER: price]` | Price section |
| 7 | `[PLACEHOLDER: what's included]` | Price section |
| 8 | `[PLACEHOLDER: FAQ answer — experience needed]` | FAQ |
| 9 | `[PLACEHOLDER: FAQ answer — timeline]` | FAQ |
| 10 | `[PLACEHOLDER: FAQ answer — custom recipes]` | FAQ |

### `cider.html`

| # | Placeholder | Location |
|---|---|---|
| 1 | `[PLACEHOLDER: CTA text — e.g. Reserve Your Kit]` | Hero CTA button (appears twice: hero + bottom CTA block) |
| 2 | `[PLACEHOLDER: what-it-is — cider]` | "What it is" one-liner |
| 3 | `[PLACEHOLDER: what makes it special — 100% Okanagan juice / source]` | "What it is" section |
| 4 | `[PLACEHOLDER: available-from]` | Availability/dates section |
| 5 | `[PLACEHOLDER: ready-in]` | Availability/dates section |
| 6 | `[PLACEHOLDER: seasonal juice note]` | Availability/dates section |
| 7 | `[PLACEHOLDER: price]` | Price section |
| 8 | `[PLACEHOLDER: what's included]` | Price section |
| 9 | `[PLACEHOLDER: FAQ answer — experience needed]` | FAQ |
| 10 | `[PLACEHOLDER: FAQ answer — timeline]` | FAQ |
| 11 | `[PLACEHOLDER: FAQ answer — custom recipes]` | FAQ |

### `index.html` (homepage banners)

| # | Placeholder | Location |
|---|---|---|
| 1 | `[PLACEHOLDER: CTA text — e.g. Explore Beer →]` | Beer banner CTA link text |
| 2 | `[PLACEHOLDER: CTA text — e.g. Explore Cider →]` | Cider banner CTA link text |

Note: homepage banner **headline/subhead copy** was written as final launch copy (not
placeholder) — only the two CTA link labels above remain owner-fillable.

### Placeholder images

**None currently referenced.** Neither page includes a `<picture>`/photo block in this
plan (it was optional and not exercised). If you want a hero/feature photo on either
page, that is a follow-up: add a `<picture>` block following the `about.html:179-198`
webp+srcset convention (e.g. `images/launch/beer-1600w.jpg` /
`images/launch/cider-1600w.jpg`) — no such filenames exist yet, so nothing is
currently broken by their absence.

**Total: 23 text placeholders across 3 files.** Search command to re-verify before
promotion:
```bash
grep -rn '\[PLACEHOLDER:' beer.html cider.html index.html
```

---

## 3. Stale-banner disposition record (needs your confirm/override)

The homepage previously had a "Beer Is Coming / waitlist" banner (badge "Coming Soon",
a waitlist `<form>`, and a hidden `#beer-waitlist-iframe` submit target).

**72-02 chose: REPURPOSE, not remove.** The existing `.beer-banner beer-banner--green`
block was rewritten in place — badge "Coming Soon" → "Now Available", headline/subhead
rewritten for a live launch, the waitlist `<form>` deleted, and a `.btn` CTA to
`beer.html` added. The orphaned `#beer-waitlist-iframe` was removed entirely (its form
target was gone; `setupBeerWaitlistForm()` in `js/modules/12-checkout.js:1690` is
null-guarded so this caused no JS regression). A second, new "Now Available" Cider
banner was added immediately after using the base `.beer-banner` class (no `--green`
modifier — the only other color option in `css/styles.css`) for visual distinction.

**This was the plan's stated default**, pending your confirmation in this checkpoint.

**Confirm, or request a different disposition:**
- Approve as-is (repurposed Beer banner + new Cider banner, waitlist gone), **or**
- Remove the Cider banner (keep only Beer live), **or**
- Restore/keep a waitlist mechanism for one or both products, **or**
- Any other reordering/placement change.

State your choice at the checkpoint. If a change is requested, a revision plan will
implement it before promotion.

---

## 4. Staging deploy steps (feature branch → staging)

From the repo root, on the branch this phase committed to:

```bash
git status                      # confirm working tree clean
git checkout main               # if not already on main
git push origin main            # → staging.steinsandvines.ca
```

`enforce-cname.yml` re-asserts the staging domain automatically after the push. No
middleware changes in this phase — nothing to deploy on Railway.

**Smoke test on staging** (`staging.steinsandvines.ca`):
1. Visit `/beer` and `/cider` — confirm they render, look visually consistent with
   `/about`, and the primary CTA links to the ferment booking flow.
2. Click through the nav on a few pages (home, a `products/*` page, `hops.html`) —
   confirm Beer + Cider links are present and resolve.
3. On the homepage, confirm the banner disposition matches §3 (or your requested
   change).
4. Open browser DevTools → Console on `/beer` and `/cider` — confirm **zero CSP
   violation errors**. Both pages copy the CSP `<meta>` tag from `about.html` per
   `CLAUDE.md` rule 12; a mismatch here would mean a domain was missed.

---

## 5. Production promotion steps — OWNER ONLY

**Do not run these until:**
- Every placeholder in §2 has been filled with real content, and
- The banner disposition in §3 has been confirmed (or its revision has shipped and
  been re-verified on staging), and
- Staging smoke test (§4) has passed.

**The executor does not run this step.** Per `CLAUDE.md` and the
`docs/PROD-DEPLOY-70-71.md` runbook precedent:

```bash
git push production main --force        # → steinsandvines.ca
```

This is frontend-only (no middleware changes shipped in this phase — Railway does not
need a `railway up`). The `enforce-cname.yml` workflow re-asserts the production
domain after the push.

---

## 6. Post-promotion checks

- [ ] `steinsandvines.ca/beer` resolves as a clean URL, loads correctly.
- [ ] `steinsandvines.ca/cider` resolves as a clean URL, loads correctly.
- [ ] Nav consistent across pages in production (spot-check home, one `products/*`
      page, `hops.html`).
- [ ] Browser console on `/beer` and `/cider` — zero CSP violations.
- [ ] `steinsandvines.ca/sitemap.xml` includes `/beer` and `/cider` entries.
- [ ] Homepage shows the confirmed banner disposition (§3), no stale "Coming Soon" /
      waitlist copy remaining.
