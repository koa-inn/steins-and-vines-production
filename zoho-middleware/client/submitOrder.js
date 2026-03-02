var API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:3001';

/**
 * Submit a cart as a Zoho Books Sales Order via the middleware.
 *
 * The server derives the Zoho contact ID from the email address — never
 * trust a client-supplied contact ID. Pass customer name, email, and phone
 * instead; the middleware will look up or create the Zoho contact.
 *
 * @param {Object} cartData
 * @param {Object} cartData.customer         — Customer information
 * @param {string} cartData.customer.email   — Customer email (required)
 * @param {string} [cartData.customer.name]  — Customer display name
 * @param {string} [cartData.customer.phone] — Customer phone number
 * @param {Array}  cartData.items            — Array of cart items, each with:
 *   @param {string} item.item_id   — Zoho item ID
 *   @param {string} item.name      — Product display name
 *   @param {number} item.quantity   — Quantity ordered
 *   @param {number} item.rate       — Unit price
 * @param {string} [cartData.notes]  — Optional order notes
 *
 * @returns {Promise<Object>} Resolves with { ok, salesorder_id, salesorder_number }
 */
function submitOrder(cartData) {
  // --- Client-side validation ---
  if (!cartData || !cartData.customer || !cartData.customer.email) {
    return Promise.reject(new Error('Missing customer email'));
  }
  if (!Array.isArray(cartData.items) || cartData.items.length === 0) {
    return Promise.reject(new Error('Cart is empty'));
  }

  // --- Build the payload ---
  var payload = {
    customer: {
      name:  cartData.customer.name  || cartData.customer.email,
      email: cartData.customer.email,
      phone: cartData.customer.phone || ''
    },
    items: cartData.items.map(function (item) {
      return {
        item_id: item.item_id,
        name: item.name || '',
        quantity: Number(item.quantity) || 1,
        rate: Number(item.rate) || 0
      };
    }),
    notes: cartData.notes || ''
  };

  return fetch(API_BASE + '/api/checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(payload)
  })
    .then(function (res) {
      return res.json().then(function (data) {
        if (!res.ok) {
          throw new Error(data.error || 'Order failed (HTTP ' + res.status + ')');
        }
        return data;
      });
    })
    .then(function (data) {
      // Success — clear the local cart and redirect
      localStorage.removeItem('sv-reservation');
      window.location.href = '/order-success.html?order=' +
        encodeURIComponent(data.salesorder_number || '');
      return data;
    })
    .catch(function (err) {
      // Display the error to the user via the toast system
      if (typeof showToast === 'function') {
        showToast(err.message, 'error');
      } else {
        alert(err.message);
      }
      throw err;
    });
}
