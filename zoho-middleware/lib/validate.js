/**
 * Shared input validation helpers for Zoho line-item payloads.
 * Used by checkout.js, pos.js, and purchaseorders.js.
 */

/**
 * Validate an array of line items.
 * Returns an error string if invalid, or null if valid.
 *
 * @param {Array} items
 * @param {object} [options]
 * @param {number}  [options.maxItems=50]      Maximum number of line items
 * @param {number}  [options.maxQty=9999]      Maximum quantity per item
 * @param {number}  [options.maxRate=100000]    Maximum rate per item
 * @param {boolean} [options.allowDecimal=false] Allow decimal quantities (e.g. weight-based items)
 */
function validateLineItems(items, options) {
  options = options || {};
  var maxItems     = options.maxItems || 50;
  var maxQty       = options.maxQty   || 9999;
  var maxRate      = options.maxRate  || 100000;
  var allowDecimal = !!options.allowDecimal;
  var minQty       = allowDecimal ? 0.001 : 1;

  if (!Array.isArray(items) || items.length === 0) {
    return 'line_items must be a non-empty array';
  }
  if (items.length > maxItems) {
    return 'Too many line items (max ' + maxItems + ')';
  }
  for (var i = 0; i < items.length; i++) {
    var item = items[i];
    if (!item.item_id || typeof item.item_id !== 'string' || item.item_id.trim() === '') {
      return 'Missing or invalid item_id for line item ' + i;
    }
    var qty = Number(item.quantity);
    if (allowDecimal) {
      if (!isFinite(qty) || qty < minQty || qty > maxQty) {
        return 'Invalid quantity for line item ' + i + ' (must be between ' + minQty + ' and ' + maxQty + ')';
      }
    } else {
      if (!isFinite(qty) || qty < minQty || qty > maxQty || Math.floor(qty) !== qty) {
        return 'Invalid quantity for line item ' + i + ' (must be a whole number between 1 and ' + maxQty + ')';
      }
    }
    var rate = Number(item.rate);
    if (!isFinite(rate) || rate < 0 || rate > maxRate) {
      return 'Invalid rate for line item ' + i + ' (must be between 0 and ' + maxRate + ')';
    }
  }
  return null;
}

/**
 * Classify a caught Axios error from a Zoho API call.
 * Returns { status, message } suitable for passing to res.status().json().
 *
 * 400-level Zoho errors (validation, bad field values) are relayed with their
 * message so the client can show a useful error to the user.
 * 5xx / network errors become generic 502s to avoid leaking internal detail.
 */
function classifyZohoError(err, fallbackMessage) {
  var status = 502;
  var message = fallbackMessage || 'An unexpected error occurred';
  if (err.response && err.response.data) {
    var zohoMsg = err.response.data.message || err.response.data.error;
    if (err.response.status >= 400 && err.response.status < 500) {
      status = 400;
      message = zohoMsg || message;
    }
  }
  return { status: status, message: message };
}

/**
 * Validate and whitelist a request body against a schema.
 *
 * Schema shape:
 *   {
 *     allowed:  string[]            — fields permitted in the output; others are stripped
 *     required: string[]            — fields that must be present and non-empty
 *     types:    { [field]: string } — 'string' | 'number' | 'boolean' type check
 *   }
 *
 * Returns { error: string|null, clean: object }
 *   error === null means valid; caller should use clean (unknown fields stripped).
 *   error is a human-readable rejection reason (returns 400 to the client).
 *
 * Does NOT modify validateLineItems or classifyZohoError.
 *
 * @param {*}      body    — raw req.body (may be any type)
 * @param {object} schema
 * @returns {{ error: string|null, clean: object }}
 */
function validateBody(body, schema) {
  schema = schema || {};
  var allowed  = schema.allowed  || [];
  var required = schema.required || [];
  var types    = schema.types    || {};

  // Must be a plain object (not null, array, string, etc.)
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'Request body must be a JSON object', clean: {} };
  }

  // Check required fields are present and non-empty
  for (var r = 0; r < required.length; r++) {
    var reqField = required[r];
    var reqVal = body[reqField];
    if (reqVal === undefined || reqVal === null || reqVal === '') {
      return { error: 'Missing required field: ' + reqField, clean: {} };
    }
  }

  // Build clean object from allowed fields only (strips unknown keys — D-08 no field smuggling)
  var clean = {};
  for (var a = 0; a < allowed.length; a++) {
    var field = allowed[a];
    if (body[field] !== undefined) {
      clean[field] = body[field];
    }
  }

  // Type-check fields that are present in clean
  var typeFields = Object.keys(types);
  for (var t = 0; t < typeFields.length; t++) {
    var tf = typeFields[t];
    if (clean[tf] !== undefined) {
      var expectedType = types[tf];
      if (typeof clean[tf] !== expectedType) {
        return { error: 'Invalid type for field: ' + tf + ' (expected ' + expectedType + ')', clean: {} };
      }
    }
  }

  return { error: null, clean: clean };
}

module.exports = {
  validateLineItems: validateLineItems,
  classifyZohoError: classifyZohoError,
  validateBody: validateBody
};
