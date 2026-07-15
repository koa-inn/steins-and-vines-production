'use strict';

/**
 * Unified 3-tier credential dispatch for the /api guard (D-46-02, D-46-06,
 * D-46-10, D-46-11).
 *
 * During the dual-accept window three credential types are simultaneously
 * valid:
 *   - legacy   : x-api-key header, unified API_SECRET_KEY/MW_API_KEY pair
 *                (lib/apiKey.js) — full admin access everywhere.
 *   - device   : x-device-token header, KIOSK_DEVICE_TOKEN (lib/deviceToken.js)
 *                — scoped to the explicit KIOSK_ROUTES allowlist below; NEVER
 *                admin-grade (a stolen iPad must not reach PII/void/consignment).
 *   - session  : sv_session cookie, server-side lookup (lib/session.js) —
 *                Google-OAuth-authenticated staff; full admin access.
 *
 * This module only resolves and classifies credentials — no money-path logic
 * lives here.
 *
 * ---------------------------------------------------------------------------
 * KIOSK_ROUTES is an EXPLICIT path allowlist, not a `/api/kiosk/*` prefix.
 * Anti-pattern warning (T-46-07): a prefix match would silently pull ANY
 * future /api/kiosk/* route into the kiosk-scoped bucket the moment anyone
 * adds it, without a human reviewing whether a bare device token should
 * reach it. Explicit list = the only route class ever added here is one a
 * human reviewed and decided is safe for a bare device token.
 *
 * D-54-GC reversal: /api/kiosk/gift-card/void used to be this comment's
 * running example of a route that must NEVER be swept in — T-46-07/D-46-02
 * kept void session/admin-only. Phase 54 (owner decision D-54-GC)
 * consciously supersedes that stance: void is status-only (no cash / no
 * Zoho money movement), requires a non-empty reason, and is logged
 * (kiosk.gift_card_voided) — so it is now an intentionally-reviewed
 * KIOSK_ROUTES member (see the entry below). The owner accepts the residual
 * risk that a leaked device token could void a certificate. The "explicit
 * list, not a prefix" rationale above still stands for every OTHER future
 * kiosk route — this reversal does not change how new routes get vetted.
 * ---------------------------------------------------------------------------
 */

var apiKeyGuard = require('./apiKey');
var deviceToken = require('./deviceToken');
var session = require('./session');

// Exact-path kiosk-scoped allowlist (Finding #2). Order/grouping mirrors the
// plan's <interfaces> block.
var KIOSK_ROUTES = [
  '/api/kiosk/products',
  '/api/kiosk/discounts', // A1: discount-preset CRUD classified kiosk-scoped
  '/api/kiosk/gift-card/lookup',
  '/api/kiosk/gift-card/next-number',
  '/api/kiosk/gift-card/void', // D-54-GC: status-only, reason-required, logged — supersedes T-46-07/D-46-02
  '/api/kiosk/recipe-quote',
  '/api/kiosk/recipe-sale',
  '/api/kiosk/recipe-sale/confirm',
  '/api/kiosk/sale',
  '/api/kiosk/sale/confirm',
  '/api/kiosk/sale/status',
  '/api/kiosk/salesorder-create',
  '/api/kiosk/salesorder-update',
  '/api/kiosk/salesorder-pay',
  '/api/kiosk/salesorders',
  '/api/kiosk/salesorder/:id', // documentation only — matched via prefix below
  '/api/kiosk/verify-pin',
  '/api/kiosk/client-error', // 57-01: no-side-effect telemetry sink — returns 204 only, never returns data; a leaked device token can at most write scrubbed error text
  '/api/pos/cancel',
  '/api/pos/status',
  '/api/contacts/search',
  '/api/contacts', // POST only (walk-in create) — GET is PII/admin-grade, see server.js PII_GET_ROUTES
];

// The literal dash-joined salesorder siblings that must NOT be swept up by
// the '/api/kiosk/salesorder/' prefix check below (they don't have a slash
// after "salesorder" so this is defensive/documentation only).
var KIOSK_SALESORDER_LITERAL_ROUTES = [
  '/api/kiosk/salesorder-create',
  '/api/kiosk/salesorder-update',
  '/api/kiosk/salesorder-pay',
  '/api/kiosk/salesorders',
];

/**
 * Matches a request path against KIOSK_ROUTES, including the one
 * param route (/api/kiosk/salesorder/:id) via prefix-segment comparison, and
 * the /api/kiosk/discounts/:id PUT/DELETE variant (A1: full discount-preset
 * CRUD is kiosk-scoped, matching the exact-path GET/POST entry above).
 */
function isKioskRoute(path) {
  if (KIOSK_ROUTES.indexOf(path) !== -1) return true;
  if (path.indexOf('/api/kiosk/salesorder/') === 0 &&
      KIOSK_SALESORDER_LITERAL_ROUTES.indexOf(path) === -1) {
    return true;
  }
  if (path.indexOf('/api/kiosk/discounts/') === 0) return true;
  return false;
}

/** Device tokens may reach kiosk-scoped routes (legacy/session always may). */
function allowKiosk(tier) {
  return tier === 'legacy' || tier === 'device' || tier === 'session';
}

/** Device tokens may NEVER reach admin-grade routes (D-46-02). */
function allowAdmin(tier) {
  return tier === 'legacy' || tier === 'session';
}

/**
 * Resolves the request's credential tier. Fully self-contained — reads
 * headers/cookies directly and does NOT assume the global guard ran, so it
 * is safe to invoke from a GET route the global guard skips.
 *
 * @returns {Promise<'legacy'|'device'|'session'|null>}
 */
async function resolveTier(req) {
  var headers = (req && req.headers) || {};
  if (apiKeyGuard.matches(headers['x-api-key'])) return 'legacy';
  if (deviceToken.matches(headers['x-device-token'])) return 'device';
  var sid = req && req.cookies && req.cookies.sv_session;
  if (sid) {
    var payload = await session.getSession(sid);
    if (payload) {
      req.staffEmail = payload.email;
      return 'session';
    }
  }
  return null;
}

/**
 * Express middleware factory. Invoke INLINE from route handlers
 * (`requireTiers([...])(req, res, function () { ... })`), never as a 3rd
 * router.get argument — see 46-04.
 *
 * Status contract (preserves the pre-existing single-key in-route contract
 * that 13+ existing unit tests assert synchronously, without awaiting):
 *   - no credential of any type present            -> SYNC 401
 *   - x-api-key present, no device/session present -> SYNC evaluate legacy
 *       (apiKeyGuard.matches is synchronous):
 *         match    -> req.authTier='legacy', next()
 *         no match -> SYNC 401 (present-but-wrong key)
 *   - device-token and/or session cookie present (the async tiers)
 *       -> resolveTier(req), then:
 *         tier in allowedTiers -> req.authTier=tier, next()
 *         tier present but insufficient, or null -> 403
 *         resolveTier rejects -> 403 (fail closed)
 */
function requireTiers(allowedTiers) {
  return function (req, res, next) {
    var headers = req.headers || {};
    var hasApiKey = !!headers['x-api-key'];
    var hasDeviceToken = !!headers['x-device-token'];
    var hasSessionCookie = !!(req.cookies && req.cookies.sv_session);

    if (!hasApiKey && !hasDeviceToken && !hasSessionCookie) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (hasApiKey && !hasDeviceToken && !hasSessionCookie) {
      if (apiKeyGuard.matches(headers['x-api-key'])) {
        req.authTier = 'legacy';
        return next();
      }
      return res.status(401).json({ error: 'Unauthorized' });
    }

    return Promise.resolve(resolveTier(req)).then(function (tier) {
      req.authTier = tier;
      if (tier && allowedTiers.indexOf(tier) !== -1) return next();
      return res.status(403).json({ error: 'Forbidden' });
    }).catch(function () {
      return res.status(403).json({ error: 'Forbidden' });
    });
  };
}

module.exports = {
  KIOSK_ROUTES: KIOSK_ROUTES,
  isKioskRoute: isKioskRoute,
  resolveTier: resolveTier,
  allowKiosk: allowKiosk,
  allowAdmin: allowAdmin,
  requireTiers: requireTiers,
};
