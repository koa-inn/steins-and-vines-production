require('dotenv').config();

var express = require('express');
var cors = require('cors');
var zohoAuth = require('./lib/zohoAuth');

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

var https = require('https');

function zohoApiBase() {
  return 'https://www.zohoapis' + (process.env.ZOHO_DOMAIN || '.com');
}

/**
 * Proxy a GET request to the Zoho Books API.
 * Automatically attaches the current access token and organization_id.
 */
function zohoGet(path) {
  return zohoAuth.getAccessToken().then(function (token) {
    var separator = path.indexOf('?') === -1 ? '?' : '&';
    var url = zohoApiBase() + '/books/v3' + path + separator + 'organization_id=' + process.env.ZOHO_ORG_ID;

    return new Promise(function (resolve, reject) {
      var parsed = new URL(url);
      var options = {
        hostname: parsed.hostname,
        path: parsed.pathname + parsed.search,
        method: 'GET',
        headers: {
          Authorization: 'Zoho-oauthtoken ' + token
        }
      };

      var req = https.request(options, function (res) {
        var chunks = [];
        res.on('data', function (c) { chunks.push(c); });
        res.on('end', function () {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString()));
          } catch (e) {
            reject(new Error('Failed to parse Zoho response'));
          }
        });
      });
      req.on('error', reject);
      req.end();
    });
  });
}

// ---------------------------------------------------------------------------
// Example API routes — expand these as you build out the integration
// ---------------------------------------------------------------------------

/**
 * GET /api/items
 * Fetch inventory items from Zoho Books.
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

app.listen(PORT, function () {
  console.log('');
  console.log('  Zoho middleware running on http://localhost:' + PORT);
  console.log('  Health check:   http://localhost:' + PORT + '/health');
  console.log('  Connect Zoho:   http://localhost:' + PORT + '/auth/zoho');
  console.log('');
});
