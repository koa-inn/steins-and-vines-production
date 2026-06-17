# Milestones

## v4.1 BrewPad Batch Lifecycle & Zoho Sync (Shipped: 2026-06-17)

**Phases completed:** 9 phases (27, 27.1, 28, 29, 29.1-29.4, 30), 32 plans

**Key accomplishments:**

- Pending-batch lifecycle in BrewPad: surface pending batches with one-click Activate and guided Schedule & Activate, pending-aware status badges, and pending-batch deletion — no more manual Google Sheet edits (Phases 27, 27.1, 29.2)
- Zoho customer sync: GET /api/batch/customer-by-number read-back endpoint + Apps Script write-back, and a "Refresh from Zoho" button in the batch detail modal updating customer name/email/phone gated on zoho_so_number (Phases 28, 29)
- Batch customer reassignment that propagates the change to the linked Zoho sales order/invoice (Phase 29.1)
- Pull non-kiosk batch sales into BrewPad: bulk-scan recent Zoho invoices for ferment-in-store sales lacking a batch, dedupe by zoho_so_number, create pending batches within a rate-limited scan window (Phase 29.3)
- Wine drill-down analytics on the BrewPad dashboard: wine batches split by selectable dimension (subcategory/brand/manufacturer/kit time) via catalog join (Phase 29.4)
- Assessment quick wins (Phase 30): removed ~26MB dead assets + dead code, repo hygiene, presentation/contrast/404 fixes, kiosk cart-leak fix, XSS hardening — plus transactional email restored on Resend, beer waitlist migrated to MailerLite, and bottling-invite emails routed through Resend

**Known deferred items at close:** 18 (see STATE.md Deferred Items) — all human-signoff/UAT bookkeeping on shipped, in-production features; no broken code.

---

## v2.0 Recipe-Based Products (Shipped: 2026-05-27)

**Phases completed:** 4 phases, 13 plans, 15 tasks

**Key accomplishments:**

- Recipe CRUD (get_recipes, get_recipe, create_recipe, update_recipe, delete_recipe) added to adminApi.gs with Recipes and RecipeIngredients sheet schemas, separate-tab ingredient storage, and soft-delete/hard-delete logic based on batch references
- Task 3 (human-verify) awaiting user action.
- Express route module with 6 recipe endpoints (CRUD + availability), Redis caching, server-side stock computation, and activation guardrails -- 14 unit tests passing
- One-liner:
- LOCK_KEYS.RECIPE_SALE constant, MILLING_FEE_ITEM_ID env var, and detectRecipeSale() single-batch fire-and-forget function with 9 unit tests — foundation for Plan 02 recipe sale endpoint
- New pos-recipe.js route with initiate + confirm endpoints: Redis mutex, server-authoritative pricing from ingredient catalog, per-ingredient Zoho invoice, void-on-failure, detectRecipeSale fire-and-forget for in-store — 14 unit tests all passing
- Mode toggle, recipe card grid, sale-type prompt with availability check, cart population with ingredient and fee lines, and recipe sale checkout routing wired to /api/kiosk/recipe-sale — kiosk recipe flow end-to-end in admin.html
- CSS-only recipe browser styles for mode toggle, 64px sale-type buttons, availability banners with colored left borders, and 8px availability dots — all using existing kiosk.css custom properties
- Full test suite green (866 tests), lint clean (0 errors), build artifacts regenerated — awaiting human verification of recipe sale flow on staging

---
