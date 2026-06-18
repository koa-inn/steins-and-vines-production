require('dotenv').config();

var validateEnv = require('./lib/validateEnv');
var checkRedis = require('./lib/checkRedis');
var checkMailer = require('./lib/checkMailer');
validateEnv();

var Sentry = require('@sentry/node');
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'production',
    tracesSampleRate: 0.1
  });
}

var express = require('express');
var cors = require('cors');
var crypto = require('crypto');
var rateLimit = require('express-rate-limit');
var helmet = require('helmet');
var zohoAuth = require('./lib/zohoAuth');
var cache = require('./lib/cache');
var log = require('./lib/logger');
var C = require('./lib/constants');
var helcimLib = require('./lib/helcim');
var cron = require('node-cron');
var brewpadIntegration = require('./lib/brewpad-integration');

var mailer = require('./lib/mailer');
var mailerlite = require('./lib/mailerlite');

var app = express();
app.set('trust proxy', 1); // Railway sits behind a load balancer
var PORT = process.env.PORT || 3001;

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

app.use(helmet());
app.use(express.json({
  limit: '1mb',
  verify: function (req, res, buf) { req.rawBody = buf; }
}));
// H3: CORS origin whitelist — only allow requests from known frontend origins
var allowedOrigins = [
  'https://steinsandvines.ca',
  'https://staging.steinsandvines.ca',
  'http://localhost:3001',
  'http://localhost:8080'
];
app.use(cors({
  origin: function(origin, callback) {
    // Allow requests with no origin (server-to-server, curl, etc.) and whitelisted origins
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('CORS: origin not allowed: ' + origin));
    }
  },
  credentials: true
}));

// H3: Referer check — key-authenticated routes must come from allowed origins
var allowedReferers = [
  'https://steinsandvines.ca',
  'https://staging.steinsandvines.ca',
  'http://localhost:3001',
  'http://localhost:8080'
];
function requireAllowedReferer(req, res, next) {
  // Skip for server-to-server calls (no Referer) and OPTIONS preflight
  if (req.method === 'OPTIONS' || !req.headers.referer) return next();
  // Checkout is protected by reCAPTCHA + rate limit instead of Referer check
  if (req.path === '/checkout') return next();
  var referer = req.headers.referer;
  var allowed = allowedReferers.some(function(origin) {
    return referer === origin || referer.startsWith(origin + '/');
  });
  if (!allowed) {
    log.warn('[referer-guard] Blocked: referer=' + referer + ' path=' + req.path);
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
}

// Request logging middleware (attaches reqId, logs method/path/status/ms)
app.use(function (req, res, next) {
  var reqId = crypto.randomBytes(4).toString('hex');
  req.id = reqId;
  var start = Date.now();
  res.on('finish', function () {
    log.info(req.method + ' ' + req.path, { reqId: reqId, status: res.statusCode, ms: Date.now() - start });
  });
  next();
});

// ---------------------------------------------------------------------------
// Health check (used by Railway)
// ---------------------------------------------------------------------------

app.get('/health', function (req, res) {
  var redisOk = cache.isConnected();
  var redisCheck = redisOk
    ? cache.getClient().then(function (c) {
        if (!c) return false;
        return c.ping().then(function (r) { return r === 'PONG'; }).catch(function () { return false; });
      }).catch(function () { return false; })
    : Promise.resolve(false);

  redisCheck.then(function (redisPong) {
    res.json({
      status: 'ok',
      authenticated: zohoAuth.isAuthenticated(),
      redis: redisPong,
      uptime: process.uptime()
    });
  });
});

// ---------------------------------------------------------------------------
// Auth routes (MUST be mounted BEFORE auth guard)
// /auth/zoho, /auth/zoho/callback, /auth/status, /api/payment/config
// ---------------------------------------------------------------------------

app.use('/', require('./routes/auth'));

var requestsLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  store: makeRedisStore(60 * 1000, 'requests'),
  skip: redisUnavailableSkip,
  message: { error: 'Too many requests, please try again later' }
});
app.post('/product-requests', requestsLimiter);
app.use('/', require('./routes/requests'));

// ---------------------------------------------------------------------------
// H4: Contact form email submission (public — no Zoho auth or API key needed)
// Railway env vars needed: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS (Gmail App Password), CONTACT_TO
// ---------------------------------------------------------------------------

var contactLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  store: makeRedisStore(60 * 1000, 'contact'),
  skip: redisUnavailableSkip,
  message: { error: 'Too many requests, please try again later' }
});

app.post('/api/contact', contactLimiter, async function(req, res) {
  var name = (req.body.name || '').trim().replace(/[\r\n]/g, ' ');
  var email = (req.body.email || '').trim();
  var message = (req.body.message || '').trim();

  // Validate
  if (!name) return res.status(400).json({ error: 'Name is required' });
  var emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) return res.status(400).json({ error: 'Valid email is required' });
  if (!message) return res.status(400).json({ error: 'Message is required' });

  try {
    // Sent via Resend (HTTPS) — Railway blocks outbound SMTP. name is already
    // CRLF-stripped above; mailer uses email as reply-to.
    await mailer.sendContactMessage({ name: name, email: email, message: message });
    res.json({ success: true });
  } catch (err) {
    console.error('[contact] Email send failed:', err.message);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

// Beer waitlist signup → adds the email to a MailerLite group (list-building,
// not transactional). Public like /api/contact (registered before the API-key
// gate) and rate-limited. Contact form + order emails still go via Resend.
var waitlistLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  store: makeRedisStore(60 * 1000, 'waitlist'),
  skip: redisUnavailableSkip,
  message: { error: 'Too many requests, please try again later' }
});

app.post('/api/waitlist', waitlistLimiter, async function (req, res) {
  var email = (req.body.email || '').trim();
  var emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) return res.status(400).json({ error: 'Valid email is required' });

  if (!mailerlite.isConfigured()) {
    console.error('[waitlist] MAILERLITE_API_KEY not set — cannot add subscriber');
    return res.status(503).json({ error: 'Waitlist is temporarily unavailable' });
  }

  try {
    var groupId = (process.env.MAILERLITE_WAITLIST_GROUP_ID || '').trim();
    await mailerlite.addSubscriber(email, groupId ? [groupId] : []);
    // Fire-and-forget staff heads-up — must not block or fail the signup.
    mailer.sendWaitlistNotification({ email: email })
      .catch(function (err) { console.error('[waitlist] staff notify failed:', err.message); });
    res.json({ success: true });
  } catch (err) {
    console.error('[waitlist] MailerLite subscribe failed:', err.message);
    res.status(500).json({ error: 'Could not join waitlist. Please try again.' });
  }
});

// ---------------------------------------------------------------------------
// Auth guard — protects all /api/* routes below
// ---------------------------------------------------------------------------

// POST routes that handle Zoho-unavailable gracefully (offline fallback mode).
// They are allowed through when Zoho is not authenticated; req.zohoOffline is
// set so each handler can switch to email-notification fallback.
var OFFLINE_CAPABLE_POSTS = ['/contacts', '/bookings', '/checkout'];

app.use('/api', function (req, res, next) {
  // Promo validate is Redis-only — never needs Zoho
  if (req.method === 'POST' && req.path === '/promo/validate') return next();
  if (!zohoAuth.isAuthenticated()) {
    if (req.method === 'POST' && OFFLINE_CAPABLE_POSTS.indexOf(req.path) !== -1) {
      req.zohoOffline = true;
      return next();
    }
    return res.status(401).json({ error: 'Not authenticated. Visit /auth/zoho to connect.' });
  }
  next();
});

// ---------------------------------------------------------------------------
// API key guard — protects mutating /api/* endpoints from unauthorized callers
// ---------------------------------------------------------------------------

var API_SECRET_KEY = process.env.API_SECRET_KEY || process.env.MW_API_KEY || '';

if (!API_SECRET_KEY) {
  log.warn('');
  log.warn('┌─────────────────────────────────────────────────────────┐');
  log.warn('│  SECURITY WARNING: API_SECRET_KEY is not set.           │');
  log.warn('│  All mutating /api/* endpoints (POST, PUT, DELETE) are  │');
  log.warn('│  BLOCKED until API_SECRET_KEY is configured.            │');
  log.warn('│  Set API_SECRET_KEY in your environment variables.      │');
  log.warn('└─────────────────────────────────────────────────────────┘');
  log.warn('');
}

// Constant-time API key comparison. A plain `===` on the secret is a timing
// oracle that leaks the key byte-by-byte via response-time measurement; this
// matters most for the PII GET guard below. Length is checked first (lengths
// are not secret) so timingSafeEqual always gets equal-length buffers.
function apiKeyMatches(sent) {
  if (!API_SECRET_KEY || typeof sent !== 'string') return false;
  var a = Buffer.from(sent);
  var b = Buffer.from(API_SECRET_KEY);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

app.use('/api', function (req, res, next) {
  if (req.method === 'GET') return next();
  // /api/checkout is public — protected by reCAPTCHA + rate limit instead of API key
  if (req.path === '/checkout') return next();
  // Promo validation is called from public checkout page without API key
  if (req.path === '/promo/validate') return next();
  // Webhooks are protected by HMAC signature verification, not API key
  if (req.path.indexOf('/webhooks/') === 0) return next();
  if (!API_SECRET_KEY) {
    return res.status(503).json({ error: 'Server not configured: API_SECRET_KEY is not set. Contact your administrator.' });
  }
  if (apiKeyMatches(req.headers['x-api-key'])) return next();
  var sent = req.headers['x-api-key'];
  log.warn('[api-key] Forbidden: method=' + req.method + ' path=' + req.path +
    ' header-present=' + (sent !== undefined) +
    ' header-length=' + (sent ? sent.length : 0) +
    ' expected-length=' + API_SECRET_KEY.length +
    ' origin=' + (req.headers.origin || 'none') +
    ' referer=' + (req.headers.referer || 'none'));
  res.status(403).json({ error: 'Forbidden' });
});

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

/**
 * Build a minimal express-rate-limit custom store backed by the existing Redis
 * client from lib/cache.js. Uses INCR + EXPIRE so the window auto-resets.
 * Falls back gracefully to a no-op (skip) when Redis is unavailable, which
 * allows the in-process MemoryStore (express-rate-limit default) to take over
 * per-instance — preserving at least single-instance protection.
 *
 * express-rate-limit v6+ store interface:
 *   increment(key) -> Promise<{ totalHits, resetTime }>
 *   decrement(key) -> Promise<void>
 *   resetKey(key)  -> Promise<void>
 */
function makeRedisStore(windowMs, prefix) {
  var windowSec = Math.ceil(windowMs / 1000);
  // Each limiter must use a unique prefix so they track separate counters per IP.
  // Without a prefix all limiters share 'rl:<ip>' and cross-contaminate each other.
  var keyPrefix = C.RATE_LIMIT_PREFIX + (prefix || 'default') + ':';

  return {
    increment: function (key) {
      if (!cache.isConnected()) {
        // Redis down — return a sentinel that signals "skip this store"
        return Promise.resolve({ totalHits: 0, resetTime: new Date(Date.now() + windowMs) });
      }
      var redisKey = keyPrefix + key;
      return cache.getClient().then(function (c) {
        if (!c) {
          return { totalHits: 0, resetTime: new Date(Date.now() + windowMs) };
        }
        // INCR is atomic; set expiry only on the first increment (NX flag)
        return c.incr(redisKey).then(function (hits) {
          if (hits === 1) {
            // First hit in this window — set expiry
            return c.expire(redisKey, windowSec).then(function () {
              return { totalHits: hits, resetTime: new Date(Date.now() + windowMs) };
            });
          }
          // Subsequent hits — check remaining TTL for accurate resetTime
          return c.ttl(redisKey).then(function (ttlSec) {
            var resetMs = ttlSec > 0 ? Date.now() + ttlSec * 1000 : Date.now() + windowMs;
            return { totalHits: hits, resetTime: new Date(resetMs) };
          });
        });
      }).catch(function () {
        return { totalHits: 0, resetTime: new Date(Date.now() + windowMs) };
      });
    },

    decrement: function (key) {
      if (!cache.isConnected()) return Promise.resolve();
      var redisKey = keyPrefix + key;
      return cache.getClient().then(function (c) {
        if (!c) return;
        return c.decr(redisKey);
      }).catch(function () {});
    },

    resetKey: function (key) {
      if (!cache.isConnected()) return Promise.resolve();
      return cache.del(keyPrefix + key);
    }
  };
}

// skip() returns true when Redis is down so express-rate-limit bypasses the
// Redis store entirely and falls back to its default MemoryStore behaviour.
// This means per-process limiting still applies when Redis is unavailable.
function redisUnavailableSkip() {
  return !cache.isConnected();
}

var apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  store: makeRedisStore(60 * 1000, 'api'),
  skip: redisUnavailableSkip,
  validate: { singleCount: false },
  message: { error: 'Too many requests, please try again later' }
});

var paymentLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  store: makeRedisStore(60 * 1000, 'payment'),
  skip: redisUnavailableSkip,
  validate: { singleCount: false },
  message: { error: 'Too many requests, please try again in a minute' }
});

var pinLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  store: makeRedisStore(60 * 1000, 'pin'),
  skip: redisUnavailableSkip,
  validate: { singleCount: false },
  message: { error: 'Too many PIN attempts, please try again in a minute' }
});

app.use('/api', apiLimiter);
app.use('/api', requireAllowedReferer);
app.use('/api/kiosk/verify-pin', pinLimiter);
app.use('/api/payment', paymentLimiter);
app.use('/api/checkout', paymentLimiter);
app.use('/api/pos/sale', paymentLimiter);
app.use('/api/kiosk/sale', function (req, res, next) {
  if (req.path === '/status') return next();
  paymentLimiter(req, res, next);
});
app.use('/api/pos/collect', paymentLimiter);
app.use('/api/kiosk/salesorder-pay', paymentLimiter);

// ---------------------------------------------------------------------------
// PII-01: Targeted API-key guard on exactly the 4 PII-exposing GET routes.
// These routes return customer/contact/invoice data — they must require the
// API key regardless of Referer (Referer can be spoofed by the public site).
//
// Rationale: The global guard above exempts ALL GET (line 254 — required for
// ~12+ legitimately-public storefront routes like /api/products, /api/ingredients).
// We cannot invert that default without breaking the public storefront.
// Solution: narrow targeted guard on exactly these 4 paths (D-07).
//
// Exact-match path list — /api/contacts/search (pos.js) is a different path
// and is intentionally NOT in this list.
// ---------------------------------------------------------------------------

var PII_GET_ROUTES = ['/api/contacts', '/api/invoices', '/api/items/inspect', '/api/snapshot'];

function requirePiiApiKey(req, res, next) {
  if (apiKeyMatches(req.headers['x-api-key'])) return next();
  return res.status(403).json({ error: 'Forbidden' });
}

PII_GET_ROUTES.forEach(function (p) { app.get(p, requirePiiApiKey); });

// ---------------------------------------------------------------------------
// Route modules
// ---------------------------------------------------------------------------

var catalogRouter = require('./routes/catalog');

app.use('/', require('./routes/bookings'));
app.use('/', catalogRouter);
app.use('/', require('./routes/items'));
app.use('/', require('./routes/payments'));
app.use('/', require('./routes/checkout'));
app.use('/', require('./routes/taxes'));
app.use('/', require('./routes/pos'));
app.use('/', require('./routes/collect'));
app.use('/', require('./routes/purchaseorders'));
app.use('/', require('./routes/consignment'));
app.use('/', require('./routes/discounts'));
app.use('/', require('./routes/promo'));
app.use('/', require('./routes/recipes'));
app.use('/', require('./routes/pos-recipe'));
app.use(require('./routes/webhooks'));

// Sentry error handler (must be after routes, before other error handlers)
if (process.env.SENTRY_DSN) {
  Sentry.setupExpressErrorHandler(app);
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

// Initialize Helcim, connect Redis, restore Zoho auth, then start listening.
// Guard with require.main === module so that importing server.js in tests
// (e.g. via supertest) does NOT bind a port or start cron jobs.
if (require.main === module) {
  helcimLib.init();
  cache.init().then(function () {
    return checkRedis();
  }).then(function () {
    return zohoAuth.init();
  }).then(function () {
    var server = app.listen(PORT, function () {
      log.info('Zoho middleware running on http://localhost:' + PORT);
      log.info('Health check: http://localhost:' + PORT + '/health');
      // Verify SMTP in the background — never block listen on it. A hung SMTP
      // connect (e.g. an unreachable IPv6 route on Railway) previously stalled
      // startup before app.listen and produced ~2 min of 502s on every deploy.
      // checkMailer never throws; it logs the result on its own.
      checkMailer();
      if (!zohoAuth.isAuthenticated()) {
        log.info('Connect Zoho: http://localhost:' + PORT + '/auth/zoho');
      } else {
        log.info('Zoho: Connected');
        // Pre-warm product and ingredients caches on startup
        log.info('Pre-warming product cache...');
        catalogRouter.refreshProducts().then(function () {
          log.info('Product cache pre-warmed');
          // Pre-warm ingredients after products (sequential to avoid rate-limiting)
          log.info('Pre-warming ingredients cache...');
          return catalogRouter.refreshIngredients();
        }).then(function () {
          log.info('Ingredients cache pre-warmed');
        }).catch(function (err) {
          log.error('Pre-warm failed: ' + err.message);
        });

        // Scheduled cache warm-up: 5 AM and 1 PM UTC daily
        // Keeps Redis caches hot during business hours so user requests never
        // trigger a cold Zoho fetch. Products first, ingredients staggered 60s later
        // to stay within Zoho's per-minute rate limit.
        cron.schedule('0 5,13 * * *', function () {
          if (!zohoAuth.isAuthenticated()) {
            log.warn('[cron] Skipping warm-up — Zoho not authenticated');
            return;
          }
          log.info('[cron] Scheduled cache warm-up starting');
          catalogRouter.refreshProducts().then(function () {
            log.info('[cron] Products cache refreshed');
          }).catch(function (err) {
            log.error('[cron] Products warm-up failed: ' + err.message);
          });
          setTimeout(function () {
            if (!zohoAuth.isAuthenticated()) return;
            catalogRouter.refreshIngredients().then(function () {
              log.info('[cron] Ingredients cache refreshed');
            }).catch(function (err) {
              log.error('[cron] Ingredients warm-up failed: ' + err.message);
            });
          }, 60000); // 60s after products to avoid rate-limit burst
        });
        log.info('[cron] Scheduled warm-up registered: 05:00 and 13:00 UTC daily');
      }

      // Retry pending batch creations + Zoho sync retries every 5 minutes (D-04, D-10)
      // Runs regardless of Zoho auth state since Apps Script calls don't need Zoho auth.
      // retrySyncQueue skips gracefully if Zoho is not authenticated.
      setInterval(function () {
        brewpadIntegration.retryPendingBatches().catch(function (err) {
          log.error('[brewpad] Retry sweep failed: ' + err.message);
        });
        // Phase 7: also sweep Zoho sync retries (D-10)
        brewpadIntegration.retrySyncQueue().catch(function (err) {
          log.error('[brewpad] Zoho sync retry sweep failed: ' + err.message);
        });
      }, 5 * 60 * 1000);
      log.info('[brewpad] Batch + Zoho sync retry sweeps registered: every 5 minutes');
    });

    process.on('SIGTERM', function () {
      log.info('[server] SIGTERM received — shutting down gracefully');
      server.close(function () {
        log.info('[server] HTTP server closed');
        cache.quit().then(function () {
          process.exit(0);
        }).catch(function () {
          process.exit(0);
        });
      });
      setTimeout(function () {
        log.error('[server] Forced shutdown after timeout');
        process.exit(1);
      }, 10000);
    });
  });
}

module.exports = app;
