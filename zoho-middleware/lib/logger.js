/**
 * Structured logger.
 *
 * Production (NODE_ENV=production): outputs newline-delimited JSON for Railway
 * log aggregation — {"ts":"...","level":"info","msg":"...",...extra}
 *
 * Development: human-readable — 12:34:56.789 [INFO ] [api/products] msg
 */

var os = require('os');
var isProd = process.env.NODE_ENV === 'production';
var hostname = os.hostname();

function log(level, msg, extra) {
  var entry = { ts: new Date().toISOString(), level: level, host: hostname, msg: msg };
  if (extra) {
    Object.keys(extra).forEach(function(k) { entry[k] = extra[k]; });
  }

  if (isProd) {
    var out = JSON.stringify(entry);
    if (level === 'error' || level === 'warn') {
      console.error(out);
    } else {
      console.log(out);
    }
    return;
  }

  // Dev: timestamp + padded level + message + optional extra
  var pad = level.toUpperCase();
  while (pad.length < 5) pad += ' ';
  var line = entry.ts.substring(11, 23) + ' [' + pad + '] ' + msg;
  if (extra) line += '  ' + JSON.stringify(extra);
  if (level === 'error' || level === 'warn') {
    console.error(line);
  } else {
    console.log(line);
  }
}

module.exports = {
  info:  function(msg, extra) { log('info',  msg, extra); },
  warn:  function(msg, extra) { log('warn',  msg, extra); },
  error: function(msg, extra) { log('error', msg, extra); },
  debug: function(msg, extra) { if (process.env.LOG_LEVEL === 'debug') log('debug', msg, extra); }
};
