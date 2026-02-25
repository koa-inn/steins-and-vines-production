function initReservationPage() {
  // Determine which cart to check out based on URL param
  var cartParam = new URLSearchParams(window.location.search).get('cart');
  if (cartParam === 'ingredient') {
    _activeCartTab = 'ingredients';
  } else {
    _activeCartTab = 'kits';
  }

  initCheckoutStepper();
  renderReservationItems();

  var items = getReservation();
  var hasKits = items.some(function (item) { return (item.item_type || 'kit') === 'kit'; });

  if (hasKits) {
    loadTimeslots();
  } else {
    // Hide timeslot picker for ingredients/services-only carts
    var picker = document.getElementById('timeslot-picker');
    if (picker) picker.classList.add('hidden');
    // Hide the "Pick a Time" step in stepper
    var step2 = document.querySelector('.stepper-step[data-step="2"]');
    if (step2) step2.classList.add('hidden');
  }

  // Hide batch notes when no kits
  if (!hasKits) {
    var batchNotes = document.querySelectorAll('.catalog-batch-note');
    batchNotes.forEach(function (n) { n.classList.add('hidden'); });
  }

  // Adapt page for product orders (non-kit items)
  if (!hasKits && items.length > 0) {
    var pageTitle = document.querySelector('[data-content="page-title"]');
    if (pageTitle) pageTitle.textContent = 'Complete Your Order';
    document.title = 'Order | Steins & Vines';
    var reservedTitle = document.querySelector('[data-content="reserved-items-title"]');
    if (reservedTitle) reservedTitle.textContent = 'Your items';
    var submitBtn = document.querySelector('[data-content="submit-btn"]');
    if (submitBtn) submitBtn.textContent = 'Place Order';
    var formNote = document.querySelector('[data-content="form-note"]');
    if (formNote) formNote.textContent = 'A confirmation email will be sent to the address provided above. All orders are in-store pickup only.';
    var confirmTitle = document.querySelector('[data-content="confirm-title"]');
    if (confirmTitle) confirmTitle.textContent = 'Order confirmed';
    var confirmText = document.querySelector('[data-content="confirm-text"]');
    if (confirmText) confirmText.textContent = 'Thank you for your order! We will prepare your items for in-store pickup. You will receive a confirmation email shortly.';
    var confirmNextEl = document.querySelector('.confirm-next');
    if (confirmNextEl) {
      confirmNextEl.innerHTML = '<h3>What\'s Next</h3><ol>'
        + '<li>We\'ll send a confirmation email with your order details</li>'
        + '<li>We\'ll notify you when your order is ready for pickup</li>'
        + '<li>Visit us in-store to collect your items</li>'
        + '</ol>';
    }
    var emptyText = document.querySelector('[data-content="reserved-empty-text"]');
    if (emptyText) emptyText.textContent = 'Your cart is empty.';
  }

  setupReservationForm();
}

// ===== Checkout Stepper =====

function initCheckoutStepper() {
  var stepper = document.getElementById('checkout-stepper');
  if (!stepper) return;

  var steps = stepper.querySelectorAll('.stepper-step');

  // Map step numbers to section IDs
  var stepSections = {
    1: 'reservation-list',
    2: 'timeslot-picker',
    3: 'reservation-form-section',
    4: 'reservation-confirm'
  };

  // Click completed steps to scroll back
  steps.forEach(function (step) {
    step.addEventListener('click', function () {
      if (!step.classList.contains('stepper-step--done')) return;
      var stepNum = parseInt(step.getAttribute('data-step'), 10);
      var sectionId = stepSections[stepNum];
      var section = document.getElementById(sectionId);
      if (section) {
        section.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });

  // Observe sections to update stepper as user scrolls
  if ('IntersectionObserver' in window) {
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var stepNum = parseInt(entry.target.getAttribute('data-checkout-step'), 10);
        if (stepNum) updateStepper(stepNum);
      });
    }, { threshold: 0.3, rootMargin: '-80px 0px 0px 0px' });

    var sections = document.querySelectorAll('[data-checkout-step]');
    sections.forEach(function (s) { observer.observe(s); });
  }
}

function updateStepper(activeStep) {
  var steps = document.querySelectorAll('.stepper-step');
  steps.forEach(function (step) {
    var num = parseInt(step.getAttribute('data-step'), 10);
    step.classList.remove('stepper-step--active', 'stepper-step--done');
    if (num < activeStep) {
      step.classList.add('stepper-step--done');
    } else if (num === activeStep) {
      step.classList.add('stepper-step--active');
    }
  });
}

function refreshReservationDependents() {
  var items = getReservation();
  var hasKits = items.some(function (item) { return (item.item_type || 'kit') === 'kit'; });

  if (hasKits) {
    loadTimeslots();
    var selected = document.querySelector('input[name="timeslot"]:checked');
    if (selected) {
      updateCompletionEstimate(selected.value);
    } else {
      var estimateEl = document.getElementById('completion-estimate');
      if (estimateEl) estimateEl.classList.add('hidden');
    }
  } else {
    var picker = document.getElementById('timeslot-picker');
    if (picker) picker.classList.add('hidden');
  }
}

function renderReservationItems() {
  var container = document.getElementById('reservation-items');
  var emptyMsg = document.getElementById('reservation-empty');
  if (!container) return;

  var items = getReservation();
  container.innerHTML = '';

  if (items.length === 0) {
    if (emptyMsg) emptyMsg.classList.remove('hidden');
    var picker = document.getElementById('timeslot-picker');
    var formSection = document.getElementById('reservation-form-section');
    if (picker) picker.classList.add('hidden');
    if (formSection) formSection.classList.add('hidden');
    return;
  }
  if (emptyMsg) emptyMsg.classList.add('hidden');
  var picker = document.getElementById('timeslot-picker');
  var formSection = document.getElementById('reservation-form-section');
  if (picker) picker.classList.remove('hidden');
  if (formSection) formSection.classList.remove('hidden');

  var table = document.createElement('table');
  table.className = 'catalog-table reservation-table';

  var thead = document.createElement('thead');
  var resCols = ['Name', 'Type', 'Brand', 'Time', 'Price', 'Status', 'Qty', ''];
  // Hide columns with no data
  var hasTime = items.some(function (it) { return (it.time || '').trim() !== ''; });
  var hasBrand = items.some(function (it) { return (it.brand || '').trim() !== ''; });
  var theadTr = document.createElement('tr');
  resCols.forEach(function (label) {
    if (label === 'Time' && !hasTime) return;
    if (label === 'Brand' && !hasBrand) return;
    var th = document.createElement('th');
    th.textContent = label;
    if (label === 'Price') th.style.textAlign = 'right';
    theadTr.appendChild(th);
  });
  thead.appendChild(theadTr);
  table.appendChild(thead);

  var tbody = document.createElement('tbody');
  items.forEach(function (item) {
    var tr = document.createElement('tr');

    // Name + discount badge
    var tdName = document.createElement('td');
    tdName.setAttribute('data-label', 'Name');
    var nameSpan = document.createElement('span');
    nameSpan.className = 'table-name';
    nameSpan.textContent = item.name;
    tdName.appendChild(nameSpan);
    if (item.discount && parseFloat(item.discount) > 0) {
      var badge = document.createElement('span');
      badge.className = 'discount-badge-sm';
      badge.textContent = Math.round(parseFloat(item.discount)) + '% OFF';
      tdName.appendChild(badge);
    }
    tr.appendChild(tdName);

    // Type
    var tdType = document.createElement('td');
    tdType.setAttribute('data-label', 'Type');
    var typeLabel = (item.item_type || 'kit').charAt(0).toUpperCase() + (item.item_type || 'kit').slice(1);
    tdType.textContent = typeLabel;
    tr.appendChild(tdType);

    // Brand
    if (hasBrand) {
      var tdBrand = document.createElement('td');
      tdBrand.setAttribute('data-label', 'Brand');
      tdBrand.textContent = item.brand || '';
      tr.appendChild(tdBrand);
    }

    // Time
    if (hasTime) {
      var tdTime = document.createElement('td');
      tdTime.setAttribute('data-label', 'Time');
      tdTime.textContent = item.time || '';
      tr.appendChild(tdTime);
    }

    // Price
    var tdPrice = document.createElement('td');
    tdPrice.setAttribute('data-label', 'Price');
    if (item.price) {
      if (item.discount && parseFloat(item.discount) > 0) {
        var origNum = parseFloat((item.price || '0').replace('$', '')) || 0;
        var disc = parseFloat(item.discount);
        tdPrice.className = 'table-prices';
        tdPrice.innerHTML = '<span class="table-price-original">' + formatCurrency(item.price) + '</span><span class="table-price-sale">' + formatCurrency(origNum * (1 - disc / 100)) + '</span>';
      } else {
        tdPrice.textContent = formatCurrency(item.price);
      }
    }
    tr.appendChild(tdPrice);

    // Stock status
    var tdStock = document.createElement('td');
    tdStock.setAttribute('data-label', 'Status');
    var stockNum = parseInt(item.stock, 10) || 0;
    var stockBadge = document.createElement('span');
    stockBadge.className = 'reservation-item-stock';
    if (stockNum > 0) {
      stockBadge.classList.add('reservation-item-stock--available');
      stockBadge.textContent = 'In Stock';
    } else {
      stockBadge.classList.add('reservation-item-stock--order');
      stockBadge.textContent = 'Needs Ordering';
    }
    tdStock.appendChild(stockBadge);
    tr.appendChild(tdStock);

    // Qty controls
    var tdQty = document.createElement('td');
    tdQty.setAttribute('data-label', 'Qty');
    var itemMax = getEffectiveMax(item);
    var qtyControls = document.createElement('div');
    qtyControls.className = 'product-qty-controls';

    var minusBtn = document.createElement('button');
    minusBtn.type = 'button';
    minusBtn.className = 'qty-btn';
    minusBtn.textContent = '\u2212';
    minusBtn.addEventListener('click', (function (itm) {
      return function () {
        var current = getReservation();
        for (var i = 0; i < current.length; i++) {
          if ((current[i].name + '|' + current[i].brand) === (itm.name + '|' + itm.brand)) {
            current[i].qty = (current[i].qty || 1) - 1;
            if (current[i].qty <= 0) current.splice(i, 1);
            break;
          }
        }
        saveReservation(current);
        renderReservationItems();
        refreshReservationDependents();
        updateReservationBar();
      };
    })(item));

    var qtySpan = document.createElement('span');
    qtySpan.className = 'qty-value';
    qtySpan.textContent = item.qty || 1;

    var plusBtn = document.createElement('button');
    plusBtn.type = 'button';
    plusBtn.textContent = '+';
    if ((item.qty || 1) >= itemMax) {
      plusBtn.className = 'qty-btn qty-btn--disabled';
      plusBtn.disabled = true;
    } else {
      plusBtn.className = 'qty-btn';
      plusBtn.addEventListener('click', (function (itm, max) {
        return function () {
          var current = getReservation();
          for (var i = 0; i < current.length; i++) {
            if ((current[i].name + '|' + current[i].brand) === (itm.name + '|' + itm.brand)) {
              var newQty = (current[i].qty || 1) + 1;
              if (newQty > max) newQty = max;
              current[i].qty = newQty;
              break;
            }
          }
          saveReservation(current);
          renderReservationItems();
          refreshReservationDependents();
          updateReservationBar();
        };
      })(item, itemMax));
    }

    qtyControls.appendChild(minusBtn);
    qtyControls.appendChild(qtySpan);
    qtyControls.appendChild(plusBtn);
    tdQty.appendChild(qtyControls);
    tr.appendChild(tdQty);

    // Remove button
    var tdRemove = document.createElement('td');
    tdRemove.setAttribute('data-label', '');
    var removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'reservation-item-remove';
    removeBtn.textContent = 'Remove';
    removeBtn.addEventListener('click', function () {
      var current = getReservation();
      var filtered = current.filter(function (r) {
        return (r.name + '|' + r.brand) !== (item.name + '|' + item.brand);
      });
      saveReservation(filtered);
      renderReservationItems();
      refreshReservationDependents();
      updateReservationBar();
    });
    tdRemove.appendChild(removeBtn);
    tr.appendChild(tdRemove);

    tbody.appendChild(tr);
  });
  table.appendChild(tbody);

  // Wrap table for mobile horizontal scroll
  var tableWrap = document.createElement('div');
  tableWrap.className = 'reservation-table-wrap';
  tableWrap.appendChild(table);
  tableWrap.addEventListener('scroll', function () {
    var atEnd = tableWrap.scrollLeft + tableWrap.clientWidth >= tableWrap.scrollWidth - 2;
    tableWrap.classList.toggle('scrolled-end', atEnd);
  });
  container.appendChild(tableWrap);

  // Subtotal (accounts for discount if stored)
  var subtotal = 0;
  items.forEach(function (item) {
    var price = parseFloat((item.price || '0').replace('$', '')) || 0;
    var disc = parseFloat(item.discount) || 0;
    if (disc > 0) price = price * (1 - disc / 100);
    subtotal += price * (item.qty || 1);
  });

  var isProductOrder = !items.some(function (item) { return (item.item_type || 'kit') === 'kit'; });

  if (isProductOrder) {
    var taxTotal = 0;
    items.forEach(function (item) {
      var price = parseFloat((item.price || '0').replace('$', '')) || 0;
      var disc = parseFloat(item.discount) || 0;
      if (disc > 0) price = price * (1 - disc / 100);
      var taxPct = parseFloat(item.tax_percentage) || 0;
      taxTotal += price * (item.qty || 1) * (taxPct / 100);
    });
    var grandTotal = subtotal + taxTotal;

    var summaryWrap = document.createElement('div');
    summaryWrap.className = 'order-summary-totals';

    var subtotalDiv = document.createElement('div');
    subtotalDiv.className = 'reservation-subtotal';
    subtotalDiv.innerHTML = '<span>Subtotal</span><span>' + formatCurrency(subtotal) + '</span>';
    summaryWrap.appendChild(subtotalDiv);

    if (taxTotal > 0) {
      var taxDiv = document.createElement('div');
      taxDiv.className = 'reservation-subtotal reservation-subtotal--detail';
      taxDiv.innerHTML = '<span>Tax</span><span>' + formatCurrency(taxTotal) + '</span>';
      summaryWrap.appendChild(taxDiv);
    }

    var totalDiv = document.createElement('div');
    totalDiv.className = 'reservation-subtotal reservation-subtotal--total';
    totalDiv.innerHTML = '<span>Total</span><span>' + formatCurrency(grandTotal) + '</span>';
    summaryWrap.appendChild(totalDiv);

    var pickupNote = document.createElement('div');
    pickupNote.className = 'reservation-pickup-note';
    pickupNote.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5S10.62 6.5 12 6.5s2.5 1.12 2.5 2.5S13.38 11.5 12 11.5z"/></svg> In-store pickup only';
    summaryWrap.appendChild(pickupNote);

    container.appendChild(summaryWrap);
  } else {
    var subtotalRow = document.createElement('div');
    subtotalRow.className = 'reservation-subtotal';
    subtotalRow.innerHTML = '<span>Estimated Subtotal <span class="reservation-disclaimer">\u2014 Final pricing may vary.</span></span><span>' + formatCurrency(subtotal) + '</span>';
    container.appendChild(subtotalRow);
  }

  // Milling upsell
  var hasGrain = items.some(function (item) {
    return item.item_type === 'ingredient' && isWeightUnit(item.unit);
  });
  var hasMilling = items.some(function (item) {
    return item.name && item.name.toLowerCase().indexOf('mill') !== -1;
  });
  if (hasGrain && !hasMilling) {
    var upsell = document.createElement('div');
    upsell.className = 'milling-upsell';
    upsell.innerHTML = '<strong>Need your grain milled?</strong> We offer milling services in-store. <a href="products.html#services">Add milling to your order \u2192</a>';
    container.appendChild(upsell);
  }

  // Clear All button
  var clearWrap = document.createElement('div');
  clearWrap.className = 'reservation-clear-wrap';
  var clearBtn = document.createElement('button');
  clearBtn.type = 'button';
  clearBtn.className = 'btn-secondary reservation-clear-btn';
  clearBtn.textContent = isProductOrder ? 'Clear Cart' : 'Clear Selected Items';
  clearBtn.addEventListener('click', function () {
    saveReservation([]);
    renderReservationItems();
    refreshReservationDependents();
    updateReservationBar();
  });
  clearWrap.appendChild(clearBtn);
  container.appendChild(clearWrap);

  // Notify listeners (e.g. deposit summary) that reservation items changed
  window.dispatchEvent(new Event('reservation-changed'));
}

function loadTimeslots() {
  var container = document.getElementById('timeslot-groups');
  if (!container) return;

  var middlewareUrl = (typeof SHEETS_CONFIG !== 'undefined' && SHEETS_CONFIG.MIDDLEWARE_URL)
    ? SHEETS_CONFIG.MIDDLEWARE_URL
    : '';

  // Check if any reserved item is out of stock
  var reservedItems = getReservation();
  var hasOutOfStock = reservedItems.some(function (item) {
    return (item.stock || 0) === 0;
  });

  // If out-of-stock items exist, calculate 2-week cutoff
  var twoWeekCutoff = null;
  if (hasOutOfStock) {
    twoWeekCutoff = new Date();
    twoWeekCutoff.setDate(twoWeekCutoff.getDate() + 14);
    twoWeekCutoff.setHours(0, 0, 0, 0);
  }

  container.innerHTML = '';

  // Notice for out-of-stock cutoff
  if (hasOutOfStock) {
    var notice = document.createElement('p');
    notice.className = 'timeslot-notice';
    notice.textContent = 'Some of your selected items need to be ordered in. Timeslots within the next 2 weeks are not available.';
    container.appendChild(notice);
  }

  // Kiosk mode: "Start Now" button when all items are in stock
  var isKiosk = document.body.classList.contains('kiosk-mode');
  if (isKiosk && !hasOutOfStock && reservedItems.length > 0) {
    var startNowWrap = document.createElement('div');
    startNowWrap.className = 'start-now-wrap';

    var startNowBtn = document.createElement('button');
    startNowBtn.type = 'button';
    startNowBtn.className = 'btn start-now-btn';
    startNowBtn.textContent = 'Start Now';

    var startNowNote = document.createElement('p');
    startNowNote.className = 'start-now-note';
    startNowNote.textContent = 'All your items are in stock — start your fermentation right away.';

    // Hidden radio that the form submission will find
    var immediateRadio = document.createElement('input');
    immediateRadio.type = 'radio';
    immediateRadio.name = 'timeslot';
    immediateRadio.value = 'Walk-in — Immediate';
    immediateRadio.classList.add('hidden');
    container.appendChild(immediateRadio);

    startNowBtn.addEventListener('click', function () {
      immediateRadio.checked = true;
      startNowBtn.classList.add('start-now-selected');
      // Deselect any calendar timeslot
      var calRadios = container.querySelectorAll('input[name="timeslot"]:not([value="Walk-in — Immediate"])');
      calRadios.forEach(function (r) { r.checked = false; });
      // Hide completion estimate for immediate
      var estimateEl = document.getElementById('completion-estimate');
      if (estimateEl) estimateEl.classList.add('hidden');
    });

    var orDivider = document.createElement('p');
    orDivider.className = 'start-now-or';
    orDivider.textContent = 'or choose a timeslot below';

    startNowWrap.appendChild(startNowNote);
    startNowWrap.appendChild(startNowBtn);
    startNowWrap.appendChild(orDivider);
    container.appendChild(startNowWrap);
  }

  // Calendar wrapper
  var cal = document.createElement('div');
  cal.className = 'cal';
  container.appendChild(cal);

  // Slots area below calendar
  var slotsArea = document.createElement('div');
  slotsArea.className = 'cal-slots';
  container.appendChild(slotsArea);

  var selectedDate = null;
  var radioIndex = 0;

  // Build month list: current month + 3 months ahead
  var now = new Date();
  var monthsList = [];
  for (var m = 0; m < 4; m++) {
    var d = new Date(now.getFullYear(), now.getMonth() + m, 1);
    monthsList.push(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'));
  }
  var currentMonthIndex = 0;

  // Cache of available dates per month { "2026-02": [{ date, available, slots_count }] }
  var availabilityCache = {};

  function fetchAvailability(ym, callback) {
    if (availabilityCache[ym]) {
      callback(availabilityCache[ym]);
      return;
    }
    var parts = ym.split('-');
    fetch(middlewareUrl + '/api/bookings/availability?year=' + parts[0] + '&month=' + parts[1])
      .then(function (res) { return res.json(); })
      .then(function (data) {
        var dates = data.dates || [];
        // Build lookup set of available date strings
        var lookup = {};
        dates.forEach(function (d) { lookup[d.date] = true; });
        availabilityCache[ym] = lookup;
        callback(lookup);
      })
      .catch(function () {
        availabilityCache[ym] = {};
        callback({});
      });
  }

  function renderCalendar() {
    cal.innerHTML = '';
    var ym = monthsList[currentMonthIndex];
    var year = parseInt(ym.substring(0, 4), 10);
    var month = parseInt(ym.substring(5, 7), 10) - 1; // 0-indexed

    // Header with arrows
    var header = document.createElement('div');
    header.className = 'cal-header';

    var prevBtn = document.createElement('button');
    prevBtn.type = 'button';
    prevBtn.className = 'cal-nav';
    prevBtn.textContent = '\u2039';
    prevBtn.disabled = currentMonthIndex === 0;
    prevBtn.addEventListener('click', function () {
      if (currentMonthIndex > 0) {
        currentMonthIndex--;
        renderCalendar();
      }
    });

    var title = document.createElement('span');
    title.className = 'cal-title';
    var monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'];
    title.textContent = monthNames[month] + ' ' + year;

    var nextBtn = document.createElement('button');
    nextBtn.type = 'button';
    nextBtn.className = 'cal-nav';
    nextBtn.textContent = '\u203A';
    nextBtn.disabled = currentMonthIndex === monthsList.length - 1;
    nextBtn.addEventListener('click', function () {
      if (currentMonthIndex < monthsList.length - 1) {
        currentMonthIndex++;
        renderCalendar();
      }
    });

    header.appendChild(prevBtn);
    header.appendChild(title);
    header.appendChild(nextBtn);
    cal.appendChild(header);

    // Day-of-week headers
    var grid = document.createElement('div');
    grid.className = 'cal-grid';
    var dowLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    dowLabels.forEach(function (d) {
      var dow = document.createElement('div');
      dow.className = 'cal-dow';
      dow.textContent = d;
      grid.appendChild(dow);
    });

    cal.appendChild(grid);

    // Fetch availability then render days
    fetchAvailability(ym, function (availableDates) {
      // Calendar days
      var firstOfMonth = new Date(year, month, 1);
      var startDow = firstOfMonth.getDay(); // 0=Sun
      var daysInMonth = new Date(year, month + 1, 0).getDate();

      var today = new Date();
      today.setHours(0, 0, 0, 0);
      var todayStr = today.getFullYear() + '-' +
        String(today.getMonth() + 1).padStart(2, '0') + '-' +
        String(today.getDate()).padStart(2, '0');

      // Leading empty cells
      for (var e = 0; e < startDow; e++) {
        var empty = document.createElement('div');
        empty.className = 'cal-day cal-day--disabled';
        grid.appendChild(empty);
      }

      for (var d = 1; d <= daysInMonth; d++) {
        var dateStr = year + '-' + String(month + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
        var cell = document.createElement('button');
        cell.type = 'button';
        cell.className = 'cal-day';
        cell.textContent = d;
        cell.setAttribute('data-date', dateStr);

        var cellDate = new Date(dateStr + 'T00:00:00');
        var isPast = cellDate < today;
        var hasSlots = !!availableDates[dateStr];
        var withinCutoff = twoWeekCutoff && cellDate < twoWeekCutoff;

        if (dateStr === todayStr) {
          cell.classList.add('cal-day--today');
        }

        if (dateStr === selectedDate) {
          cell.classList.add('cal-day--selected');
        }

        if (isPast || !hasSlots || withinCutoff) {
          cell.classList.add('cal-day--disabled');
          cell.disabled = true;
        } else {
          cell.classList.add('cal-day--available');
        }

        (function (ds) {
          cell.addEventListener('click', function () {
            selectedDate = ds;
            renderCalendar();
            renderDaySlots(ds);
          });
        })(dateStr);

        grid.appendChild(cell);
      }
    });
  }

  function renderDaySlots(dateStr) {
    slotsArea.innerHTML = '<p class="cal-slots-loading">Loading times...</p>';

    fetch(middlewareUrl + '/api/bookings/slots?date=' + dateStr)
      .then(function (res) { return res.json(); })
      .then(function (data) {
        slotsArea.innerHTML = '';
        var slots = data.slots || [];
        if (slots.length === 0) {
          slotsArea.innerHTML = '<p>No available times for this date.</p>';
          return;
        }

        var dateObj = new Date(dateStr + 'T00:00:00');
        var heading = document.createElement('h3');
        heading.className = 'cal-slots-heading';
        heading.textContent = dateObj.toLocaleDateString('en-US', {
          weekday: 'long',
          month: 'long',
          day: 'numeric'
        });
        slotsArea.appendChild(heading);

        var grid = document.createElement('div');
        grid.className = 'cal-slots-grid';

        slots.forEach(function (slot) {
          // Bookings API returns slot as time string (e.g. "10:00 AM")
          var timeStr = slot.time || slot;
          var option = document.createElement('div');
          option.className = 'timeslot-option';

          var id = 'timeslot-' + radioIndex;
          radioIndex++;

          var radio = document.createElement('input');
          radio.type = 'radio';
          radio.name = 'timeslot';
          radio.id = id;
          radio.value = dateStr + ' ' + timeStr;

          var label = document.createElement('label');
          label.setAttribute('for', id);
          label.textContent = timeStr;

          option.appendChild(radio);
          option.appendChild(label);
          grid.appendChild(option);
        });

        slotsArea.appendChild(grid);
      })
      .catch(function () {
        slotsArea.innerHTML = '<p>Unable to load times for this date.</p>';
      });
  }

  renderCalendar();

  // Touch swipe for calendar month navigation
  var _calTouchStartX = null;
  cal.addEventListener('touchstart', function (e) {
    _calTouchStartX = e.touches[0].clientX;
  }, { passive: true });
  cal.addEventListener('touchend', function (e) {
    if (_calTouchStartX === null) return;
    var dx = e.changedTouches[0].clientX - _calTouchStartX;
    _calTouchStartX = null;
    if (Math.abs(dx) < 50) return;
    if (dx < 0 && currentMonthIndex < monthsList.length - 1) {
      currentMonthIndex++;
      renderCalendar();
    } else if (dx > 0 && currentMonthIndex > 0) {
      currentMonthIndex--;
      renderCalendar();
    }
  }, { passive: true });

  // Attach listener for completion estimate + deselect Start Now
  container.addEventListener('change', function (e) {
    if (e.target.name === 'timeslot') {
      updateCompletionEstimate(e.target.value);
      // If a calendar slot was picked, deselect Start Now
      var snBtn = container.querySelector('.start-now-btn');
      if (snBtn && e.target.value !== 'Walk-in — Immediate') {
        snBtn.classList.remove('start-now-selected');
      }
    }
  });
}

function updateCompletionEstimate(timeslotValue) {
  var estimateEl = document.getElementById('completion-estimate');
  var textEl = document.getElementById('completion-estimate-text');
  if (!estimateEl || !textEl) return;

  var items = getReservation();
  if (items.length === 0) {
    estimateEl.classList.add('hidden');
    return;
  }

  // Find the longest brew time (in weeks) among reserved items
  var maxWeeks = 0;
  items.forEach(function (item) {
    var weeks = parseInt(item.time, 10);
    if (!isNaN(weeks) && weeks > maxWeeks) {
      maxWeeks = weeks;
    }
  });

  if (maxWeeks === 0) {
    estimateEl.classList.add('hidden');
    return;
  }

  // Parse the date portion of the timeslot value (e.g. "2026-02-15 10:00 AM")
  var datePart = timeslotValue.split(' ')[0];
  var startDate = new Date(datePart + 'T00:00:00');
  if (isNaN(startDate.getTime())) {
    estimateEl.classList.add('hidden');
    return;
  }

  var weekStart = new Date(startDate);
  weekStart.setDate(weekStart.getDate() + (maxWeeks * 7));
  var weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);

  var opts = { month: 'long', day: 'numeric' };
  var startStr = weekStart.toLocaleDateString('en-US', opts);
  var endOpts = weekStart.getMonth() === weekEnd.getMonth() ? { day: 'numeric' } : opts;
  var endStr = weekEnd.toLocaleDateString('en-US', endOpts);
  var yearStr = weekEnd.getFullYear();

  textEl.textContent = 'Estimated ready the week of ' + startStr + '–' + endStr + ', ' + yearStr
    + ' (approximately ' + maxWeeks + ' week' + (maxWeeks !== 1 ? 's' : '')
    + ' from your appointment). This is an estimate — actual times may vary.';
  estimateEl.classList.remove('hidden');
}


// Beer Waitlist Google Form — replace with your actual form URL and entry ID
var BEER_WAITLIST_FORM_URL = 'https://docs.google.com/forms/d/e/YOUR_BEER_WAITLIST_FORM_ID/formResponse';
var BEER_WAITLIST_FIELDS = {
  email: 'entry.YOUR_EMAIL_ENTRY_ID'
};

function setupBeerWaitlistForm() {
  var form = document.getElementById('beer-waitlist-form');
  if (!form) return;

  form.addEventListener('submit', function(e) {
    e.preventDefault();

    var emailInput = document.getElementById('beer-waitlist-email');
    var email = emailInput.value.trim();
    if (!email) return;

    // Build hidden form for Google Form submission
    var hiddenForm = document.createElement('form');
    hiddenForm.method = 'POST';
    hiddenForm.action = BEER_WAITLIST_FORM_URL;
    hiddenForm.target = 'beer-waitlist-iframe';
    hiddenForm.style.display = 'none';

    var emailField = document.createElement('input');
    emailField.name = BEER_WAITLIST_FIELDS.email;
    emailField.value = email;
    hiddenForm.appendChild(emailField);

    document.body.appendChild(hiddenForm);
    hiddenForm.submit();
    document.body.removeChild(hiddenForm);

    // Show confirmation
    form.classList.add('hidden');
    document.getElementById('beer-waitlist-confirm').classList.remove('hidden');
  });
}

function setupReservationForm() {
  var form = document.getElementById('reservation-form');
  if (!form) return;

  // Record page load time for bot detection
  var loadedAtField = document.getElementById('res-loaded-at');
  if (loadedAtField) loadedAtField.value = String(Date.now());

  // --- Payment setup (Global Payments hosted fields) ---
  var paymentSection = document.getElementById('payment-section');
  var paymentError = document.getElementById('payment-error');
  var depositSummary = document.getElementById('deposit-summary');
  var gpCardForm = null;
  var gpToken = null;         // populated by token-success callback
  var paymentConfig = null;   // { publicApiKey, depositAmount, enabled }
  var isKioskMode = document.body.classList.contains('kiosk-mode');

  var mwUrl = (typeof SHEETS_CONFIG !== 'undefined' && SHEETS_CONFIG.MIDDLEWARE_URL)
    ? SHEETS_CONFIG.MIDDLEWARE_URL : '';

  // Fetch payment config from middleware and initialize hosted fields
  if (!isKioskMode && paymentSection) {
    fetch(mwUrl + '/api/payment/config')
      .then(function (r) { return r.json(); })
      .then(function (cfg) {
        paymentConfig = cfg;
        if (!cfg.enabled || !cfg.accessToken) return;

        // Show the payment section
        paymentSection.classList.remove('hidden');
        var headingEl = document.getElementById('payment-heading');
        var noteEl = document.getElementById('payment-note');
        var cfgItems = getReservation();
        var cfgIsProductOrder = !cfgItems.some(function (item) { return (item.item_type || 'kit') === 'kit'; });
        if (cfgIsProductOrder) {
          if (noteEl) noteEl.textContent = 'Your card will be charged the full amount. In-store pickup only.';
        } else {
          if (headingEl) headingEl.textContent = 'Payment \u2014 $' + Number(cfg.depositAmount).toFixed(2) + ' deposit';
          if (noteEl) noteEl.textContent = 'Your card will be charged a $' + Number(cfg.depositAmount).toFixed(2) + ' deposit. The remaining balance is due at your appointment.';
        }

        // Configure Global Payments JS SDK with access token
        if (typeof GlobalPayments !== 'undefined') {
          GlobalPayments.configure({
            accessToken: cfg.accessToken,
            apiVersion: '2021-03-22',
            env: cfg.env === 'production' ? 'production' : 'sandbox'
          });

          gpCardForm = GlobalPayments.ui.form({
            fields: {
              'card-holder-name': {
                placeholder: 'Jane Smith',
                target: '#credit-card-holder'
              },
              'card-number': {
                placeholder: '•••• •••• •••• ••••',
                target: '#credit-card-number'
              },
              'card-expiration': {
                placeholder: 'MM / YYYY',
                target: '#credit-card-expiry'
              },
              'card-cvv': {
                placeholder: '•••',
                target: '#credit-card-cvv'
              },
              'submit': {
                text: 'Verify Card',
                target: '#credit-card-submit'
              }
            },
            styles: {
              '#secure-payment-field[type=button]': {
                'background': '#722F37',
                'border': '1px solid #722F37',
                'color': '#ffffff',
                'cursor': 'pointer',
                'padding': '12px 24px',
                'font-size': '16px',
                'border-radius': '4px',
                'width': '100%',
                'font-family': 'Lato, sans-serif'
              },
              '#secure-payment-field[type=button]:hover': {
                'background': '#5a2530'
              }
            }
          });

          gpCardForm.on('token-success', function (resp) {
            gpToken = resp.paymentReference;
            if (paymentError) {
              paymentError.textContent = '';
              paymentError.classList.remove('visible');
            }
            var submitEl = document.getElementById('credit-card-submit');
            if (submitEl) submitEl.classList.add('card-verified');
          });

          gpCardForm.on('token-error', function (resp) {
            gpToken = null;
            if (paymentError) {
              paymentError.textContent = resp.error ? resp.error.message || 'Card validation failed.' : 'Card validation failed.';
              paymentError.classList.add('visible');
            }
          });
        }
      })
      .catch(function (err) {
        console.error('[payment] Config fetch failed:', err.message);
      });
  }

  /**
   * Update the deposit summary display based on cart items and payment config.
   */
  function updateDepositSummary() {
    if (!depositSummary || !paymentConfig || !paymentConfig.enabled || isKioskMode) return;
    var items = getReservation();
    var total = 0;
    items.forEach(function (item) {
      var p = (parseFloat(String(item.price || '0').replace(/[^0-9.]/g, '')) || 0);
      var disc = parseFloat(item.discount) || 0;
      if (disc > 0) p = p * (1 - disc / 100);
      total += p * (item.qty || 1);
    });
    if (items.length === 0 || total <= 0) {
      depositSummary.classList.add('hidden');
      return;
    }

    var depIsProductOrder = !items.some(function (item) { return (item.item_type || 'kit') === 'kit'; });

    if (depIsProductOrder) {
      var depTaxTotal = 0;
      items.forEach(function (item) {
        var p = (parseFloat(String(item.price || '0').replace(/[^0-9.]/g, '')) || 0);
        var disc = parseFloat(item.discount) || 0;
        if (disc > 0) p = p * (1 - disc / 100);
        var taxPct = parseFloat(item.tax_percentage) || 0;
        depTaxTotal += p * (item.qty || 1) * (taxPct / 100);
      });
      var depGrandTotal = total + depTaxTotal;

      var depHtml = '<div class="deposit-summary-row"><span>Subtotal</span><span>$' + total.toFixed(2) + '</span></div>';
      if (depTaxTotal > 0) {
        depHtml += '<div class="deposit-summary-row"><span>Tax</span><span>$' + depTaxTotal.toFixed(2) + '</span></div>';
      }
      depHtml += '<div class="deposit-summary-row deposit-summary-row--total"><span>Total</span><span>$' + depGrandTotal.toFixed(2) + '</span></div>';
      depositSummary.innerHTML = depHtml;
      depositSummary.classList.remove('hidden');

      // Update payment heading with total
      var depHeadingEl = document.getElementById('payment-heading');
      if (depHeadingEl) depHeadingEl.innerHTML = '<svg class="payment-icon" viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M20 4H4c-1.11 0-2 .89-2 2v12c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V6c0-1.11-.89-2-2-2zm0 14H4v-6h16v6zm0-10H4V6h16v2z"/></svg> Payment \u2014 $' + depGrandTotal.toFixed(2);
    } else {
      var deposit = Math.min(paymentConfig.depositAmount, total);
      var balance = Math.max(0, total - deposit);
      depositSummary.innerHTML = '<div class="deposit-summary-row"><span>Deposit</span><span id="deposit-summary-amount">$' + deposit.toFixed(2) + '</span></div>'
        + '<div class="deposit-summary-row"><span>Balance due at appointment</span><span id="deposit-summary-balance">$' + balance.toFixed(2) + '</span></div>';
      depositSummary.classList.remove('hidden');
    }
  }

  // Update deposit summary whenever reservation items change
  window.addEventListener('reservation-changed', updateDepositSummary);
  window.addEventListener('storage', updateDepositSummary);
  setTimeout(updateDepositSummary, 500);

  // Inline validation on blur
  function showFieldError(input, msg) {
    input.classList.add('field-error');
    var errEl = input.parentElement.querySelector('.form-error-msg');
    if (!errEl) {
      errEl = document.createElement('div');
      errEl.className = 'form-error-msg';
      input.parentElement.appendChild(errEl);
    }
    errEl.textContent = msg;
    errEl.classList.add('visible');
  }

  function clearFieldError(input) {
    input.classList.remove('field-error');
    var errEl = input.parentElement.querySelector('.form-error-msg');
    if (errEl) errEl.classList.remove('visible');
  }

  var nameInput = document.getElementById('res-name');
  var emailInput = document.getElementById('res-email');
  var phoneInput = document.getElementById('res-phone');

  function markValid(input) {
    clearFieldError(input);
    input.classList.add('field-valid');
  }

  function clearValid(input) {
    input.classList.remove('field-valid');
  }

  if (nameInput) nameInput.addEventListener('blur', function () {
    if (!this.value.trim()) { clearValid(this); showFieldError(this, 'Name is required.'); }
    else markValid(this);
  });

  if (emailInput) emailInput.addEventListener('blur', function () {
    var val = this.value.trim();
    if (!val) { clearValid(this); showFieldError(this, 'Email is required.'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) { clearValid(this); showFieldError(this, 'Please enter a valid email.'); return; }
    markValid(this);
  });

  if (phoneInput) phoneInput.addEventListener('blur', function () {
    var val = this.value.trim();
    if (!val) { clearValid(this); showFieldError(this, 'Phone number is required.'); return; }
    var digits = val.replace(/\D/g, '');
    if (digits.length < 10) { clearValid(this); showFieldError(this, 'Please enter at least 10 digits.'); return; }
    markValid(this);
  });

  // Clear errors on focus
  [nameInput, emailInput, phoneInput].forEach(function (el) {
    if (el) el.addEventListener('focus', function () { clearFieldError(this); clearValid(this); });
  });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (navigator.vibrate) navigator.vibrate(10);

    // Bot check: honeypot field should be empty
    var honeypot = document.getElementById('res-website');
    if (honeypot && honeypot.value) return;

    // Bot check: form submitted too fast (under 3 seconds) — skip in kiosk mode
    if (!document.body.classList.contains('kiosk-mode')) {
      var loadedAt = parseInt(document.getElementById('res-loaded-at').value, 10) || 0;
      if (Date.now() - loadedAt < 3000) return;
    }

    var items = getReservation();
    if (items.length === 0) {
      showToast('Please add at least one product to your ' + (hasKits ? 'reservation' : 'cart') + '.', 'error');
      return;
    }

    var hasKits = items.some(function (item) { return (item.item_type || 'kit') === 'kit'; });
    var selectedTimeslot = document.querySelector('input[name="timeslot"]:checked');
    if (hasKits && !selectedTimeslot) {
      showToast('Please select a timeslot.', 'error');
      return;
    }

    var name = document.getElementById('res-name').value.trim();
    var email = document.getElementById('res-email').value.trim();
    var phone = document.getElementById('res-phone').value.trim();

    if (!name) {
      showToast('Please enter your name.', 'error');
      return;
    }

    // In kiosk mode, email and phone are optional (hidden fields)
    if (!isKioskMode) {
      var emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailPattern.test(email)) {
        showToast('Please enter a valid email address.', 'error');
        return;
      }

      var phoneDigits = phone.replace(/\D/g, '');
      if (phoneDigits.length < 10 || phoneDigits.length > 15) {
        showToast('Please enter a valid phone number (at least 10 digits).', 'error');
        return;
      }
    }

    var productNames = items.map(function (item) {
      var q = item.qty || 1;
      return item.name + (q > 1 ? ' x' + q : '');
    }).join(', ');
    var timeslot = selectedTimeslot ? selectedTimeslot.value : (!hasKits ? 'In-store pickup' : 'No timeslot \u2014 Pickup only');

    // Disable submit button and show processing state to prevent double-submissions
    var submitBtn = form.querySelector('button[type="submit"]');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.setAttribute('data-original-text', submitBtn.textContent);
      submitBtn.textContent = 'Processing...';
      submitBtn.classList.add('btn-loading');
    }

    var middlewareUrl = mwUrl;
    var isWalkIn = timeslot === 'Walk-in — Immediate';
    var needsPayment = !isWalkIn && !isKioskMode && paymentConfig && paymentConfig.enabled;

    // Calculate order total and deposit
    var orderTotal = 0;
    items.forEach(function (item) {
      var p = String(item.price || '0').replace(/[^0-9.]/g, '');
      var disc = parseFloat(item.discount) || 0;
      var effectiveP = (parseFloat(p) || 0);
      if (disc > 0) effectiveP = effectiveP * (1 - disc / 100);
      orderTotal += effectiveP * (item.qty || 1);
    });

    var submitIsProductOrder = !items.some(function (item) { return (item.item_type || 'kit') === 'kit'; });
    var orderTax = 0;
    if (submitIsProductOrder) {
      items.forEach(function (item) {
        var p = String(item.price || '0').replace(/[^0-9.]/g, '');
        var disc = parseFloat(item.discount) || 0;
        var effectiveP = (parseFloat(p) || 0);
        if (disc > 0) effectiveP = effectiveP * (1 - disc / 100);
        var taxPct = parseFloat(item.tax_percentage) || 0;
        orderTax += effectiveP * (item.qty || 1) * (taxPct / 100);
      });
    }
    var chargeTotal = orderTotal + orderTax;
    var depositAmt = needsPayment ? (submitIsProductOrder ? chargeTotal : Math.min(paymentConfig.depositAmount, orderTotal)) : 0;

    // Parse date and time from timeslot value (e.g. "2026-02-15 10:00 AM")
    var slotParts = timeslot.split(' ');
    var slotDate = slotParts[0];
    var slotTime = slotParts.slice(1).join(' ');

    // Step 0: Charge deposit (skip for walk-in / kiosk)
    var paymentPromise;
    if (needsPayment && depositAmt > 0) {
      // Validate that we have a token from the hosted fields
      if (!gpToken) {
        showToast('Please enter your card details.', 'error');
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = submitBtn.getAttribute('data-original-text') || 'Submit Reservation';
          submitBtn.classList.remove('btn-loading');
        }
        return;
      }

      paymentPromise = fetch(middlewareUrl + '/api/payment/charge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': MW_API_KEY },
        body: JSON.stringify({
          token: gpToken,
          amount: depositAmt,
          customer: { name: name, email: email }
        })
      })
      .then(function (r) {
        if (!r.ok) return r.json().then(function (d) { throw new Error(d.error || 'Payment failed'); });
        return r.json();
      });
    } else {
      paymentPromise = Promise.resolve({ transaction_id: '', amount: 0 });
    }

    paymentPromise
    .then(function (paymentResult) {
      var txnId = paymentResult.transaction_id || '';
      var chargedAmount = paymentResult.amount || 0;

      // Step 1: Find or create contact
      // In kiosk mode with no email, use a placeholder for the walk-in contact
      var contactEmail = email || (isKioskMode ? 'walkin@steinsandvines.ca' : '');
      return fetch(middlewareUrl + '/api/contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': MW_API_KEY },
        body: JSON.stringify({ name: name, email: contactEmail, phone: phone })
      })
      .then(function (res) {
        if (!res.ok) throw new Error('Failed to create contact');
        return res.json();
      })
      .then(function (contactData) {
        var customerId = contactData.contact_id;

        // Step 2: Create booking (skip for walk-in)
        if (isWalkIn) {
          return { customerId: customerId, bookingId: null, timeslotLabel: 'Walk-in — Immediate' };
        }

        return fetch(middlewareUrl + '/api/bookings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': MW_API_KEY },
          body: JSON.stringify({
            date: slotDate,
            time: slotTime,
            customer: { name: name, email: email, phone: phone },
            notes: productNames
          })
        })
        .then(function (res) {
          if (!res.ok) throw new Error('Failed to create booking');
          return res.json();
        })
        .then(function (bookingData) {
          return {
            customerId: customerId,
            bookingId: bookingData.booking_id,
            timeslotLabel: bookingData.timeslot || timeslot
          };
        });
      })
      .then(function (result) {
        // Step 3: Create Sales Order (with deposit info)
        var lineItems = items.map(function (item) {
          var lineItem = {
            name: item.name + (item.brand ? ' — ' + item.brand : ''),
            quantity: item.qty || 1,
            rate: parseFloat(String(item.price || '0').replace(/[^0-9.]/g, '')) || 0
          };
          if (item.zoho_item_id) lineItem.item_id = item.zoho_item_id;
          var disc = parseFloat(item.discount) || 0;
          if (disc > 0) lineItem.discount = disc;
          return lineItem;
        });

        var checkoutPayload = {
          customer_id: result.customerId,
          items: lineItems,
          notes: (submitIsProductOrder ? 'Order' : 'Reservation') + ' for ' + name + ' \u2014 ' + timeslot,
          appointment_id: result.bookingId || '',
          timeslot: result.timeslotLabel
        };

        // Attach payment info if deposit was charged
        if (txnId) {
          checkoutPayload.transaction_id = txnId;
          checkoutPayload.deposit_amount = chargedAmount;
        }

        return fetch(middlewareUrl + '/api/checkout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': MW_API_KEY },
          body: JSON.stringify(checkoutPayload)
        })
        .then(function (res) {
          if (!res.ok) throw new Error('Failed to create order');
          return res.json();
        });
      });
    })
    .then(function (orderResult) {
      // Success — save order details before clearing reservation
      var orderedItems = items.slice(); // copy before clearing
      var orderedTimeslot = timeslot;

      // Step 3.5: If kiosk mode + terminal enabled, push sale to POS
      var terminalPromise;
      if (isKioskMode && middlewareUrl) {
        terminalPromise = fetch(middlewareUrl + '/api/pos/status')
          .then(function (r) { return r.json(); })
          .then(function (posStatus) {
            if (!posStatus.enabled) return null;

            // Show terminal processing overlay
            showTerminalOverlay('Processing payment on terminal...', 'Please tap, insert, or swipe your card.');

            return fetch(middlewareUrl + '/api/pos/sale', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'x-api-key': MW_API_KEY },
              body: JSON.stringify({
                amount: orderTotal,
                salesorder_number: orderResult.salesorder_number || '',
                items: orderedItems.map(function (it) {
                  return { name: it.name, price: it.price, qty: it.qty || 1 };
                }),
                customer_name: name
              })
            })
            .then(function (r) { return r.json(); })
            .then(function (posResult) {
              hideTerminalOverlay();
              return posResult;
            })
            .catch(function (posErr) {
              hideTerminalOverlay();
              console.error('[kiosk] Terminal sale failed:', posErr.message);
              return { error: posErr.message };
            });
          })
          .catch(function () { return null; });
      } else {
        terminalPromise = Promise.resolve(null);
      }

      return terminalPromise.then(function (posResult) {
        localStorage.removeItem(getCartKeyForTab(_activeCartTab));
        document.getElementById('reservation-list').classList.add('hidden');
        document.getElementById('timeslot-picker').classList.add('hidden');
        document.getElementById('reservation-form-section').classList.add('hidden');

        // Update stepper to confirmation step
        updateStepper(4);

        // Show confirmation
        var confirmEl = document.getElementById('reservation-confirm');
        if (confirmEl) {
          confirmEl.classList.remove('hidden');

          // Order number
          var orderNumEl = document.getElementById('confirm-order-number');
          if (orderNumEl && orderResult && orderResult.salesorder_number) {
            orderNumEl.textContent = 'Order #' + orderResult.salesorder_number;
          }

          // Build summary
          var summaryEl = document.getElementById('confirm-summary');
          if (summaryEl) {
            var summaryHtml = '';
            orderedItems.forEach(function (item) {
              var q = item.qty || 1;
              var p = parseFloat(String(item.price || '0').replace(/[^0-9.]/g, '')) || 0;
              var disc = parseFloat(item.discount) || 0;
              if (disc > 0) p = p * (1 - disc / 100);
              summaryHtml += '<div class="confirm-summary-row">'
                + '<span>' + escapeHTML(item.name) + (q > 1 ? ' x' + q : '') + '</span>'
                + '<span>$' + (p * q).toFixed(2) + '</span>'
                + '</div>';
            });
            if (submitIsProductOrder) {
              summaryHtml += '<div class="confirm-summary-row"><span>Pickup</span><span>In-store</span></div>';
              summaryHtml += '<div class="confirm-summary-row"><span>Subtotal</span><span>$' + orderTotal.toFixed(2) + '</span></div>';
              if (orderTax > 0) {
                summaryHtml += '<div class="confirm-summary-row"><span>Tax</span><span>$' + orderTax.toFixed(2) + '</span></div>';
              }
              summaryHtml += '<div class="confirm-summary-row confirm-summary-row--total"><span>Total paid</span><span>$' + chargeTotal.toFixed(2) + '</span></div>';
            } else {
              summaryHtml += '<div class="confirm-summary-row"><span>Timeslot</span><span>' + escapeHTML(orderedTimeslot) + '</span></div>';

              // Show terminal payment result
              if (posResult && posResult.ok) {
                summaryHtml += '<div class="confirm-summary-row"><span>Paid via terminal</span><span>$' + Number(posResult.amount).toFixed(2) + '</span></div>';
              } else if (orderResult && orderResult.deposit_amount > 0) {
                summaryHtml += '<div class="confirm-summary-row"><span>Deposit paid</span><span>$' + Number(orderResult.deposit_amount).toFixed(2) + '</span></div>';
                if (orderResult.balance_due > 0) {
                  summaryHtml += '<div class="confirm-summary-row confirm-summary-row--total"><span>Balance due</span><span>$' + Number(orderResult.balance_due).toFixed(2) + '</span></div>';
                }
              } else {
                summaryHtml += '<div class="confirm-summary-row confirm-summary-row--total"><span>Total</span><span>$' + orderTotal.toFixed(2) + '</span></div>';
              }

              // If terminal failed, show fallback message
              if (posResult && posResult.error) {
                summaryHtml += '<div class="confirm-summary-row" style="color:var(--color-brown);"><span>Please pay at the counter</span><span></span></div>';
              }
            }

            summaryEl.innerHTML = summaryHtml;
          }

          // Scroll to confirmation
          confirmEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      });
    })
    .catch(function (err) {
      showToast('Something went wrong: ' + err.message + '. Please try again.', 'error');
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = submitBtn.getAttribute('data-original-text') || (submitIsProductOrder ? 'Place Order' : 'Submit Reservation');
        submitBtn.classList.remove('btn-loading');
      }
    });
  });
}

function setupContactValidation() {
  var nameInput = document.getElementById('name');
  var emailInput = document.getElementById('email');
  if (!nameInput && !emailInput) return;

  function showFieldError(input, msg) {
    input.classList.add('field-error');
    var errEl = input.parentElement.querySelector('.form-error-msg');
    if (!errEl) {
      errEl = document.createElement('div');
      errEl.className = 'form-error-msg';
      input.parentElement.appendChild(errEl);
    }
    errEl.textContent = msg;
    errEl.classList.add('visible');
  }

  function clearFieldError(input) {
    input.classList.remove('field-error');
    var errEl = input.parentElement.querySelector('.form-error-msg');
    if (errEl) errEl.classList.remove('visible');
  }

  if (nameInput) {
    nameInput.addEventListener('blur', function () {
      if (!this.value.trim()) showFieldError(this, 'Name is required.');
      else clearFieldError(this);
    });
    nameInput.addEventListener('focus', function () { clearFieldError(this); });
  }

  if (emailInput) {
    emailInput.addEventListener('blur', function () {
      var val = this.value.trim();
      if (!val) { showFieldError(this, 'Email is required.'); return; }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) { showFieldError(this, 'Please enter a valid email.'); return; }
      clearFieldError(this);
    });
    emailInput.addEventListener('focus', function () { clearFieldError(this); });
  }
}
