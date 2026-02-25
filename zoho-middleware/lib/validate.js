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
 * @param {number} [options.maxItems=50]   Maximum number of line items
 * @param {number} [options.maxQty=9999]   Maximum quantity per item
 * @param {number} [options.maxRate=100000] Maximum rate per item
 */
function validateLineItems(items, options) {
  options = options || {};
  var maxItems = options.maxItems || 50;
  var maxQty   = options.maxQty   || 9999;
  var maxRate  = options.maxRate  || 100000;

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
    if (!isFinite(qty) || qty < 1 || qty > maxQty || Math.floor(qty) !== qty) {
      return 'Invalid quantity for line item ' + i + ' (must be a whole number between 1 and ' + maxQty + ')';
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

module.exports = {
  validateLineItems: validateLineItems,
  classifyZohoError: classifyZohoError
};
