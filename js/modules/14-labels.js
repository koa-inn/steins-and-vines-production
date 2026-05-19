// ===== Labels Mockup Tool =====
(function () {
  'use strict';

  // Source: COGS - Labels.csv (verified 2026-05-18)
  // D-07: JS constant -- no server-side data needed
  // D-08: SKUs 11013-c4000 and 11034-c4000 excluded (Used for packaging)
  var LABEL_DATA = [
    // Satin / Matte BOPP (Waterproof)
    { sku: '814051',       name: '4x3 Satin BOPP',              w: 4,   h: 3,   material: 'bopp',  finish: 'Satin',  price: 0.70, containers: 'both',   uses: '355mL Beer Bottle, 750mL Wine Bottle, 355mL Can' },
    { sku: '814022',       name: '4x6 Matte BOPP',              w: 4,   h: 6,   material: 'bopp',  finish: 'Matte',  price: 1.80, containers: 'bottle', uses: '750mL Wine Bottle' },
    { sku: '814021',       name: '4x4 Matte BOPP',              w: 4,   h: 4,   material: 'bopp',  finish: 'Matte',  price: 1.15, containers: 'both',   uses: '' },
    { sku: '814053',       name: '2.5" Circle Satin BOPP',      w: 2.5, h: 2.5, material: 'bopp',  finish: 'Satin',  price: 0.45, containers: 'both',   uses: '' },
    // SKU 814042 (4x100 Continuous Satin BOPP) omitted from public pricing -- available on request
    // Matte Poly (Durable)
    { sku: '14024-c4000',  name: '3x5 Matte Poly',              w: 3,   h: 5,   material: 'poly',  finish: 'Matte',  price: 1.10, containers: 'both',   uses: '' },
    { sku: '14018-c4000',  name: '4x3 Matte Poly',              w: 4,   h: 3,   material: 'poly',  finish: 'Matte',  price: 0.80, containers: 'both',   uses: '' },
    { sku: '14037-c4000',  name: '2" Circle Matte Poly',        w: 2,   h: 2,   material: 'poly',  finish: 'Matte',  price: 0.40, containers: 'both',   uses: '' },
    // High Gloss Paper (Budget) -- packaging SKUs excluded per D-08
    { sku: '11029-c4000',  name: '3x3 High Gloss Paper',        w: 3,   h: 3,   material: 'paper', finish: 'Gloss',  price: 0.45, containers: 'both',   uses: '' },
    { sku: '11016-c4000',  name: '4x2 High Gloss Paper',        w: 4,   h: 2,   material: 'paper', finish: 'Gloss',  price: 0.40, containers: 'both',   uses: '' },
    { sku: '11025-c4000',  name: '3x6 High Gloss Paper',        w: 3,   h: 6,   material: 'paper', finish: 'Gloss',  price: 1.00, containers: 'both',   uses: '' },
    { sku: '11019-c4000',  name: '4x4 High Gloss Paper',        w: 4,   h: 4,   material: 'paper', finish: 'Gloss',  price: 0.80, containers: 'both',   uses: '' },
    { sku: '11024-c4000',  name: '3x5 High Gloss Paper',        w: 3,   h: 5,   material: 'paper', finish: 'Gloss',  price: 0.85, containers: 'both',   uses: '' },
    { sku: '11039-c4000',  name: '3" Circle High Gloss Paper',  w: 3,   h: 3,   material: 'paper', finish: 'Gloss',  price: 0.45, containers: 'both',   uses: '' },
    { sku: '11037-c4000',  name: '2" Circle High Gloss Paper',  w: 2,   h: 2,   material: 'paper', finish: 'Gloss',  price: 0.25, containers: 'both',   uses: '' }
  ];

  var MATERIAL_LABELS = {
    bopp:  'Waterproof',
    poly:  'Waterproof',
    paper: 'Paper'
  };

  function buildPricingTable() {
    var tableWrap = document.getElementById('labels-pricing-table-wrap');
    if (!tableWrap) return;

    var html = '<table class="labels-pricing-table"><thead><tr>';
    html += '<th>Size</th><th>Material</th><th>Finish</th><th style="text-align:right">Per Label</th>';
    html += '</tr></thead><tbody>';

    var sorted = LABEL_DATA.filter(function (l) { return !l.continuous; });
    var matOrder = { paper: 0, poly: 1, bopp: 2 };
    sorted.sort(function (a, b) {
      var aCircle = a.name.indexOf('Circle') !== -1 ? 1 : 0;
      var bCircle = b.name.indexOf('Circle') !== -1 ? 1 : 0;
      if (aCircle !== bCircle) return aCircle - bCircle;
      var aMat = matOrder[a.material] || 0;
      var bMat = matOrder[b.material] || 0;
      if (aMat !== bMat) return aMat - bMat;
      return a.price - b.price;
    });

    sorted.forEach(function (l) {
      var sizeStr;
      var isCircle = l.name.indexOf('Circle') !== -1;
      if (l.continuous) {
        sizeStr = l.w + '" wide continuous roll';
      } else if (isCircle) {
        sizeStr = l.w + '" circle';
      } else {
        sizeStr = l.w + '" &times; ' + l.h + '"';
      }

      var priceStr = l.continuous ? '$' + l.price.toFixed(2) + '/inch' : '$' + l.price.toFixed(2);

      html += '<tr>';
      html += '<td>' + sizeStr + '</td>';
      html += '<td>' + (MATERIAL_LABELS[l.material] || l.material) + '</td>';
      html += '<td>' + (l.finish || '') + '</td>';
      html += '<td>' + priceStr + '</td>';
      html += '</tr>';
    });

    html += '</tbody></table>';
    tableWrap.innerHTML = html;
  }

  var TEMPLATE_PATHS = {
    bottle: 'images/labels/bottle-template.svg',
    can:    'images/labels/can-template.svg'
  };

  var PHOTO_PATHS = {
    can: 'images/labels/can-photo.jpg',
    bottle: 'images/labels/bottle-photo.jpg'
  };

  var PLACEHOLDER_PATH = 'images/labels/placeholder-label.svg';
  var MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB per D-10

  // Label region coordinates on photo/SVG canvases (tuned 2026-05-18)
  // Can: derived from can-template.svg label rect (SVG viewBox 600x800 -> canvas 280x420)
  //   SVG label rect: x=210, y=240, w=180, h=320 -> scale x=0.467, y=0.525
  // Bottle: derived from bottle-photo.jpg (280x560) -- blank label area on bottle body
  var PHOTO_LABEL_REGIONS = {
    can:    { x: 95, y: 125, w: 90, h: 170 },
    bottle: { x: 55, y: 190, w: 120, h: 170 }
  };

  // Module state
  var _canvasFlat = null;   var _ctxFlat = null;
  var _canvasCan = null;    var _ctxCan = null;
  var _canvasBottle = null; var _ctxBottle = null;
  var _currentLabelType = null;  // selected LABEL_DATA entry
  var _templateImages = {};      // preloaded Image objects (canPhoto, bottlePhoto, canSvg, bottleSvg)
  var _placeholderImg = null;
  var _userImage = null;
  var _fileInput = null;
  var _resetBtn = null;
  var _typeSelect = null;

  // Rounded rectangle helper for clip paths
  function roundedRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  }

  // Fallback template drawing if SVG/photo fails to load
  function drawFallbackTemplate(ctx, type, w, h) {
    ctx.fillStyle = '#e8e4d8';
    ctx.fillRect(0, 0, w, h);

    if (type === 'bottle') {
      // Simple bottle shape
      ctx.fillStyle = '#4a6f4b';
      // Neck
      ctx.fillRect(w * 0.44, h * 0.06, w * 0.12, h * 0.19);
      // Shoulder (trapezoid via paths)
      ctx.beginPath();
      ctx.moveTo(w * 0.44, h * 0.25);
      ctx.lineTo(w * 0.29, h * 0.35);
      ctx.lineTo(w * 0.71, h * 0.35);
      ctx.lineTo(w * 0.56, h * 0.25);
      ctx.closePath();
      ctx.fill();
      // Body
      ctx.fillRect(w * 0.29, h * 0.35, w * 0.42, h * 0.50);
      // Bottom
      ctx.fillRect(w * 0.29, h * 0.85, w * 0.42, h * 0.04);
    } else {
      // Simple can shape
      ctx.fillStyle = '#888';
      // Top rim
      ctx.beginPath();
      ctx.ellipse(w / 2, h * 0.15, w * 0.36, h * 0.04, 0, 0, Math.PI * 2);
      ctx.fill();
      // Body
      ctx.fillRect(w * 0.14, h * 0.15, w * 0.71, h * 0.66);
      // Bottom rim
      ctx.beginPath();
      ctx.ellipse(w / 2, h * 0.81, w * 0.36, h * 0.04, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Scanline cylindrical warp -- D-04
  // Draws labelImg onto ctx within a target region, warped to simulate wrapping around a cylinder.
  // numSlices horizontal strips are drawn with cosine-scaled widths.
  function drawCylindrical(ctx, labelImg, region, numSlices) {
    numSlices = numSlices || 40;
    var sliceH = region.h / numSlices;

    // Cover-fit: compute source crop to fill region aspect ratio
    var imgAspect = labelImg.naturalWidth / labelImg.naturalHeight;
    var regionAspect = region.w / region.h;
    var srcX, srcY, srcW, srcH;
    if (imgAspect > regionAspect) {
      srcH = labelImg.naturalHeight;
      srcW = srcH * regionAspect;
      srcX = (labelImg.naturalWidth - srcW) / 2;
      srcY = 0;
    } else {
      srcW = labelImg.naturalWidth;
      srcH = srcW / regionAspect;
      srcX = 0;
      srcY = (labelImg.naturalHeight - srcH) / 2;
    }

    var sliceSrcH = srcH / numSlices;

    for (var i = 0; i < numSlices; i++) {
      var t = (i / (numSlices - 1)) * Math.PI - Math.PI / 2;
      var scale = Math.cos(t) * 0.3 + 0.7;
      var sliceW = region.w * scale;
      var sliceX = region.x + (region.w - sliceW) / 2;

      ctx.drawImage(
        labelImg,
        srcX, srcY + i * sliceSrcH, srcW, sliceSrcH,
        sliceX, region.y + i * sliceH, sliceW, sliceH
      );
    }
  }

  // Flat preview -- D-03: exact aspect ratio rectangle with dimension labels
  function renderFlat() {
    if (!_ctxFlat || !_currentLabelType) return;
    var W = _canvasFlat.width;
    var H = _canvasFlat.height;
    _ctxFlat.clearRect(0, 0, W, H);

    // Background
    _ctxFlat.fillStyle = '#fafafa';
    _ctxFlat.fillRect(0, 0, W, H);

    var labelImg = _userImage || _placeholderImg;
    if (!labelImg || !labelImg.complete || !labelImg.naturalWidth) return;

    var lt = _currentLabelType;
    // Skip flat preview for continuous roll labels
    if (lt.continuous) {
      _ctxFlat.fillStyle = '#555';
      _ctxFlat.font = '14px Lato, Arial, sans-serif';
      _ctxFlat.textAlign = 'center';
      _ctxFlat.fillText('Continuous roll — no flat preview', W / 2, H / 2);
      return;
    }

    var pad = 40;
    var labelAspect = lt.w / lt.h;
    var availW = W - pad * 2;
    var availH = H - pad * 2 - 30;
    var drawW, drawH;
    if (labelAspect > availW / availH) {
      drawW = availW;
      drawH = drawW / labelAspect;
    } else {
      drawH = availH;
      drawW = drawH * labelAspect;
    }
    var drawX = (W - drawW) / 2;
    var drawY = (H - drawH) / 2 - 15;

    // Draw label image clipped to rectangle
    _ctxFlat.save();
    _ctxFlat.beginPath();
    _ctxFlat.rect(drawX, drawY, drawW, drawH);
    _ctxFlat.clip();
    // Cover-fit inside the rectangle
    var imgAspect = labelImg.naturalWidth / labelImg.naturalHeight;
    var rectAspect = drawW / drawH;
    var imgDrawW, imgDrawH, imgDrawX, imgDrawY;
    if (imgAspect > rectAspect) {
      imgDrawH = drawH;
      imgDrawW = drawH * imgAspect;
      imgDrawX = drawX - (imgDrawW - drawW) / 2;
      imgDrawY = drawY;
    } else {
      imgDrawW = drawW;
      imgDrawH = drawW / imgAspect;
      imgDrawX = drawX;
      imgDrawY = drawY - (imgDrawH - drawH) / 2;
    }
    _ctxFlat.drawImage(labelImg, imgDrawX, imgDrawY, imgDrawW, imgDrawH);
    _ctxFlat.restore();

    // Border
    _ctxFlat.strokeStyle = 'rgba(0,0,0,0.2)';
    _ctxFlat.lineWidth = 1;
    _ctxFlat.strokeRect(drawX, drawY, drawW, drawH);

    // Dimension text
    var dimText;
    if (lt.w === lt.h) {
      dimText = lt.w + '" circle';
    } else {
      dimText = lt.w + '" x ' + lt.h + '"';
    }
    _ctxFlat.fillStyle = '#555';
    _ctxFlat.font = '14px Lato, Arial, sans-serif';
    _ctxFlat.textAlign = 'center';
    _ctxFlat.fillText(dimText, W / 2, drawY + drawH + 20);
  }

  function renderCan() {
    if (!_ctxCan) return;
    var W = _canvasCan.width;
    var H = _canvasCan.height;
    _ctxCan.clearRect(0, 0, W, H);

    var bgImg = _templateImages.canPhoto;
    if (bgImg && bgImg.complete && bgImg.naturalWidth > 0) {
      _ctxCan.drawImage(bgImg, 0, 0, W, H);
    } else {
      // Fallback to SVG or drawn shape
      var svgImg = _templateImages.canSvg;
      if (svgImg && svgImg.complete && svgImg.naturalWidth > 0) {
        _ctxCan.drawImage(svgImg, 0, 0, W, H);
      } else {
        drawFallbackTemplate(_ctxCan, 'can', W, H);
      }
    }

    var labelImg = _userImage || _placeholderImg;
    if (labelImg && labelImg.complete && labelImg.naturalWidth > 0) {
      drawCylindrical(_ctxCan, labelImg, PHOTO_LABEL_REGIONS.can, 40);
    }
  }

  function renderBottle() {
    if (!_ctxBottle) return;
    var W = _canvasBottle.width;
    var H = _canvasBottle.height;
    _ctxBottle.clearRect(0, 0, W, H);

    var bgImg = _templateImages.bottlePhoto;
    if (bgImg && bgImg.complete && bgImg.naturalWidth > 0) {
      _ctxBottle.drawImage(bgImg, 0, 0, W, H);
    } else {
      var svgImg = _templateImages.bottleSvg;
      if (svgImg && svgImg.complete && svgImg.naturalWidth > 0) {
        _ctxBottle.drawImage(svgImg, 0, 0, W, H);
      } else {
        drawFallbackTemplate(_ctxBottle, 'bottle', W, H);
      }
    }

    var labelImg = _userImage || _placeholderImg;
    if (labelImg && labelImg.complete && labelImg.naturalWidth > 0) {
      drawCylindrical(_ctxBottle, labelImg, PHOTO_LABEL_REGIONS.bottle, 40);
    }
  }

  // Render all 3 previews -- D-02 (single upload updates all)
  function renderAll() {
    renderFlat();
    renderCan();
    renderBottle();
  }

  // Image preloading
  function preloadImages(callback) {
    var loaded = 0;
    var total = 5; // bottleSvg, canSvg, placeholder, canPhoto, bottlePhoto

    function onLoad() {
      loaded++;
      if (loaded >= total && callback) {
        callback();
      }
    }

    // SVG fallbacks (existing)
    _templateImages.bottleSvg = new Image();
    _templateImages.bottleSvg.onload = onLoad;
    _templateImages.bottleSvg.onerror = onLoad;
    _templateImages.bottleSvg.src = TEMPLATE_PATHS.bottle;

    _templateImages.canSvg = new Image();
    _templateImages.canSvg.onload = onLoad;
    _templateImages.canSvg.onerror = onLoad;
    _templateImages.canSvg.src = TEMPLATE_PATHS.can;

    // Photo backgrounds (new)
    _templateImages.canPhoto = new Image();
    _templateImages.canPhoto.onload = onLoad;
    _templateImages.canPhoto.onerror = onLoad;
    _templateImages.canPhoto.src = PHOTO_PATHS.can;

    _templateImages.bottlePhoto = new Image();
    _templateImages.bottlePhoto.onload = onLoad;
    _templateImages.bottlePhoto.onerror = onLoad;
    _templateImages.bottlePhoto.src = PHOTO_PATHS.bottle;

    // Placeholder label
    _placeholderImg = new Image();
    _placeholderImg.onload = onLoad;
    _placeholderImg.onerror = onLoad;
    _placeholderImg.src = PLACEHOLDER_PATH;
  }

  // Populate label type select dropdown and handle changes -- D-06
  function populateLabelTypeSelector() {
    if (!_typeSelect) return;
    var html = '';
    LABEL_DATA.forEach(function (l, idx) {
      html += '<option value="' + idx + '">' + l.name + ' (' + l.w + '" x ' + l.h + '")</option>';
    });
    _typeSelect.innerHTML = html;
    // Default to first non-continuous label
    var defaultIdx = 0;
    for (var i = 0; i < LABEL_DATA.length; i++) {
      if (!LABEL_DATA[i].continuous) { defaultIdx = i; break; }
    }
    _typeSelect.value = String(defaultIdx);
    _currentLabelType = LABEL_DATA[defaultIdx];
    updateContainerVisibility();
  }

  function handleLabelTypeChange() {
    var idx = parseInt(_typeSelect.value, 10);
    if (isNaN(idx) || idx < 0 || idx >= LABEL_DATA.length) return;
    _currentLabelType = LABEL_DATA[idx];
    updateContainerVisibility();
    renderAll();
  }

  // D-06: show/hide can and bottle previews based on container compatibility
  function updateContainerVisibility() {
    var canWrap = document.getElementById('preview-can-wrap');
    var bottleWrap = document.getElementById('preview-bottle-wrap');
    if (!_currentLabelType) return;

    var containers = _currentLabelType.containers;
    if (canWrap) {
      if (containers === 'bottle') {
        canWrap.classList.add('hidden');
      } else {
        canWrap.classList.remove('hidden');
      }
    }
    if (bottleWrap) {
      if (containers === 'can') {
        bottleWrap.classList.add('hidden');
      } else {
        bottleWrap.classList.remove('hidden');
      }
    }
  }

  // File upload handler (per D-10)
  function handleFileUpload(e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;

    // Validate file size (max 5 MB)
    if (file.size > MAX_FILE_SIZE) {
      alert('File is too large. Maximum size is 5 MB.');
      e.target.value = '';
      return;
    }

    // Validate file type
    var validTypes = ['image/png', 'image/jpeg', 'image/webp'];
    if (validTypes.indexOf(file.type) === -1) {
      alert('Invalid file type. Please upload a PNG, JPG, or WEBP image.');
      e.target.value = '';
      return;
    }

    var reader = new FileReader();
    reader.onload = function (loadEvent) {
      var img = new Image();
      img.onload = function () {
        _userImage = img;
        if (_resetBtn) {
          _resetBtn.disabled = false;
        }
        renderAll();
      };
      img.onerror = function () {
        alert('Could not load image. Please try a different file.');
      };
      img.src = loadEvent.target.result;
    };
    reader.readAsDataURL(file);
  }

  // Reset handler (per D-13)
  function handleReset() {
    _userImage = null;
    if (_fileInput) {
      _fileInput.value = '';
    }
    if (_resetBtn) {
      _resetBtn.disabled = true;
    }
    renderAll();
  }

  // Initialization (DOMContentLoaded)
  function init() {
    // Build pricing table (always runs if wrapper exists)
    buildPricingTable();

    // Canvas preview tool — disabled pending proper product photos
    _canvasFlat = document.getElementById('labels-canvas-flat');
    if (!_canvasFlat) return;

    _ctxFlat = _canvasFlat.getContext('2d');
    _canvasFlat.width = 300;
    _canvasFlat.height = 300;

    _canvasCan = document.getElementById('labels-canvas-can');
    if (_canvasCan) {
      _ctxCan = _canvasCan.getContext('2d');
      _canvasCan.width = 280;
      _canvasCan.height = 420;
    }

    _canvasBottle = document.getElementById('labels-canvas-bottle');
    if (_canvasBottle) {
      _ctxBottle = _canvasBottle.getContext('2d');
      _canvasBottle.width = 280;
      _canvasBottle.height = 560;
    }

    _fileInput = document.getElementById('labels-upload');
    _resetBtn = document.getElementById('labels-reset');
    _typeSelect = document.getElementById('labels-type-select');

    populateLabelTypeSelector();

    preloadImages(function () {
      renderAll();
    });

    if (_typeSelect) {
      _typeSelect.addEventListener('change', handleLabelTypeChange);
    }
    if (_fileInput) {
      _fileInput.addEventListener('change', handleFileUpload);
    }
    if (_resetBtn) {
      _resetBtn.addEventListener('click', handleReset);
    }
  }

  document.addEventListener('DOMContentLoaded', init);

  // Expose for testing
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      LABEL_DATA: LABEL_DATA,
      MAX_FILE_SIZE: MAX_FILE_SIZE,
      _init: init,
      _renderAll: renderAll,
      _renderFlat: renderFlat,
      _renderCan: renderCan,
      _renderBottle: renderBottle,
      _buildPricingTable: buildPricingTable,
      _handleReset: handleReset,
      _handleFileUpload: handleFileUpload,
      _handleLabelTypeChange: handleLabelTypeChange,
      _drawCylindrical: drawCylindrical
    };
  }
})();
