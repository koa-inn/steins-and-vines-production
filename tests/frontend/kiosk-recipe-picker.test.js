'use strict';

// Phase 90-04 (D-19/D-20): kiosk recipe-mode search dropdown above the tiles.

global.window = global.window || {};
global.window.addEventListener = global.window.addEventListener || jest.fn();
global.navigator = global.navigator || { userAgent: 'test' };
global.console = { log: jest.fn(), warn: jest.fn(), error: jest.fn(), info: jest.fn() };
global.alert = jest.fn();
global.SHEETS_CONFIG = {
  MIDDLEWARE_URL: 'http://localhost:3001',
  MW_API_KEY: 'test-key',
  SPREADSHEET_ID: 'test-id',
  GOOGLE_CLIENT_ID: 'test-client-id',
  STAFF_EMAILS: 'test@example.com',
  API_BASE: 'https://script.google.com/test',
  SERVER_TOKEN: 'test-token'
};

function flush() { return new Promise(function (r) { setTimeout(r, 0); }); }

function mockRecipes(list) {
  global.fetch = jest.fn(function () {
    return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({ recipes: list }); } });
  });
}

async function setup(list) {
  jest.resetModules();
  if (global.window) delete global.window.KioskCore;
  delete global.window.RecipePicker;
  document.body.innerHTML = '<div id="kiosk-recipe-grid"></div><div id="kiosk-recipe-prompt" style="display:none"></div>' +
    '<span id="kiosk-recipe-selected-name"></span>';
  mockRecipes(list);
  require('../../js/kiosk.js');
  var core = global.window.KioskCore;
  core.setMode('recipes');
  await flush();
  await flush();
  return core;
}

function fire(el, type) {
  el.dispatchEvent(new window.Event(type, { bubbles: true, cancelable: true }));
}

var THREE = [
  { recipe_id: 'R1', name: 'west coast IPA', style: 'American', pricing_mode: 'fixed', locked_price: 10 },
  { recipe_id: 'R2', name: 'Amber', style: 'NEIPA', pricing_mode: 'fixed', locked_price: 10 },
  { recipe_id: 'R3', name: 'Stout', style: 'Dry', pricing_mode: 'fixed', locked_price: 10 }
];

describe('kiosk recipe search dropdown', function () {
  test('renders a search header as the first child of the grid', async function () {
    await setup(THREE);
    var grid = document.getElementById('kiosk-recipe-grid');
    expect(grid.firstElementChild.className).toBe('kiosk-recipe-search');
    var input = document.getElementById('kiosk-recipe-search-input');
    expect(input.getAttribute('role')).toBe('combobox');
    expect(input.getAttribute('aria-expanded')).toBe('false');
    expect(input.getAttribute('aria-controls')).toBe('kiosk-recipe-search-list');
    expect(input.getAttribute('placeholder')).toBe('Search or choose a recipe');
    var panel = document.getElementById('kiosk-recipe-search-list');
    expect(panel.getAttribute('role')).toBe('listbox');
    expect(panel.style.display).toBe('none');
    expect(grid.querySelectorAll('.kiosk-recipe-card')).toHaveLength(3);
  });

  test('focus and click open the panel with all recipes A-Z; Escape closes', async function () {
    await setup(THREE);
    var input = document.getElementById('kiosk-recipe-search-input');
    fire(input, 'focus');
    var panel = document.getElementById('kiosk-recipe-search-list');
    expect(panel.style.display).toBe('');
    expect(input.getAttribute('aria-expanded')).toBe('true');
    var rows = panel.querySelectorAll('[role="option"]');
    expect(Array.prototype.map.call(rows, function (r) { return r.getAttribute('data-recipe-id'); }))
      .toEqual(['R2', 'R3', 'R1']);
    expect(rows[0].textContent).toContain('Amber');
    expect(rows[0].textContent).toContain('NEIPA');

    input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(panel.style.display).toBe('none');
    fire(input, 'click');
    expect(panel.style.display).toBe('');
  });

  test('typing narrows rows and tiles; clearing restores them', async function () {
    await setup(THREE);
    var input = document.getElementById('kiosk-recipe-search-input');
    var panel = document.getElementById('kiosk-recipe-search-list');
    input.value = 'ipa';
    fire(input, 'input');
    expect(panel.querySelectorAll('[role="option"]')).toHaveLength(2);
    var tiles = document.querySelectorAll('.kiosk-recipe-card');
    var hidden = Array.prototype.filter.call(tiles, function (t) { return t.style.display === 'none'; });
    expect(hidden).toHaveLength(1);
    expect(hidden[0].getAttribute('data-recipe-id')).toBe('R3');
    input.value = '';
    fire(input, 'input');
    expect(panel.querySelectorAll('[role="option"]')).toHaveLength(3);
    Array.prototype.forEach.call(tiles, function (t) { expect(t.style.display).toBe(''); });
  });

  test('no match shows a single non-selectable row', async function () {
    await setup(THREE);
    var input = document.getElementById('kiosk-recipe-search-input');
    input.value = 'zzzz';
    fire(input, 'input');
    var panel = document.getElementById('kiosk-recipe-search-list');
    expect(panel.querySelectorAll('[role="option"]')).toHaveLength(0);
    expect(panel.textContent).toBe('No recipes match. Clear the search to see all.');
  });

  test('choosing a row behaves like tapping the tile and closes the panel', async function () {
    var core = await setup(THREE);
    var input = document.getElementById('kiosk-recipe-search-input');
    fire(input, 'focus');
    var row = document.querySelector('#kiosk-recipe-search-list [data-recipe-id="R3"]');
    fire(row, 'mousedown');
    expect(core._getSelectedRecipe().recipe_id).toBe('R3');
    expect(document.getElementById('kiosk-recipe-grid').style.display).toBe('none');
    expect(document.getElementById('kiosk-recipe-prompt').style.display).toBe('');
  });

  test('tile tap selects the same recipe object', async function () {
    var core = await setup(THREE);
    fire(document.querySelector('.kiosk-recipe-card[data-recipe-id="R2"]'), 'click');
    expect(core._getSelectedRecipe().recipe_id).toBe('R2');
  });

  test('empty catalog keeps the empty block and no search header', async function () {
    await setup([]);
    var grid = document.getElementById('kiosk-recipe-grid');
    expect(grid.textContent).toContain('No active recipes');
    expect(document.getElementById('kiosk-recipe-search-input')).toBeNull();
  });

  test('40 recipes list 40 rows (no cap)', async function () {
    var list = [];
    for (var i = 0; i < 40; i++) list.push({ recipe_id: 'R' + i, name: 'Recipe ' + i, style: 'S', pricing_mode: 'fixed', locked_price: 5 });
    await setup(list);
    fire(document.getElementById('kiosk-recipe-search-input'), 'focus');
    expect(document.querySelectorAll('#kiosk-recipe-search-list [role="option"]')).toHaveLength(40);
  });

  test('recipe text is escaped in rows', async function () {
    await setup([{ recipe_id: 'X', name: '<img src=x onerror=1>', style: '<b>s</b>', pricing_mode: 'fixed', locked_price: 5 }]);
    fire(document.getElementById('kiosk-recipe-search-input'), 'focus');
    expect(document.querySelector('#kiosk-recipe-search-list img')).toBeNull();
    expect(document.querySelector('#kiosk-recipe-search-list b')).toBeNull();
  });
});
