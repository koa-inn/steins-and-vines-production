var express = require('express');
var zohoApi = require('../lib/zoho-api');
var log = require('../lib/logger');

var inventoryGet = zohoApi.inventoryGet;
var inventoryPost = zohoApi.inventoryPost;
var inventoryPut = zohoApi.inventoryPut;

var router = express.Router();

/**
 * GET /api/purchase-orders
 * List purchase orders from Zoho Inventory.
 * ?status=open (default), draft, billed, closed, all
 */
router.get('/api/purchase-orders', function (req, res) {
  var params = {};
  var status = req.query.status || 'open';
  if (status !== 'all') params.status = status;
  inventoryGet('/purchaseorders', params)
    .then(function (data) { res.json(data); })
    .catch(function (err) {
      log.error('[api/purchase-orders GET] ' + err.message);
      res.status(502).json({ error: 'Unable to fetch purchase orders' });
    });
});

/**
 * GET /api/purchase-orders/:id
 * Get a single purchase order from Zoho Inventory.
 */
router.get('/api/purchase-orders/:id', function (req, res) {
  inventoryGet('/purchaseorders/' + req.params.id)
    .then(function (data) { res.json(data); })
    .catch(function (err) {
      log.error('[api/purchase-orders/:id GET] ' + err.message);
      res.status(502).json({ error: 'Unable to fetch purchase order' });
    });
});

/**
 * POST /api/purchase-orders
 * Create a new purchase order in Zoho Inventory.
 * Body: { vendor_id, date, line_items: [{ item_id, quantity, rate }] }
 */
router.post('/api/purchase-orders', function (req, res) {
  inventoryPost('/purchaseorders', req.body)
    .then(function (data) { res.json(data); })
    .catch(function (err) {
      log.error('[api/purchase-orders POST] ' + err.message);
      res.status(502).json({ error: 'Unable to create purchase order' });
    });
});

/**
 * PUT /api/purchase-orders/:id
 * Update a purchase order in Zoho Inventory (e.g. add/change line items).
 * Body: { vendor_id, line_items: [{ item_id, quantity, rate }] }
 */
router.put('/api/purchase-orders/:id', function (req, res) {
  inventoryPut('/purchaseorders/' + req.params.id, req.body)
    .then(function (data) { res.json(data); })
    .catch(function (err) {
      log.error('[api/purchase-orders/:id PUT] ' + err.message);
      res.status(502).json({ error: 'Unable to update purchase order' });
    });
});

module.exports = router;
