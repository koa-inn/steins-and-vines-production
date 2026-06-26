#!/usr/bin/env node
/**
 * Generate responsive WebP images from product PNGs.
 * Outputs {sku}-400w.webp and {sku}-800w.webp alongside the originals.
 *
 * Usage: node scripts/optimize-images.js
 * Requires: npm install --save-dev sharp
 */

var fs = require('fs');
var path = require('path');
var sharp = require('sharp');

var SIZES = [400, 800];
var SRC_DIR = path.join(__dirname, '..', 'images', 'products');

// Facility/about photos (ASSET-01, audit #18): large JPEGs displayed on the
// homepage + about page. Emit responsive webp at photo sizes plus a downsized
// JPEG fallback so the multi-MB originals can be retired from deployment.
var FACILITY_DIR = path.join(__dirname, '..', 'images', 'facility');
var FACILITY_SIZES = [800, 1600];
var FACILITY_FALLBACK_W = 1600;
// Only the images actually referenced in HTML (others in the dir are unused).
var FACILITY_IMAGES = ['interior', 'storefront', 'paul', 'koa'];

async function processProducts() {
  var files = fs.readdirSync(SRC_DIR).filter(function (f) {
    return f.endsWith('.png') && !f.match(/-\d+w\.webp$/);
  });

  console.log('Products: found ' + files.length + ' source images');
  var created = 0;
  var skipped = 0;

  for (var i = 0; i < files.length; i++) {
    var file = files[i];
    var basename = file.replace(/\.png$/, '');
    var srcPath = path.join(SRC_DIR, file);

    for (var j = 0; j < SIZES.length; j++) {
      var w = SIZES[j];
      var outName = basename + '-' + w + 'w.webp';
      var outPath = path.join(SRC_DIR, outName);

      if (fs.existsSync(outPath)) {
        skipped++;
        continue;
      }

      try {
        var meta = await sharp(srcPath).metadata();
        var resizeW = (meta.width && meta.width > w) ? w : null;
        await sharp(srcPath)
          .resize(resizeW, null, { withoutEnlargement: true })
          .webp({ quality: 80 })
          .toFile(outPath);
        created++;
      } catch (err) {
        console.error('Error processing ' + file + ' @ ' + w + 'w:', err.message);
      }
    }

    if ((i + 1) % 20 === 0) {
      console.log('  Processed ' + (i + 1) + '/' + files.length + '...');
    }
  }

  console.log('Products done: ' + created + ' created, ' + skipped + ' skipped');
}

async function processFacility() {
  var created = 0;
  var skipped = 0;
  console.log('Facility: processing ' + FACILITY_IMAGES.length + ' photos');

  for (var i = 0; i < FACILITY_IMAGES.length; i++) {
    var name = FACILITY_IMAGES[i];
    var srcPath = path.join(FACILITY_DIR, name + '.jpg');
    if (!fs.existsSync(srcPath)) {
      console.error('  MISSING source: ' + name + '.jpg (skipping)');
      continue;
    }

    // Responsive webp variants
    for (var j = 0; j < FACILITY_SIZES.length; j++) {
      var w = FACILITY_SIZES[j];
      var outPath = path.join(FACILITY_DIR, name + '-' + w + 'w.webp');
      if (fs.existsSync(outPath)) { skipped++; continue; }
      try {
        await sharp(srcPath)
          .resize(w, null, { withoutEnlargement: true })
          .webp({ quality: 78 })
          .toFile(outPath);
        created++;
      } catch (err) {
        console.error('  Error ' + name + ' @ ' + w + 'w webp:', err.message);
      }
    }

    // Downsized JPEG fallback (for the rare non-webp client) — replaces the
    // multi-MB original as the <img> src.
    var jpgFallback = path.join(FACILITY_DIR, name + '-' + FACILITY_FALLBACK_W + 'w.jpg');
    if (!fs.existsSync(jpgFallback)) {
      try {
        await sharp(srcPath)
          .resize(FACILITY_FALLBACK_W, null, { withoutEnlargement: true })
          .jpeg({ quality: 80, mozjpeg: true })
          .toFile(jpgFallback);
        created++;
      } catch (err) {
        console.error('  Error ' + name + ' jpeg fallback:', err.message);
      }
    } else {
      skipped++;
    }
  }

  console.log('Facility done: ' + created + ' created, ' + skipped + ' skipped');
}

async function run() {
  await processProducts();
  await processFacility();
}

run().catch(function (err) {
  console.error(err);
  process.exit(1);
});
