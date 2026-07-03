var express = require('express');
var axios = require('axios');
var zohoApi = require('../lib/zoho-api');
var zohoAuth = require('../lib/zohoAuth');
var log = require('../lib/logger');
var validate = require('../lib/validate');

var zohoGet = zohoApi.zohoGet;
var zohoPost = zohoApi.zohoPost;
var inventoryGet = zohoApi.inventoryGet;
var inventoryPut = zohoApi.inventoryPut;
var ZOHO_INVENTORY_BASE = zohoApi.ZOHO_INVENTORY_BASE;
var validateBody = validate.validateBody;

// Standard Zoho Books item fields allowed in create/update payloads (D-08 whitelist).
// Unknown fields are stripped silently before forwarding to Zoho (no field smuggling).
var ITEM_ALLOWED_FIELDS = [
  'name', 'sku', 'rate', 'purchase_rate', 'description', 'unit',
  'product_type', 'item_type', 'category_name', 'category_id',
  'sales_tax_rule_id', 'tax_id', 'status',
  // Custom fields used by this org
  'cf_type', 'cf_subcategory', 'cf_subcategory_1', 'cf_vendor',
  'cf_brand', 'cf_manufacturer', 'cf_origin', 'cf_vintage',
  'cf_region', 'cf_country', 'cf_grapes', 'cf_weight', 'cf_unit',
  'cf_color', 'cf_style', 'cf_abv', 'cf_ibu', 'cf_srm', 'cf_og',
  'cf_fg', 'cf_milling_fee', 'cf_tag', 'cf_notes'
];

var ITEM_FIELD_TYPES = {
  rate: 'number',
  purchase_rate: 'number'
};

var ITEM_CREATE_SCHEMA = {
  allowed: ITEM_ALLOWED_FIELDS,
  required: ['name'],
  types: ITEM_FIELD_TYPES
};

var ITEM_UPDATE_SCHEMA = {
  allowed: ITEM_ALLOWED_FIELDS,
  required: [],
  types: ITEM_FIELD_TYPES
};

var router = express.Router();

// Local numeric-id guard (M20) — mirrors purchaseorders.js:17-19. Kept as a
// local copy rather than extracted to a shared lib per CLAUDE rule 2 (simplest
// change); this is the 2nd copy of the same idiom — a lib/validate.js home
// would prevent drift if a 3rd copy is ever needed (follow-up, not in scope).
function isValidId(id) {
  return /^\d+$/.test(String(id));
}

/**
 * GET /api/items
 * Fetch inventory items from Zoho Books (uncached, all statuses).
 */
router.get('/api/items', function (req, res) {
  zohoGet('/items')
    .then(function (data) { res.json(data); })
    .catch(function (err) {
      log.error('[api/items] ' + err.message);
      res.status(502).json({ error: 'Unable to fetch items' });
    });
});

/**
 * POST /api/items
 * Create a new item in Zoho Books/Inventory.
 * Body-shape validated before forwarding to Zoho (PII-02 / D-08).
 */
router.post('/api/items', function (req, res) {
  var result = validateBody(req.body, ITEM_CREATE_SCHEMA);
  if (result.error) {
    return res.status(400).json({ error: result.error });
  }
  zohoPost('/items', result.clean)
    .then(function (data) { res.status(201).json(data); })
    .catch(function (err) {
      var msg = err.message;
      if (err.response && err.response.data) {
        msg = err.response.data.message || err.response.data.error || msg;
      }
      log.error('[api/items POST] ' + msg);
      res.status(err.response && err.response.status || 502).json({ error: 'Unable to update item' });
    });
});

/**
 * GET /api/contacts
 * Fetch contacts (customers/vendors) from Zoho Books.
 */
router.get('/api/contacts', function (req, res) {
  var params = {};
  if (req.query.search) params.search_text = req.query.search;
  if (req.query.contact_name) params.contact_name = req.query.contact_name;
  if (req.query.email) params.email = req.query.email;
  zohoGet('/contacts', params)
    .then(function (data) { res.json(data); })
    .catch(function (err) {
      log.error('[api/contacts] ' + err.message);
      res.status(502).json({ error: 'Unable to fetch contacts' });
    });
});

/**
 * GET /api/invoices
 * Fetch invoices from Zoho Books.
 */
router.get('/api/invoices', function (req, res) {
  zohoGet('/invoices')
    .then(function (data) { res.json(data); })
    .catch(function (err) {
      log.error('[api/invoices] ' + err.message);
      res.status(502).json({ error: 'Unable to fetch invoices' });
    });
});

/**
 * GET /api/inventory/items/:id
 * Fetch a single item from Zoho Inventory (full detail).
 */
router.get('/api/inventory/items/:id', function (req, res) {
  if (!isValidId(req.params.id)) {
    return res.status(400).json({ error: 'Invalid item ID' });
  }
  inventoryGet('/items/' + req.params.id)
    .then(function (data) { res.json(data); })
    .catch(function (err) {
      log.error('[api/inventory/items GET] ' + err.message);
      res.status(502).json({ error: 'Unable to fetch item' });
    });
});

/**
 * PUT /api/inventory/items/:id
 * Update a single item in Zoho Inventory.
 * Body-shape validated before forwarding to Zoho (PII-02 / D-08).
 * Partial update — name is not required in body (id is in path).
 */
router.put('/api/inventory/items/:id', function (req, res) {
  var result = validateBody(req.body, ITEM_UPDATE_SCHEMA);
  if (result.error) {
    return res.status(400).json({ error: result.error });
  }
  inventoryPut('/items/' + req.params.id, result.clean)
    .then(function (data) { res.json(data); })
    .catch(function (err) {
      log.error('[api/inventory/items PUT] ' + err.message);
      res.status(502).json({ error: 'Unable to update item' });
    });
});

/**
 * GET /api/items/:item_id/image
 * Proxy the Zoho Inventory item image endpoint.
 * Returns the raw image binary with the correct Content-Type.
 * Returns 404 if the item has no image.
 */
router.get('/api/items/:item_id/image', function (req, res) {
  if (!isValidId(req.params.item_id)) {
    return res.status(400).json({ error: 'Invalid item ID' });
  }
  zohoAuth.getAccessToken()
    .then(function (token) {
      return axios.get(ZOHO_INVENTORY_BASE + '/items/' + req.params.item_id + '/image', {
        headers: { Authorization: 'Zoho-oauthtoken ' + token },
        params: { organization_id: process.env.ZOHO_ORG_ID },
        responseType: 'arraybuffer',
        validateStatus: function (status) { return status < 500; }
      });
    })
    .then(function (response) {
      if (response.status === 404 || !response.data || response.data.length === 0) {
        return res.status(404).json({ error: 'No image for this item' });
      }
      // Zoho may return a JSON error body even with 200 — detect by checking
      // if the Content-Type is application/json
      var contentType = response.headers['content-type'] || '';
      if (contentType.indexOf('application/json') !== -1) {
        // Zoho returned a JSON error (e.g. "no image uploaded")
        return res.status(404).json({ error: 'No image for this item' });
      }
      res.set('Content-Type', contentType || 'image/png');
      res.set('Content-Length', response.data.length);
      res.send(Buffer.from(response.data));
    })
    .catch(function (err) {
      log.error('[api/items/image] Error for item ' + req.params.item_id + ': ' + err.message);
      res.status(502).json({ error: 'Failed to fetch image' });
    });
});

module.exports = router;
