// ===== Labels Mockup Tool =====
(function () {
  'use strict';

  // Per D-17: Label region coordinates (x, y, width, height) on the 600x800 canvas
  // These define where the uploaded image gets composited onto each template
  var LABEL_REGIONS = {
    bottle: { x: 175, y: 280, w: 250, h: 200, radius: 8 },
    can:    { x: 100, y: 150, w: 400, h: 400, radius: 12 }
  };

  var TEMPLATE_PATHS = {
    bottle: 'images/labels/bottle-template.svg',
    can:    'images/labels/can-template.svg'
  };

  var PLACEHOLDER_PATH = 'images/labels/placeholder-label.svg';
  var MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB per D-10
  var CANVAS_WIDTH = 600;
  var CANVAS_HEIGHT = 800;

  // Module state
  var _canvas = null;
  var _ctx = null;
  var _currentTemplate = 'bottle';
  var _templateImages = {};  // preloaded Image objects keyed by template name
  var _placeholderImg = null;
  var _userImage = null;     // uploaded Image object, null if none
  var _fileInput = null;
  var _resetBtn = null;

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

  // Fallback template drawing if SVG fails to load
  function drawFallbackTemplate() {
    _ctx.fillStyle = '#e8e4d8';
    _ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    if (_currentTemplate === 'bottle') {
      // Simple bottle shape
      _ctx.fillStyle = '#4a6f4b';
      // Neck
      _ctx.fillRect(265, 50, 70, 150);
      // Shoulder (trapezoid via paths)
      _ctx.beginPath();
      _ctx.moveTo(265, 200);
      _ctx.lineTo(175, 280);
      _ctx.lineTo(425, 280);
      _ctx.lineTo(335, 200);
      _ctx.closePath();
      _ctx.fill();
      // Body
      _ctx.fillRect(175, 280, 250, 400);
      // Bottom
      _ctx.fillRect(175, 680, 250, 30);
    } else {
      // Simple can shape
      _ctx.fillStyle = '#888';
      // Top rim
      _ctx.beginPath();
      _ctx.ellipse(300, 120, 200, 30, 0, 0, Math.PI * 2);
      _ctx.fill();
      // Body
      _ctx.fillRect(100, 120, 400, 530);
      // Bottom rim
      _ctx.beginPath();
      _ctx.ellipse(300, 650, 200, 30, 0, 0, Math.PI * 2);
      _ctx.fill();
    }
  }

  // Core render function (per D-11, D-12)
  function render() {
    if (!_ctx) return;

    // Clear canvas
    _ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Draw template base image
    var templateImg = _templateImages[_currentTemplate];
    if (templateImg && templateImg.complete && templateImg.naturalWidth > 0) {
      _ctx.drawImage(templateImg, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    } else {
      // Fallback: draw a simple shape if template SVG failed to load
      drawFallbackTemplate();
    }

    // Get label region for current template
    var region = LABEL_REGIONS[_currentTemplate];

    // Draw the label image (user upload or placeholder) into the label region
    var labelImg = _userImage || _placeholderImg;

    if (labelImg && labelImg.complete && labelImg.naturalWidth > 0) {
      // Save context for clipping
      _ctx.save();

      // Create rounded rectangle clip path for label region per D-11
      roundedRect(_ctx, region.x, region.y, region.w, region.h, region.radius);
      _ctx.clip();

      // Scale and center the label image within the region (cover fit)
      var imgAspect = labelImg.naturalWidth / labelImg.naturalHeight;
      var regionAspect = region.w / region.h;
      var drawW, drawH, drawX, drawY;

      if (imgAspect > regionAspect) {
        // Image is wider — fit to height, crop sides
        drawH = region.h;
        drawW = region.h * imgAspect;
        drawX = region.x - (drawW - region.w) / 2;
        drawY = region.y;
      } else {
        // Image is taller — fit to width, crop top/bottom
        drawW = region.w;
        drawH = region.w / imgAspect;
        drawX = region.x;
        drawY = region.y - (drawH - region.h) / 2;
      }

      _ctx.drawImage(labelImg, drawX, drawY, drawW, drawH);

      _ctx.restore();

      // Draw subtle border around label region for depth effect per D-11
      _ctx.save();
      _ctx.strokeStyle = 'rgba(0, 0, 0, 0.15)';
      _ctx.lineWidth = 1;
      roundedRect(_ctx, region.x, region.y, region.w, region.h, region.radius);
      _ctx.stroke();
      _ctx.restore();
    }
  }

  // Image preloading
  function preloadImages(callback) {
    var loaded = 0;
    var total = 3; // bottle, can, placeholder

    function onLoad() {
      loaded++;
      if (loaded >= total && callback) {
        callback();
      }
    }

    _templateImages.bottle = new Image();
    _templateImages.bottle.onload = onLoad;
    _templateImages.bottle.onerror = onLoad; // proceed even on error
    _templateImages.bottle.src = TEMPLATE_PATHS.bottle;

    _templateImages.can = new Image();
    _templateImages.can.onload = onLoad;
    _templateImages.can.onerror = onLoad;
    _templateImages.can.src = TEMPLATE_PATHS.can;

    _placeholderImg = new Image();
    _placeholderImg.onload = onLoad;
    _placeholderImg.onerror = onLoad;
    _placeholderImg.src = PLACEHOLDER_PATH;
  }

  // Template switch handler (per D-09)
  function handleTemplateSwitch(e) {
    var btn = e.currentTarget;
    var template = btn.getAttribute('data-template');
    if (!template || template === _currentTemplate) return;

    _currentTemplate = template;

    // Update active state on buttons
    var allBtns = document.querySelectorAll('.labels-template-btn');
    for (var i = 0; i < allBtns.length; i++) {
      var isActive = allBtns[i].getAttribute('data-template') === template;
      allBtns[i].classList.toggle('active', isActive);
      allBtns[i].setAttribute('aria-selected', isActive ? 'true' : 'false');
    }

    render();
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
        render();
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
    render();
  }

  // Initialization (DOMContentLoaded)
  function init() {
    _canvas = document.getElementById('labels-canvas');
    if (!_canvas) return; // Not on the labels page — exit silently

    _ctx = _canvas.getContext('2d');
    _canvas.width = CANVAS_WIDTH;
    _canvas.height = CANVAS_HEIGHT;

    _fileInput = document.getElementById('labels-upload');
    _resetBtn = document.getElementById('labels-reset');

    // Preload template images
    preloadImages(function () {
      render();
    });

    // Template selector buttons
    var templateBtns = document.querySelectorAll('.labels-template-btn');
    for (var i = 0; i < templateBtns.length; i++) {
      templateBtns[i].addEventListener('click', handleTemplateSwitch);
    }

    // File upload handler per D-10
    if (_fileInput) {
      _fileInput.addEventListener('change', handleFileUpload);
    }

    // Reset button per D-13
    if (_resetBtn) {
      _resetBtn.addEventListener('click', handleReset);
    }
  }

  document.addEventListener('DOMContentLoaded', init);

  // Expose for testing
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      LABEL_REGIONS: LABEL_REGIONS,
      MAX_FILE_SIZE: MAX_FILE_SIZE,
      _init: init,
      _render: render,
      _handleReset: handleReset,
      _handleTemplateSwitch: handleTemplateSwitch,
      _handleFileUpload: handleFileUpload
    };
  }
})();
