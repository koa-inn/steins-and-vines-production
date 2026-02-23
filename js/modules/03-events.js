// ===== Anonymous Event Tracking =====

var _eventQueue = [];
var _EVENT_FLUSH_THRESHOLD = 5;

function trackEvent(type, sku, name) {
  var url = (typeof SHEETS_CONFIG !== 'undefined' && SHEETS_CONFIG.TRACK_EVENTS_URL)
    ? SHEETS_CONFIG.TRACK_EVENTS_URL
    : '';
  if (!url) return;
  _eventQueue.push({ type: type, sku: sku, name: name });
  if (_eventQueue.length >= _EVENT_FLUSH_THRESHOLD) {
    flushEvents();
  }
}

function flushEvents() {
  if (_eventQueue.length === 0) return;
  var url = (typeof SHEETS_CONFIG !== 'undefined' && SHEETS_CONFIG.TRACK_EVENTS_URL)
    ? SHEETS_CONFIG.TRACK_EVENTS_URL
    : '';
  if (!url) return;
  var payload = JSON.stringify({ events: _eventQueue });
  _eventQueue = [];
  if (navigator.sendBeacon) {
    navigator.sendBeacon(url, new Blob([payload], { type: 'application/json' }));
  }
}

document.addEventListener('visibilitychange', function () {
  if (document.visibilityState === 'hidden') {
    flushEvents();
  }
});
