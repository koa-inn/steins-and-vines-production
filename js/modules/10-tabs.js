function initProductTabs() {
  var tabs = document.getElementById('product-tabs');
  if (!tabs) return;

  var ingredientsLoaded = false;
  var servicesLoaded = false;

  tabs.addEventListener('click', function (e) {
    var btn = e.target.closest('.product-tab-btn');
    if (!btn) return;

    var tab = btn.getAttribute('data-product-tab');
    _activeCartTab = tab;

    // Swap active button
    var allBtns = tabs.querySelectorAll('.product-tab-btn');
    allBtns.forEach(function (b) { b.classList.remove('active'); });
    btn.classList.add('active');

    // Show/hide controls
    var controlIds = ['catalog-controls-kits', 'catalog-controls-ingredients', 'catalog-controls-services'];
    controlIds.forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.classList.add('hidden');
    });
    var activeControls = document.getElementById('catalog-controls-' + tab);
    if (activeControls) activeControls.classList.remove('hidden');

    // Sync view mode to the new tab's preference
    catalogViewMode = getCatalogViewMode(tab);
    syncToggleButtons(catalogViewMode);

    // Show/hide kits notes
    var batchNote = document.getElementById('kits-batch-note');
    if (batchNote) batchNote.classList.toggle('hidden', tab !== 'kits');
    var processNote = document.getElementById('kits-process-note');
    if (processNote) processNote.classList.toggle('hidden', tab !== 'kits');
    var priceNote = document.getElementById('kits-price-note');
    if (priceNote) priceNote.classList.toggle('hidden', tab !== 'kits');
    var guaranteeNote = document.getElementById('kits-guarantee-note');
    if (guaranteeNote) guaranteeNote.classList.toggle('hidden', tab !== 'kits');

    // Always show reservation bar if there are items
    updateReservationBar();

    // Clear rendered catalog sections
    var catalog = document.getElementById('product-catalog');
    if (catalog) {
      var sections = catalog.querySelectorAll('.catalog-section, .catalog-no-results, .catalog-divider, .catalog-skeleton-grid');
      sections.forEach(function (el) { el.parentNode.removeChild(el); });
    }

    // Load the appropriate tab
    if (tab === 'kits') {
      if (applyKitsFilters) applyKitsFilters();
    } else if (tab === 'ingredients') {
      if (!ingredientsLoaded) {
        ingredientsLoaded = true;
        loadIngredients(function () {
          // After first load, subsequent clicks just re-render
        });
      } else {
        renderIngredients();
      }
    } else if (tab === 'services') {
      if (!servicesLoaded) {
        servicesLoaded = true;
        loadServices(function () {});
      } else {
        renderServices();
      }
    }
  });

  // Wire up ingredients filter/sort toggle
  var ingredientToggle = document.getElementById('ingredient-toggle');
  var ingredientCollapsible = document.getElementById('ingredient-collapsible');
  if (ingredientToggle && ingredientCollapsible) {
    ingredientToggle.addEventListener('click', function () {
      var expanded = ingredientToggle.getAttribute('aria-expanded') === 'true';
      ingredientToggle.setAttribute('aria-expanded', String(!expanded));
      ingredientCollapsible.classList.toggle('open');
    });
  }
}

// ===== Ingredients & Supplies =====
