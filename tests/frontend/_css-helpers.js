'use strict';
// Tiny declared-value CSS reader shared by the mobile-audit regression suites.
// Reads css/styles.css, strips comments, and returns rule blocks by exact selector,
// optionally scoped to the @media block whose query contains `mediaContains`.
var fs = require('fs');
var path = require('path');
var CSS_PATH = path.join(__dirname, '../../css/styles.css');

function src() {
  return fs.readFileSync(CSS_PATH, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
}
function esc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// All blocks for a selector. Each entry: { media: '<query or null>', body: '<declarations>' }.
function blocks(selector) {
  var s = src();
  var out = [];
  // Anchor on a rule boundary (start, `{` or `}`) so `body.nav-open #bar` never matches `#bar`.
  var re = new RegExp('(^|[}{;])\\s*' + esc(selector) + '\\s*\\{([^}]*)\\}', 'g');
  var m;
  while ((m = re.exec(s)) !== null) {
    // Find the nearest enclosing @media by scanning backwards for an unclosed @media {.
    // The boundary character (m[1]) belongs to the text before the rule, so keep it.
    var before = s.slice(0, m.index + m[1].length);
    var depth = 0, media = null;
    for (var i = before.length - 1; i >= 0; i--) {
      if (before[i] === '}') depth++;
      else if (before[i] === '{') {
        if (depth === 0) {
          var at = before.lastIndexOf('@media', i);
          media = at !== -1 ? before.slice(at, i).trim() : null;
          break;
        }
        depth--;
      }
    }
    out.push({ media: media, body: m[2] });
  }
  return out;
}

function block(selector, mediaContains) {
  var all = blocks(selector).filter(function (b) {
    if (mediaContains === undefined) return true;
    if (mediaContains === null) return b.media === null;
    return b.media && b.media.indexOf(mediaContains) !== -1;
  });
  return all.length ? all[all.length - 1].body : null;
}

function decl(body, prop) {
  if (!body) return null;
  var re = new RegExp('(?:^|;)\\s*' + esc(prop) + '\\s*:\\s*([^;]+)');
  var m = body.match(re);
  return m ? m[1].trim() : null;
}

module.exports = { block: block, blocks: blocks, decl: decl, src: src };
