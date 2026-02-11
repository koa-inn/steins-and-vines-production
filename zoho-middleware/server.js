require('dotenv').config();

var express = require('express');
var cors = require('cors');
var axios = require('axios');
var zohoAuth = require('./lib/zohoAuth');
var cache = require('./lib/cache');

var app = express();
var PORT = process.env.PORT || 3001;

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

app.use(express.json());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true
}));

// ---------------------------------------------------------------------------
// Auth routes
// ---------------------------------------------------------------------------

/**
 * GET /auth/zoho
 * Redirects the user to Zoho's OAuth consent screen.
 */
app.get('/auth/zoho', function (req, res) {
  res.redirect(zohoAuth.getAuthorizationUrl());
});

/**
 * GET /auth/zoho/callback
 * Zoho redirects here with ?code=... after the user grants access.
 */
app.get('/auth/zoho/callback', function (req, res) {
  var code = req.query.code;
  if (!code) {
    return res.status(400).json({ error: 'Missing authorization code' });
  }

  zohoAuth.exchangeCode(code)
    .then(function () {
      // In production, redirect to the frontend dashboard instead
      res.json({ ok: true, message: 'Zoho authentication successful' });
    })
    .catch(function (err) {
      console.error('[callback] Token exchange failed:', err.message);
      res.status(500).json({ error: 'Token exchange failed: ' + err.message });
    });
});

/**
 * GET /auth/status
 * Quick check: is the server currently authenticated with Zoho?
 */
app.get('/auth/status', function (req, res) {
  res.json({ authenticated: zohoAuth.isAuthenticated() });
});

// ---------------------------------------------------------------------------
// Auth guard — protects all /api/* routes below
// ---------------------------------------------------------------------------

app.use('/api', function (req, res, next) {
  if (!zohoAuth.isAuthenticated()) {
    return res.status(401).json({ error: 'Not authenticated. Visit /auth/zoho to connect.' });
  }
  next();
});

// ---------------------------------------------------------------------------
// Zoho Books API proxy helpers
// ---------------------------------------------------------------------------

var API_URLS = {
  '.com':    'https://www.zohoapis.com',
  '.eu':     'https://www.zohoapis.eu',
  '.in':     'https://www.zohoapis.in',
  '.com.au': 'https://www.zohoapis.com.au',
  '.ca':     'https://www.zohoapis.ca',
  '.jp':     'https://www.zohoapis.jp',
  '.sa':     'https://www.zohoapis.sa'
};

var apiDomain = process.env.ZOHO_DOMAIN || '.com';
var ZOHO_API_BASE = (API_URLS[apiDomain] || ('https://www.zohoapis' + apiDomain)) + '/books/v3';

/**
 * Proxy a GET request to the Zoho Books API.
 * Automatically attaches the current access token and organization_id.
 */
function zohoGet(path, params) {
  return zohoAuth.getAccessToken().then(function (token) {
    var query = Object.assign({ organization_id: process.env.ZOHO_ORG_ID }, params || {});
    return axios.get(ZOHO_API_BASE + path, {
      headers: { Authorization: 'Zoho-oauthtoken ' + token },
      params: query
    }).then(function (response) {
      return response.data;
    });
  });
}

/**
 * Proxy a POST request to the Zoho Books API.
 * Automatically attaches the current access token and organization_id.
 */
function zohoPost(path, body) {
  return zohoAuth.getAccessToken().then(function (token) {
    return axios.post(ZOHO_API_BASE + path, body, {
      headers: { Authorization: 'Zoho-oauthtoken ' + token },
      params: { organization_id: process.env.ZOHO_ORG_ID }
    }).then(function (response) {
      return response.data;
    });
  });
}

// ---------------------------------------------------------------------------
// Zoho Bookings API helpers
// ---------------------------------------------------------------------------

var BOOKINGS_API_BASE = (API_URLS[apiDomain] || ('https://www.zohoapis' + apiDomain)) + '/bookings/v1/json';

/**
 * Proxy a GET request to the Zoho Bookings API.
 * Bookings API does not require organization_id.
 */
function bookingsGet(path, params) {
  return zohoAuth.getAccessToken().then(function (token) {
    return axios.get(BOOKINGS_API_BASE + path, {
      headers: { Authorization: 'Zoho-oauthtoken ' + token },
      params: params || {}
    }).then(function (response) {
      return response.data;
    });
  });
}

/**
 * Proxy a POST request to the Zoho Bookings API.
 * Bookings API does not require organization_id.
 */
function bookingsPost(path, body) {
  return zohoAuth.getAccessToken().then(function (token) {
    return axios.post(BOOKINGS_API_BASE + path, body, {
      headers: { Authorization: 'Zoho-oauthtoken ' + token }
    }).then(function (response) {
      return response.data;
    });
  });
}

/**
 * Convert 12-hour time string to 24-hour format.
 * "10:00 AM" → "10:00:00", "2:30 PM" → "14:30:00"
 */
function normalizeTimeTo24h(timeStr) {
  var match = timeStr.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return timeStr; // already 24h or unrecognized
  var h = parseInt(match[1], 10);
  var m = match[2];
  var period = match[3].toUpperCase();
  if (period === 'PM' && h !== 12) h += 12;
  if (period === 'AM' && h === 12) h = 0;
  return String(h).padStart(2, '0') + ':' + m + ':00';
}

// ---------------------------------------------------------------------------
// API routes — Bookings
// ---------------------------------------------------------------------------

var AVAILABILITY_CACHE_PREFIX = 'zoho:availability:';
var AVAILABILITY_CACHE_TTL = 300; // 5 minutes

/**
 * GET /api/bookings/availability?year=YYYY&month=MM
 * Returns which dates in a month have available slots.
 * Cached in Redis for 5 minutes.
 */
app.get('/api/bookings/availability', function (req, res) {
  var year = req.query.year;
  var month = req.query.month;

  if (!year || !month) {
    return res.status(400).json({ error: 'Missing year or month query parameter' });
  }

  month = String(month).padStart(2, '0');
  var cacheKey = AVAILABILITY_CACHE_PREFIX + year + '-' + month;

  cache.get(cacheKey)
    .then(function (cached) {
      if (cached) {
        console.log('[api/bookings/availability] Cache hit for ' + year + '-' + month);
        return res.json({ source: 'cache', dates: cached });
      }

      console.log('[api/bookings/availability] Cache miss — fetching from Zoho');

      // Calculate all dates in the month
      var daysInMonth = new Date(parseInt(year, 10), parseInt(month, 10), 0).getDate();
      var datePromises = [];

      for (var d = 1; d <= daysInMonth; d++) {
        var dateStr = year + '-' + month + '-' + String(d).padStart(2, '0');
        datePromises.push(
          (function (ds) {
            return bookingsGet('/availableslots', {
              service_id: process.env.ZOHO_BOOKINGS_SERVICE_ID,
              staff_id: process.env.ZOHO_BOOKINGS_STAFF_ID,
              selected_date: ds
            }).then(function (data) {
              var slots = (data.response && data.response.returnvalue &&
                data.response.returnvalue.data) || [];
              return { date: ds, available: slots.length > 0, slots_count: slots.length };
            }).catch(function () {
              return { date: ds, available: false, slots_count: 0 };
            });
          })(dateStr)
        );
      }

      return Promise.all(datePromises).then(function (results) {
        var dates = results.filter(function (r) { return r.available; });

        cache.set(cacheKey, dates, AVAILABILITY_CACHE_TTL);

        res.json({ source: 'zoho', dates: dates });
      });
    })
    .catch(function (err) {
      console.error('[api/bookings/availability]', err.message);
      res.status(502).json({ error: err.message });
    });
});

/**
 * GET /api/bookings/slots?date=YYYY-MM-DD
 * Fetch available time slots for a specific date.
 */
app.get('/api/bookings/slots', function (req, res) {
  var date = req.query.date;
  if (!date) {
    return res.status(400).json({ error: 'Missing date query parameter' });
  }

  bookingsGet('/availableslots', {
    service_id: process.env.ZOHO_BOOKINGS_SERVICE_ID,
    staff_id: process.env.ZOHO_BOOKINGS_STAFF_ID,
    selected_date: date
  })
    .then(function (data) {
      var slots = (data.response && data.response.returnvalue &&
        data.response.returnvalue.data) || [];
      res.json({ date: date, slots: slots });
    })
    .catch(function (err) {
      console.error('[api/bookings/slots]', err.message);
      res.status(502).json({ error: err.message });
    });
});

/**
 * POST /api/bookings
 * Create an appointment in Zoho Bookings.
 *
 * Expected body:
 * {
 *   date: "YYYY-MM-DD",
 *   time: "10:00 AM",
 *   customer: { name: "...", email: "...", phone: "..." },
 *   notes: "optional"
 * }
 */
app.post('/api/bookings', function (req, res) {
  var body = req.body;

  if (!body || !body.date || !body.time) {
    return res.status(400).json({ error: 'Missing date or time' });
  }
  if (!body.customer || !body.customer.name || !body.customer.email) {
    return res.status(400).json({ error: 'Missing customer name or email' });
  }

  var time24 = normalizeTimeTo24h(body.time);

  var bookingPayload = {
    service_id: process.env.ZOHO_BOOKINGS_SERVICE_ID,
    staff_id: process.env.ZOHO_BOOKINGS_STAFF_ID,
    from_time: body.date + ' ' + time24,
    customer_details: {
      name: body.customer.name,
      email: body.customer.email,
      phone_number: body.customer.phone || ''
    },
    additional_fields: {
      notes: body.notes || ''
    }
  };

  bookingsPost('/appointment', bookingPayload)
    .then(function (data) {
      var appointment = (data.response && data.response.returnvalue) || {};

      // Invalidate availability cache for this month
      var ym = body.date.substring(0, 7).split('-');
      cache.del(AVAILABILITY_CACHE_PREFIX + ym[0] + '-' + ym[1]);

      res.status(201).json({
        ok: true,
        booking_id: appointment.booking_id || null,
        timeslot: body.date + ' ' + body.time
      });
    })
    .catch(function (err) {
      var message = err.message;
      if (err.response && err.response.data) {
        message = err.response.data.message || err.response.data.error || message;
      }
      console.error('[api/bookings POST]', message);
      res.status(502).json({ error: message });
    });
});

/**
 * POST /api/contacts
 * Find an existing Zoho Books contact by email, or create a new one.
 *
 * Expected body:
 * { name: "...", email: "...", phone: "..." }
 *
 * Returns: { contact_id: "..." }
 */
app.post('/api/contacts', function (req, res) {
  var body = req.body;
  if (!body || !body.email) {
    return res.status(400).json({ error: 'Missing email' });
  }

  // Search for existing contact by email
  zohoGet('/contacts', { email: body.email })
    .then(function (data) {
      var contacts = data.contacts || [];
      if (contacts.length > 0) {
        return res.json({ contact_id: contacts[0].contact_id, created: false });
      }

      // Not found — create new contact
      var contactPayload = {
        contact_name: body.name || body.email,
        contact_type: 'customer',
        email: body.email,
        phone: body.phone || ''
      };

      return zohoPost('/contacts', contactPayload)
        .then(function (createData) {
          var contact = createData.contact || {};
          res.status(201).json({ contact_id: contact.contact_id, created: true });
        });
    })
    .catch(function (err) {
      var message = err.message;
      if (err.response && err.response.data) {
        message = err.response.data.message || err.response.data.error || message;
      }
      console.error('[api/contacts POST]', message);
      res.status(502).json({ error: message });
    });
});

// ---------------------------------------------------------------------------
// API routes — Zoho Books
// ---------------------------------------------------------------------------

var PRODUCTS_CACHE_KEY = 'zoho:products';
var PRODUCTS_CACHE_TTL = 300; // 5 minutes in seconds

/**
 * GET /api/products
 * Returns active items from Zoho Inventory, cached in Redis for 5 minutes.
 */
app.get('/api/products', function (req, res) {
  cache.get(PRODUCTS_CACHE_KEY)
    .then(function (cached) {
      if (cached) {
        console.log('[api/products] Cache hit');
        return res.json({ source: 'cache', items: cached });
      }

      console.log('[api/products] Cache miss — fetching from Zoho');
      return zohoGet('/items', { status: 'active' })
        .then(function (data) {
          var items = data.items || [];

          // Store in Redis (fire-and-forget — don't block the response)
          cache.set(PRODUCTS_CACHE_KEY, items, PRODUCTS_CACHE_TTL);

          res.json({ source: 'zoho', items: items });
        });
    })
    .catch(function (err) {
      console.error('[api/products]', err.message);
      res.status(502).json({ error: err.message });
    });
});

/**
 * GET /api/items
 * Fetch inventory items from Zoho Books (uncached, all statuses).
 */
app.get('/api/items', function (req, res) {
  zohoGet('/items')
    .then(function (data) { res.json(data); })
    .catch(function (err) {
      console.error('[api/items]', err.message);
      res.status(502).json({ error: err.message });
    });
});

/**
 * POST /api/items
 * Create a new item in Zoho Books/Inventory.
 */
app.post('/api/items', function (req, res) {
  zohoPost('/items', req.body)
    .then(function (data) { res.status(201).json(data); })
    .catch(function (err) {
      var msg = err.message;
      if (err.response && err.response.data) {
        msg = err.response.data.message || err.response.data.error || msg;
      }
      console.error('[api/items POST]', msg);
      res.status(err.response && err.response.status || 502).json({ error: msg });
    });
});

/**
 * GET /api/contacts
 * Fetch contacts (customers/vendors) from Zoho Books.
 */
app.get('/api/contacts', function (req, res) {
  zohoGet('/contacts')
    .then(function (data) { res.json(data); })
    .catch(function (err) {
      console.error('[api/contacts]', err.message);
      res.status(502).json({ error: err.message });
    });
});

/**
 * GET /api/invoices
 * Fetch invoices from Zoho Books.
 */
app.get('/api/invoices', function (req, res) {
  zohoGet('/invoices')
    .then(function (data) { res.json(data); })
    .catch(function (err) {
      console.error('[api/invoices]', err.message);
      res.status(502).json({ error: err.message });
    });
});

/**
 * POST /api/checkout
 * Accepts a cart payload, formats it as a Zoho Books Sales Order, and creates
 * it via the API. Invalidates the products cache so stock counts refresh.
 *
 * Expected request body:
 * {
 *   customer_id: "zoho_contact_id",
 *   items: [
 *     { item_id: "zoho_item_id", name: "Product Name", quantity: 2, rate: 14.99 }
 *   ],
 *   notes: "optional order notes"
 * }
 */
app.post('/api/checkout', function (req, res) {
  var body = req.body;

  // --- Validate required fields ---
  if (!body || !body.customer_id) {
    return res.status(400).json({ error: 'Missing customer_id' });
  }
  if (!Array.isArray(body.items) || body.items.length === 0) {
    return res.status(400).json({ error: 'Cart is empty' });
  }

  // --- Build Zoho Sales Order payload ---
  var lineItems = body.items.map(function (item) {
    return {
      item_id: item.item_id,
      name: item.name || '',
      quantity: Number(item.quantity) || 1,
      rate: Number(item.rate) || 0
    };
  });

  var salesOrder = {
    customer_id: body.customer_id,
    date: new Date().toISOString().slice(0, 10),  // YYYY-MM-DD
    line_items: lineItems,
    notes: body.notes || '',
    custom_fields: []
  };

  // Appointment custom fields (from Zoho Bookings integration)
  if (body.appointment_id) {
    salesOrder.custom_fields.push({
      api_name: process.env.ZOHO_CF_APPOINTMENT_ID || 'cf_appointment_id',
      value: body.appointment_id
    });
  }
  if (body.timeslot) {
    salesOrder.custom_fields.push({
      api_name: process.env.ZOHO_CF_TIMESLOT || 'cf_appointment_timeslot',
      value: body.timeslot
    });
  }
  salesOrder.custom_fields.push({
    api_name: process.env.ZOHO_CF_STATUS || 'cf_reservation_status',
    value: body.appointment_id ? 'Pending' : 'Walk-in'
  });

  zohoPost('/salesorders', salesOrder)
    .then(function (data) {
      // Invalidate product cache so stock counts refresh on next fetch
      cache.del(PRODUCTS_CACHE_KEY);

      res.status(201).json({
        ok: true,
        salesorder_id: data.salesorder ? data.salesorder.salesorder_id : null,
        salesorder_number: data.salesorder ? data.salesorder.salesorder_number : null
      });
    })
    .catch(function (err) {
      var status = 502;
      var message = err.message;

      // Surface Zoho-specific errors (e.g. "Out of Stock", validation)
      if (err.response && err.response.data) {
        message = err.response.data.message || err.response.data.error || message;
        // 400-level from Zoho → relay as 400 to the client
        if (err.response.status >= 400 && err.response.status < 500) {
          status = 400;
        }
      }

      console.error('[api/checkout]', message);
      res.status(status).json({ error: message });
    });
});

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------

app.get('/health', function (req, res) {
  res.json({
    status: 'ok',
    authenticated: zohoAuth.isAuthenticated(),
    uptime: process.uptime()
  });
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

// Connect Redis, then start listening
cache.init().then(function () {
  app.listen(PORT, function () {
    console.log('');
    console.log('  Zoho middleware running on http://localhost:' + PORT);
    console.log('  Health check:   http://localhost:' + PORT + '/health');
    console.log('  Connect Zoho:   http://localhost:' + PORT + '/auth/zoho');
    console.log('');
  });
});
