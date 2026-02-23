var _allServices = [];
var _servicesSortVal = 'name-asc';

function loadServices(callback) {
  var middlewareUrl = (typeof SHEETS_CONFIG !== 'undefined' && SHEETS_CONFIG.MIDDLEWARE_URL)
    ? SHEETS_CONFIG.MIDDLEWARE_URL : '';

  function loadFromCSV() {
    var csvUrl = (typeof SHEETS_CONFIG !== 'undefined' && SHEETS_CONFIG.PUBLISHED_SERVICES_CSV_URL)
      ? SHEETS_CONFIG.PUBLISHED_SERVICES_CSV_URL : null;

    var CACHE_KEY = 'sv-services-csv';
    var CACHE_TS_KEY = 'sv-services-csv-ts';
    var CACHE_TTL = 60 * 60 * 1000;

    function getCached() {
      try {
        var csv = localStorage.getItem(CACHE_KEY);
        var ts = parseInt(localStorage.getItem(CACHE_TS_KEY), 10) || 0;
        if (csv) return { csv: csv, fresh: (Date.now() - ts) < CACHE_TTL };
      } catch (e) {}
      return null;
    }

    function setCached(csv) {
      try {
        localStorage.setItem(CACHE_KEY, csv);
        localStorage.setItem(CACHE_TS_KEY, String(Date.now()));
      } catch (e) {}
    }

    var cached = getCached();
    var csvPromise;

    if (cached) {
      csvPromise = Promise.resolve(cached.csv);
      if (!cached.fresh) {
        var refreshUrl = csvUrl || 'content/services.csv';
        fetchCSV(refreshUrl).then(setCached).catch(function () {});
      }
    } else {
      csvPromise = csvUrl
        ? fetchCSV(csvUrl).catch(function () { return fetchCSV('content/services.csv'); })
        : fetchCSV('content/services.csv');
      csvPromise.then(setCached);
    }

    return csvPromise.then(function (csv) {
      var lines = csv.trim().split('\n');
      var headers = lines[0].split(',');
      var items = [];

      for (var i = 1; i < lines.length; i++) {
        var values = parseCSVLine(lines[i]);
        if (values.length < headers.length) continue;
        var obj = {};
        for (var j = 0; j < headers.length; j++) {
          obj[headers[j].trim()] = values[j].trim();
        }
        if (!obj.name && !obj.sku) continue;
        if (obj.hide && obj.hide.toLowerCase() === 'true') continue;
        items.push(obj);
      }
      return items;
    });
  }

  var MW_CACHE_KEY = 'sv-services-mw';
  var MW_CACHE_TS_KEY = 'sv-services-mw-ts';
  var MW_CACHE_TTL = 10 * 60 * 1000;

  function getCachedMW() {
    try {
      var data = localStorage.getItem(MW_CACHE_KEY);
      var ts = parseInt(localStorage.getItem(MW_CACHE_TS_KEY), 10) || 0;
      if (data) return { data: JSON.parse(data), fresh: (Date.now() - ts) < MW_CACHE_TTL };
    } catch (e) {}
    return null;
  }

  function setCachedMW(items) {
    try {
      localStorage.setItem(MW_CACHE_KEY, JSON.stringify(items));
      localStorage.setItem(MW_CACHE_TS_KEY, String(Date.now()));
    } catch (e) {}
  }

  function fetchFromMiddleware() {
    return fetch(middlewareUrl + '/api/services')
      .then(function (r) {
        if (!r.ok) throw new Error('Middleware returned ' + r.status);
        return r.json();
      })
      .then(function (data) {
        var items = data.items || [];
        return items.map(function (z) {
          return {
            name: z.name || '',
            price: z.rate != null ? String(z.rate) : '',
            description: z.description || '',
            sku: z.sku || '',
            stock: z.stock_on_hand != null ? String(z.stock_on_hand) : '0',
            discount: z.discount != null ? String(z.discount) : '0'
          };
        });
      });
  }

  function loadFromMiddleware() {
    var cached = getCachedMW();

    if (cached) {
      var promise = Promise.resolve(cached.data);
      if (!cached.fresh) {
        fetchFromMiddleware().then(setCachedMW).catch(function () {});
      }
      return promise;
    }

    return fetchFromMiddleware().then(function (items) {
      setCachedMW(items);
      return items;
    });
  }

  var dataPromise = middlewareUrl
    ? loadFromMiddleware().catch(function () { return loadFromCSV(); })
    : loadFromCSV();

  dataPromise
    .then(function (items) {
      _allServices = items.filter(function (r) {
        var p = parseFloat(r.price_per_unit || r.rate || r.price || '0') || 0;
        return p > 0;
      });
      renderServices();
      wireServiceEvents();
      if (callback) callback();
    })
    .catch(function () {});
}

function wireServiceEvents() {
  var searchInput = document.getElementById('service-search');
  if (searchInput) {
    var timer;
    searchInput.addEventListener('input', function () {
      clearTimeout(timer);
      timer = setTimeout(renderServices, 180);
    });
  }
}

function renderServices() {
  var catalog = document.getElementById('product-catalog');
  if (!catalog) return;

  var sections = catalog.querySelectorAll('.catalog-section, .catalog-no-results, .catalog-divider, .catalog-skeleton-grid');
  sections.forEach(function (el) { el.parentNode.removeChild(el); });

  var searchInput = document.getElementById('service-search');
  var query = searchInput ? searchInput.value.toLowerCase() : '';

  var filtered = _allServices.filter(function (r) {
    if (!query) return true;
    var name = (r.name || '').toLowerCase();
    var desc = (r.desription || r.description || '').toLowerCase();
    return name.indexOf(query) !== -1 || desc.indexOf(query) !== -1;
  });

  filtered.sort(function (a, b) {
    switch (_servicesSortVal) {
      case 'name-asc': return (a.name || '').localeCompare(b.name || '');
      case 'name-desc': return (b.name || '').localeCompare(a.name || '');
      case 'price-asc': return (parseFloat((a.price || '').replace(/[^0-9.]/g, '')) || 0) - (parseFloat((b.price || '').replace(/[^0-9.]/g, '')) || 0);
      case 'price-desc': return (parseFloat((b.price || '').replace(/[^0-9.]/g, '')) || 0) - (parseFloat((a.price || '').replace(/[^0-9.]/g, '')) || 0);
      default: return 0;
    }
  });

  if (filtered.length === 0) {
    var msg = document.createElement('p');
    msg.className = 'catalog-no-results';
    msg.textContent = 'No services found.';
    catalog.appendChild(msg);
    return;
  }

  var wrapper = document.createElement('div');
  wrapper.className = 'catalog-section';

  var sectionHeader = document.createElement('div');
  sectionHeader.className = 'catalog-section-header';
  var heading = document.createElement('h2');
  heading.className = 'catalog-section-title';
  heading.textContent = 'Our Services';
  sectionHeader.appendChild(heading);
  wrapper.appendChild(sectionHeader);

  if (catalogViewMode === 'table') {
    var table = document.createElement('table');
    table.className = 'catalog-table';
    var thead = document.createElement('thead');
    var svcCols = [
      { label: 'Name', sort: 'name' },
      { label: 'Description', sort: null },
      { label: 'Price', sort: 'price' }
    ];
    var svcTheadTr = document.createElement('tr');
    svcCols.forEach(function (col) {
      var th = document.createElement('th');
      th.textContent = col.label;
      if (col.label === 'Price') th.style.textAlign = 'right';
      if (col.sort) {
        th.setAttribute('data-sort', col.sort);
        var arrow = document.createElement('span');
        arrow.className = 'sort-arrow';
        var sortBase = _servicesSortVal.replace(/-asc$|-desc$/, '');
        if (sortBase === col.sort) {
          th.classList.add('sort-active');
          arrow.textContent = _servicesSortVal.indexOf('-desc') !== -1 ? '\u25BC' : '\u25B2';
        } else {
          arrow.textContent = '\u25B2';
        }
        th.appendChild(arrow);
        th.addEventListener('click', (function (sortKey) {
          return function () {
            var base = _servicesSortVal.replace(/-asc$|-desc$/, '');
            if (base === sortKey) {
              _servicesSortVal = sortKey + (_servicesSortVal.indexOf('-asc') !== -1 ? '-desc' : '-asc');
            } else {
              _servicesSortVal = sortKey + '-asc';
            }
            renderServices();
          };
        })(col.sort));
      }
      svcTheadTr.appendChild(th);
    });
    thead.appendChild(svcTheadTr);
    table.appendChild(thead);

    var tbody = document.createElement('tbody');
    filtered.forEach(function (svc) {
      var tr = document.createElement('tr');

      var tdName = document.createElement('td');
      tdName.setAttribute('data-label', 'Name');
      tdName.className = 'table-name';
      tdName.textContent = svc.name || '';
      var discount = parseFloat(svc.discount) || 0;
      if (discount > 0) {
        var badge = document.createElement('span');
        badge.className = 'discount-badge-sm';
        badge.textContent = Math.round(discount) + '% OFF';
        tdName.appendChild(badge);
      }
      tr.appendChild(tdName);

      var tdDesc = document.createElement('td');
      tdDesc.setAttribute('data-label', 'Description');
      tdDesc.textContent = (svc.desription || svc.description || '').trim();
      tr.appendChild(tdDesc);

      var tdPrice = document.createElement('td');
      tdPrice.setAttribute('data-label', 'Price');
      var price = (svc.price || '').trim();
      if (price) {
        tdPrice.className = 'table-prices';
        if (discount > 0) {
          var priceNum = parseFloat(price.replace(/[^0-9.]/g, ''));
          var salePrice = formatCurrency(priceNum * (1 - discount / 100));
          tdPrice.innerHTML = '<span class="table-price-original">' + formatCurrency(price) + '</span><span class="table-price-sale">' + salePrice + '</span>';
        } else {
          tdPrice.textContent = formatCurrency(price);
        }
      }
      tr.appendChild(tdPrice);

      var svcDescText = (svc.desription || svc.description || '').trim();
      var svcHasDetail = svcDescText || svc.sku;
      if (svcHasDetail) {
        // Add chevron
        var svcChevron = document.createElement('span');
        svcChevron.className = 'table-expand-chevron';
        svcChevron.innerHTML = '&#9660;';
        tdName.insertBefore(svcChevron, tdName.firstChild);

        var svcDetailTr = document.createElement('tr');
        svcDetailTr.className = 'table-detail-row';
        var svcDetailTd = document.createElement('td');
        svcDetailTd.setAttribute('colspan', '3');
        svcDetailTd.className = 'table-detail-cell';
        var svcDetailContent = document.createElement('div');
        svcDetailContent.className = 'table-detail-content';

        if (svc.sku) {
          var svcImgWrap = document.createElement('div');
          svcImgWrap.className = 'table-detail-image';
          var svcImg = document.createElement('img');
          setResponsiveImg(svcImg, svc.sku);
          svcImg.alt = svc.name || 'Product image';
          svcImg.loading = 'lazy';
          svcImg.onerror = function() { this.parentElement.remove(); };
          svcImgWrap.appendChild(svcImg);
          svcDetailContent.appendChild(svcImgWrap);
        }

        if (svcDescText) {
          var svcTextDiv = document.createElement('div');
          svcTextDiv.className = 'table-detail-text';
          var svcDescP = document.createElement('p');
          svcDescP.textContent = svcDescText;
          svcTextDiv.appendChild(svcDescP);
          svcDetailContent.appendChild(svcTextDiv);
        }

        svcDetailTd.appendChild(svcDetailContent);
        svcDetailTr.appendChild(svcDetailTd);

        tbody.appendChild(tr);
        tbody.appendChild(svcDetailTr);

        (function(mainRow, detail, chev) {
          var skipClick = false;
          mainRow.addEventListener('mousedown', function(e) {
            if (e.target.closest('.product-reserve-wrap')) skipClick = true;
          });
          mainRow.style.cursor = 'pointer';
          mainRow.addEventListener('click', function(e) {
            if (skipClick) { skipClick = false; return; }
            if (e.target.closest('.product-reserve-wrap')) return;
            var isOpen = detail.classList.toggle('open');
            chev.classList.toggle('open', isOpen);
            mainRow.classList.toggle('expanded', isOpen);
          });
        })(tr, svcDetailTr, svcChevron);
      } else {
        tbody.appendChild(tr);
      }
    });
    table.appendChild(tbody);
    wrapper.appendChild(table);
  } else {
    var grid = document.createElement('div');
    grid.className = 'product-grid';

    filtered.forEach(function (svc) {
      var card = document.createElement('div');
      card.className = 'product-card';

      var header = document.createElement('div');
      header.className = 'product-card-header';
      var cardName = document.createElement('h4');
      cardName.textContent = svc.name;
      header.appendChild(cardName);
      card.appendChild(header);

      // Description (handles the typo column name)
      var descText = (svc.desription || svc.description || '').trim();
      if (descText) {
        var descEl = document.createElement('p');
        descEl.className = 'service-description';
        descEl.textContent = descText;
        card.appendChild(descEl);
      }

      // Price with optional discount
      var price = (svc.price || '').trim();
      var discount = parseFloat(svc.discount) || 0;

      if (discount > 0) {
        var badge = document.createElement('span');
        badge.className = 'product-discount-badge';
        badge.textContent = Math.round(discount) + '% OFF';
        card.appendChild(badge);
      }

      if (price) {
        var priceRow = document.createElement('div');
        priceRow.className = 'product-prices service-price';
        var priceBox = document.createElement('div');
        priceBox.className = 'product-price-box';

        if (discount > 0) {
          var priceNum = parseFloat(price.replace(/[^0-9.]/g, ''));
          var salePrice = formatCurrency(priceNum * (1 - discount / 100));
          priceBox.innerHTML = '<span class="product-price-label">Price</span><span class="product-price-original">' + formatCurrency(price) + '</span><span class="product-price-value">' + salePrice + '</span>';
        } else {
          priceBox.innerHTML = '<span class="product-price-label">Price</span><span class="product-price-value">' + formatCurrency(price) + '</span>';
        }

        priceRow.appendChild(priceBox);
        card.appendChild(priceRow);
      }

      grid.appendChild(card);
    });

    wrapper.appendChild(grid);
  }

  catalog.appendChild(wrapper);
  equalizeCardHeights();
}

function parseCSVLine(line) {
  var result = [];
  var current = '';
  var inQuotes = false;
  for (var i = 0; i < line.length; i++) {
    var ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        result.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
  }
  result.push(current);
  return result;
}

// ===== Reservation System =====
