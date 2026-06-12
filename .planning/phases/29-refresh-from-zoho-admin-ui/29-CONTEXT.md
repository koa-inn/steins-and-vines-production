# Phase 29: Refresh-from-Zoho Admin UI - Context

**Gathered:** 2026-06-11
**Status:** Ready for planning

<domain>
## Phase Boundary

Build the staff-facing UI for the Zoho customer refresh on **both** batch detail surfaces — the admin Batches modal (`js/admin.js` `renderBatchDetailModal`) and the BrewPad detail pane (`js/brewpad.js`). A "Refresh from Zoho" button (1) calls the Phase 28 middleware endpoint `GET /api/batch/customer-by-number?number={zoho_so_number}`, (2) writes the returned non-empty fields back via Apps Script `update_batch` (frontend two-call orchestration, Phase 28 D-10), and (3) updates the displayed customer name/email/phone in place without a page reload. The action is hidden when the batch carries no valid `zoho_so_number` (ZSYNC-01, ZSYNC-02).

**In scope:** refresh button + Zoho ref display on both detail surfaces; new Email/Phone display rows on both detail views; in-place post-refresh display update incl. cached-object patching; result-state messaging (success / no-change / partial / not-found / Zoho-error / voided-doc warning); frontend tests per existing patterns; staging verification on iPad Safari.

**Out of scope:** any middleware or Apps Script changes (Phase 28 shipped both and is verified live); manual SO-linking for unlinked batches in the *admin* surface (BrewPad's existing Link to Invoice stays as-is); customer reassignment with Zoho propagation (Phase 29.1); automatic/background re-sync; public batch.html changes.

**⚠ Key scoping facts (verified in code):**
- The backend is DONE. `GET /api/batch/customer-by-number` exists at `zoho-middleware/routes/pos.js:1370` with the full D-01..D-16 contract; `updateBatch()` `allowedFields` already accepts `customer_email`/`customer_phone` (commit `c3f7a72`). This phase is frontend-only.
- The roadmap's "batch detail modal" is ambiguous — there are TWO detail surfaces. `js/admin.js` has **zero** `zoho_so_number` references today; `js/brewpad.js` already has a Zoho-aware Invoice section (Zoho Ref row ~2227, Link to Invoice ~2244, sync indicator, `callSyncZoho`). User decided: both surfaces.
- Neither surface displays customer email/phone today — only the name (via `getCustomerDisplayName`). BrewPad's "Send Bottling Invite" button already gates on `b.customer_email` (~2324), so the field is present on batch objects.
- REQUIREMENTS.md prematurely marks ZSYNC-01/02 `[x]` Complete — nothing is built. The tick should flip only after this phase verifies.

</domain>

<decisions>
## Implementation Decisions

### Surfaces & placement
- **D-01:** The refresh button appears on **both** surfaces: BrewPad detail pane AND admin Batches detail modal.
- **D-02:** BrewPad: button goes in the **existing Invoice section** (beside the linked-number display / "Change Linked Order").
- **D-03:** Admin modal: add a **new "Zoho Ref" row to the info grid** showing the linked `zoho_so_number` with the Refresh button beside it — mirrors BrewPad's pattern so staff can see what the refresh pulls from. Not just a bare button in the actions footer.

### Displayed customer info
- **D-04:** Add **Email and Phone display rows to both detail views** (admin `batch-detail-grid`, BrewPad `bp-detail-info` rows). Refreshed values must be visible, and the rows are useful day-to-day (bottling invites depend on email).
- **D-05:** Post-refresh display update is **in-place**: patch the name/email/phone DOM nodes and the in-memory batch object. No detail re-fetch/re-render, no scroll loss, no page reload.
- **D-06:** Patch ALL caches that render customer name: BrewPad `_batchesData`/`_allBatchesData`, sessionStorage `sv-bp-batch-{id}` snapshot, and the admin batch list row data — so lists don't show a stale name after refresh (planner verifies the exact cache set).

### Unlinked-batch state (ZSYNC-02)
- **D-07:** When the batch has no usable Zoho link, the refresh button is **hidden** (not disabled). BrewPad's existing "Link to Invoice" UI is the natural affordance in that state; the admin Zoho Ref row shows **"Not linked"** instead of a number.
- **D-08:** "Usable link" is gated on **format, not just presence**: render the button only when `zoho_so_number` matches `/^(INV|SO)-\d+$/i` (same shape the endpoint validates). Malformed legacy values display as-is but get no button — a 400 `invalid_number` request can never fire from the UI.

### Refresh flow & feedback
- **D-09:** **One-click apply** — click → button busy/spinner → fields update + toast. No preview/confirm step: the operation is non-destructive by design (Phase 28 D-02 — blank Zoho values never overwrite existing batch data).
- **D-10:** **Distinct toasts per endpoint state**, using each surface's existing toast helper:
  - Full success → "Customer info updated from {number}"
  - No change → "Already up to date"
  - Partial 200 (`contact_unavailable: true`) → updated name applied; toast notes email/phone unavailable in Zoho
  - 404 `not_found` → "{number} no longer exists in Zoho"
  - 502 `zoho_error` → "Zoho unreachable — try again later"
- **D-11:** **Voided/deleted documents warn but still apply** (Phase 28 D-14 ships `document_status`): warning-style toast, e.g. "Updated — note: {number} is void in Zoho".
- **D-12:** **No-change short-circuit:** compare fetched values to the batch's current values; if nothing differs, show "Already up to date" and **skip the Apps Script `update_batch` call entirely** (no version bump, no wasted call).
- **D-13 (carried from Phase 28 D-02/D-10):** Write-back sends **only non-empty fetched fields** to `update_batch`, with `expectedVersion` per the optimistic-locking convention.

### Claude's Discretion
- Exact button label/styling per surface — follow each surface's conventions (`admin-btn-sm` / `bp-btn-sm`, secondary style).
- Loading-state mechanics (disable + spinner vs label swap) and exact toast wording, as long as D-10/D-11 semantics hold.
- How the no-change comparison treats whitespace/case.
- Optimistic-lock conflict (`expectedVersion` mismatch) handling — follow the existing stale-version error pattern (toast + refresh).
- Test structure — follow `tests/frontend/` Jest jsdom patterns and the module-export convention.
- Whether the admin "Not linked" row renders for ALL batches or only when relevant — pick what reads cleanest in the grid.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 28 contract (the API this UI consumes)
- `.planning/phases/28-zoho-customer-read-back-path/28-CONTEXT.md` — locked decisions D-01..D-16; especially D-02 (never erase), D-10 (frontend two-call orchestration), D-13–D-15 (error contract).
- `zoho-middleware/routes/pos.js` ~1370–1490 — the shipped `GET /api/batch/customer-by-number` implementation: exact response fields (`customer_name`, `customer_id`, `customer_email`, `customer_phone`, `document_number`, `document_status`, `contact_unavailable`), error bodies (`invalid_number`/`not_found`/`zoho_error`), and the `x-api-key` auth.
- `apps-script/adminApi.gs` — `updateBatch()` `allowedFields` now includes `customer_email`/`customer_phone` (commit `c3f7a72`); `update_batch` action + optimistic locking (`expectedVersion`).

### Admin frontend (Batches modal)
- `js/admin.js` — `renderBatchDetailModal` ~5854–6000 (info grid where Zoho Ref/Email/Phone rows go; `batch-detail-actions`; event-binding pattern with `batchId`/`batchVersion`); `adminApiGet`/`adminApiPost` (~630/653, Apps Script calls); middleware call pattern with `SHEETS_CONFIG.MIDDLEWARE_URL` + `x-api-key: SHEETS_CONFIG.MW_API_KEY` (~3214–3220, ~5442, ~7109); `getCustomerDisplayName` (~35); `showToast`.
- `js/sheets-config.js` — `MIDDLEWARE_URL` / `MW_API_KEY` config source.

### BrewPad frontend (detail pane)
- `js/brewpad.js` — detail pane info rows + Invoice section ~2220–2360 (where the button and Email/Phone rows go); invoice-link handlers + `_currentBatchDetail` in-place patch precedent ~740–749, ~2462–2540; `mwUrl()`/`mwApiKey()` middleware helpers; cache fields `_batchesData`, `_allBatchesData`, sessionStorage `sv-bp-batch-{id}`; `showToast`; `getCustomerDisplayName` (~34).

### Phase planning docs
- `.planning/ROADMAP.md` §"Phase 29" — goal + 4 success criteria (criterion #4: verified on staging, iPad Safari, no console errors).
- `.planning/REQUIREMENTS.md` — ZSYNC-01, ZSYNC-02 (note: prematurely ticked `[x]` — fix when phase actually completes).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`GET /api/batch/customer-by-number`** — complete, tested, deployed; this phase only consumes it.
- **BrewPad Invoice section** — existing Zoho Ref display, link/change-link UI, and `_currentBatchDetail` in-place patching are the exact precedent for D-02/D-05.
- **Middleware fetch pattern** — both files already call middleware with `x-api-key` headers (`search-invoices` calls in both admin.js and brewpad.js are copy-paste templates).
- **`adminApiPost('update_batch', { batch_id, expectedVersion, updates })`** — the write-back call, used identically by Phase 27 activation handlers in both files.
- **Toast helpers** — `showToast(msg, 'success'|'error'|...)` in both surfaces.

### Established Patterns
- **ES5 vanilla JS** (`var`, no arrow functions); edit `js/admin.js`/`js/brewpad.js` source then `npm run build`; never touch `.min.js`.
- **Optimistic locking** — mutations pass `expectedVersion` = batch `last_updated`; detail renderers already capture `batchVersion`.
- **Frontend tests** — Jest jsdom in `tests/frontend/`; modules append `module.exports` guards for testability. CI runs frontend + middleware tests and ESLint on push.
- **Staging-first** — `git push origin main` → staging UAT → prod held until v4.1 batch ships (per STATE.md blocker, phases 27–29.1 deploy together).

### Integration Points
- Admin info grid (`renderBatchDetailModal`) ↔ new Zoho Ref + Email + Phone rows + refresh button/handler.
- BrewPad Invoice section ↔ refresh button; `bp-detail-info` ↔ Email/Phone rows.
- Both ↔ `GET {MIDDLEWARE_URL}/api/batch/customer-by-number?number=…` (header `x-api-key`) → `adminApiPost('update_batch', …)`.
- Post-refresh ↔ DOM nodes + `_currentBatchDetail` / `_batchesData` / `_allBatchesData` / sessionStorage / admin list caches (D-06).

### ⚠ Planner notes
- The middleware endpoint accepts the API key via `x-api-key` header — BrewPad's `mwApiKey()` and admin's `SHEETS_CONFIG.MW_API_KEY` both supply it; note admin's `apiHeaders`-style helpers only attach the key for *mutating* calls in some paths, so the GET here must set the header explicitly (the `search-invoices` calls show how).
- Phase 28's D-02 preserve-blanks policy is server-agnostic — the **frontend** must omit empty fields from the `updates` payload; `update_batch` would happily write `''`.
- `getCustomerDisplayName` prefers firstname+lastname over `customer_name` — the refresh writes `customer_name` only; verify how a refreshed `customer_name` interacts with existing firstname/lastname fields on display (may need to decide which node to update).
- Success criterion #4 = iPad Safari on staging — keep touch targets/els consistent with each surface's existing buttons.

</code_context>

<specifics>
## Specific Ideas

- The admin modal should show **what** the refresh pulls from — hence the Zoho Ref row (D-03) rather than a context-free button.
- Mental model carried from Phase 28: "pull what Zoho knows, add it to the batch, never subtract" — that's why one-click apply needs no confirmation (D-09).
- Staff must be able to distinguish "bad link" from "Zoho is down" from "Zoho just has no email" — the whole point of distinct toasts (D-10).

</specifics>

<deferred>
## Deferred Ideas

- **Manual SO-linking in the admin modal** — BrewPad has Link to Invoice; the admin surface only displays "Not linked". Adding link/search UI to admin is a new capability (and partially covered by the existing "Future Requirements" entry for manual SO/contact linking).
- **REQUIREMENTS.md premature `[x]` on ZSYNC-01/02** — bookkeeping fix to make at phase completion, not a feature.

</deferred>

---

*Phase: 29-Refresh-from-Zoho Admin UI*
*Context gathered: 2026-06-11*
