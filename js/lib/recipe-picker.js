// ===== Steins & Vines — Recipe Picker helper =====
// Shared pure helper (D-20) used by the kiosk, admin and BrewPad recipe pickers.
// No DOM access. Exposes window.RecipePicker in the browser and module.exports in Jest.

function _rpName(r) {
  return String((r && r.name) || '');
}

function _rpStyle(r) {
  return String((r && r.style) || '');
}

function _rpCompare(a, b) {
  var an = _rpName(a).toLowerCase();
  var bn = _rpName(b).toLowerCase();
  if (an < bn) return -1;
  if (an > bn) return 1;
  var ai = String((a && a.recipe_id) || '');
  var bi = String((b && b.recipe_id) || '');
  if (ai < bi) return -1;
  if (ai > bi) return 1;
  return 0;
}

// Returns a new array sorted case-insensitively by name (ties by recipe_id).
function sortRecipesByName(list) {
  if (!Array.isArray(list)) return [];
  return list.slice().sort(_rpCompare);
}

// Filters on name OR style (case-insensitive substring). No item cap.
function filterRecipes(list, term) {
  var sorted = sortRecipesByName(list);
  var t = String((term === null || term === undefined) ? '' : term).trim().toLowerCase();
  if (!t) return sorted;
  return sorted.filter(function (r) {
    return _rpName(r).toLowerCase().indexOf(t) !== -1 ||
      _rpStyle(r).toLowerCase().indexOf(t) !== -1;
  });
}

// exact = trimmed case-insensitive equality; similar = contains either way, excluding exact.
function findRecipeNameMatches(list, name) {
  var t = String((name === null || name === undefined) ? '' : name).trim().toLowerCase();
  if (t.length < 2) return { exact: [], similar: [] };
  var exact = [];
  var similar = [];
  sortRecipesByName(list).forEach(function (r) {
    var n = _rpName(r).trim().toLowerCase();
    if (!n) return;
    if (n === t) {
      exact.push(r);
    } else if (n.indexOf(t) !== -1 || t.indexOf(n) !== -1) {
      similar.push(r);
    }
  });
  return { exact: exact, similar: similar };
}

if (typeof window !== 'undefined') {
  window.RecipePicker = {
    sortRecipesByName: sortRecipesByName,
    filterRecipes: filterRecipes,
    findRecipeNameMatches: findRecipeNameMatches
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    sortRecipesByName: sortRecipesByName,
    filterRecipes: filterRecipes,
    findRecipeNameMatches: findRecipeNameMatches
  };
}
