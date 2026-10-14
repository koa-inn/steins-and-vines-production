'use strict';

/**
 * Real-Postgres beer_category semantics for lib/recipe-pg.js — Phase 89 Plan 04 (D-03/D-04/D-05).
 * Runs only via `npm run test:db`.
 */

var pgHarness = require('./helpers/pg-harness');
var describeDb = pgHarness.describeDb;
var startPostgres = pgHarness.startPostgres;
var applyMigrations = pgHarness.applyMigrations;

describeDb('recipe-pg beer_category', function () {
  var container;
  var pool;
  var recipePg;
  var harness;

  beforeAll(async function () {
    var started = await startPostgres();
    container = started.container;
    var migrateResult = applyMigrations(started.connectionString);
    if (migrateResult.code !== 0) {
      throw new Error('applyMigrations failed: ' + migrateResult.stderr);
    }
    jest.resetModules();
    var db = require('../../lib/db');
    recipePg = require('../../lib/recipe-pg');
    pool = db.createPool(started.connectionString);
  }, 120000);

  afterAll(async function () {
    if (pool) await pool.end();
    if (container) await container.stop();
  }, 60000);

  harness = pgHarness.rollbackEachTest(function () {
    return pool;
  });

  async function make(client, extra) {
    var res = await recipePg.createRecipe(client, Object.assign({ name: 'Orig', notes: 'n' }, extra || {}),
      { now: new Date('2026-01-01T00:00:00.000Z') });
    var d = await recipePg.getRecipe(client, res.recipe_id);
    return { id: res.recipe_id, token: d.recipe.updated_at, res: res };
  }

  async function raw(client, id) {
    var r = await client.query('select beer_category, updated_at from recipes where recipe_id = $1', [id]);
    return r.rows[0];
  }

  async function counts(client) {
    var r = await client.query('select count(*)::int as n from recipes');
    var i = await client.query('select count(*)::int as n from recipe_ingredients');
    return r.rows[0].n + ':' + i.rows[0].n;
  }

  it('create normalises beer_category to the canonical key', async function () {
    var client = harness.client();
    var m = await make(client, { beer_category: 'IPA' });
    expect(m.res.ok).toBe(true);
    expect((await recipePg.getRecipe(client, m.id)).recipe.beer_category).toBe('ipa');
    expect((await raw(client, m.id)).beer_category).toBe('ipa');
  });

  it('create without beer_category stores NULL and reads back empty string', async function () {
    var client = harness.client();
    var m = await make(client);
    expect((await raw(client, m.id)).beer_category).toBeNull();
    expect((await recipePg.getRecipe(client, m.id)).recipe.beer_category).toBe('');
  });

  it('create rejects an off-list category and writes nothing', async function () {
    var client = harness.client();
    var before = await counts(client);
    var res = await recipePg.createRecipe(client, { name: 'X', beer_category: 'purple' }, {});
    expect(res.ok).toBe(false);
    expect(res.error).toBe('invalid_data');
    expect(await counts(client)).toBe(before);
  });

  it('update sets a normalised category and bumps updated_at', async function () {
    var client = harness.client();
    var m = await make(client);
    var res = await recipePg.updateRecipe(client, { recipe_id: m.id, beer_category: 'Red Ale' },
      { expectedUpdatedAt: m.token, now: new Date('2026-02-02T00:00:00.000Z') });
    expect(res.ok).toBe(true);
    var d = (await recipePg.getRecipe(client, m.id)).recipe;
    expect(d.beer_category).toBe('redale');
    expect(d.updated_at).toBe('2026-02-02T00:00:00.000Z');
  });

  it('update with beer_category undefined leaves the column untouched', async function () {
    var client = harness.client();
    var m = await make(client, { beer_category: 'stout' });
    var res = await recipePg.updateRecipe(client, { recipe_id: m.id, notes: 'changed' }, { expectedUpdatedAt: m.token });
    expect(res.ok).toBe(true);
    expect((await raw(client, m.id)).beer_category).toBe('stout');
  });

  it("update with '' clears the column to NULL", async function () {
    var client = harness.client();
    var m = await make(client, { beer_category: 'stout' });
    var res = await recipePg.updateRecipe(client, { recipe_id: m.id, beer_category: '' }, { expectedUpdatedAt: m.token });
    expect(res.ok).toBe(true);
    expect((await raw(client, m.id)).beer_category).toBeNull();
    expect((await recipePg.getRecipe(client, m.id)).recipe.beer_category).toBe('');
  });

  it('update with an off-list category and a stale token reports invalid_data, not stale_recipe', async function () {
    var client = harness.client();
    var m = await make(client, { beer_category: 'stout' });
    var res = await recipePg.updateRecipe(client, { recipe_id: m.id, beer_category: 'purple' },
      { expectedUpdatedAt: '2000-01-01T00:00:00.000Z' });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('invalid_data');
    expect((await raw(client, m.id)).beer_category).toBe('stout');
  });

  it('listRecipes rows carry beer_category as the 19th key after schedule_id', async function () {
    var client = harness.client();
    await make(client, { beer_category: 'ipa' });
    var list = await recipePg.listRecipes(client, {});
    var keys = Object.keys(list.recipes[0]);
    expect(keys[17]).toBe('schedule_id');
    expect(keys[18]).toBe('beer_category');
    expect(list.recipes[0].beer_category).toBe('ipa');
  });
});
