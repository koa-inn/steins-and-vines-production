-- 0006_recipes_beer_category.sql — Phase 89: optional beer_category on recipes.
-- Additive only (83 D-04). Plain nullable text, NO CHECK constraint (89 D-03): the deploy allowlist
-- forbids DROP CONSTRAINT, so the enum is enforced in lib/recipe-rules.js and apps-script/adminApi.gs.
-- No data step (89 D-07): staff set values in BrewPad.
-- D-13: ships to production only in the same promotion as 0004/0005 (node-pg-migrate order check).
-- Never edit this file once applied — add a new migration instead.

-- Up Migration
alter table recipes add column beer_category text;
comment on column recipes.beer_category is 'Optional beer tint key; app-level enum, see lib/recipe-rules.js BEER_CATEGORY_KEYS (Phase 89)';

-- Down Migration
alter table recipes drop column beer_category;
