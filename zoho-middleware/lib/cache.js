/**
 * Redis cache layer.
 *
 * Connects lazily on first use. If Redis is unavailable the server
 * still works — cache misses just fall through to the Zoho API.
 */

var redis = require('redis');
var log = require('./logger');

var client = null;
var connected = false;

function getClient() {
  if (client) return Promise.resolve(client);

  client = redis.createClient({
    url: process.env.REDIS_URL || 'redis://localhost:6379',
    socket: {
      reconnectStrategy: function (retries) {
        if (retries > 10) return false;          // give up after 10 attempts
        return Math.min(retries * 500, 5000);    // 500ms, 1s, 1.5s, ... 5s max
      }
    }
  });

  client.on('error', function (err) {
    if (connected) {
      log.error('[redis] Connection lost: ' + err.message);
    }
    connected = false;
  });

  client.on('ready', function () {
    connected = true;
    log.info('[redis] Connected');
  });

  client.on('end', function () {
    connected = false;
    client = null;  // allow fresh client on next getClient() call
  });

  return client.connect().then(function () {
    connected = true;
    return client;
  }).catch(function (err) {
    log.error('[redis] Failed to connect: ' + err.message);
    log.warn('[redis] Caching disabled — API calls will hit Zoho directly');
    connected = false;
    client = null;  // allow fresh attempt if Redis comes up later
    return null;
  });
}

/**
 * Get a cached value by key.
 * Returns null on miss or if Redis is unavailable.
 */
function get(key) {
  if (!connected) return Promise.resolve(null);

  return getClient().then(function (c) {
    return c.get(key);
  }).then(function (val) {
    if (val === null) return null;
    try {
      return JSON.parse(val);
    } catch (e) {
      return null;
    }
  }).catch(function () {
    return null;
  });
}

/**
 * Store a value in cache with a TTL (in seconds).
 */
function set(key, value, ttlSeconds) {
  if (!connected) return Promise.resolve();

  return getClient().then(function (c) {
    return c.set(key, JSON.stringify(value), { EX: ttlSeconds });
  }).catch(function (err) {
    log.error('[redis] Failed to set cache: ' + err.message);
  });
}

/**
 * Delete a cached key (useful for cache invalidation after writes).
 */
function del(key) {
  if (!connected) return Promise.resolve();

  return getClient().then(function (c) {
    return c.del(key);
  }).catch(function () {});
}

/**
 * Acquire a distributed lock (Redis SETNX with TTL).
 * Returns true if the lock was acquired, false if already held.
 * Falls back to true if Redis is unavailable (in-process flag takes over).
 */
function acquireLock(key, ttlSeconds) {
  if (!connected) return Promise.resolve(true);
  return getClient().then(function (c) {
    return c.set('lock:' + key, '1', { NX: true, EX: ttlSeconds });
  }).then(function (result) {
    return result !== null; // 'OK' if acquired; null if already held
  }).catch(function () {
    return true; // on Redis error, fall through to in-process guard
  });
}

/**
 * Release a distributed lock.
 */
function releaseLock(key) {
  if (!connected) return Promise.resolve();
  return getClient().then(function (c) {
    return c.del('lock:' + key);
  }).catch(function () {});
}

/**
 * Initialize the Redis connection eagerly (call at server startup).
 */
function init() {
  return getClient();
}

/**
 * Gracefully close the Redis connection.
 */
function quit() {
  if (client && connected) {
    return client.quit().then(function () {
      client = null;
      connected = false;
    });
  }
  return Promise.resolve();
}

module.exports = {
  get: get,
  set: set,
  del: del,
  acquireLock: acquireLock,
  releaseLock: releaseLock,
  init: init,
  quit: quit
};
