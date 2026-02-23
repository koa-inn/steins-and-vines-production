// ===== Toast Notifications =====
function showToast(message, type) {
  var container = document.querySelector('.toast-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  var toast = document.createElement('div');
  toast.className = 'toast' + (type ? ' toast--' + type : '');
  toast.textContent = message;
  container.appendChild(toast);
  // Trigger reflow then animate in
  toast.offsetHeight;
  toast.classList.add('show');
  setTimeout(function () {
    toast.classList.remove('show');
    setTimeout(function () { toast.remove(); }, 300);
  }, 3500);
}

// Escape HTML entities for safe interpolation
function escapeHTML(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ===== Responsive Product Image Helper =====

function setResponsiveImg(img, sku) {
  img.src = 'images/products/' + sku + '.png';
  img.width = 400;
  img.height = 400;
  img.srcset = 'images/products/' + sku + '-400w.webp 400w, images/products/' + sku + '-800w.webp 800w';
  img.sizes = '(max-width: 768px) 45vw, 200px';
}

// Shared CSV fetch helper — used by all tab loaders
function fetchCSV(url) {
  return fetch(url).then(function (res) {
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.text();
  });
}

// Skeleton loading helper — creates placeholder cards that mimic real layout
function createSkeletonCard() {
  var card = document.createElement('div');
  card.className = 'skeleton-card';
  card.innerHTML =
    '<div class="skeleton-element skeleton-brand"></div>' +
    '<div class="skeleton-element skeleton-title"></div>' +
    '<div class="skeleton-element skeleton-detail"></div>' +
    '<div class="skeleton-badges">' +
      '<div class="skeleton-element skeleton-badge"></div>' +
      '<div class="skeleton-element skeleton-badge"></div>' +
    '</div>' +
    '<div class="skeleton-prices">' +
      '<div class="skeleton-element skeleton-price-box"></div>' +
      '<div class="skeleton-element skeleton-price-box"></div>' +
    '</div>' +
    '<div class="skeleton-element skeleton-notes"></div>';
  return card;
}

function showCatalogSkeletons(container, count) {
  if (!container) return;
  var grid = document.createElement('div');
  grid.className = 'catalog-skeleton-grid';
  for (var i = 0; i < count; i++) {
    grid.appendChild(createSkeletonCard());
  }
  container.appendChild(grid);
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
