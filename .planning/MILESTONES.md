# Milestones

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
