var express = require('express');
var zohoApi = require('../lib/zoho-api');
var validate = require('../lib/validate');
var log = require('../lib/logger');

var inventoryGet = zohoApi.inventoryGet;
var inventoryPost = zohoApi.inventoryPost;
var inventoryPut = zohoApi.inventoryPut;

var validateLineItems = validate.validateLineItems;
var classifyZohoError = validate.classifyZohoError;

var router = express.Router();

var ALLOWED_PO_STATUSES = ['open', 'draft', 'billed', 'closed', 'cancelled', 'void'];

function isValidId(id) {
  return /^\d+$/.test(String(id));
}

/**
 * GET /api/purchase-orders
 * List purchase orders from Zoho Inventory.
 * ?status=open (default) | draft | billed | closed | cancelled | void | all
 */
router.get('/api/purchase-orders', function (req, res) {
  var status = req.query.status || 'open';
  if (status !== 'all' && ALLOWED_PO_STATUSES.indexOf(status) === -1) {
    return res.status(400).json({ error: 'Invalid status. Allowed: ' + ALLOWED_PO_STATUSES.join(', ') + ', all' });
  }
  var params = {};
  if (status !== 'all') params.status = status;
  inventoryGet('/purchaseorders', params)
    .then(function (data) { res.json(data); })
    .catch(function (err) {
      log.error('[api/purchase-orders GET] ' + err.message);
      var e = classifyZohoError(err, 'Unable to fetch purchase orders');
      res.status(e.status).json({ error: e.message });
    });
});

/**
 * GET /api/purchase-orders/:id
 * Get a single purchase order from Zoho Inventory.
 */
router.get('/api/purchase-orders/:id', function (req, res) {
  if (!isValidId(req.params.id)) {
    return res.status(400).json({ error: 'Invalid purchase order ID' });
  }
  inventoryGet('/purchaseorders/' + req.params.id)
    .then(function (data) { res.json(data); })
    .catch(function (err) {
      log.error('[api/purchase-orders/:id GET] ' + err.message);
      var e = classifyZohoError(err, 'Unable to fetch purchase order');
      res.status(e.status).json({ error: e.message });
    });
});

/**
 * POST /api/purchase-orders
 * Create a new purchase order in Zoho Inventory.
 * Body: { vendor_id, date, line_items: [{ item_id, quantity, rate }] }
 */
router.post('/api/purchase-orders', function (req, res) {
  var body = req.body || {};

  if (!body.vendor_id || typeof body.vendor_id !== 'string' || body.vendor_id.trim() === '') {
    return res.status(400).json({ error: 'Missing or invalid vendor_id' });
  }
  var lineItemError = validateLineItems(body.line_items);
  if (lineItemError) {
    return res.status(400).json({ error: lineItemError });
  }

  var payload = {
    vendor_id: body.vendor_id.trim(),
    date: body.date || new Date().toISOString().slice(0, 10),
    line_items: body.line_items.map(function (li) {
      return {
        item_id: li.item_id,
        quantity: Number(li.quantity),
        rate: Number(li.rate) || 0
      };
    })
  };
  if (body.notes) payload.notes = String(body.notes).slice(0, 500);

  inventoryPost('/purchaseorders', payload)
    .then(function (data) { res.status(201).json(data); })
    .catch(function (err) {
      log.error('[api/purchase-orders POST] ' + err.message);
      var e = classifyZohoError(err, 'Unable to create purchase order');
      res.status(e.status).json({ error: e.message });
    });
});

/**
 * PUT /api/purchase-orders/:id
 * Replace a purchase order's line items in Zoho Inventory.
 * Body: { vendor_id, line_items: [{ item_id, quantity, rate }] }
 */
router.put('/api/purchase-orders/:id', function (req, res) {
  if (!isValidId(req.params.id)) {
    return res.status(400).json({ error: 'Invalid purchase order ID' });
  }
  var body = req.body || {};
  if (!body.vendor_id || typeof body.vendor_id !== 'string' || body.vendor_id.trim() === '') {
    return res.status(400).json({ error: 'Missing or invalid vendor_id' });
  }
  var lineItemError = validateLineItems(body.line_items);
  if (lineItemError) {
    return res.status(400).json({ error: lineItemError });
  }

  var payload = {
    vendor_id: body.vendor_id.trim(),
    line_items: body.line_items.map(function (li) {
      return {
        item_id: li.item_id,
        quantity: Number(li.quantity),
        rate: Number(li.rate) || 0
      };
    })
  };
  if (body.date) payload.date = body.date;
  if (body.notes) payload.notes = String(body.notes).slice(0, 500);

  inventoryPut('/purchaseorders/' + req.params.id, payload)
    .then(function (data) { res.json(data); })
    .catch(function (err) {
      log.error('[api/purchase-orders/:id PUT] ' + err.message);
      var e = classifyZohoError(err, 'Unable to update purchase order');
      res.status(e.status).json({ error: e.message });
    });
});

/**
 * POST /api/purchase-orders/:id/add-item
 * Atomically add or increment a single line item on an existing PO.
 * Performs the GET → merge → PUT on the server to avoid client-side races.
 * Body: { item_id, quantity, rate }
 */
router.post('/api/purchase-orders/:id/add-item', function (req, res) {
  if (!isValidId(req.params.id)) {
    return res.status(400).json({ error: 'Invalid purchase order ID' });
  }
  var body = req.body || {};
  if (!body.item_id || typeof body.item_id !== 'string' || body.item_id.trim() === '') {
    return res.status(400).json({ error: 'Missing or invalid item_id' });
  }
  var qty = Number(body.quantity);
  if (!isFinite(qty) || qty < 1 || qty > 9999 || Math.floor(qty) !== qty) {
    return res.status(400).json({ error: 'Invalid quantity (must be a whole number between 1 and 9999)' });
  }
  var rate = Number(body.rate);
  if (!isFinite(rate) || rate < 0 || rate > 100000) {
    return res.status(400).json({ error: 'Invalid rate' });
  }

  var poId = req.params.id;
  var itemId = body.item_id.trim();

  inventoryGet('/purchaseorders/' + poId)
    .then(function (data) {
      var po = data.purchaseorder;
      if (!po) throw new Error('Purchase order not found');

      var lineItems = (po.line_items || []).map(function (li) {
        return { item_id: li.item_id, quantity: li.quantity, rate: li.rate };
      });

      var existing = lineItems.find(function (li) { return li.item_id === itemId; });
      if (existing) {
        existing.quantity = existing.quantity + qty;
      } else {
        lineItems.push({ item_id: itemId, quantity: qty, rate: rate });
      }

      return inventoryPut('/purchaseorders/' + poId, {
        vendor_id: po.vendor_id,
        date: po.date,
        line_items: lineItems
      });
    })
    .then(function (data) { res.json(data); })
    .catch(function (err) {
      log.error('[api/purchase-orders/:id/add-item] ' + err.message);
      var e = classifyZohoError(err, 'Unable to add item to purchase order');
      res.status(e.status).json({ error: e.message });
    });
});

module.exports = router;
