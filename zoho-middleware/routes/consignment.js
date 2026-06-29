'use strict';

var express = require('express');
var zohoApi = require('../lib/zoho-api');
var cache = require('../lib/cache');
var log = require('../lib/logger');
var C = require('../lib/constants');
var apiKeyGuard = require('../lib/apiKey');

var zohoGet = zohoApi.zohoGet;

var REPORT_CACHE_PREFIX = C.CACHE_KEYS.CONSIGNMENT_REPORT_PREFIX;
var REPORT_CACHE_TTL = 300; // 5 minutes

var router = express.Router();

function lastDayOfMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

/**
 * GET /api/admin/consignment-report?month=2026-04
 * Returns consignment sales aggregated by artisan for the given month.
 */
router.get('/api/admin/consignment-report', function (req, res) {
  if (!apiKeyGuard.matches(req.headers['x-api-key'])) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  var month = req.query.month || new Date().toISOString().slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return res.status(400).json({ error: 'Invalid month format (expected YYYY-MM)' });
  }

  var parts = month.split('-');
  var year = parseInt(parts[0], 10);
  var mon = parseInt(parts[1], 10);
  var dateStart = month + '-01';
  var dateEnd = month + '-' + lastDayOfMonth(year, mon);
  var cacheKey = REPORT_CACHE_PREFIX + month;

  cache.get(cacheKey)
    .then(function (cached) {
      if (cached) {
        log.info('[consignment-report] Cache hit for ' + month);
        return res.json(cached);
      }

      log.info('[consignment-report] Fetching invoices for ' + month);
      return zohoGet('/invoices', {
        date_start: dateStart,
        date_end: dateEnd,
        per_page: 200,
        sort_column: 'date',
        sort_order: 'A'
      }).then(function (data) {
        var invoices = data.invoices || [];
        var artisanMap = {};

        invoices.forEach(function (inv) {
          var customFields = inv.custom_fields || [];
          var detailsField = null;

          for (var i = 0; i < customFields.length; i++) {
            var cf = customFields[i];
            if (cf.api_name === process.env.ZOHO_CF_CONSIGNMENT_DETAILS && cf.value) {
              detailsField = cf.value;
              break;
            }
          }

          if (!detailsField) return;

          var details;
          try {
            details = JSON.parse(detailsField);
          } catch (e) {
            return;
          }

          if (!Array.isArray(details)) return;

          details.forEach(function (d) {
            var name = d.artisan_name || 'Unknown';
            if (!artisanMap[name]) {
              artisanMap[name] = {
                artisan_name: name,
                commission_rate: d.commission_rate || 0,
                total_sales: 0,
                total_payout: 0,
                store_commission: 0,
                items_sold: 0,
                sales: []
              };
            }
            var entry = artisanMap[name];
            var saleAmount = d.sale_amount || 0;
            var payout = d.artisan_payout || 0;
            entry.total_sales = Math.round((entry.total_sales + saleAmount) * 100) / 100;
            entry.total_payout = Math.round((entry.total_payout + payout) * 100) / 100;
            entry.store_commission = Math.round((entry.total_sales - entry.total_payout) * 100) / 100;
            entry.items_sold += d.quantity || 0;
            entry.sales.push({
              invoice_number: inv.invoice_number || '',
              date: inv.date || '',
              item_name: d.item_name || '',
              quantity: d.quantity || 0,
              sale_amount: saleAmount,
              artisan_payout: payout
            });
          });
        });

        var artisans = Object.keys(artisanMap).sort().map(function (k) { return artisanMap[k]; });

        var totals = {
          total_sales: 0,
          total_payouts: 0,
          total_store_commission: 0
        };
        artisans.forEach(function (a) {
          totals.total_sales = Math.round((totals.total_sales + a.total_sales) * 100) / 100;
          totals.total_payouts = Math.round((totals.total_payouts + a.total_payout) * 100) / 100;
          totals.total_store_commission = Math.round((totals.total_store_commission + a.store_commission) * 100) / 100;
        });

        var result = {
          month: month,
          artisans: artisans,
          totals: totals
        };

        cache.set(cacheKey, result, REPORT_CACHE_TTL).catch(function () {});
        return res.json(result);
      });
    })
    .catch(function (err) {
      log.error('[consignment-report] ' + err.message);
      res.status(502).json({ error: 'Failed to generate consignment report' });
    });
});

module.exports = router;
