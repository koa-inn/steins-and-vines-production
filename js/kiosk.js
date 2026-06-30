// ===== Steins & Vines In-Store POS (Standalone Kiosk) =====
// Self-contained IIFE — no dependency on admin.js.

(function () {
  'use strict';

  // ===== State =====
  var accessToken = null;
  var userEmail = null;
  var tokenClient = null;
  var _tokenRefreshTimer = null;
  var _silentRefreshTimer = null;
  var _handlingUnauthorized = false;

  // ===== Persistent Session =====
  var SESSION_KEY = 'sv-kiosk-session';

  function saveSession(token, expiresIn, email, name) {
    var existing = loadSessionRaw();
    var data = {
      token: token,
      expires_at: Date.now() + (expiresIn * 1000),
      email: email,
      name: name || (existing && existing.name) || '',
      auth_at: (existing && existing.auth_at) ? existing.auth_at : Date.now()
    };
    localStorage.setItem(SESSION_KEY, JSON.stringify(data));
  }

  /** Load session without expiry check (for PIN flow). */
  function loadSessionRaw() {
    try {
      var raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) { return null; }
  }

  function loadSession() {
    try {
      var raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      var data = JSON.parse(raw);
      // Expired if within 5 minutes of expiry
      if (data.expires_at < Date.now() + 5 * 60 * 1000) return null;
      return data;
    } catch (e) { return null; }
  }

  function isSessionValidForPin(session) {
    if (!session || !session.email || !session.auth_at) return false;
    return (Date.now() - session.auth_at) < SESSION_MAX_AGE;
  }

  function clearSession() {
    localStorage.removeItem(SESSION_KEY);
  }

  // ===== Toast Notification System =====

  function showToast(message, type, opts) {
    if (!type) type = 'info';
    if (!opts) opts = {};
    var container = document.getElementById('kiosk-toast-container');
    if (!container) return;

    var toast = document.createElement('div');
    toast.className = 'admin-toast admin-toast--' + type;

    var msgSpan = document.createElement('span');
    msgSpan.className = 'admin-toast-msg';
    msgSpan.textContent = message;
    toast.appendChild(msgSpan);

    if (opts.undo) {
      var undoBtn = document.createElement('button');
      undoBtn.className = 'admin-toast-undo';
      undoBtn.textContent = 'Undo';
      undoBtn.addEventListener('click', function () {
        opts.undo();
        removeToast(toast);
      });
      toast.appendChild(undoBtn);
    }

    var closeBtn = document.createElement('button');
    closeBtn.className = 'admin-toast-close';
    closeBtn.innerHTML = '&times;';
    closeBtn.addEventListener('click', function () { removeToast(toast); });
    toast.appendChild(closeBtn);

    container.appendChild(toast);

    var duration = opts.duration || (type === 'error' ? 6000 : 3500);
    var timer = setTimeout(function () { removeToast(toast); }, duration);
    toast._timer = timer;
  }

  function removeToast(toast) {
    if (toast._removed) return;
    toast._removed = true;
    clearTimeout(toast._timer);
    toast.classList.add('removing');
    setTimeout(function () {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 150);
  }

  // ===== Google OAuth =====

  function initGoogleAuth() {
    // waitForGoogleIdentity / gsiInitTokenClient defined in js/lib/auth.js
    tokenClient = gsiInitTokenClient({
      client_id: SHEETS_CONFIG.CLIENT_ID,
      scope: SHEETS_CONFIG.SCOPES + ' https://www.googleapis.com/auth/userinfo.email',
      callback: onTokenResponse
    });

    var signoutBtn = document.getElementById('kiosk-signout');
    if (signoutBtn) signoutBtn.addEventListener('click', kioskSignOut);

    // Check for PIN-lockable session first (no token refresh needed)
    var savedRaw = loadSessionRaw();
    if (savedRaw && isSessionValidForPin(savedRaw)) {
      showLockScreen(savedRaw);
      return;
    }

    // Try restoring a saved session via silent token refresh
    var saved = loadSession();
    if (saved) {
      _silentRefreshTimer = setTimeout(function () {
        _silentRefreshTimer = null;
        console.warn('[Kiosk] Silent refresh timed out — showing sign-in button');
        clearSession();
        showSignInButton();
      }, 5000);
      try {
        tokenClient.requestAccessToken({ prompt: '', login_hint: saved.email });
      } catch (err) {
        clearTimeout(_silentRefreshTimer);
        _silentRefreshTimer = null;
        console.warn('[Kiosk] Silent refresh failed:', err.message);
        clearSession();
        showSignInButton();
      }
      return;
    }

    showSignInButton();
  }

  function showSignInButton() {
    var signinBtn = document.getElementById('kiosk-google-signin-btn');
    if (signinBtn && !signinBtn.querySelector('button')) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn';
      btn.textContent = 'Sign in with Google';
      btn.addEventListener('click', function () {
        tokenClient.requestAccessToken();
      });
      signinBtn.appendChild(btn);
    }
  }

  function onTokenResponse(response) {
    if (_silentRefreshTimer) { clearTimeout(_silentRefreshTimer); _silentRefreshTimer = null; }
    _handlingUnauthorized = false;
    if (response.error) {
      console.warn('[Kiosk] Token response error:', response.error);
      clearSession();
      showSignInButton();
      return;
    }
    accessToken = response.access_token;
    var expiresIn = response.expires_in || 3600;

    // fetchGoogleUserInfo defined in js/lib/auth.js
    fetchGoogleUserInfo(accessToken)
      .then(function (info) {
        userEmail = info.email;
        saveSession(accessToken, expiresIn, userEmail, info.name || '');
        kioskCheckAuthorization();
      })
      .catch(function () {
        showKioskDenied();
      });
  }

  function kioskCheckAuthorization() {
    console.log('[Kiosk] Checking authorization for:', userEmail);

    adminApiGet('check_auth')
      .then(function (result) {
        console.log('[Kiosk] Server auth result:', result);
        if (result.authorized) {
          showKioskApp();
        } else {
          showKioskDenied();
        }
      })
      .catch(function (err) {
        console.error('[Kiosk] Server auth failed:', err.message);
        showKioskDenied();
      });
  }

  function showKioskApp() {
    document.getElementById('kiosk-signin').style.display = 'none';
    document.getElementById('kiosk-app').style.display = '';

    var emailEl = document.getElementById('kiosk-user-email');
    if (emailEl) emailEl.textContent = userEmail;

    var signoutBtn = document.getElementById('kiosk-signout');
    if (signoutBtn) signoutBtn.style.display = '';

    var deniedMsg = document.getElementById('kiosk-denied-msg');
    if (deniedMsg) deniedMsg.style.display = 'none';

    // Set up periodic token refresh (~50 min)
    if (_tokenRefreshTimer) clearInterval(_tokenRefreshTimer);
    _tokenRefreshTimer = setInterval(function () {
      tokenClient.requestAccessToken({ prompt: '' });
    }, 50 * 60 * 1000);

    startInactivityTimer();
    kioskCheckTerminal();
    kioskLoadProducts();
    // D-06: render the empty-cart state on load so "+ Add custom item" is
    // available before any catalog item is added (kioskRenderCart is otherwise
    // only triggered on cart change).
    kioskRenderCart();
  }

  function showKioskDenied() {
    var deniedMsg = document.getElementById('kiosk-denied-msg');
    if (deniedMsg) deniedMsg.style.display = '';
  }

  function kioskSignOut() {
    stopInactivityTimer();
    if (_tokenRefreshTimer) { clearInterval(_tokenRefreshTimer); _tokenRefreshTimer = null; }
    if (accessToken) {
      google.accounts.oauth2.revoke(accessToken);
    }
    accessToken = null;
    userEmail = null;
    clearSession();

    document.getElementById('kiosk-signin').style.display = '';
    document.getElementById('kiosk-app').style.display = 'none';

    var signoutBtn = document.getElementById('kiosk-signout');
    if (signoutBtn) signoutBtn.style.display = 'none';

    var emailEl = document.getElementById('kiosk-user-email');
    if (emailEl) emailEl.textContent = '';

    showSignInButton();
  }

  function handleUnauthorized() {
    if (_handlingUnauthorized) return;
    _handlingUnauthorized = true;
    if (_tokenRefreshTimer) { clearInterval(_tokenRefreshTimer); _tokenRefreshTimer = null; }
    clearSession();
    accessToken = null;
    userEmail = null;

    document.getElementById('kiosk-signin').style.display = '';
    document.getElementById('kiosk-app').style.display = 'none';

    var signoutBtn = document.getElementById('kiosk-signout');
    if (signoutBtn) signoutBtn.style.display = 'none';

    var emailEl = document.getElementById('kiosk-user-email');
    if (emailEl) emailEl.textContent = '';

    showSignInButton();
  }

  // ===== PIN Lock Screen =====

  function showLockScreen(session) {
    _isLocked = true;
    _pinBuffer = '';
    _pinAttempts = 0;
    var lockScreen = document.getElementById('kiosk-lock-screen');
    var userEl = document.getElementById('kiosk-lock-user');
    var errorEl = document.getElementById('kiosk-lock-error');
    var dots = document.querySelectorAll('.kiosk-lock-dot');

    if (userEl) userEl.textContent = session.name || session.email || '';
    if (errorEl) errorEl.textContent = '';
    dots.forEach(function (d) { d.classList.remove('kiosk-lock-dot--filled'); });

    lockScreen.style.display = '';
    lockScreen.classList.remove('kiosk-lock--exiting');

    // Wire keypad
    var keypad = document.getElementById('kiosk-lock-keypad');
    keypad.classList.remove('kiosk-lock-keypad--locked');
    keypad.querySelectorAll('.kiosk-lock-key[data-digit]').forEach(function (key) {
      key.onclick = function () { pinEntry(key.getAttribute('data-digit')); };
    });

    var backspace = document.getElementById('kiosk-lock-backspace');
    if (backspace) backspace.onclick = pinBackspace;

    var signoutBtn = document.getElementById('kiosk-lock-signout');
    if (signoutBtn) signoutBtn.onclick = function () {
      lockScreen.style.display = 'none';
      kioskSignOut();
    };
  }

  function hideLockScreen() {
    var lockScreen = document.getElementById('kiosk-lock-screen');
    lockScreen.classList.add('kiosk-lock--exiting');
    setTimeout(function () {
      lockScreen.style.display = 'none';
      lockScreen.classList.remove('kiosk-lock--exiting');
      _isLocked = false;
    }, 250);
  }

  function pinEntry(digit) {
    if (_pinBuffer.length >= 4) return;
    _pinBuffer += digit;
    var dots = document.querySelectorAll('.kiosk-lock-dot');
    if (dots[_pinBuffer.length - 1]) dots[_pinBuffer.length - 1].classList.add('kiosk-lock-dot--filled');
    if (_pinBuffer.length === 4) {
      setTimeout(pinSubmit, 150);
    }
  }

  function pinBackspace() {
    if (_pinBuffer.length === 0) return;
    _pinBuffer = _pinBuffer.slice(0, -1);
    var dots = document.querySelectorAll('.kiosk-lock-dot');
    dots[_pinBuffer.length].classList.remove('kiosk-lock-dot--filled');
  }

  function pinClearDots() {
    _pinBuffer = '';
    document.querySelectorAll('.kiosk-lock-dot').forEach(function (d) {
      d.classList.remove('kiosk-lock-dot--filled');
    });
  }

  function pinSubmit() {
    var mwUrl = kioskMwUrl();
    fetch(mwUrl + '/api/kiosk/verify-pin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': SHEETS_CONFIG.MW_API_KEY || '' },
      body: JSON.stringify({ pin: _pinBuffer })
    })
    .then(function (r) { return r.json().then(function (d) { return { status: r.status, data: d }; }); })
    .then(function (result) {
      if (result.data.ok) {
        hideLockScreen();
        unlockAfterPin();
      } else {
        _pinAttempts++;
        var dotsContainer = document.getElementById('kiosk-lock-dots');
        var errorEl = document.getElementById('kiosk-lock-error');

        if (dotsContainer) {
          dotsContainer.classList.add('kiosk-lock-dots--error');
          setTimeout(function () {
            dotsContainer.classList.remove('kiosk-lock-dots--error');
            pinClearDots();
          }, 600);
        }

        if (_pinAttempts >= 5) {
          if (errorEl) errorEl.textContent = 'Too many attempts \u2014 try again in 1 minute';
          var keypad = document.getElementById('kiosk-lock-keypad');
          if (keypad) keypad.classList.add('kiosk-lock-keypad--locked');
          setTimeout(function () {
            _pinAttempts = 0;
            if (keypad) keypad.classList.remove('kiosk-lock-keypad--locked');
            if (errorEl) errorEl.textContent = '';
          }, 60000);
        } else {
          if (errorEl) {
            errorEl.textContent = 'Incorrect PIN';
            setTimeout(function () { errorEl.textContent = ''; }, 2000);
          }
        }
      }
    })
    .catch(function () {
      var errorEl = document.getElementById('kiosk-lock-error');
      if (errorEl) errorEl.textContent = 'Cannot verify \u2014 check connection';
      pinClearDots();
    });
  }

  function unlockAfterPin() {
    var saved = loadSession();
    if (!saved) {
      // Token expired — try silent refresh
      var savedRaw = loadSessionRaw();
      if (!savedRaw) { kioskSignOut(); return; }
      try {
        tokenClient.requestAccessToken({ prompt: '', login_hint: savedRaw.email });
      } catch (e) {
        kioskSignOut();
      }
      return;
    }

    // Token still valid — go straight to app
    accessToken = saved.token;
    userEmail = saved.email;
    showKioskApp();
  }

  // ===== Inactivity Timer =====

  function startInactivityTimer() {
    stopInactivityTimer();
    var events = ['touchstart', 'click', 'keydown'];
    function resetTimer() {
      if (_isLocked) return;
      clearTimeout(_inactivityTimer);
      _inactivityTimer = setTimeout(lockKiosk, INACTIVITY_TIMEOUT);
    }
    events.forEach(function (evt) {
      document.addEventListener(evt, resetTimer, { passive: true });
    });
    _inactivityTimer = setTimeout(lockKiosk, INACTIVITY_TIMEOUT);
    // Store cleanup function
    window._kioskInactivityCleanup = function () {
      events.forEach(function (evt) {
        document.removeEventListener(evt, resetTimer);
      });
      clearTimeout(_inactivityTimer);
    };
  }

  function stopInactivityTimer() {
    if (window._kioskInactivityCleanup) window._kioskInactivityCleanup();
    clearTimeout(_inactivityTimer);
  }

  function lockKiosk() {
    stopInactivityTimer();
    var saved = loadSessionRaw();
    if (saved && isSessionValidForPin(saved)) {
      showLockScreen(saved);
    } else {
      kioskSignOut();
    }
  }

  // ===== Admin API Helpers =====

  function fetchWithRetry(url, options, retries) {
    if (retries === undefined) retries = 1;
    return fetch(url, options).catch(function (err) {
      if (retries > 0) {
        return new Promise(function (resolve) {
          setTimeout(resolve, 1000);
        }).then(function () {
          return fetchWithRetry(url, options, retries - 1);
        });
      }
      throw err;
    });
  }

  function isUnauthorizedError(data) {
    var msg = ((data.message || data.error || '') + '').toLowerCase();
    return msg.indexOf('unauthorized') !== -1 || msg.indexOf('not authorized') !== -1;
  }

  function adminApiGet(action, params) {
    if (!SHEETS_CONFIG.ADMIN_API_URL) {
      return Promise.reject(new Error('Admin API not configured'));
    }
    var url = SHEETS_CONFIG.ADMIN_API_URL + '?action=' + encodeURIComponent(action) + '&token=' + encodeURIComponent(accessToken);
    if (params) {
      Object.keys(params).forEach(function (key) {
        url += '&' + encodeURIComponent(key) + '=' + encodeURIComponent(params[key]);
      });
    }
    return fetchWithRetry(url, {
      method: 'GET'
    }).then(function (res) {
      return res.json();
    }).then(function (data) {
      if (!data.ok) {
        if (isUnauthorizedError(data)) handleUnauthorized();
        throw new Error(data.message || data.error || 'API error');
      }
      return data;
    });
  }

  function adminApiPost(action, payload) {
    if (!SHEETS_CONFIG.ADMIN_API_URL) {
      return Promise.reject(new Error('Admin API not configured'));
    }
    payload.action = action;
    payload.token = accessToken;
    return fetchWithRetry(SHEETS_CONFIG.ADMIN_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain' // Use text/plain to avoid CORS preflight
      },
      body: JSON.stringify(payload)
    }).then(function (res) {
      return res.json();
    }).then(function (data) {
      if (!data.ok) {
        if (isUnauthorizedError(data)) handleUnauthorized();
        throw new Error(data.message || data.error || 'API error');
      }
      return data;
    });
  }

  // ===== Shared Utilities =====

  // escapeHTML — canonical apostrophe-escaping implementation (mirrors js/lib/utils.js).
  // kiosk.js is a standalone bundle (not part of concat:js) so carries its own copy.
  function escapeHTML(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ===== Batch QR + Label =====

  function generateBatchQR(batchId, batchAccessToken) {
    var url = window.location.origin + '/batch.html?id=' + encodeURIComponent(batchId) + '&token=' + encodeURIComponent(batchAccessToken);
    var qr = qrcode(0, 'M');
    qr.addData(url);
    qr.make();
    return qr;
  }

  var LABEL_CSS =
    '@page{size:4in 6in;margin:0;}' +
    'body{margin:0;font-family:Arial,Helvetica,sans-serif;}' +
    '.label{width:4in;height:6in;padding:0.2in 0.25in;box-sizing:border-box;display:flex;flex-direction:column;overflow:hidden;}' +
    '.top-row{display:flex;align-items:center;justify-content:space-between;padding-bottom:5px;border-bottom:1.5px solid #000;margin-bottom:6px;}' +
    '.logo-stack{display:flex;align-items:center;gap:8px;}' +
    '.logo-icon{height:48px;}' +
    '.logo-wordmark{height:20px;}' +
    '.qr-box{width:72px;height:72px;display:flex;align-items:center;justify-content:center;}' +
    '.qr-box svg{width:72px;height:72px;}' +
    '.qr-empty{width:72px;height:72px;border:1.5px solid #000;}' +
    '.batch-id{font-size:15px;font-weight:bold;text-align:center;margin:2px 0 1px;letter-spacing:1px;}' +
    '.product-name{font-size:11px;text-align:center;font-weight:600;margin-bottom:5px;}' +
    '.info-grid{display:grid;grid-template-columns:auto 1fr;gap:1px 8px;font-size:9.5px;line-height:1.5;margin-bottom:4px;}' +
    '.info-grid .lbl{font-weight:bold;text-align:right;white-space:nowrap;}' +
    '.write-line{border-bottom:1px solid #000;min-width:100px;display:inline-block;height:12px;}' +
    '.section-title{font-size:8.5px;font-weight:bold;text-transform:uppercase;letter-spacing:0.5px;margin:4px 0 2px;border-bottom:0.5px solid #ccc;padding-bottom:1px;}' +
    '.schedule-wrap{min-height:108px;margin-bottom:4px;}' +
    '.schedule-table{width:100%;border-collapse:collapse;font-size:8.5px;line-height:1.4;}' +
    '.schedule-table td{padding:1px 4px 1px 0;vertical-align:top;}' +
    '.schedule-table td:first-child{white-space:nowrap;font-weight:600;width:52px;}' +
    '.schedule-table td:last-child{color:#555;font-size:8px;text-align:right;white-space:nowrap;}' +
    '.notes-box{border:1px solid #999;border-radius:2px;flex:1;min-height:40px;margin:0 0 6px;position:relative;}' +
    '.notes-box-label{position:absolute;top:-1px;left:4px;font-size:7px;font-weight:bold;color:#000;text-transform:uppercase;background:#fff;padding:0 2px;}' +
    '.agreement{flex-shrink:0;border-top:1px solid #999;padding-top:3px;}' +
    '.agreement-title{font-size:7px;font-weight:bold;text-align:center;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:2px;}' +
    '.agreement-text{font-size:6.5px;line-height:1.35;text-align:justify;color:#333;margin-bottom:4px;}' +
    '.sig-area{display:flex;gap:6px;align-items:flex-end;}' +
    '.sig-block{flex:1;}.sig-block .sig-line{border-bottom:1px solid #000;height:14px;}' +
    '.sig-block .sig-label{font-size:6px;text-align:center;margin-top:1px;color:#555;}' +
    '.sig-block.sm{flex:0.4;}' +
    '.email-row{margin-bottom:4px;}.email-row .sig-line{border-bottom:1px solid #000;height:12px;}' +
    '.email-row .sig-label{font-size:6px;margin-top:1px;color:#555;}';

  var AGREEMENT_TEXT = 'By signing, I request assistance and guidance, as required, in preparing my wine must for fermentation. I acknowledge that by default, Steins &amp; Vines will add a natural shell fish derivative, Chitosan, for the purpose of clearing. I consent to my name, telephone number, address and email (if supplied) being kept in a database with the understanding that this information will not be sold or exchanged. I acknowledge that the wine made for me by Steins &amp; Vines is for my personal use only. I acknowledge that Steins &amp; Vines has transferred ownership of my wine and all ingredients to me.';

  function buildBatchLabelHTML(opts) {
    var b = opts.batch || {};
    var tasks = opts.tasks || [];
    var qrSvg = opts.qrSvg || '';
    var isBlank = opts.blank || false;
    var origin = window.location.origin;

    var iconUrl = origin + '/images/label-icon.png';
    var wordmarkUrl = origin + '/images/label-wordmark.png';

    var h = '<!DOCTYPE html><html><head><meta charset="UTF-8">';
    h += '<title>' + (isBlank ? 'Blank Batch Form' : 'Batch ' + escapeHTML(b.batch_id || '')) + '</title>';
    h += '<style>' + LABEL_CSS + '</style></head><body><div class="label">';

    // Top row: logos + QR
    h += '<div class="top-row"><div class="logo-stack">';
    h += '<img class="logo-icon" src="' + iconUrl + '" alt="">';
    h += '<img class="logo-wordmark" src="' + wordmarkUrl + '" alt="">';
    h += '</div>';
    if (qrSvg) {
      h += '<div class="qr-box">' + qrSvg + '</div>';
    } else if (!isBlank) {
      h += '<div class="qr-empty"></div>';
    }
    h += '</div>';

    // Batch ID + Product
    h += '<div class="batch-id">' + (isBlank ? 'Batch ID: <span class="write-line" style="min-width:140px;"></span>' : escapeHTML(b.batch_id || '')) + '</div>';
    h += '<div class="product-name">' + (isBlank ? 'Kit: <span class="write-line" style="min-width:180px;"></span>' : escapeHTML(b.product_name || b.product_sku || '')) + '</div>';

    // Info grid
    h += '<div class="info-grid">';
    h += '<span class="lbl">Customer:</span><span class="val">' + (isBlank ? '<span class="write-line"></span>' : escapeHTML(b.customer_name || '')) + '</span>';
    h += '<span class="lbl">Email:</span><span class="val">' + (isBlank ? '<span class="write-line"></span>' : escapeHTML(b.customer_email || '')) + '</span>';
    h += '<span class="lbl">Phone:</span><span class="val">' + (isBlank ? '<span class="write-line"></span>' : escapeHTML(b.customer_phone || '')) + '</span>';
    h += '<span class="lbl">Start Date:</span><span class="val">' + (isBlank ? '<span class="write-line"></span>' : escapeHTML(String(b.start_date || '').substring(0, 10))) + '</span>';
    var loc = isBlank ? '<span class="write-line"></span>' : escapeHTML([b.shelf_id, b.bin_id, b.vessel_id].filter(Boolean).join(' - ') || '—');
    h += '<span class="lbl">Primary Location:</span><span class="val">' + loc + '</span>';
    h += '<span class="lbl">Transfer 1:</span><span class="val"><span class="write-line"></span></span>';
    h += '<span class="lbl">Transfer 2:</span><span class="val"><span class="write-line"></span></span>';
    h += '<span class="lbl">Transfer 3:</span><span class="val"><span class="write-line"></span></span>';
    h += '</div>';

    // Schedule
    h += '<div class="section-title">Schedule</div>';
    h += '<div class="schedule-wrap"><table class="schedule-table">';

    if (!isBlank && tasks.length > 0) {
      var startMs = b.start_date ? new Date(String(b.start_date).substring(0, 10)).getTime() : 0;
      tasks.forEach(function (t) {
        var dayLabel = '—';
        var dateLabel = '';
        if (t.due_date) {
          var dueStr = String(t.due_date).substring(0, 10);
          dateLabel = dueStr;
          if (startMs) {
            var dayNum = Math.round((new Date(dueStr).getTime() - startMs) / 86400000);
            dayLabel = 'Day ' + (dayNum < 1 ? 1 : dayNum);
          }
        } else {
          dayLabel = 'TBD';
        }
        if (t.step_number === 1 || t.step_number === '1') dayLabel = 'Day 1';
        h += '<tr><td>' + escapeHTML(dayLabel) + '</td>';
        h += '<td>' + escapeHTML(t.title || 'Step ' + t.step_number) + '</td>';
        h += '<td>' + escapeHTML(dateLabel) + '</td></tr>';
      });
    } else {
      h += '<tr><td style="font-weight:bold;font-size:7.5px;padding-bottom:2px;">Day</td>';
      h += '<td style="font-weight:bold;font-size:7.5px;padding-bottom:2px;">Step</td>';
      h += '<td style="font-weight:bold;font-size:7.5px;padding-bottom:2px;text-align:right;">Date</td></tr>';
      for (var i = 0; i < 8; i++) {
        h += '<tr><td style="border-bottom:0.5px solid #ccc;">____</td>';
        h += '<td style="border-bottom:0.5px solid #ccc;">&nbsp;</td>';
        h += '<td style="border-bottom:0.5px solid #ccc;">&nbsp;</td></tr>';
      }
    }
    h += '</table></div>';

    // Notes box
    h += '<div class="notes-box"><span class="notes-box-label">Notes</span></div>';

    // Agreement
    h += '<div class="agreement">';
    h += '<div class="agreement-title">Customer Agreement</div>';
    h += '<div class="agreement-text">' + AGREEMENT_TEXT + '</div>';
    h += '<div class="sig-area">';
    h += '<div class="sig-block"><div class="sig-line"></div><div class="sig-label">Signature</div></div>';
    h += '<div class="sig-block sm"><div class="sig-line"></div><div class="sig-label">Date</div></div>';
    h += '</div></div>';

    h += '</div></body></html>';
    return h;
  }

  // ===== PIN Lock State =====
  var _pinBuffer = '';
  var _pinAttempts = 0;
  var _inactivityTimer = null;
  var _isLocked = false;
  var INACTIVITY_TIMEOUT = 10 * 60 * 1000; // 10 minutes
  var SESSION_MAX_AGE = 24 * 60 * 60 * 1000; // 24 hours

  // ===== Kiosk Sale State =====

  var _kioskProducts = [];
  var _kioskCart = {};
  var _kioskMakersFeeWaived = false;
  var _kioskProductsLoaded = false;
  var _kioskProductsLoading = false;
  var _kioskCurrentView = 'browse';
  var _kioskSaleData = null;
  var _kioskSearchTimer = null;
  var _kioskTerminalReady = false;
  var _kioskCustomer = null; // { contact_id, name, email } or null (walk-in)
  var _kioskHideOutOfStock = false;
  var _kioskCustomCounter = 0; // auto-incrementing counter for custom-line cart keys
  var _kioskGiftCertCounter = 0; // counter for gift-cert cart line keys (GIFTCARD-01)

  var _kioskDiscount = null;
  // null = no discount
  // { presetId: 'id', name: 'Staff 10%', type: 'percentage'|'fixed', value: 10, scope: 'cart'|'item', targetItemId: '' }

  var _kioskDiscountPresets = [];
  var _kioskEditingDiscountId = null; // null = creating a new preset; id = editing existing

  var _kioskGiftCard = null;
  // null = no gift card applied to this sale; { cert_number, amount_applied, balance } when applied (Phase 44, D-08)

  // Customer browse mode state
  var _kioskCbTab = 'kits';
  var _kioskCbSearch = '';
  var _kioskCbSearchTimer = null;

  // Sales Order / Collect Payment state
  var _kioskSalesOrders = [];
  var _kioskSoItems = [];       // items for new SO creation
  var _kioskSoCustomer = null;  // { contact_id, name, email }
  var _kioskSoSearchTimer = null;
  var _kioskSoPayingId = null;  // tracks SO being paid (for retry)
  var _kioskImportedSoId = null;        // SO ID when cart was imported from an SO
  var _kioskImportedSoNumber = null;    // SO number for display (e.g., "SO-001234")
  var _kioskImportedSoUpdated = false;  // true after SO update succeeds -- skip on retry (D-08)
  var _kioskSoActiveChips = ['open', 'draft'];  // default active chip filter (D-10)

  // Recipe browser state
  var _kioskMode = 'products';
  var _kioskRecipes = [];
  var _kioskRecipesLoaded = false;
  var _kioskRecipesLoading = false;
  var _kioskSelectedRecipe = null;
  var _kioskSaleType = null;
  var _kioskMillGrain = false;
  var _kioskRecipeAvailability = null;
  var _kioskRecipeContext = null; // { recipe_id, recipe_name, sale_type, mill_grain, locked_price, ingredients }

  // Phase 35 state vars (ported from admin.js kiosk IIFE — 36-05)
  var _kioskTargetVolumeL = null;   // target volume in litres, or null = use base
  var _kioskScaleFactor   = 1.0;    // display preview only; server recomputes authoritative value
  var _kioskStockOverride = false;  // true when manager override button was clicked
  var _kioskQuote = null;           // last successful /api/kiosk/recipe-quote response
  var _kioskQuoteTimer = null;      // debounce timer for quote fetch

  // Phase 36 state vars
  var _kioskModifiedIngredients = null;  // array of base-quantity ingredients (null = unmodified)
  var _kioskModifyPanelOpen = false;     // whether the modify panel has been expanded

  // Phase 36: ingredient catalog for modify panel autocomplete
  var _kioskIngredientCatalog = [];
  var _kioskCatalogLoaded = false;

  var MAKERS_FEE = 45; // Added to kit rates for in-store pricing
  var MAKERS_FEE_SKU = 'MAKERS-FEE';
  var MATERIALS_FEE = 5; // Materials fee (corks etc.) — carries PST
  var MATERIALS_FEE_SKU = 'MAT-FEE';

  // ===== Filter State =====

  var _kioskFilters = {
    search: '',
    category: '',
    type: '',
    stockStatus: '',
    hideOos: false,
    sort: 'name-asc'
  };

  var _kioskViewMode = localStorage.getItem('sv-kiosk-view-mode') || 'grid';

  // ===== Kiosk Helpers =====

  function kioskMwUrl() {
    return (typeof SHEETS_CONFIG !== 'undefined' && SHEETS_CONFIG.MIDDLEWARE_URL)
      ? SHEETS_CONFIG.MIDDLEWARE_URL : '';
  }

  function kioskFmt(amount) {
    return '$' + (parseFloat(amount) || 0).toFixed(2);
  }

  // ---- Phase 35+36: Server quote fetch (ported from admin.js, 36-05) ----

  // GAP-8 (36-18): Hoisted to module scope so kioskFetchRecipeQuote can re-render
  // the ingredient list from scaled quote.ingredients without sale-type being set.
  // Implements the kiosk grouped <ul>/<li> idiom (D-10 / RDISP-03).
  // Previously defined as a closure inside kioskShowRecipePrompt; moved here so both
  // kioskShowRecipePrompt and kioskFetchRecipeQuote can call it.
  function kioskRenderRecipeIngredients(ingredients, el) {
    if (!el || !ingredients) return;
    var groups = (typeof groupRecipeIngredients === 'function')
      ? groupRecipeIngredients(ingredients)
      : [{ label: '', count: ingredients.length, items: ingredients }];
    var html = '';
    groups.forEach(function (group) {
      html += group.label
        ? '<strong>' + escapeHTML(group.label) + ' (' + group.count + ')</strong>'
        : '<strong>Ingredients:</strong>';
      html += '<ul style="margin:0.25rem 0;padding-left:1.25rem;">';
      group.items.forEach(function (ing) {
        html += '<li>' + escapeHTML(ing.item_name) + ' — ' + escapeHTML(String(ing.quantity || '')) + ' ' + escapeHTML(ing.unit || '') + '</li>';
      });
      html += '</ul>';
    });
    el.innerHTML = html;
  }

  // Fetch a dry-run quote from GET /api/kiosk/recipe-quote.
  // On success: store _kioskQuote and update Add-to-Cart button price.
  // On error: clear _kioskQuote (display falls back to base price).
  // Call debounced via kioskScheduleRecipeQuote (350 ms).
  function kioskFetchRecipeQuote() {
    // GAP-8 (36-18): Drop _kioskSaleType from the early-return guard.
    // When no sale type is chosen yet, use 'in-store' as a preview default so
    // the live price and ingredient list update as the user adjusts volume/factor.
    // The charged amount is still the server total at the REAL sale type (chosen later).
    if (!_kioskSelectedRecipe) return;
    var mw = kioskMwUrl();
    var headers = {};
    if (typeof SHEETS_CONFIG !== 'undefined' && SHEETS_CONFIG.MW_API_KEY) {
      headers['x-api-key'] = SHEETS_CONFIG.MW_API_KEY;
    }
    var recipeId = _kioskSelectedRecipe.recipe_id;
    var targetVol = _kioskTargetVolumeL || (Number(_kioskSelectedRecipe.batch_size_l) || null);
    // GAP-8 (36-18): Use real sale type when chosen; 'in-store' preview default otherwise.
    // DISPLAY ONLY — the Add-to-Cart gate and charged amount still require a real _kioskSaleType.
    var saleType = _kioskSaleType || 'in-store';
    var url = mw + '/api/kiosk/recipe-quote?recipe_id=' + encodeURIComponent(recipeId) +
              '&sale_type=' + encodeURIComponent(saleType);
    if (targetVol) url += '&target_volume_l=' + encodeURIComponent(targetVol);
    // Phase 36: pass modified_ingredients when the user has edited the ingredient list
    if (Array.isArray(_kioskModifiedIngredients)) {
      url += '&modified_ingredients=' + encodeURIComponent(JSON.stringify(_kioskModifiedIngredients));
    }
    // Discount: server applies it to the recipe's product/fee portions and returns
    // the discounted total. The charged amount is always this server quote.
    if (_kioskDiscount && _kioskDiscount.presetId) {
      url += '&discount_preset_id=' + encodeURIComponent(_kioskDiscount.presetId);
    }
    // Show "Calculating..." while waiting (GAP-4 36-15: ungated — always show)
    var previewEl = document.getElementById('kiosk-recipe-price-preview');
    if (previewEl) {
      previewEl.style.display = '';
      previewEl.innerHTML = '<span style="color:var(--ink-tertiary);">Calculating…</span>';
    }
    return fetch(url, { headers: headers })
      .then(function (r) { return r.json().then(function (d) { return { status: r.status, data: d }; }); })
      .then(function (result) {
        if (result.status === 200 && result.data && result.data.ok &&
            result.data.recipe_id === recipeId) {
          _kioskQuote = result.data;
          // Update price preview — ungated (GAP-4 36-15: write regardless of panel state)
          var el = document.getElementById('kiosk-recipe-price-preview');
          if (el) {
            el.style.display = '';
            var total = typeof result.data.total === 'number' ? result.data.total : null;
            if (total !== null) {
              var disc = result.data.discount;
              var before = result.data.total_before_discount;
              if (disc && typeof before === 'number' && before > total) {
                el.innerHTML = 'Estimated total: <s style="color:var(--ink-tertiary);">' +
                  escapeHTML('$' + before.toFixed(2)) + '</s> <strong>' + escapeHTML('$' + total.toFixed(2)) + '</strong>' +
                  ' <span style="color:var(--cellar-green,#2e6e4e);">(' + escapeHTML(disc.name) + ')</span>';
              } else {
                el.innerHTML = 'Estimated total: <strong>' + escapeHTML('$' + total.toFixed(2)) + '</strong>';
              }
            } else {
              el.innerHTML = '<span style="color:var(--batch-danger);">Price unavailable — check connection</span>';
            }
          }
          // GAP-4 36-15: update prominent #kiosk-recipe-summary-price from server total (D-06)
          // The displayed price is ALWAYS the server quote — never client-side math.
          var summaryPriceEl = document.getElementById('kiosk-recipe-summary-price');
          if (summaryPriceEl) {
            if (total !== null) {
              summaryPriceEl.textContent = kioskFmt(total) + ' per batch';
            } else {
              summaryPriceEl.textContent = 'Price calculated at checkout';
            }
          }
          // GAP-8 (36-18): Re-render ingredient list from scaled quote.ingredients.
          // This shows scaled quantities to the user before they choose a sale type.
          // Only re-render when the quote returned a non-empty ingredients array —
          // an empty array means the recipe has no ingredients yet (leave base list).
          if (Array.isArray(result.data.ingredients) && result.data.ingredients.length > 0) {
            var ingListEl = document.getElementById('kiosk-recipe-ingredients');
            if (ingListEl) {
              kioskRenderRecipeIngredients(result.data.ingredients, ingListEl);
            }
          }
          kioskUpdateAddToCartButton();
        } else {
          _kioskQuote = null;
          // Error path — ungated (GAP-4 36-15)
          var errEl = document.getElementById('kiosk-recipe-price-preview');
          if (errEl) {
            errEl.style.display = '';
            errEl.innerHTML = '<span style="color:var(--batch-danger);">Price unavailable — check connection</span>';
          }
          kioskUpdateAddToCartButton();
        }
      })
      .catch(function () {
        _kioskQuote = null;
        // Catch path — ungated (GAP-4 36-15)
        var errEl2 = document.getElementById('kiosk-recipe-price-preview');
        if (errEl2) {
          errEl2.style.display = '';
          errEl2.innerHTML = '<span style="color:var(--batch-danger);">Price unavailable — check connection</span>';
        }
        kioskUpdateAddToCartButton();
      });
  }

  function kioskScheduleRecipeQuote() {
    if (_kioskQuoteTimer) clearTimeout(_kioskQuoteTimer);
    _kioskQuoteTimer = setTimeout(kioskFetchRecipeQuote, 350);
  }

  // ---- Phase 36: Ingredient catalog for modify panel autocomplete ----

  function kioskLoadIngredientCatalog() {
    if (_kioskCatalogLoaded) return;
    var mw = kioskMwUrl();
    if (!mw) return;
    var headers = {};
    if (typeof SHEETS_CONFIG !== 'undefined' && SHEETS_CONFIG.MW_API_KEY) {
      headers['x-api-key'] = SHEETS_CONFIG.MW_API_KEY;
    }
    fetch(mw + '/api/ingredients?include_internal=1', { headers: headers })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)); })
      .then(function (data) {
        _kioskIngredientCatalog = data.items || data.ingredients || data || [];
        _kioskCatalogLoaded = true;
      })
      .catch(function () { /* non-fatal */ });
  }

  // ---- Phase 36: Modify panel row rendering ----

  // Render editable ingredient rows grouped by cf_type into #kiosk-modify-tbody.
  // data-ing-idx maps to the ORIGINAL flat array index via ingredients.indexOf(ing) (caveat #7).
  function renderKioskModifyRows() {
    var tbody = document.getElementById('kiosk-modify-tbody');
    if (!tbody) return;
    var ingredients = _kioskModifiedIngredients;
    if (!ingredients || ingredients.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" class="kiosk-modify-empty">' +
        'No ingredients — use ‘+ Add Ingredient’ to build a custom list</td></tr>';
      return;
    }
    var groups = (typeof groupRecipeIngredients === 'function')
      ? groupRecipeIngredients(ingredients)
      : [{ label: '', count: ingredients.length, items: ingredients }];
    var html = '';
    groups.forEach(function (group) {
      if (group.label) {
        html += '<tr class="kiosk-modify-group-header"><td colspan="4" style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--ink-tertiary);">' +
          escapeHTML(group.label) + ' (' + group.count + ')</td></tr>';
      }
      group.items.forEach(function (ing) {
        var idx = ingredients.indexOf(ing); // CRITICAL: original flat-array index (caveat #7)
        var qtyVal = typeof ing.quantity !== 'undefined' ? ing.quantity : (ing.base_quantity || '');
        html += '<tr class="kiosk-modify-row" data-ing-idx="' + idx + '">';
        html += '<td class="ing-autocomplete-wrap"><input type="text" class="admin-input ing-search" ' +
          'style="font-size:1rem;" value="' +
          escapeHTML(ing.item_name || '') + '" autocomplete="off" /></td>';
        html += '<td><input type="number" class="admin-input ing-qty" step="0.01" min="0" ' +
          'inputmode="decimal" style="font-size:1rem;" value="' +
          escapeHTML(String(qtyVal)) + '" /></td>';
        html += '<td class="ing-unit">' + escapeHTML(ing.unit || '') + '</td>';
        html += '<td><button type="button" class="btn-secondary ing-remove" aria-label="Remove ' +
          escapeHTML(ing.item_name || '') + '">&#10005;</button></td>';
        html += '</tr>';
      });
    });
    tbody.innerHTML = html;
    attachKioskModifyRowListeners();
  }

  // Attach event listeners for remove, qty change, and search autocomplete on modify rows.
  function attachKioskModifyRowListeners() {
    var tbody = document.getElementById('kiosk-modify-tbody');
    if (!tbody) return;

    // Remove buttons
    tbody.querySelectorAll('.ing-remove').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var row = btn.closest('.kiosk-modify-row');
        var idx = parseInt(row && row.getAttribute('data-ing-idx'), 10);
        if (isNaN(idx) || idx < 0 || !_kioskModifiedIngredients) return;
        _kioskModifiedIngredients.splice(idx, 1);
        renderKioskModifyRows();
        kioskScheduleRecipeQuote();
      });
    });

    // Quantity changes
    tbody.querySelectorAll('.ing-qty').forEach(function (input) {
      input.addEventListener('change', function () {
        var row = input.closest('.kiosk-modify-row');
        var idx = parseInt(row && row.getAttribute('data-ing-idx'), 10);
        if (!isNaN(idx) && _kioskModifiedIngredients && _kioskModifiedIngredients[idx]) {
          _kioskModifiedIngredients[idx].quantity = parseFloat(input.value) || 0;
        }
        kioskScheduleRecipeQuote();
      });
    });

    // Search autocomplete — use kiosk ingredient catalog
    tbody.querySelectorAll('.ing-search').forEach(function (input) {
      input.addEventListener('input', function () {
        kioskShowIngredientAutocomplete(input);
      });
      input.addEventListener('focus', function () {
        if (!input.value) kioskShowIngredientAutocomplete(input);
      });
      input.addEventListener('blur', function () {
        setTimeout(function () { kioskHideIngredientAutocomplete(input); }, 200);
      });
    });
  }

  // Simple autocomplete for the modify panel using _kioskIngredientCatalog
  function kioskShowIngredientAutocomplete(input) {
    kioskHideIngredientAutocomplete(input);
    var q = (input.value || '').toLowerCase().trim();
    var matches = _kioskIngredientCatalog.filter(function (item) {
      return (item.item_name || item.name || '').toLowerCase().indexOf(q) !== -1;
    }).slice(0, 8);
    if (!matches.length) return;
    var drop = document.createElement('div');
    // GAP-7 H5/L1 36-15: use .ing-autocomplete-drop CSS class (cellar palette) — no hardcoded #fff/#ccc
    drop.className = 'ing-autocomplete-drop';
    matches.forEach(function (item) {
      var opt = document.createElement('div');
      opt.setAttribute('role', 'option');
      opt.style.cssText = 'cursor:pointer;';
      opt.textContent = item.item_name || item.name || '';
      opt.addEventListener('mousedown', function (e) {
        e.preventDefault();
        input.value = item.item_name || item.name || '';
        // Update _kioskModifiedIngredients entry
        var row = input.closest('.kiosk-modify-row');
        var idx = parseInt(row && row.getAttribute('data-ing-idx'), 10);
        if (!isNaN(idx) && _kioskModifiedIngredients && _kioskModifiedIngredients[idx]) {
          _kioskModifiedIngredients[idx].item_id = item.item_id || '';
          _kioskModifiedIngredients[idx].item_name = item.item_name || item.name || '';
          _kioskModifiedIngredients[idx].unit = item.unit || item.purchase_unit || '';
          // Update unit display in row
          var unitCell = row ? row.querySelector('.ing-unit') : null;
          if (unitCell) unitCell.textContent = _kioskModifiedIngredients[idx].unit;
        }
        kioskHideIngredientAutocomplete(input);
        kioskScheduleRecipeQuote();
      });
      drop.appendChild(opt);
    });
    var wrap = input.closest('.ing-autocomplete-wrap') || input.parentNode;
    if (wrap) {
      wrap.style.position = 'relative';
      wrap.appendChild(drop);
    }
  }

  function kioskHideIngredientAutocomplete(input) {
    var wrap = input.closest('.ing-autocomplete-wrap') || input.parentNode;
    if (!wrap) return;
    var drops = wrap.querySelectorAll('.ing-autocomplete-drop');
    drops.forEach(function (d) { d.parentNode.removeChild(d); });
  }

  // Returns item rate including maker's fee + materials fee for kits
  function kioskEffectiveRate(product) {
    var base = parseFloat(product.rate) || 0;
    return (kioskGetItemType(product) === 'kit') ? base + MAKERS_FEE + MATERIALS_FEE : base;
  }

  function kioskGetItemType(p) {
    var ptype = (p.product_type || '').toLowerCase();
    if (ptype === 'service') return 'service';
    var cfType = (p.cf_type || '').toLowerCase();
    if (cfType === 'consignment') return 'consignment';
    if (cfType && typeof KIT_CATEGORIES !== 'undefined' && KIT_CATEGORIES.indexOf(cfType) !== -1) return 'kit';
    if (cfType === 'ingredient') return 'ingredient';
    if (ptype === 'inventory' || ptype === 'goods') return 'ingredient';
    return ptype || 'other';
  }

  function kioskIsConsignment(p) {
    return kioskGetItemType(p) === 'consignment';
  }

  function kioskItemCategory(p) {
    return p.category_name || '';
  }

  function kioskIsWeightItem(p) {
    return (p.unit || '').toLowerCase() === 'kg';
  }

  // Stock overflow warning — fires when cart qty would exceed stock_on_hand (D-01, D-02, D-03)
  function kioskCheckStockOverflow(product, newQty) {
    var stock = parseFloat(product.stock_on_hand) || 0;
    var isService = (product.product_type || '').toLowerCase() === 'service';
    // Skip: services have no stock tracking, weight items are bulk, out-of-stock handled elsewhere (D-04)
    if (isService || kioskIsWeightItem(product) || stock <= 0) return true;
    if (newQty > stock) {
      var name = product.name || 'This item';
      return confirm('"' + name + '" — only ' + stock + ' in stock, cart would have ' + newQty + '. Add anyway?');
    }
    return true;
  }

  function kioskItemTax(item, qty) {
    var rate = parseFloat(item.rate) || 0;
    var pct = parseFloat(item.tax_percentage) || 0;
    return parseFloat((rate * qty * pct / 100).toFixed(2));
  }

  function kioskCartIsEmpty() {
    return Object.keys(_kioskCart).length === 0;
  }

  function kioskCartHasKits() {
    return Object.keys(_kioskCart).some(function (id) {
      return kioskGetItemType(_kioskCart[id].item) === 'kit';
    });
  }

  function kioskFindMakersFee() {
    for (var i = 0; i < _kioskProducts.length; i++) {
      if ((_kioskProducts[i].sku || '').toUpperCase() === MAKERS_FEE_SKU) return _kioskProducts[i];
    }
    return null;
  }

  function kioskFindMaterialsFee() {
    for (var i = 0; i < _kioskProducts.length; i++) {
      if ((_kioskProducts[i].sku || '').toUpperCase() === MATERIALS_FEE_SKU) return _kioskProducts[i];
    }
    return null;
  }

  function kioskCountKitsInCart() {
    var count = 0;
    var keys = Object.keys(_kioskCart);
    for (var i = 0; i < keys.length; i++) {
      var entry = _kioskCart[keys[i]];
      if (entry.item && kioskGetItemType(entry.item) === 'kit') {
        count += entry.qty;
      }
    }
    return count;
  }

  function kioskSyncKitFees() {
    if (_kioskMakersFeeWaived) return;
    var makersFee = kioskFindMakersFee();
    var materialsFee = kioskFindMaterialsFee();
    var totalKits = kioskCountKitsInCart();
    if (totalKits > 0) {
      if (makersFee) _kioskCart[makersFee.item_id] = { item: makersFee, qty: totalKits };
      if (materialsFee) _kioskCart[materialsFee.item_id] = { item: materialsFee, qty: totalKits };
    } else {
      if (makersFee) delete _kioskCart[makersFee.item_id];
      if (materialsFee) delete _kioskCart[materialsFee.item_id];
      _kioskMakersFeeWaived = false;
    }
  }

  function kioskIsKitFee(item) {
    var sku = (item.sku || '').toUpperCase();
    return sku === MAKERS_FEE_SKU || sku === MATERIALS_FEE_SKU;
  }

  function kioskFindProductById(itemId) {
    if (!itemId) return null;
    for (var i = 0; i < _kioskProducts.length; i++) {
      if (_kioskProducts[i].item_id === itemId) return _kioskProducts[i];
    }
    return null;
  }

  // ===== Cart Totals =====

  var KIOSK_TAX_RATE_DEFAULT = 0.05; // 5% GST fallback when item has no tax_percentage

  function kioskR2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

  function kioskCalcTotals() {
    var ids = Object.keys(_kioskCart);
    var subtotal = 0;
    ids.forEach(function (id) {
      var entry = _kioskCart[id];
      if (!entry || !entry.item) return; // skip non-item entries (defensive guard)
      subtotal += (parseFloat(entry.item.rate) || 0) * entry.qty;
    });
    subtotal = kioskR2(subtotal);

    // Per-line discount amounts (id -> $) drive both the total and per-line tax.
    var lineDiscount = {};
    var discountAmount = 0;

    if (_kioskDiscount) {
      if (_kioskRecipeContext) {
        // Recipe cart: the discount is server-authoritative — the discount-aware
        // quote already computed it against the recipe's product/fee portions.
        discountAmount = (_kioskQuote && _kioskQuote.discount && typeof _kioskQuote.discount.amount === 'number')
          ? _kioskQuote.discount.amount : 0;
        discountAmount = Math.min(discountAmount, subtotal);
      } else {
        // Standard cart: discount only the lines whose product type matches.
        var scope = _kioskDiscount.scope;
        var matchedIds = [];
        var matchedSubtotal = 0;
        ids.forEach(function (id) {
          var entry = _kioskCart[id];
          if (!entry || !entry.item) return;
          if (entry.item.custom || entry.item.gift_cert) return; // D-08: custom/gift_cert lines are never discounted
          var m;
          if (scope === 'cart') {
            m = true;
          } else if (scope === 'type' && typeof discountMatches === 'function') {
            m = discountMatches(classifyDiscountItem(entry.item), _kioskDiscount.applies_to || []);
          } else {
            m = false;
          }
          if (m) {
            matchedIds.push(id);
            matchedSubtotal += (parseFloat(entry.item.rate) || 0) * entry.qty;
          }
        });
        matchedSubtotal = kioskR2(matchedSubtotal);

        if (_kioskDiscount.type === 'percentage') {
          matchedIds.forEach(function (id) {
            var entry = _kioskCart[id];
            var lt = (parseFloat(entry.item.rate) || 0) * entry.qty;
            var d = kioskR2(lt * _kioskDiscount.value / 100);
            lineDiscount[id] = d;
            discountAmount += d;
          });
          discountAmount = kioskR2(discountAmount);
        } else {
          var fixed = Math.min(parseFloat(_kioskDiscount.value) || 0, matchedSubtotal);
          var remaining = fixed;
          matchedIds.forEach(function (id, k) {
            var entry = _kioskCart[id];
            var lt = (parseFloat(entry.item.rate) || 0) * entry.qty;
            var d;
            if (k === matchedIds.length - 1) {
              d = remaining;
            } else {
              d = matchedSubtotal > 0 ? kioskR2(fixed * (lt / matchedSubtotal)) : 0;
              remaining = kioskR2(remaining - d);
            }
            if (d > lt) d = lt;
            lineDiscount[id] = d;
          });
          discountAmount = kioskR2(fixed);
        }
      }
    }

    // Per-item tax using catalog tax_percentage (matches server-side calculation)
    var taxTotal = 0;
    ids.forEach(function (id) {
      var entry = _kioskCart[id];
      if (!entry || !entry.item) return;
      var lt = (parseFloat(entry.item.rate) || 0) * entry.qty;
      var d = lineDiscount[id] || 0;
      // Recipe cart uses a uniform ratio (recipe lines are mostly tax-exempt anyway).
      if (_kioskRecipeContext && discountAmount > 0 && subtotal > 0) {
        d = kioskR2(lt * (discountAmount / subtotal));
      }
      var taxable = Math.max(lt - d, 0);
      var pct = parseFloat(entry.item.tax_percentage);
      if (isNaN(pct)) pct = KIOSK_TAX_RATE_DEFAULT * 100;
      taxTotal += taxable * (pct / 100);
    });
    taxTotal = kioskR2(taxTotal);

    return {
      subtotal: subtotal,
      discount: kioskR2(discountAmount),
      tax: taxTotal,
      total: kioskR2(subtotal - discountAmount + taxTotal)
    };
  }

  // ===== View Switching =====

  function kioskShowView(name) {
    var views = ['browse', 'browse-customer', 'customer', 'payment', 'review-batches', 'receipt', 'error', 'collect', 'create-so'];
    views.forEach(function (v) {
      var el = document.getElementById('kiosk-view-' + v);
      if (el) el.style.display = (v === name) ? '' : 'none';
    });
    _kioskCurrentView = name;
    if (name === 'browse') {
      var bmBtn = document.getElementById('kiosk-browse-mode-btn');
      if (bmBtn) bmBtn.style.display = '';
    }
  }

  // ===== Recipe Browser Mode Toggle =====

  function kioskSetMode(mode) {
    _kioskMode = mode;
    var prodGrid = document.getElementById('kiosk-product-grid');
    var recipeGrid = document.getElementById('kiosk-recipe-grid');
    var recipePrompt = document.getElementById('kiosk-recipe-prompt');
    var searchBar = document.querySelector('.kiosk-search-bar');
    var filterBar = document.querySelector('.kiosk-filter-bar');
    var resultCount = document.getElementById('kiosk-result-count');

    if (prodGrid) prodGrid.style.display = mode === 'products' ? '' : 'none';
    if (recipeGrid) recipeGrid.style.display = mode === 'recipes' ? 'grid' : 'none';
    if (recipePrompt) {
      recipePrompt.style.display = 'none';
      recipePrompt.classList.remove('kiosk-recipe-prompt-view'); // GAP-5 36-15
    }
    if (searchBar) searchBar.style.display = mode === 'products' ? '' : 'none';
    if (filterBar) filterBar.style.display = mode === 'products' ? '' : 'none';
    if (resultCount) resultCount.style.display = mode === 'products' ? '' : 'none';

    var btns = document.querySelectorAll('.kiosk-mode-toggle__btn');
    btns.forEach(function (btn) {
      if (btn.getAttribute('data-mode') === mode) {
        btn.classList.add('kiosk-mode-toggle__btn--active');
      } else {
        btn.classList.remove('kiosk-mode-toggle__btn--active');
      }
    });

    if (mode === 'recipes' && !_kioskRecipesLoaded && !_kioskRecipesLoading) {
      kioskLoadRecipes();
    }
  }

  // ===== Terminal Status Bar =====

  function kioskSetTerminalStatus(ready, msg) {
    _kioskTerminalReady = ready;
    var dot = document.getElementById('kiosk-terminal-dot');
    var label = document.getElementById('kiosk-terminal-label');
    if (!dot || !label) return;
    dot.className = 'kiosk-terminal-dot' +
      (ready ? ' kiosk-terminal-dot--ready' :
       (msg.indexOf('not configured') !== -1 ? ' kiosk-terminal-dot--error' : ' kiosk-terminal-dot--warn'));
    label.textContent = msg;
  }

  function kioskCheckTerminal() {
    var mwUrl = kioskMwUrl();
    if (!mwUrl) {
      kioskSetTerminalStatus(false, 'Terminal: middleware not configured');
      return;
    }
    fetch(mwUrl + '/api/pos/status')
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.enabled) {
          kioskSetTerminalStatus(true, 'Terminal ready (' + (data.terminal_type || 'UPA') + ')');
        } else {
          var d = data.diagnostics || {};
          var msg = 'Terminal not enabled';
          if (!d.HELCIM_API_TOKEN_SET) msg = 'Terminal: HELCIM_API_TOKEN not set in Railway';
          else if (!d.HELCIM_DEVICE_CODE_SET) msg = 'Terminal: HELCIM_DEVICE_CODE not set in Railway';
          else if (d.init_error) msg = 'Terminal init error: ' + d.init_error;
          else msg = 'Terminal: device not initialized';
          kioskSetTerminalStatus(false, msg);
        }
      })
      .catch(function () {
        kioskSetTerminalStatus(false, 'Terminal: middleware unreachable');
      });
  }

  // ===== Load Products =====

  function kioskLoadProducts(forceRefresh) {
    if (_kioskProductsLoading) return;
    if (_kioskProductsLoaded && !forceRefresh) {
      kioskRenderProducts();
      return;
    }

    var mwUrl = kioskMwUrl();
    if (!mwUrl) {
      var grid = document.getElementById('kiosk-product-grid');
      if (grid) grid.innerHTML = '<p class="kiosk-loading">Middleware URL not configured.</p>';
      return;
    }

    _kioskProductsLoading = true;
    var grid = document.getElementById('kiosk-product-grid');
    if (grid) grid.innerHTML = '<p class="kiosk-loading">Loading products...</p>';

    var url = mwUrl + '/api/kiosk/products' + (forceRefresh ? '?bust=1' : '');
    fetch(url)
      .then(function (r) { return r.json(); })
      .then(function (data) {
        _kioskProducts = data.items || [];
        _kioskProductsLoaded = true;
        _kioskProductsLoading = false;
        kioskPopulateCategories();
        kioskRenderProducts();
      })
      .catch(function (err) {
        _kioskProductsLoading = false;
        var grid2 = document.getElementById('kiosk-product-grid');
        if (grid2) grid2.innerHTML = '<p class="kiosk-loading">Failed to load products: ' + err.message + '</p>';
      });
  }

  // ===== Recipe Browser =====

  function kioskLoadRecipes(forceRefresh) {
    if (_kioskRecipesLoading) return;
    if (_kioskRecipesLoaded && !forceRefresh) {
      kioskRenderRecipes();
      return;
    }
    _kioskRecipesLoading = true;
    var grid = document.getElementById('kiosk-recipe-grid');
    if (grid) grid.innerHTML = '<p class="kiosk-loading">Loading recipes...</p>';
    var mw = kioskMwUrl();
    fetch(mw + '/api/recipes?status=active', {
      headers: { 'x-api-key': SHEETS_CONFIG.MW_API_KEY || '' }
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        _kioskRecipes = data.recipes || [];
        _kioskRecipesLoaded = true;
        _kioskRecipesLoading = false;
        kioskRenderRecipes();
      })
      .catch(function (err) {
        _kioskRecipesLoading = false;
        var grid2 = document.getElementById('kiosk-recipe-grid');
        if (grid2) grid2.innerHTML = '<p class="kiosk-loading">Failed to load recipes: ' + err.message + '</p>';
      });
  }

  function kioskRecipePrice(recipe) {
    if (recipe.pricing_mode === 'dynamic' && Number(recipe.computed_price) > 0) return recipe.computed_price;
    if (recipe.pricing_mode !== 'dynamic' && Number(recipe.locked_price) > 0) return recipe.locked_price;
    if (Number(recipe.computed_price) > 0) return recipe.computed_price;
    if (Number(recipe.locked_price) > 0) return recipe.locked_price;
    return 0;
  }

  // Returns the display price adjusted for sale type context.
  // Dynamic recipes: take-out excludes service_fee + materials_fee from computed_price.
  // Locked recipes: always use locked_price regardless of sale type.
  function kioskRecipePriceForContext(recipe, saleType) {
    if (!recipe) return 0;
    if (recipe.pricing_mode === 'dynamic') {
      var base = Number(recipe.computed_price);
      if (!(base > 0)) return Number(recipe.locked_price) > 0 ? Number(recipe.locked_price) : 0;
      if (saleType === 'take-out') {
        var serviceFee = Number(recipe.service_fee) || 0;
        var materialsFee = Number(recipe.materials_fee) || 0;
        var takeOut = Math.round((base - serviceFee - materialsFee) * 100) / 100;
        return takeOut > 0 ? takeOut : base;
      }
      return base;
    }
    // Locked mode: same price regardless of sale type
    return Number(recipe.locked_price) > 0 ? Number(recipe.locked_price) : 0;
  }

  function kioskRenderRecipes() {
    if (_kioskMode !== 'recipes') return;
    var grid = document.getElementById('kiosk-recipe-grid');
    if (!grid) return;
    if (_kioskRecipes.length === 0) {
      grid.innerHTML = '<div class="kiosk-cart-empty"><p><strong>No active recipes</strong></p><p>No recipes are currently active.</p></div>';
      return;
    }
    var html = '';
    _kioskRecipes.forEach(function (r) {
      html += '<div class="kiosk-product-card kiosk-recipe-card" data-recipe-id="' + escapeHTML(r.recipe_id || '') + '">';
      html += '<div class="kiosk-product-body">';
      html += '<div class="kiosk-type-badge kiosk-type-badge--kit">Recipe</div>';
      html += '<div class="kiosk-product-name">' + escapeHTML(r.name || '') + '</div>';
      html += '<div class="kiosk-product-sku">' + escapeHTML(r.style || '') + (r.abv ? ' &middot; ' + r.abv + '%' : '') + '</div>';
      var rPrice = kioskRecipePrice(r);
      html += '<div class="kiosk-product-price" data-recipe-price-id="' + escapeHTML(r.recipe_id || '') + '">' + (rPrice > 0 ? kioskFmt(rPrice) : 'Market price') + '</div>';
      html += '<div class="kiosk-product-stock">' + (r.pricing_mode === 'dynamic' ? 'based on ingredients' : 'incl. brewing fee') + '</div>';
      html += '</div></div>';
    });
    grid.innerHTML = html;

    grid.querySelectorAll('.kiosk-recipe-card').forEach(function (card) {
      card.addEventListener('click', function () {
        var recipeId = card.getAttribute('data-recipe-id');
        var recipe = null;
        for (var i = 0; i < _kioskRecipes.length; i++) {
          if (_kioskRecipes[i].recipe_id === recipeId) { recipe = _kioskRecipes[i]; break; }
        }
        if (recipe) kioskShowRecipePrompt(recipe);
      });
    });

    // Background-warm computed_price for dynamic recipes whose detail cache was cold.
    // When enrichListPrices on the server had no detail cache, computed_price is absent.
    // Fetch each such recipe detail now so the card price updates immediately.
    _kioskRecipes.forEach(function (r) {
      if (r.pricing_mode !== 'dynamic') return;
      if (Number(r.computed_price) > 0) return; // already have a price
      if (r._fetchedDetail) {
        // Detail already fetched (e.g. user returned from prompt); update card directly.
        if (r._fetchedDetail.recipe && r._fetchedDetail.recipe.computed_price != null) {
          r.computed_price = r._fetchedDetail.recipe.computed_price;
          var priceCell = grid.querySelector('[data-recipe-price-id="' + r.recipe_id + '"]');
          if (priceCell) {
            var warm = Number(r.computed_price);
            priceCell.textContent = warm > 0 ? kioskFmt(warm) : 'Market price';
          }
        }
        return;
      }
      (function (recipe) {
        var mwWarm = kioskMwUrl();
        fetch(mwWarm + '/api/recipes/' + encodeURIComponent(recipe.recipe_id), {
          headers: { 'x-api-key': SHEETS_CONFIG.MW_API_KEY || '' }
        })
          .then(function (resp) { return resp.json(); })
          .then(function (data) {
            recipe._fetchedDetail = data;
            if (data.recipe) {
              if (data.recipe.computed_price != null) recipe.computed_price = data.recipe.computed_price;
              if (data.recipe.milling_fee_rate != null) recipe.milling_fee_rate = data.recipe.milling_fee_rate;
              var priceEl = grid.querySelector('[data-recipe-price-id="' + recipe.recipe_id + '"]');
              if (priceEl) {
                var warm = kioskRecipePrice(recipe);
                priceEl.textContent = warm > 0 ? kioskFmt(warm) : 'Market price';
              }
            }
          })
          .catch(function () {}); // silently ignore — card retains locked_price as fallback
      }(r));
    });
  }

  function kioskShowRecipePrompt(recipe) {
    _kioskSelectedRecipe = recipe;
    _kioskSaleType = null;
    _kioskMillGrain = false;
    _kioskRecipeAvailability = null;

    var grid = document.getElementById('kiosk-recipe-grid');
    var prompt = document.getElementById('kiosk-recipe-prompt');
    if (grid) grid.style.display = 'none';
    if (prompt) {
      prompt.style.display = '';
      // GAP-5 36-15: bounded scroll context so action buttons are reachable on iPad
      prompt.classList.add('kiosk-recipe-prompt-view');
    }

    var nameEl = document.getElementById('kiosk-recipe-selected-name');
    if (nameEl) nameEl.textContent = recipe.name || '';

    // Show recipe summary (style, ABV, base price, ingredients).
    // The price shown here is the base price before sale-type selection.
    // kioskUpdateSummaryPrice() is called again after sale-type changes.
    var summaryEl = document.getElementById('kiosk-recipe-summary');
    if (summaryEl) {
      var summaryHtml = '<div style="margin:0.5rem 0;color:var(--ink-secondary);font-size:0.9rem;">';
      summaryHtml += escapeHTML(recipe.style || '') + (recipe.abv ? ' &middot; ' + recipe.abv + '% ABV' : '');
      summaryHtml += '</div>';
      summaryHtml += '<div id="kiosk-recipe-summary-price" style="font-size:1.1rem;font-weight:700;color:var(--barrel);margin:0.5rem 0;">';
      var promptPrice = kioskRecipePrice(recipe);
      if (promptPrice > 0) {
        summaryHtml += kioskFmt(promptPrice) + ' per batch';
        if (recipe.pricing_mode === 'dynamic') summaryHtml += ' (based on ingredients)';
      } else {
        summaryHtml += 'Price calculated at checkout';
      }
      summaryHtml += '</div>';
      summaryHtml += '<div id="kiosk-recipe-ingredients" style="margin:0.75rem 0;font-size:0.85rem;color:var(--ink-secondary);">Loading ingredients...</div>';
      summaryEl.innerHTML = summaryHtml;

      // Fetch ingredients for display; cache on recipe object for reuse in kioskAddRecipeToCart
      // (GAP-8 36-18: kioskRenderRecipeIngredients hoisted to module scope — used here and
      // in kioskFetchRecipeQuote to update the list when the scaled quote arrives)
      if (recipe._fetchedDetail) {
        var ingEl = document.getElementById('kiosk-recipe-ingredients');
        if (ingEl && recipe._fetchedDetail.ingredients) {
          kioskRenderRecipeIngredients(recipe._fetchedDetail.ingredients, ingEl);
        }
        // Update computed_price on recipe in case card fetch already populated it
        if (recipe._fetchedDetail.recipe && recipe._fetchedDetail.recipe.computed_price != null) {
          recipe.computed_price = recipe._fetchedDetail.recipe.computed_price;
          kioskUpdateSummaryPrice();
          kioskUpdateAddToCartButton();
        }
      } else {
        var mwForSummary = kioskMwUrl();
        fetch(mwForSummary + '/api/recipes/' + encodeURIComponent(recipe.recipe_id), {
          headers: { 'x-api-key': SHEETS_CONFIG.MW_API_KEY || '' }
        })
          .then(function (r) { return r.json(); })
          .then(function (data) {
            var ingEl2 = document.getElementById('kiosk-recipe-ingredients');
            if (ingEl2 && data.ingredients) {
              kioskRenderRecipeIngredients(data.ingredients, ingEl2);
            }
            recipe._fetchedDetail = data;
            if (data.recipe) {
              if (data.recipe.computed_price != null) recipe.computed_price = data.recipe.computed_price;
              if (data.recipe.milling_fee_rate != null) recipe.milling_fee_rate = data.recipe.milling_fee_rate;
              var cardGrid = document.getElementById('kiosk-recipe-grid');
              if (cardGrid) {
                var cardPriceEl = cardGrid.querySelector('[data-recipe-price-id="' + recipe.recipe_id + '"]');
                if (cardPriceEl) {
                  var warm = kioskRecipePrice(recipe);
                  cardPriceEl.textContent = warm > 0 ? kioskFmt(warm) : 'Market price';
                }
              }
              kioskUpdateSummaryPrice();
              kioskUpdateAddToCartButton();
            }
          })
          .catch(function () {
            var ingEl3 = document.getElementById('kiosk-recipe-ingredients');
            if (ingEl3) ingEl3.innerHTML = '';
          });
      }
    }

    var inStoreBtn = document.getElementById('kiosk-btn-in-store');
    var takeOutBtn = document.getElementById('kiosk-btn-take-out');
    if (inStoreBtn) { inStoreBtn.classList.remove('kiosk-sale-type-btn--selected'); inStoreBtn.classList.add('btn-secondary'); }
    if (takeOutBtn) { takeOutBtn.classList.remove('kiosk-sale-type-btn--selected'); takeOutBtn.classList.add('btn-secondary'); }

    var millingToggle = document.getElementById('kiosk-milling-toggle');
    var addBtn = document.getElementById('kiosk-add-recipe-to-cart');
    var millCheckbox = document.getElementById('kiosk-mill-grain');
    if (millingToggle) millingToggle.style.display = 'none';
    if (addBtn) addBtn.style.display = 'none';
    if (millCheckbox) millCheckbox.checked = false;

    var bannerEl = document.getElementById('kiosk-avail-banner');
    if (bannerEl) bannerEl.innerHTML = '';

    // Phase 35 + GAP-3: Wire target-volume input, ×factor input, and live factor readout (36-05/36-10)
    var volWrap     = document.getElementById('kiosk-recipe-volume-wrap');
    var volInput    = document.getElementById('kiosk-target-volume');
    var factorInput = document.getElementById('kiosk-target-factor');  // GAP-3
    var factorRdout = document.getElementById('kiosk-scale-factor-readout');
    var conflictEl  = document.getElementById('kiosk-stock-conflict');
    var baseVol     = Number(recipe.batch_size_l) || 0;

    _kioskTargetVolumeL = baseVol > 0 ? baseVol : null;
    _kioskScaleFactor   = 1.0;
    _kioskStockOverride = false;
    if (conflictEl) conflictEl.style.display = 'none';

    if (volWrap) volWrap.style.display = '';
    if (baseVol > 0) {
      if (volInput) { volInput.value = baseVol; volInput.max = baseVol * 10; volInput.disabled = false; }
      // GAP-3: factor input pre-filled to 1.00 when a base volume exists
      if (factorInput) { factorInput.value = '1.00'; factorInput.max = '10'; factorInput.disabled = false; }
      if (factorRdout) factorRdout.textContent = '1.00\xd7 base ' + baseVol.toFixed(1) + ' L';
    } else {
      // D-11: no batch_size_l — disable BOTH inputs (do NOT assume factor 1)
      if (volInput) volInput.disabled = true;
      if (factorInput) factorInput.disabled = true;  // FAC-4: no-base disables both
      if (factorRdout) factorRdout.textContent = 'Set batch size (L) on this recipe to enable scaling';
    }

    if (volInput) {
      volInput.oninput = function () {
        var val = parseFloat(volInput.value) || 0;
        _kioskTargetVolumeL = val > 0 ? val : null;
        var factor = (val > 0 && baseVol > 0) ? val / baseVol : 1;
        _kioskScaleFactor = factor;
        // FAC-2: litres → factor sync (display only — server quote is authoritative for price, D-06)
        if (factorInput) factorInput.value = factor.toFixed(2);
        if (factorRdout) {
          factorRdout.textContent = factor.toFixed(2) + '\xd7 base ' + baseVol.toFixed(1) + ' L';
        }
        // Reset stock conflict state on volume change
        _kioskStockOverride = false;
        if (conflictEl) conflictEl.style.display = 'none';
        // Re-fetch quote for new target volume (debounced, 35-06)
        kioskScheduleRecipeQuote();
      };
    }

    // GAP-3: ×factor input — factor → litres sync (client-side display only, D-06)
    // The factor is DISPLAY-ONLY; the charged price still comes from kioskScheduleRecipeQuote.
    if (factorInput) {
      factorInput.oninput = function () {
        var rawFactor = parseFloat(factorInput.value) || 0;
        // Clamp factor to (0, 10] — bounds matching litres max of base×10
        var clampedFactor = rawFactor <= 0 ? 0.1 : (rawFactor > 10 ? 10 : rawFactor);
        if (clampedFactor !== rawFactor && rawFactor > 0) {
          factorInput.value = clampedFactor.toFixed(2);
        }
        if (clampedFactor <= 0) return;  // invalid — do nothing

        // FAC-1: factor → litres = factor × base, rounded to nearest 0.5 L
        var rawLitres = clampedFactor * baseVol;
        var roundedLitres = Math.round(rawLitres * 2) / 2;  // nearest 0.5
        roundedLitres = Math.max(0.5, Math.min(roundedLitres, baseVol * 10));

        _kioskTargetVolumeL = roundedLitres;
        _kioskScaleFactor   = clampedFactor;

        if (volInput) volInput.value = roundedLitres;
        if (factorRdout) {
          factorRdout.textContent = clampedFactor.toFixed(2) + '\xd7 base ' + baseVol.toFixed(1) + ' L';
        }
        // Reset stock conflict state on factor change
        _kioskStockOverride = false;
        if (conflictEl) conflictEl.style.display = 'none';
        // FAC-5: re-quote after factor change (client-side display only — server quote is authoritative)
        kioskScheduleRecipeQuote();
      };
    }

    // Initial quote fetch for the base volume (35-06)
    kioskScheduleRecipeQuote();

    // Phase 36: Wire ingredient modification panel (MOD-01)
    _kioskModifiedIngredients = null;  // reset on recipe change
    _kioskModifyPanelOpen = false;

    var modifyWrap   = document.getElementById('kiosk-recipe-modify-wrap');
    var modifyToggle = document.getElementById('kiosk-modify-toggle');
    var modifyPanel  = document.getElementById('kiosk-modify-panel');
    var pricePreview = document.getElementById('kiosk-recipe-price-preview');
    var lockedNotice = document.getElementById('kiosk-locked-price-notice');
    var addRowBtn    = document.getElementById('kiosk-modify-add-row');

    if (modifyWrap) modifyWrap.style.display = '';
    if (modifyPanel) modifyPanel.style.display = 'none';
    if (pricePreview) { pricePreview.style.display = 'none'; pricePreview.innerHTML = ''; }
    if (lockedNotice) lockedNotice.style.display = 'none';

    if (modifyToggle) {
      modifyToggle.textContent = 'Modify Ingredients';
      modifyToggle.onclick = function () {
        _kioskModifyPanelOpen = !_kioskModifyPanelOpen;
        if (_kioskModifyPanelOpen) {
          // Lazy clone: deep-copy base ingredients on first expand (D-04)
          if (!Array.isArray(_kioskModifiedIngredients)) {
            var baseIngs = (recipe.ingredients && recipe.ingredients.length)
              ? recipe.ingredients
              : (_kioskSelectedRecipe && _kioskSelectedRecipe._fetchedDetail &&
                 _kioskSelectedRecipe._fetchedDetail.ingredients)
                ? _kioskSelectedRecipe._fetchedDetail.ingredients
                : [];
            _kioskModifiedIngredients = baseIngs.map(function (ing) {
              return Object.assign({}, ing);
            });
          }
          if (modifyPanel) modifyPanel.style.display = '';
          modifyToggle.textContent = 'Modify Ingredients ▲';
          renderKioskModifyRows();
          // Show locked-price notice for locked recipes
          if (lockedNotice && recipe.pricing_mode === 'locked') {
            lockedNotice.style.display = '';
          }
          // Show price preview
          if (pricePreview) pricePreview.style.display = '';
          kioskScheduleRecipeQuote();
          // Lazy-load ingredient catalog for autocomplete
          kioskLoadIngredientCatalog();
        } else {
          if (modifyPanel) modifyPanel.style.display = 'none';
          modifyToggle.textContent = 'Modify Ingredients';
        }
      };
    }

    if (addRowBtn) {
      addRowBtn.onclick = function () {
        if (!Array.isArray(_kioskModifiedIngredients)) {
          _kioskModifiedIngredients = [];
        }
        _kioskModifiedIngredients.push({
          item_id: '',
          item_name: '',
          unit: '',
          quantity: 0
        });
        renderKioskModifyRows();
        kioskScheduleRecipeQuote();
      };
    }

    kioskCheckRecipeAvailability(recipe.recipe_id);
  }

  // Updates #kiosk-recipe-summary-price to reflect current sale type and computed_price.
  function kioskUpdateSummaryPrice() {
    var priceEl = document.getElementById('kiosk-recipe-summary-price');
    if (!priceEl || !_kioskSelectedRecipe) return;
    var recipe = _kioskSelectedRecipe;
    var contextPrice = kioskRecipePriceForContext(recipe, _kioskSaleType);
    var millingRate = Number(recipe.milling_fee_rate) || 0;
    if (_kioskMillGrain && _kioskSaleType === 'take-out' && millingRate > 0) {
      contextPrice += millingRate;
    }
    if (contextPrice > 0) {
      var label = kioskFmt(contextPrice) + ' per batch';
      if (recipe.pricing_mode === 'dynamic') {
        label += _kioskSaleType === 'take-out' ? ' (ingredients only)' : ' (based on ingredients)';
      }
      if (_kioskMillGrain && _kioskSaleType === 'take-out') label += ' (incl. milling)';
      priceEl.textContent = label;
    } else {
      priceEl.textContent = 'Price calculated at checkout';
    }
  }

  function kioskSelectSaleType(saleType) {
    _kioskSaleType = saleType;
    var inStoreBtn = document.getElementById('kiosk-btn-in-store');
    var takeOutBtn = document.getElementById('kiosk-btn-take-out');
    var millingToggle = document.getElementById('kiosk-milling-toggle');

    if (inStoreBtn) {
      if (saleType === 'in-store') { inStoreBtn.classList.add('kiosk-sale-type-btn--selected'); inStoreBtn.classList.remove('btn-secondary'); }
      else { inStoreBtn.classList.remove('kiosk-sale-type-btn--selected'); inStoreBtn.classList.add('btn-secondary'); }
    }
    if (takeOutBtn) {
      if (saleType === 'take-out') { takeOutBtn.classList.add('kiosk-sale-type-btn--selected'); takeOutBtn.classList.remove('btn-secondary'); }
      else { takeOutBtn.classList.remove('kiosk-sale-type-btn--selected'); takeOutBtn.classList.add('btn-secondary'); }
    }

    if (millingToggle) millingToggle.style.display = saleType === 'take-out' ? '' : 'none';

    // GAP-4 36-15: show price-preview as soon as a sale-type is selected (not just when modify panel opens)
    // The quote fetch triggered below will immediately set "Calculating…" then the real price.
    var pricePreviewEl = document.getElementById('kiosk-recipe-price-preview');
    if (pricePreviewEl) pricePreviewEl.style.display = '';

    kioskUpdateSummaryPrice();
    kioskScheduleRecipeQuote();  // Phase 35+36: re-quote on sale-type change (36-05)
    kioskUpdateAddToCartButton();
  }

  function kioskUpdateAddToCartButton() {
    var addBtn = document.getElementById('kiosk-add-recipe-to-cart');
    if (!addBtn || !_kioskSelectedRecipe || !_kioskSaleType) {
      if (addBtn) addBtn.style.display = 'none';
      return;
    }

    var avail = _kioskRecipeAvailability;
    if (avail && (avail.summary === 'cannot_brew' || avail.summary === 'unknown')) {
      addBtn.style.display = 'none';
      return;
    }

    // Phase 35+36: use server quote total when available (scaled + authoritative)
    var price;
    if (_kioskQuote && _kioskQuote.recipe_id === _kioskSelectedRecipe.recipe_id &&
        typeof _kioskQuote.total === 'number' && _kioskQuote.total > 0) {
      price = _kioskQuote.total;
    } else {
      price = kioskRecipePriceForContext(_kioskSelectedRecipe, _kioskSaleType);
      var millingRate = Number(_kioskSelectedRecipe.milling_fee_rate) || 0;
      if (_kioskMillGrain && _kioskSaleType === 'take-out' && millingRate > 0) {
        price += millingRate;
      }
    }
    // Phase 36: append "(Modified)" when ingredient list has been changed
    var isModified = Array.isArray(_kioskModifiedIngredients);
    var btnLabel = (price > 0 ? 'Add to Cart — ' + kioskFmt(price) : 'Add to Cart') +
                   (isModified ? ' (Modified)' : '');
    addBtn.textContent = btnLabel;
    addBtn.style.display = '';
  }

  function kioskCheckRecipeAvailability(recipeId) {
    var bannerEl = document.getElementById('kiosk-avail-banner');
    if (bannerEl) bannerEl.innerHTML = '<p class="kiosk-loading">Checking stock...</p>';
    var mw = kioskMwUrl();
    fetch(mw + '/api/recipes/' + encodeURIComponent(recipeId) + '/availability', {
      headers: { 'x-api-key': SHEETS_CONFIG.MW_API_KEY || '' }
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        _kioskRecipeAvailability = data;
        kioskRenderAvailBanner(data);
        kioskUpdateAddToCartButton();
      })
      .catch(function () {
        _kioskRecipeAvailability = { summary: 'unknown' };
        kioskRenderAvailBanner({ summary: 'unknown' });
        kioskUpdateAddToCartButton();
      });
  }

  function kioskRenderAvailBanner(avail) {
    var bannerEl = document.getElementById('kiosk-avail-banner');
    if (!bannerEl) return;
    var summary = avail.summary || 'unknown';
    if (summary === 'all_ok') {
      bannerEl.innerHTML = '';
      return;
    }
    if (summary === 'some_low') {
      bannerEl.innerHTML = '<div class="kiosk-avail-warning">Some ingredients are low — this may be the last batch. <button type="button" class="btn-secondary" id="kiosk-avail-dismiss" style="margin-left:8px;padding:4px 12px;font-size:0.82rem;">Proceed anyway</button></div>';
      var dismissBtn = document.getElementById('kiosk-avail-dismiss');
      if (dismissBtn) {
        dismissBtn.addEventListener('click', function () { bannerEl.innerHTML = ''; });
      }
      return;
    }
    if (summary === 'cannot_brew') {
      bannerEl.innerHTML = '<div class="kiosk-avail-block">Cannot proceed: one or more ingredients are out of stock.</div>';
      return;
    }
    bannerEl.innerHTML = '<div class="kiosk-avail-block">Stock data unavailable — refresh and try again.</div>';
  }

  function kioskAddRecipeToCart() {
    if (!_kioskSelectedRecipe || !_kioskSaleType) return;
    var recipe = _kioskSelectedRecipe;
    var avail = _kioskRecipeAvailability;

    if (avail && (avail.summary === 'cannot_brew' || avail.summary === 'unknown')) return;

    _kioskCart = {};

    function processRecipeData(data) {
      if (!data.recipe) {
        alert('Failed to load recipe details');
        return;
      }
      var fullRecipe = data.recipe;
      var ingredients = data.ingredients || [];
      var pricingMode = fullRecipe.pricing_mode || recipe.pricing_mode || (Number(recipe.locked_price) > 0 ? 'locked' : 'dynamic');

      _kioskRecipeContext = {
        recipe_id: recipe.recipe_id,
        recipe_name: recipe.name,
        sale_type: _kioskSaleType,
        mill_grain: _kioskMillGrain,
        locked_price: recipe.locked_price,
        pricing_mode: pricingMode,
        ingredients: ingredients,
        target_volume_l: _kioskTargetVolumeL
      };

      // Phase 35+36: Use server quote (scaled+modified) when available; fall back to base data
      var quoteForCart = (_kioskQuote &&
                          _kioskQuote.recipe_id === recipe.recipe_id &&
                          Array.isArray(_kioskQuote.ingredients))
                         ? _kioskQuote : null;

      if (pricingMode === 'dynamic') {
        // Add each ingredient as a priced line item
        // Prefer scaled+modified quantities from server quote when present
        var ingSource = quoteForCart ? quoteForCart.ingredients : ingredients;
        ingSource.forEach(function (ing, ingIdx) {
          // Unique per occurrence: a recipe can list the same item_id multiple
          // times (e.g. hop/salt additions at different times). Keying by
          // item_id alone collided and dropped all but the last → undercharge.
          var key = 'recipe-ing-' + ingIdx + '-' + (ing.item_id || ing.ingredient_id);
          var ingQty = Number(ing.quantity) || 0;
          var ingRate;
          if (quoteForCart) {
            // quote ingredient: line_total is authoritative; fall back to rate * qty
            ingRate = Number(ing.line_total) || (Number(ing.rate) * ingQty);
          } else {
            ingRate = (Number(ing.rate) || 0) * ingQty;
          }
          _kioskCart[key] = {
            item: {
              item_id: ing.item_id,
              name: escapeHTML(ing.item_name) + ' (' + ingQty + ' ' + escapeHTML(ing.unit || '') + ')',
              rate: ingRate,
              tax_percentage: Number(ing.tax_percentage) || 0,
              product_type: 'recipe_ingredient'
            },
            qty: 1
          };
        });
        // Add fee lines for in-store sales
        if (_kioskSaleType === 'in-store') {
          if (Number(fullRecipe.service_fee) > 0) {
            _kioskCart['recipe-fee-brewing'] = {
              item: { item_id: 'fee-brewing', name: 'Brewing Fee', rate: parseFloat(fullRecipe.service_fee) || 0, tax_percentage: Number(fullRecipe.brewing_fee_tax) || 0, product_type: 'fee' },
              qty: 1
            };
          }
          if (Number(fullRecipe.materials_fee) > 0) {
            _kioskCart['recipe-fee-materials'] = {
              item: { item_id: 'fee-materials', name: 'Materials Fee', rate: parseFloat(fullRecipe.materials_fee) || 0, tax_percentage: Number(fullRecipe.materials_fee_tax) || 0, product_type: 'fee' },
              qty: 1
            };
          }
        }
        // Add milling fee for take-out when checked
        if (_kioskSaleType === 'take-out' && _kioskMillGrain) {
          var millingFee = Number(recipe.milling_fee_rate || fullRecipe.milling_fee_rate) || 0;
          _kioskCart['recipe-fee-milling'] = {
            item: { item_id: 'fee-milling', name: 'Milling Fee', rate: millingFee, tax_percentage: Number(recipe.milling_fee_tax || fullRecipe.milling_fee_tax) || 0, product_type: 'fee' },
            qty: 1
          };
        }
      } else {
        // Locked mode: ingredient lines as info-only (rate=0), plus single total line
        // Show SCALED+MODIFIED quantities from quote when available, otherwise base quantities
        var lockedIngSource = quoteForCart ? quoteForCart.ingredients : ingredients;
        lockedIngSource.forEach(function (ing, ingIdx) {
          // Unique per occurrence (see dynamic-mode note): same item_id may
          // appear multiple times in a recipe; index-qualify the cart key.
          var key = 'recipe-ing-' + ingIdx + '-' + (ing.item_id || ing.ingredient_id);
          _kioskCart[key] = {
            item: {
              item_id: ing.item_id,
              name: escapeHTML(ing.item_name) + ' (' + (Number(ing.quantity) || 0) + ' ' + escapeHTML(ing.unit || '') + ')',
              rate: 0,
              tax_percentage: 0,
              product_type: 'recipe_ingredient'
            },
            qty: 1
          };
        });
        // Single total line — use the PRE-DISCOUNT quote total when available, else
        // locked_price. The discount is applied separately in kioskCalcTotals from
        // the server quote, so the cart line must stay at the undiscounted amount.
        var packagePrice = quoteForCart
          ? Number(quoteForCart.total_before_discount != null ? quoteForCart.total_before_discount : quoteForCart.total)
          : (parseFloat(recipe.locked_price) || 0);
        _kioskCart['recipe-total'] = {
          item: {
            item_id: recipe.recipe_id,
            name: escapeHTML(recipe.name || recipe.recipe_id) + ' — Package Price',
            rate: packagePrice,
            tax_percentage: 0,
            product_type: 'recipe'
          },
          qty: 1
        };
      }

      kioskSetMode('products');
      kioskRenderCart();
    }

    // Always fetch fresh to ensure tax rates and prices are current
    {
      var mw = kioskMwUrl();
      fetch(mw + '/api/recipes/' + encodeURIComponent(recipe.recipe_id), {
        headers: { 'x-api-key': SHEETS_CONFIG.MW_API_KEY || '' }
      })
        .then(function (r) { return r.json(); })
        .then(processRecipeData)
        .catch(function (err) {
          alert('Failed to load recipe: ' + err.message);
        });
    }
  }

  function kioskPopulateCategories() {
    var sel = document.getElementById('kiosk-category-filter');
    if (!sel) return;

    var typeFilter = _kioskFilters.type;
    var cats = {};
    _kioskProducts.forEach(function (p) {
      // Filter categories based on selected type
      if (typeFilter === 'consignment') {
        if (!kioskIsConsignment(p)) return;
      } else if (typeFilter) {
        if ((p.product_type || '').toLowerCase() !== typeFilter) return;
      }
      var cat = kioskItemCategory(p);
      if (cat) cats[cat] = true;
    });

    var prev = sel.value;
    while (sel.options.length > 1) sel.remove(1);

    Object.keys(cats).sort().forEach(function (cat) {
      var opt = document.createElement('option');
      opt.value = cat;
      opt.textContent = cat;
      sel.appendChild(opt);
    });

    // Add "Other" for uncategorized items within current type filter (D-06)
    var hasUncategorized = _kioskProducts.some(function (p) {
      if (typeFilter === 'consignment') {
        if (!kioskIsConsignment(p)) return false;
      } else if (typeFilter) {
        if ((p.product_type || '').toLowerCase() !== typeFilter) return false;
      }
      return !kioskItemCategory(p);
    });
    if (hasUncategorized) {
      var otherOpt = document.createElement('option');
      otherOpt.value = '__other__';
      otherOpt.textContent = 'Other';
      sel.appendChild(otherOpt);
    }

    // Restore previous selection if still valid
    if (cats[prev] || prev === '__other__') {
      sel.value = prev;
    } else {
      sel.value = '';
      _kioskFilters.category = '';
    }
  }

  // ===== Filter + Sort Products =====

  function kioskGetFilteredProducts() {
    var search = (_kioskFilters.search || '').toLowerCase().trim();
    var cat = _kioskFilters.category;
    var type = _kioskFilters.type;
    var stockStatus = _kioskFilters.stockStatus;
    var hideOos = _kioskFilters.hideOos;

    var filtered = _kioskProducts.filter(function (p) {
      var itemType = kioskGetItemType(p);
      var isService = itemType === 'service';
      var stock = parseFloat(p.stock_on_hand) || 0;

      // Type filter
      if (type && itemType !== type) return false;

      // Category filter
      var itemCat = kioskItemCategory(p);
      if (cat === '__other__') {
        if (itemCat !== '') return false;
      } else if (cat && itemCat.toLowerCase() !== cat.toLowerCase()) return false;

      // Stock status filter
      if (stockStatus === 'in-stock' && stock <= 0 && !isService) return false;
      if (stockStatus === 'low-stock' && (stock <= 0 || stock > 5)) return false;
      if (stockStatus === 'out-of-stock' && stock > 0) return false;

      // Hide OOS (skip services)
      if (hideOos && stock <= 0 && !isService) return false;

      // Text search
      if (search) {
        var haystack = ((p.name || '') + ' ' + (p.sku || '') + ' ' + itemCat + ' ' + itemType).toLowerCase();
        if (haystack.indexOf(search) === -1) return false;
      }
      return true;
    });

    // Sort
    var sort = _kioskFilters.sort || 'name-asc';
    filtered.sort(function (a, b) {
      switch (sort) {
        case 'name-asc': return (a.name || '').localeCompare(b.name || '');
        case 'name-desc': return (b.name || '').localeCompare(a.name || '');
        case 'price-asc': return (parseFloat(a.rate) || 0) - (parseFloat(b.rate) || 0);
        case 'price-desc': return (parseFloat(b.rate) || 0) - (parseFloat(a.rate) || 0);
        case 'stock-asc': return (parseFloat(a.stock_on_hand) || 0) - (parseFloat(b.stock_on_hand) || 0);
        default: return 0;
      }
    });
    return filtered;
  }

  // ===== Render Product Grid =====

  function kioskRenderProducts() {
    var grid = document.getElementById('kiosk-product-grid');
    if (!grid) return;
    var filtered = kioskGetFilteredProducts();

    // Update result count
    var countEl = document.getElementById('kiosk-result-count');
    if (countEl) countEl.textContent = 'Showing ' + filtered.length + ' of ' + _kioskProducts.length + ' products';

    if (filtered.length === 0) {
      grid.innerHTML = '<p class="kiosk-loading">No products match your filters.</p>';
      return;
    }
    if (_kioskViewMode === 'list') {
      grid.classList.add('kiosk-product-grid--list');
      kioskRenderProductList(grid, filtered);
    } else {
      grid.classList.remove('kiosk-product-grid--list');
      kioskRenderProductGrid(grid, filtered);
    }
  }

  function kioskRenderProductGrid(grid, filtered) {
    var html = '';
    filtered.forEach(function (p) {
      var cartEntry = _kioskCart[p.item_id];
      var inCart = cartEntry ? cartEntry.qty : 0;
      var stock = parseFloat(p.stock_on_hand) || 0;
      var itemType = kioskGetItemType(p);
      var isService = itemType === 'service';
      var outOfStock = !isService && stock <= 0;
      var lowStock = !outOfStock && !isService && stock <= 5;

      var cardClass = 'kiosk-product-card' + (outOfStock ? ' kiosk-product-card--out-of-stock' : '');

      var placeholderEmoji = isService ? '&#9881;' : '&#127866;';
      var imgHtml;
      if (p.image_name && p.sku) {
        imgHtml = '<img class="kiosk-product-img" src="images/products/' +
          encodeURIComponent(p.sku) + '.png" alt="" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\';">' +
          '<div class="kiosk-product-img-placeholder" style="display:none;">' + placeholderEmoji + '</div>';
      } else {
        imgHtml = '<div class="kiosk-product-img-placeholder">' + placeholderEmoji + '</div>';
      }

      var stockLabel, stockClass;
      if (isService) {
        stockLabel = '';
        stockClass = '';
      } else if (outOfStock) {
        stockLabel = stock < 0 ? (Math.round(stock) + ' in stock') : 'Out of stock';
        stockClass = 'kiosk-product-stock--out';
      } else if (lowStock) {
        stockLabel = 'Low stock (' + Math.round(stock) + ')';
        stockClass = 'kiosk-product-stock--low';
      } else {
        stockLabel = 'In stock';
        stockClass = '';
      }

      html += '<div class="' + cardClass + '" data-item-id="' + p.item_id + '">';
      if (inCart > 0) {
        html += '<div class="kiosk-card-in-cart">' + inCart + '</div>';
      }
      if (itemType === 'consignment') {
        html += '<div class="kiosk-consignment-badge">Consignment</div>';
      } else if (isService) {
        html += '<div class="kiosk-service-badge">Service</div>';
      }
      html += imgHtml;
      var displayRate = parseFloat(p.rate) || 0;
      html += '<div class="kiosk-product-body">';
      if (p.manufacturer && kioskGetItemType(p) === 'kit') {
        html += '<div class="kiosk-product-producer">' + escapeHTML(p.manufacturer) + '</div>';
      }
      html += '<div class="kiosk-product-name">' + escapeHTML(p.name || '') + '</div>';
      if (p.sku) html += '<div class="kiosk-product-sku">' + escapeHTML(p.sku) + '</div>';
      html += '<div class="kiosk-product-price">' + kioskFmt(displayRate) + '</div>';
      if (stockLabel) html += '<div class="kiosk-product-stock ' + stockClass + '">' + stockLabel + '</div>';
      html += '</div>';
      html += '</div>';
    });

    grid.innerHTML = html;

    var cards = grid.querySelectorAll('.kiosk-product-card');
    cards.forEach(function (card) {
      card.addEventListener('click', function () {
        var itemId = card.getAttribute('data-item-id');
        var product = _kioskProducts.filter(function (p) { return p.item_id === itemId; })[0];
        if (!product) return;
        var isService = (product.product_type || '').toLowerCase() === 'service';
        var stock = parseFloat(product.stock_on_hand) || 0;
        if (!isService && stock <= 0) {
          if (!confirm('"' + (product.name || 'This item') + '" is out of stock. Add to cart anyway (special order)?')) return;
        }
        kioskAddToCart(product);
      });
    });
  }

  function kioskRenderProductList(grid, filtered) {
    var html = '<table class="kiosk-list-table">';
    html += '<thead><tr>';
    html += '<th>Name</th>';
    html += '<th>Type</th>';
    html += '<th>Category</th>';
    html += '<th>Price</th>';
    html += '<th>Stock</th>';
    html += '<th></th>';
    html += '</tr></thead>';
    html += '<tbody>';

    filtered.forEach(function (p) {
      var stock = parseFloat(p.stock_on_hand) || 0;
      var itemType = kioskGetItemType(p);
      var isService = itemType === 'service';
      var outOfStock = !isService && stock <= 0;
      var rowClass = outOfStock ? ' kiosk-list-row--oos' : '';
      var displayRate = parseFloat(p.rate) || 0;
      var cat = kioskItemCategory(p);
      var typeLabel = itemType.charAt(0).toUpperCase() + itemType.slice(1);

      html += '<tr class="kiosk-list-row' + rowClass + '" data-item-id="' + escapeHTML(p.item_id) + '">';
      var kioskListName = p.manufacturer && kioskGetItemType(p) === 'kit'
        ? escapeHTML(p.manufacturer) + ' — ' + escapeHTML(p.name || '')
        : escapeHTML(p.name || '');
      html += '<td><div class="kiosk-list-name">' + kioskListName + '</div>';
      if (p.sku) html += '<div class="kiosk-list-sku">' + escapeHTML(p.sku) + '</div>';
      html += '</td>';

      // Type badge
      html += '<td>';
      html += '<span class="kiosk-type-badge kiosk-type-badge--' + escapeHTML(itemType) + '">' + escapeHTML(typeLabel) + '</span>';
      html += '</td>';

      html += '<td>' + escapeHTML(cat) + '</td>';
      html += '<td>' + kioskFmt(displayRate) + '</td>';

      // Stock
      html += '<td>';
      if (isService) {
        html += '<span class="kiosk-stock--service">Service</span>';
      } else if (outOfStock) {
        html += '<span class="kiosk-product-stock--out">Out of stock</span>';
      } else if (stock <= 5) {
        html += '<span class="kiosk-product-stock--low">Low (' + Math.round(stock) + ')</span>';
      } else {
        html += Math.round(stock);
      }
      html += '</td>';

      // Add button
      html += '<td>';
      html += '<button type="button" class="kiosk-list-add-btn' + (outOfStock ? ' kiosk-list-add-btn--oos' : '') + '" data-item-id="' + escapeHTML(p.item_id) + '">+</button>';
      html += '</td>';

      html += '</tr>';
    });

    html += '</tbody></table>';
    grid.innerHTML = html;

    Array.prototype.forEach.call(grid.querySelectorAll('.kiosk-list-add-btn'), function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var itemId = btn.getAttribute('data-item-id');
        var product = null;
        for (var i = 0; i < _kioskProducts.length; i++) {
          if (_kioskProducts[i].item_id === itemId) { product = _kioskProducts[i]; break; }
        }
        if (!product) return;
        var isService = (product.product_type || '').toLowerCase() === 'service';
        var stock = parseFloat(product.stock_on_hand) || 0;
        if (!isService && stock <= 0) {
          if (!confirm('"' + (product.name || 'This item') + '" is out of stock. Add to cart anyway (special order)?')) return;
        }
        kioskAddToCart(product);
      });
    });
  }

  // ===== Cart Management =====

  function kioskAddToCart(product) {
    var id = product.item_id;
    if (kioskIsWeightItem(product)) {
      var input = prompt('Enter quantity in kg for "' + (product.name || '') + '":', _kioskCart[id] ? _kioskCart[id].qty : '1');
      if (input === null) return;
      var qty = parseFloat(input);
      if (!isFinite(qty) || qty <= 0) return;
      qty = Math.round(qty * 1000) / 1000;
      _kioskCart[id] = { item: product, qty: qty };
    } else {
      var currentQty = _kioskCart[id] ? _kioskCart[id].qty : 0;
      var newQty = currentQty + 1;
      if (!kioskCheckStockOverflow(product, newQty)) return;
      if (_kioskCart[id]) {
        _kioskCart[id].qty = newQty;
      } else {
        _kioskCart[id] = { item: product, qty: 1 };
      }
    }

    // If adding a kit, reset waiver and sync maker's fee
    if (kioskGetItemType(product) === 'kit') {
      _kioskMakersFeeWaived = false;
      kioskSyncKitFees();
    }

    kioskRenderCart();
    kioskRenderProducts();
  }

  // ===== Customer Browse Mode =====

  function kioskCbIsWine(p) {
    var haystack = ((p.name || '') + ' ' + kioskItemCategory(p)).toLowerCase();
    var keywords = ['wine', 'red', 'white', 'ros', 'cider', 'seltzer', 'chardonnay', 'merlot', 'cab', 'pinot', 'sauvignon', 'malbec', 'shiraz', 'gewurz'];
    for (var i = 0; i < keywords.length; i++) {
      if (haystack.indexOf(keywords[i]) !== -1) return true;
    }
    return false;
  }

  function kioskCbIsBeer(p) {
    var haystack = ((p.name || '') + ' ' + kioskItemCategory(p)).toLowerCase();
    var keywords = ['beer', 'ale', 'lager', 'ipa', 'stout', 'porter', 'hefe', 'wheat', 'pilsner', 'pale', 'amber'];
    for (var i = 0; i < keywords.length; i++) {
      if (haystack.indexOf(keywords[i]) !== -1) return true;
    }
    return false;
  }

  function kioskCbRenderWineCard(p) {
    var inCart = _kioskCart[p.item_id] ? _kioskCart[p.item_id].qty : 0;
    var oos = (parseFloat(p.stock_on_hand) || 0) <= 0;
    var cat = kioskItemCategory(p);
    var price = kioskEffectiveRate(p);
    var html = '<div class="kiosk-label-wine' + (oos ? ' oos' : '') + '" data-item-id="' + p.item_id + '">';
    if (inCart > 0) html += '<div class="kiosk-cb-in-cart-badge">' + inCart + '</div>';
    html += '<div class="cb-label-body">';
    html += '<div class="cb-ornament"></div>';
    html += '<div class="cb-product-name">' + escapeHTML(p.name) + '</div>';
    if (cat) html += '<div class="cb-product-category">' + escapeHTML(cat) + '</div>';
    html += '<div class="cb-spacer"></div>';
    html += '</div>';
    html += '<div class="cb-price-footer">';
    html += '<div class="cb-price-col"><div class="cb-price-label">In Store</div><div class="cb-price-value">' + kioskFmt(price) + '</div></div>';
    html += '</div>';
    html += '<button type="button" class="cb-add-btn' + (inCart > 0 ? ' in-cart' : '') + '" ' + (oos ? 'disabled' : '') + '>';
    html += oos ? 'Out of Stock' : (inCart > 0 ? '\u2713 In Cart (' + inCart + ')' : 'Add to Cart');
    html += '</button>';
    html += '</div>';
    return html;
  }

  function kioskCbRenderBeerCard(p) {
    var inCart = _kioskCart[p.item_id] ? _kioskCart[p.item_id].qty : 0;
    var oos = (parseFloat(p.stock_on_hand) || 0) <= 0;
    var cat = kioskItemCategory(p);
    var price = kioskEffectiveRate(p);
    var html = '<div class="kiosk-label-beer' + (oos ? ' oos' : '') + '" data-item-id="' + p.item_id + '">';
    if (inCart > 0) html += '<div class="kiosk-cb-in-cart-badge">' + inCart + '</div>';
    html += '<div class="cb-label-body">';
    html += '<div class="cb-product-category">' + escapeHTML(cat || 'Beer') + '</div>';
    html += '<div class="cb-product-name">' + escapeHTML(p.name) + '</div>';
    html += '<div class="cb-gold-rule"></div>';
    html += '<div class="cb-spacer"></div>';
    html += '</div>';
    html += '<div class="cb-price-footer">';
    html += '<div class="cb-price-col"><div class="cb-price-label">In Store</div><div class="cb-price-value">' + kioskFmt(price) + '</div></div>';
    html += '</div>';
    html += '<button type="button" class="cb-add-btn' + (inCart > 0 ? ' in-cart' : '') + '" ' + (oos ? 'disabled' : '') + '>';
    html += oos ? 'Out of Stock' : (inCart > 0 ? '\u2713 In Cart (' + inCart + ')' : 'Add to Cart');
    html += '</button>';
    html += '</div>';
    return html;
  }

  function kioskCbRenderCard(p) {
    var inCart = _kioskCart[p.item_id] ? _kioskCart[p.item_id].qty : 0;
    var oos = (parseFloat(p.stock_on_hand) || 0) <= 0;
    var cat = kioskItemCategory(p);
    var price = kioskEffectiveRate(p);
    var stock = parseFloat(p.stock_on_hand) || 0;
    var stockClass = oos ? 'out' : (stock <= 5 ? 'low' : '');
    var stockLabel = oos ? 'Out of stock' : (stock <= 5 ? 'Low stock (' + Math.round(stock) + ')' : '');
    var html = '<div class="kiosk-cb-card' + (oos ? ' oos' : '') + '" data-item-id="' + p.item_id + '">';
    if (inCart > 0) html += '<div class="kiosk-cb-in-cart-badge">' + inCart + '</div>';
    if (p.image_name && p.sku) {
      html += '<img class="cb-card-img" src="images/products/' + encodeURIComponent(p.sku) + '.png" alt="" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\';">';
      html += '<div class="cb-card-img-placeholder" style="display:none;">\uD83D\uDCE6</div>';
    } else {
      html += '<div class="cb-card-img-placeholder">\uD83D\uDCE6</div>';
    }
    html += '<div class="cb-card-body">';
    html += '<div class="cb-card-name">' + escapeHTML(p.name) + '</div>';
    if (cat) html += '<div class="cb-card-category">' + escapeHTML(cat) + '</div>';
    html += '<div class="cb-card-price">' + kioskFmt(price) + '</div>';
    if (stockLabel) html += '<div class="cb-card-stock ' + stockClass + '">' + stockLabel + '</div>';
    html += '<button type="button" class="cb-add-btn' + (inCart > 0 ? ' in-cart' : '') + '" ' + (oos ? 'disabled' : '') + '>';
    html += oos ? 'Out of Stock' : (inCart > 0 ? '\u2713 In Cart (' + inCart + ')' : 'Add to Cart');
    html += '</button>';
    html += '</div>';
    html += '</div>';
    return html;
  }

  function kioskRenderCbGrid() {
    var grid = document.getElementById('kiosk-cb-grid');
    if (!grid) return;

    var search = _kioskCbSearch.toLowerCase().trim();

    var filtered = _kioskProducts.filter(function (p) {
      var ptype = (p.product_type || '').toLowerCase();
      if (_kioskCbTab === 'kits') {
        if (ptype !== 'kit') return false;
      } else {
        if (ptype !== 'ingredient' && ptype !== 'service') return false;
        if ((parseFloat(p.rate) || 0) === 0) return false;
      }
      if (search) {
        var haystack = ((p.name || '') + ' ' + kioskItemCategory(p)).toLowerCase();
        if (haystack.indexOf(search) === -1) return false;
      }
      return true;
    });

    if (filtered.length === 0) {
      grid.innerHTML = '<p class="kiosk-loading">No products found.</p>';
      return;
    }

    var html = '';
    filtered.forEach(function (p) {
      var ptype = (p.product_type || '').toLowerCase();
      if (ptype === 'kit') {
        if (kioskCbIsWine(p)) {
          html += kioskCbRenderWineCard(p);
        } else if (kioskCbIsBeer(p)) {
          html += kioskCbRenderBeerCard(p);
        } else {
          html += kioskCbRenderCard(p);
        }
      } else {
        html += kioskCbRenderCard(p);
      }
    });

    grid.innerHTML = html;

    Array.prototype.forEach.call(grid.querySelectorAll('.cb-add-btn:not([disabled])'), function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var card = btn.closest('[data-item-id]');
        if (!card) return;
        var itemId = card.getAttribute('data-item-id');
        var product = null;
        for (var i = 0; i < _kioskProducts.length; i++) {
          if (_kioskProducts[i].item_id === itemId) { product = _kioskProducts[i]; break; }
        }
        if (!product) return;
        kioskAddToCart(product);
        kioskRenderCbGrid();
        kioskUpdateCbCartBar();
      });
    });
  }

  function kioskUpdateCbCartBar() {
    var bar = document.getElementById('kiosk-cb-cart-bar');
    var summary = document.getElementById('kiosk-cb-cart-summary');
    if (!bar || !summary) return;
    var count = 0;
    var ids = Object.keys(_kioskCart);
    for (var i = 0; i < ids.length; i++) {
      count += _kioskCart[ids[i]].qty;
    }
    if (count === 0) {
      bar.style.display = 'none';
    } else {
      bar.style.display = '';
      var totals = kioskCalcTotals();
      summary.textContent = count + ' item' + (count !== 1 ? 's' : '') + ' \u2014 ' + kioskFmt(totals.total);
    }
  }

  function kioskShowCustomerBrowse() {
    kioskShowView('browse-customer');
    var btn = document.getElementById('kiosk-browse-mode-btn');
    if (btn) btn.style.display = 'none';
    kioskRenderCbGrid();
    kioskUpdateCbCartBar();
  }

  function kioskExitCustomerBrowse() {
    kioskShowView('browse');
    var btn = document.getElementById('kiosk-browse-mode-btn');
    if (btn) btn.style.display = '';
  }

  function kioskSetQty(itemId, qty) {
    var wasKit = _kioskCart[itemId] && kioskGetItemType(_kioskCart[itemId].item) === 'kit';
    if (qty <= 0) {
      delete _kioskCart[itemId];
    } else {
      if (_kioskCart[itemId]) {
        // Only check overflow on qty increase, not decrease (D-01)
        if (qty > _kioskCart[itemId].qty) {
          if (!kioskCheckStockOverflow(_kioskCart[itemId].item, qty)) return;
        }
        _kioskCart[itemId].qty = qty;
      }
    }
    if (wasKit) kioskSyncKitFees();
    kioskRenderCart();
    kioskRenderProducts();
  }

  function kioskRemoveFromCart(itemId) {
    var wasFee = _kioskCart[itemId] && kioskIsKitFee(_kioskCart[itemId].item);
    var wasKit = _kioskCart[itemId] && kioskGetItemType(_kioskCart[itemId].item) === 'kit';
    delete _kioskCart[itemId];
    if (wasFee) {
      _kioskMakersFeeWaived = true;
    } else if (wasKit) {
      kioskSyncKitFees();
    }
    kioskRenderCart();
    kioskRenderProducts();
  }

  function kioskClearCart() {
    _kioskMakersFeeWaived = false;
    _kioskCart = {};
    _kioskDiscount = null;
    _kioskGiftCard = null;
    _kioskSelectedRecipe = null;
    _kioskSaleType = null;
    _kioskMillGrain = false;
    _kioskRecipeAvailability = null;
    _kioskRecipeContext = null;
    // Phase 35+36: reset quote and modify state on cart clear
    _kioskQuote = null;
    _kioskModifiedIngredients = null;
    _kioskModifyPanelOpen = false;
    _kioskTargetVolumeL = null;
    kioskUpdateDiscountDisplay();
    kioskRenderCart();
    kioskRenderProducts();
  }

  // ===== Custom Item Modal (D-05, D-06) =====

  function kioskShowCustomItemModal() {
    var overlay = document.getElementById('kiosk-custom-item-overlay');
    if (!overlay) {
      // Build the overlay once and append to kiosk container
      overlay = document.createElement('div');
      overlay.id = 'kiosk-custom-item-overlay';
      overlay.style.cssText = [
        'position:fixed', 'top:0', 'left:0', 'right:0', 'bottom:0',
        'background:rgba(0,0,0,0.55)', 'z-index:1200',
        'display:flex', 'align-items:center', 'justify-content:center'
      ].join(';');
      overlay.innerHTML = [
        '<div style="background:#fff;border-radius:12px;padding:1.5rem;width:min(90vw,440px);box-shadow:0 8px 32px rgba(0,0,0,0.25);">',
        '<h3 style="margin:0 0 1rem;font-size:1.25rem;">Add custom item</h3>',
        '<div style="margin-bottom:1rem;">',
        '<label style="display:block;font-weight:600;margin-bottom:0.25rem;" for="kci-desc">Description <span style="color:#c00;">*</span></label>',
        '<input id="kci-desc" type="text" maxlength="100" placeholder="e.g. Equipment rental" autocomplete="off"',
        ' style="width:100%;box-sizing:border-box;padding:0.6rem;font-size:1.1rem;border:1px solid #ccc;border-radius:6px;">',
        '</div>',
        '<div style="margin-bottom:1rem;">',
        '<label style="display:block;font-weight:600;margin-bottom:0.25rem;" for="kci-note">Note (optional)</label>',
        '<input id="kci-note" type="text" maxlength="100" placeholder="e.g. weekend" autocomplete="off"',
        ' style="width:100%;box-sizing:border-box;padding:0.6rem;font-size:1.1rem;border:1px solid #ccc;border-radius:6px;">',
        '</div>',
        '<div style="display:flex;gap:1rem;margin-bottom:1rem;">',
        '<div style="flex:1;">',
        '<label style="display:block;font-weight:600;margin-bottom:0.25rem;" for="kci-price">Price ($)</label>',
        '<input id="kci-price" type="number" step="0.01" min="0" placeholder="0.00" inputmode="decimal"',
        ' style="width:100%;box-sizing:border-box;padding:0.6rem;font-size:1.1rem;border:1px solid #ccc;border-radius:6px;">',
        '</div>',
        '<div style="flex:1;">',
        '<label style="display:block;font-weight:600;margin-bottom:0.25rem;" for="kci-qty">Qty</label>',
        '<input id="kci-qty" type="number" step="1" min="1" value="1" inputmode="numeric"',
        ' style="width:100%;box-sizing:border-box;padding:0.6rem;font-size:1.1rem;border:1px solid #ccc;border-radius:6px;">',
        '</div>',
        '</div>',
        '<div style="margin-bottom:1.25rem;display:flex;align-items:center;gap:0.6rem;">',
        '<input id="kci-exempt" type="checkbox" style="width:1.3rem;height:1.3rem;cursor:pointer;">',
        '<label for="kci-exempt" style="font-size:1rem;cursor:pointer;">Tax-exempt (default: taxable at 5% GST)</label>',
        '</div>',
        '<div id="kci-error" style="color:#c00;font-size:0.9rem;margin-bottom:0.75rem;display:none;"></div>',
        '<div style="display:flex;gap:0.75rem;justify-content:flex-end;">',
        '<button id="kci-cancel" type="button" style="padding:0.65rem 1.25rem;font-size:1rem;border:1px solid #ccc;border-radius:6px;background:#f5f5f5;cursor:pointer;">Cancel</button>',
        '<button id="kci-add" type="button" style="padding:0.65rem 1.25rem;font-size:1rem;border:none;border-radius:6px;background:#5a3e1b;color:#fff;cursor:pointer;font-weight:600;">Add to cart</button>',
        '</div>',
        '</div>'
      ].join('');
      var kioskRoot = document.getElementById('kiosk-root') || document.body;
      kioskRoot.appendChild(overlay);
    }
    overlay.style.display = 'flex';

    // Reset fields
    var descEl = document.getElementById('kci-desc');
    var noteEl = document.getElementById('kci-note');
    var priceEl = document.getElementById('kci-price');
    var qtyEl = document.getElementById('kci-qty');
    var exemptEl = document.getElementById('kci-exempt');
    var errEl = document.getElementById('kci-error');
    if (descEl) { descEl.value = ''; descEl.focus(); }
    if (noteEl) noteEl.value = '';
    if (priceEl) priceEl.value = '';
    if (qtyEl) qtyEl.value = '1';
    if (exemptEl) exemptEl.checked = false;
    if (errEl) { errEl.textContent = ''; errEl.style.display = 'none'; }

    var cancelBtn = document.getElementById('kci-cancel');
    var addBtn = document.getElementById('kci-add');

    if (cancelBtn) {
      cancelBtn.onclick = function () {
        overlay.style.display = 'none';
      };
    }
    if (addBtn) {
      addBtn.onclick = function () {
        kioskSubmitCustomItem(overlay);
      };
    }
    // Close on backdrop click
    overlay.onclick = function (e) {
      if (e.target === overlay) overlay.style.display = 'none';
    };
  }

  function kioskSubmitCustomItem(overlay) {
    var descEl = document.getElementById('kci-desc');
    var noteEl = document.getElementById('kci-note');
    var priceEl = document.getElementById('kci-price');
    var qtyEl = document.getElementById('kci-qty');
    var exemptEl = document.getElementById('kci-exempt');
    var errEl = document.getElementById('kci-error');

    function showErr(msg) {
      if (errEl) { errEl.textContent = msg; errEl.style.display = ''; }
    }

    var desc = descEl ? descEl.value.trim() : '';
    var note = noteEl ? noteEl.value.trim() : '';
    var rate = priceEl ? parseFloat(priceEl.value) : NaN;
    var qty = qtyEl ? parseInt(qtyEl.value, 10) : NaN;
    var taxExempt = exemptEl ? exemptEl.checked : false;

    // D-05 validation
    if (!desc || desc.length < 1 || desc.length > 100) {
      showErr('Description is required (1–100 characters).');
      if (descEl) descEl.focus();
      return;
    }
    if (!isFinite(rate)) {
      showErr('Please enter a valid price.');
      if (priceEl) priceEl.focus();
      return;
    }
    if (!isFinite(qty) || qty < 1 || qty !== Math.floor(qty)) {
      showErr('Quantity must be a whole number of 1 or more.');
      if (qtyEl) qtyEl.focus();
      return;
    }

    // D-03: explicit confirm for rate > 2000 or negative
    if (rate > 2000 || rate < 0) {
      var fmtAmt = '$' + Math.abs(rate).toFixed(2) + (rate < 0 ? ' (negative)' : '');
      var confirmed = window.confirm(
        'You entered ' + fmtAmt + ' — confirm this custom charge?'
      );
      if (!confirmed) return;
    }

    // Add to cart
    var customItem = {
      custom: true,
      description: desc,
      note: note,
      name: desc,
      rate: rate,
      tax_percentage: taxExempt ? 0 : 5,
      taxable: !taxExempt
    };
    _kioskCustomCounter += 1;
    _kioskCart['custom-' + _kioskCustomCounter] = { item: customItem, qty: qty };

    if (overlay) overlay.style.display = 'none';
    kioskRenderCart();
  }

  // ===== Gift Card Issue / Reload Modal (GIFTCARD-01a, 01d — D-08) =====

  function kioskShowGiftCardIssueModal() {
    var overlay = document.getElementById('kiosk-gift-card-issue-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'kiosk-gift-card-issue-overlay';
      overlay.style.cssText = [
        'position:fixed', 'top:0', 'left:0', 'right:0', 'bottom:0',
        'background:rgba(0,0,0,0.55)', 'z-index:1200',
        'display:flex', 'align-items:center', 'justify-content:center'
      ].join(';');
      overlay.innerHTML = [
        '<div style="background:#fff;border-radius:12px;padding:1.5rem;width:min(90vw,440px);box-shadow:0 8px 32px rgba(0,0,0,0.25);">',
        '<h3 id="kgci-title" style="margin:0 0 1rem;font-size:1.25rem;">Issue Gift Certificate</h3>',
        '<div style="display:flex;gap:0.5rem;margin-bottom:1rem;">',
        '<button id="kgci-mode-issue" type="button" style="flex:1;padding:0.5rem;font-size:0.95rem;border:2px solid #5a3e1b;border-radius:6px;background:#5a3e1b;color:#fff;cursor:pointer;font-weight:600;">Issue New</button>',
        '<button id="kgci-mode-reload" type="button" style="flex:1;padding:0.5rem;font-size:0.95rem;border:2px solid #ccc;border-radius:6px;background:#f5f5f5;color:#333;cursor:pointer;">Reload Existing</button>',
        '</div>',
        '<div style="margin-bottom:1rem;">',
        '<label style="display:block;font-weight:600;margin-bottom:0.25rem;" for="kgci-cert">Certificate # <span style="color:#c00;">*</span></label>',
        '<input id="kgci-cert" type="text" maxlength="10" placeholder="GC-000001" autocomplete="off"',
        ' style="width:100%;box-sizing:border-box;padding:0.6rem;font-size:1rem;border:1px solid #ccc;border-radius:6px;">',
        '</div>',
        '<div style="margin-bottom:1.25rem;">',
        '<label id="kgci-value-label" style="display:block;font-weight:600;margin-bottom:0.25rem;" for="kgci-value">Face Value ($) <span style="color:#c00;">*</span></label>',
        '<input id="kgci-value" type="number" step="0.01" min="0.01" max="2000" placeholder="0.00" inputmode="decimal"',
        ' style="width:100%;box-sizing:border-box;padding:0.6rem;font-size:1rem;border:1px solid #ccc;border-radius:6px;">',
        '</div>',
        '<div id="kgci-error" style="color:#c00;font-size:0.9rem;margin-bottom:0.75rem;display:none;"></div>',
        '<div style="display:flex;gap:0.75rem;justify-content:flex-end;">',
        '<button id="kgci-cancel" type="button" style="padding:0.65rem 1.25rem;font-size:1rem;border:1px solid #ccc;border-radius:6px;background:#f5f5f5;cursor:pointer;">Cancel</button>',
        '<button id="kgci-issue" type="button" style="padding:0.65rem 1.25rem;font-size:1rem;border:none;border-radius:6px;background:#5a3e1b;color:#fff;cursor:pointer;font-weight:600;">Issue Certificate</button>',
        '</div>',
        '</div>'
      ].join('');
      var kioskRoot = document.getElementById('kiosk-root') || document.body;
      kioskRoot.appendChild(overlay);
    }

    overlay.style.display = 'flex';

    var _gcMode = 'issue';
    var titleEl = document.getElementById('kgci-title');
    var certEl = document.getElementById('kgci-cert');
    var valueEl = document.getElementById('kgci-value');
    var valueLabelEl = document.getElementById('kgci-value-label');
    var errEl = document.getElementById('kgci-error');
    var cancelBtn = document.getElementById('kgci-cancel');
    var issueBtn = document.getElementById('kgci-issue');
    var modeIssueBtn = document.getElementById('kgci-mode-issue');
    var modeReloadBtn = document.getElementById('kgci-mode-reload');

    if (valueEl) valueEl.value = '';
    if (errEl) { errEl.textContent = ''; errEl.style.display = 'none'; }

    function setGcMode(mode) {
      _gcMode = mode;
      var isIssue = mode === 'issue';
      if (titleEl) titleEl.textContent = isIssue ? 'Issue Gift Certificate' : 'Reload Gift Certificate';
      if (valueLabelEl) valueLabelEl.innerHTML = (isIssue ? 'Face Value ($)' : 'Reload Amount ($)') + ' <span style="color:#c00;">*</span>';
      if (issueBtn) issueBtn.textContent = isIssue ? 'Issue Certificate' : 'Reload Certificate';
      if (modeIssueBtn) {
        modeIssueBtn.style.background = isIssue ? '#5a3e1b' : '#f5f5f5';
        modeIssueBtn.style.color = isIssue ? '#fff' : '#333';
        modeIssueBtn.style.borderColor = isIssue ? '#5a3e1b' : '#ccc';
      }
      if (modeReloadBtn) {
        modeReloadBtn.style.background = isIssue ? '#f5f5f5' : '#5a3e1b';
        modeReloadBtn.style.color = isIssue ? '#333' : '#fff';
        modeReloadBtn.style.borderColor = isIssue ? '#ccc' : '#5a3e1b';
      }
      if (certEl) {
        certEl.value = '';
        certEl.readOnly = false;
        if (errEl) { errEl.textContent = ''; errEl.style.display = 'none'; }
        if (isIssue) {
          certEl.value = 'Loading…';
          certEl.readOnly = true;
          var mwUrl = kioskMwUrl();
          fetch(mwUrl + '/api/kiosk/gift-card/next-number', {
            headers: { 'x-api-key': SHEETS_CONFIG.MW_API_KEY || '' }
          }).then(function (r) { return r.json(); }).then(function (d) {
            if (certEl) { certEl.value = d.suggested || ''; certEl.readOnly = false; }
          }).catch(function () {
            if (certEl) { certEl.value = ''; certEl.readOnly = false; }
          });
        }
      }
      if (valueEl) valueEl.value = '';
    }

    if (modeIssueBtn) { modeIssueBtn.onclick = function () { setGcMode('issue'); }; }
    if (modeReloadBtn) { modeReloadBtn.onclick = function () { setGcMode('reload'); }; }

    if (cancelBtn) {
      cancelBtn.onclick = function () { overlay.style.display = 'none'; };
    }
    if (issueBtn) {
      issueBtn.onclick = function () { kioskSubmitGiftCardIssue(overlay, _gcMode); };
    }
    overlay.onclick = function (e) {
      if (e.target === overlay) overlay.style.display = 'none';
    };

    // Initialize in Issue mode (fetches suggested cert number)
    setGcMode('issue');
  }

  function kioskSubmitGiftCardIssue(overlay, mode) {
    var certEl = document.getElementById('kgci-cert');
    var valueEl = document.getElementById('kgci-value');
    var errEl = document.getElementById('kgci-error');
    var issueBtn = document.getElementById('kgci-issue');

    function showGcErr(msg) {
      if (errEl) { errEl.textContent = msg; errEl.style.display = ''; }
    }

    var cert = certEl ? certEl.value.trim().toUpperCase() : '';
    var val = valueEl ? parseFloat(valueEl.value) : NaN;
    var isIssue = mode === 'issue';

    if (!/^GC-\d{6}$/.test(cert)) {
      showGcErr('Certificate number must be in the format GC-000001.');
      if (certEl) certEl.focus();
      return;
    }
    if (!isFinite(val) || val <= 0 || val > 2000) {
      showGcErr('Amount must be between $0.01 and $2,000.00.');
      if (valueEl) valueEl.focus();
      return;
    }

    if (isIssue) {
      // Issue mode: add gift_cert line to cart; cert is activated on payment success (G-44-01 fix)
      _kioskGiftCertCounter += 1;
      _kioskCart['giftcert-' + _kioskGiftCertCounter] = {
        item: {
          gift_cert: true,
          gift_action: 'issue',
          cert_number: cert,
          name: 'Gift Certificate ' + cert,
          rate: val,
          tax_percentage: 0,
          taxable: false
        },
        qty: 1
      };
      if (overlay) overlay.style.display = 'none';
      kioskRenderCart();
    } else {
      // Reload mode: pre-check cert exists and is active (UX guard; server re-validates, D-05)
      if (issueBtn) { issueBtn.disabled = true; issueBtn.textContent = 'Checking…'; }
      if (errEl) { errEl.textContent = ''; errEl.style.display = 'none'; }
      var mwUrl = kioskMwUrl();
      fetch(mwUrl + '/api/kiosk/gift-card/lookup?cert_number=' + encodeURIComponent(cert), {
        headers: { 'x-api-key': SHEETS_CONFIG.MW_API_KEY || '' }
      })
      .then(function (r) { return r.json().then(function (d) { return { status: r.status, data: d }; }); })
      .then(function (result) {
        if (result.status === 404 || !result.data.ok) {
          showGcErr('Certificate not found. Check the certificate number and try again.');
          if (issueBtn) { issueBtn.disabled = false; issueBtn.textContent = 'Reload Certificate'; }
          return;
        }
        var certData = result.data.data || {};
        if (certData.status && certData.status !== 'active') {
          showGcErr('Certificate is not active and cannot be reloaded.');
          if (issueBtn) { issueBtn.disabled = false; issueBtn.textContent = 'Reload Certificate'; }
          return;
        }
        // Cert is valid and active — add reload line to cart
        _kioskGiftCertCounter += 1;
        _kioskCart['giftcert-' + _kioskGiftCertCounter] = {
          item: {
            gift_cert: true,
            gift_action: 'reload',
            cert_number: cert,
            name: 'Gift Cert Reload ' + cert,
            rate: val,
            tax_percentage: 0,
            taxable: false
          },
          qty: 1
        };
        if (overlay) overlay.style.display = 'none';
        kioskRenderCart();
      })
      .catch(function () {
        showGcErr('Connection error. Please check your connection and try again.');
        if (issueBtn) { issueBtn.disabled = false; issueBtn.textContent = 'Reload Certificate'; }
      });
    }
  }

  function kioskRenderCart() {
    var container = document.getElementById('kiosk-cart-items');
    var totalsEl = document.getElementById('kiosk-cart-totals');
    var checkoutBtn = document.getElementById('kiosk-checkout-btn');
    var checkoutTotal = document.getElementById('kiosk-checkout-total');
    if (!container) return;

    var keys = Object.keys(_kioskCart);

    var discountBtn = document.getElementById('kiosk-discount-btn');

    // SO import banner (D-01)
    var bannerHtml = '';
    if (_kioskImportedSoId) {
      bannerHtml = '<div class="kiosk-cart-so-banner">' +
        '<span>Order: <strong>' + escapeHTML(_kioskImportedSoNumber || '') + '</strong></span>' +
        '<button type="button" class="kiosk-cart-so-clear" title="Detach SO" aria-label="Detach SO">&#215;</button>' +
        '</div>';
    }

    if (keys.length === 0) {
      container.innerHTML = bannerHtml +
        '<p class="kiosk-cart-empty">No items in cart</p>' +
        '<div style="margin-top:0.5rem;">' +
        '<button id="kiosk-add-custom-btn" type="button" class="kiosk-add-custom-btn" style="width:100%;padding:0.6rem;font-size:0.95rem;border:1px dashed #888;border-radius:6px;background:none;cursor:pointer;color:#555;">' +
        '+ Add custom item' +
        '</button>' +
        '</div>' +
        '<div style="margin-top:0.5rem;">' +
        '<button id="kiosk-add-gc-btn" type="button" class="kiosk-add-custom-btn" style="width:100%;padding:0.6rem;font-size:0.95rem;border:1px dashed #5a3e1b;border-radius:6px;background:none;cursor:pointer;color:#5a3e1b;">' +
        '+ Issue / Reload Gift Card' +
        '</button>' +
        '</div>';
      var soClearEmpty = container.querySelector('.kiosk-cart-so-clear');
      if (soClearEmpty) {
        soClearEmpty.addEventListener('click', function () {
          kioskClearImportedSo();
          kioskRenderCart();
        });
      }
      var addCustomBtnEmpty = document.getElementById('kiosk-add-custom-btn');
      if (addCustomBtnEmpty) {
        addCustomBtnEmpty.addEventListener('click', function () {
          kioskShowCustomItemModal();
        });
      }
      var addGcBtnEmpty = document.getElementById('kiosk-add-gc-btn');
      if (addGcBtnEmpty) {
        addGcBtnEmpty.addEventListener('click', function () {
          kioskShowGiftCardIssueModal();
        });
      }
      if (totalsEl) totalsEl.style.display = 'none';
      if (checkoutBtn) checkoutBtn.disabled = true;
      if (checkoutTotal) checkoutTotal.textContent = '$0.00';
      if (discountBtn) discountBtn.disabled = true;
      kioskUpdateDiscountDisplay();
      return;
    }

    var html = '';
    keys.forEach(function (id) {
      var entry = _kioskCart[id];
      if (!entry || !entry.item) return; // skip non-item entries (defensive guard)
      var item = entry.item;
      var qty = entry.qty;
      var rate = parseFloat(item.rate) || 0;
      var lineTotal = rate * qty;
      // GIFTCARD-01: gift_cert lines render with fixed qty=1 and a remove button (no qty stepper)
      if (item.gift_cert) {
        html += '<div class="kiosk-cart-line">';
        html += '<div class="kiosk-cart-line-name" title="' + escapeHTML(item.name || '') + '">' + escapeHTML(item.name || '') + '</div>';
        html += '<div class="kiosk-cart-qty"><span class="kiosk-qty-val">1</span></div>';
        html += '<div class="kiosk-cart-line-total">' + kioskFmt(lineTotal) + '</div>';
        html += '<button class="kiosk-cart-remove-btn" data-id="' + id + '">&times;</button>';
        html += '</div>';
        return;
      }
      html += '<div class="kiosk-cart-line">';
      var isWeight = kioskIsWeightItem(item);
      html += '<div class="kiosk-cart-line-name" title="' + escapeHTML(item.name || '') + '">' + escapeHTML(item.name || '') + '</div>';
      if (isWeight) {
        html += '<div class="kiosk-cart-qty">';
        html += '<input type="number" class="kiosk-qty-input" data-id="' + id + '" value="' + qty + '" step="0.01" min="0.001" inputmode="decimal">';
        html += '<span class="kiosk-qty-unit">kg</span>';
        html += '</div>';
      } else {
        html += '<div class="kiosk-cart-qty">';
        html += '<button class="kiosk-qty-btn" data-action="dec" data-id="' + id + '">-</button>';
        html += '<input type="number" class="kiosk-qty-input" data-id="' + id + '" value="' + qty + '" step="1" min="1" inputmode="numeric">';
        html += '<button class="kiosk-qty-btn" data-action="inc" data-id="' + id + '">+</button>';
        html += '</div>';
      }
      html += '<div class="kiosk-cart-line-total">' + kioskFmt(lineTotal) + '</div>';
      html += '<button class="kiosk-cart-remove-btn" data-id="' + id + '">&times;</button>';
      html += '</div>';
    });

    // D-06: Add custom item button in cart area
    html += '<div style="margin-top:0.5rem;">' +
      '<button id="kiosk-add-custom-btn" type="button" class="kiosk-add-custom-btn" style="width:100%;padding:0.6rem;font-size:0.95rem;border:1px dashed #888;border-radius:6px;background:none;cursor:pointer;color:#555;">' +
      '+ Add custom item' +
      '</button>' +
      '</div>';
    // GIFTCARD-01a/01d: Issue / Reload Gift Card button
    html += '<div style="margin-top:0.5rem;">' +
      '<button id="kiosk-add-gc-btn" type="button" class="kiosk-add-custom-btn" style="width:100%;padding:0.6rem;font-size:0.95rem;border:1px dashed #5a3e1b;border-radius:6px;background:none;cursor:pointer;color:#5a3e1b;">' +
      '+ Issue / Reload Gift Card' +
      '</button>' +
      '</div>';

    container.innerHTML = bannerHtml + html;

    // Wire SO banner clear button
    var soClearBtn = container.querySelector('.kiosk-cart-so-clear');
    if (soClearBtn) {
      soClearBtn.addEventListener('click', function () {
        kioskClearImportedSo();
        kioskRenderCart();
      });
    }

    container.querySelectorAll('.kiosk-qty-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-id');
        var action = btn.getAttribute('data-action');
        if (!_kioskCart[id]) return;
        var newQty = _kioskCart[id].qty + (action === 'inc' ? 1 : -1);
        kioskSetQty(id, newQty);
      });
    });

    container.querySelectorAll('.kiosk-qty-input').forEach(function (input) {
      input.addEventListener('input', function () {
        var id = input.getAttribute('data-id');
        var val = parseFloat(input.value);
        if (!_kioskCart[id] || !isFinite(val) || val <= 0) return;
        _kioskCart[id].qty = Math.round(val * 1000) / 1000;
        var rate = parseFloat(_kioskCart[id].item.rate) || 0;
        var lineEl = input.closest('.kiosk-cart-line');
        if (lineEl) {
          var totalEl = lineEl.querySelector('.kiosk-cart-line-total');
          if (totalEl) totalEl.textContent = kioskFmt(rate * _kioskCart[id].qty);
        }
        var totals = kioskCalcTotals();
        var subEl = document.getElementById('kiosk-subtotal');
        var taxEl = document.getElementById('kiosk-tax');
        var totalEl2 = document.getElementById('kiosk-total');
        var checkoutTotal = document.getElementById('kiosk-checkout-total');
        if (subEl) subEl.textContent = kioskFmt(totals.subtotal);
        if (taxEl) taxEl.textContent = kioskFmt(totals.tax);
        if (totalEl2) totalEl2.textContent = kioskFmt(totals.total);
        if (checkoutTotal) checkoutTotal.textContent = kioskFmt(totals.total);
        kioskUpdateDiscountDisplay();
      });
      input.addEventListener('change', function () {
        var id = input.getAttribute('data-id');
        var val = parseFloat(input.value);
        if (!isFinite(val) || val <= 0) {
          kioskRemoveFromCart(id);
        } else {
          kioskSetQty(id, Math.round(val * 1000) / 1000);
        }
      });
    });

    container.querySelectorAll('.kiosk-cart-remove-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-id');
        kioskRemoveFromCart(id);
      });
    });

    // D-06: Wire "Add custom item" button
    var addCustomBtn = document.getElementById('kiosk-add-custom-btn');
    if (addCustomBtn) {
      addCustomBtn.addEventListener('click', function () {
        kioskShowCustomItemModal();
      });
    }
    // GIFTCARD-01a/01d: Wire "Issue / Reload Gift Card" button
    var addGcBtn = document.getElementById('kiosk-add-gc-btn');
    if (addGcBtn) {
      addGcBtn.addEventListener('click', function () {
        kioskShowGiftCardIssueModal();
      });
    }

    var totals = kioskCalcTotals();
    var subEl = document.getElementById('kiosk-subtotal');
    var taxEl = document.getElementById('kiosk-tax');
    var totalEl = document.getElementById('kiosk-total');
    if (subEl) subEl.textContent = kioskFmt(totals.subtotal);
    if (taxEl) taxEl.textContent = kioskFmt(totals.tax);
    if (totalEl) totalEl.textContent = kioskFmt(totals.total);
    if (totalsEl) totalsEl.style.display = '';
    if (checkoutBtn) checkoutBtn.disabled = false;
    if (checkoutTotal) checkoutTotal.textContent = kioskFmt(totals.total);
    if (discountBtn) discountBtn.disabled = kioskCartIsEmpty();
    kioskUpdateDiscountDisplay();
  }

  // ===== Checkout Flow =====

  function kioskStartCheckout() {
    if (kioskCartIsEmpty()) return;
    if (!_kioskTerminalReady) {
      showToast('POS terminal is not ready. Check terminal status below.', 'error');
      return;
    }
    kioskShowCustomerStep();
  }

  function kioskShowCustomerStep() {
    kioskShowView('customer');

    var hasKits = kioskCartHasKits();
    var proceedBtn = document.getElementById('kiosk-customer-proceed');
    var skipBtn = document.getElementById('kiosk-customer-skip');
    var backBtn = document.getElementById('kiosk-customer-back');
    var searchInput = document.getElementById('kiosk-customer-search');
    var resultsEl = document.getElementById('kiosk-customer-results');
    var selectedEl = document.getElementById('kiosk-customer-selected');
    var newToggle = document.getElementById('kiosk-new-customer-toggle');
    var newForm = document.getElementById('kiosk-new-customer-form');
    var saveBtn = document.getElementById('kiosk-new-customer-save');

    // Reset search state
    if (searchInput) searchInput.value = '';
    if (resultsEl) resultsEl.innerHTML = '';
    if (newForm) newForm.style.display = 'none';
    if (skipBtn) skipBtn.style.display = hasKits ? 'none' : '';

    function updateProceedState() {
      if (proceedBtn) proceedBtn.disabled = !_kioskCustomer;
    }

    function kioskSelectCustomer(c) {
      _kioskCustomer = c;
      if (searchInput) { searchInput.value = ''; }
      if (resultsEl) resultsEl.innerHTML = '';
      if (selectedEl) {
        selectedEl.style.display = '';
        selectedEl.innerHTML = '<span>' + escapeHTML(c.name || '') + (c.email ? ' &mdash; ' + escapeHTML(c.email) : '') + '</span>' +
          '<button type="button" style="background:none;border:none;cursor:pointer;font-size:1rem;padding:0 0.25rem;" id="kiosk-clear-customer">&times;</button>';
        var clearBtn = document.getElementById('kiosk-clear-customer');
        if (clearBtn) {
          clearBtn.onclick = function () {
            _kioskCustomer = null;
            selectedEl.style.display = 'none';
            selectedEl.innerHTML = '';
            updateProceedState();
          };
        }
      }
      if (newForm) newForm.style.display = 'none';
      updateProceedState();
    }

    // If customer was pre-selected from cart pane, show them
    if (_kioskCustomer) {
      kioskSelectCustomer(_kioskCustomer);
    } else {
      if (selectedEl) { selectedEl.style.display = 'none'; selectedEl.innerHTML = ''; }
      if (proceedBtn) proceedBtn.disabled = true;
    }

    if (backBtn) {
      backBtn.onclick = function () { kioskShowView('browse'); };
    }

    if (skipBtn) {
      skipBtn.onclick = function () { kioskProceedToPayment(); };
    }

    if (proceedBtn) {
      proceedBtn.onclick = function () {
        if (_kioskCustomer) kioskProceedToPayment();
      };
    }

    if (newToggle) {
      newToggle.onclick = function () {
        if (newForm) newForm.style.display = newForm.style.display === 'none' ? '' : 'none';
      };
    }

    if (saveBtn) {
      saveBtn.onclick = function () {
        var nameEl = document.getElementById('kiosk-new-name');
        var emailEl = document.getElementById('kiosk-new-email');
        var phoneEl = document.getElementById('kiosk-new-phone');
        var name = nameEl ? nameEl.value.trim() : '';
        var email = emailEl ? emailEl.value.trim() : '';
        var phone = phoneEl ? phoneEl.value.trim() : '';
        if (!name || !email) {
          showToast('Name and email are required', 'error');
          return;
        }
        saveBtn.disabled = true;
        var mwUrl = kioskMwUrl();
        fetch(mwUrl + '/api/contacts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': SHEETS_CONFIG.MW_API_KEY || '' },
          body: JSON.stringify({ name: name, email: email, phone: phone })
        })
        .then(function (r) { return r.json().then(function (d) { return { status: r.status, data: d }; }); })
        .then(function (result) {
          saveBtn.disabled = false;
          if (result.data && result.data.contact_id) {
            if (nameEl) nameEl.value = '';
            if (emailEl) emailEl.value = '';
            if (phoneEl) phoneEl.value = '';
            kioskSelectCustomer({ contact_id: result.data.contact_id, name: name, email: email });
          } else {
            showToast(result.data.error || 'Could not create customer', 'error');
          }
        })
        .catch(function () {
          saveBtn.disabled = false;
          showToast('Could not create customer', 'error');
        });
      };
    }

    var searchTimer = null;
    if (searchInput) {
      searchInput.addEventListener('input', function () {
        clearTimeout(searchTimer);
        var q = searchInput.value.trim();
        if (!q) { if (resultsEl) resultsEl.innerHTML = ''; return; }
        searchTimer = setTimeout(function () {
          var mwUrl = kioskMwUrl();
          fetch(mwUrl + '/api/contacts?search=' + encodeURIComponent(q), { headers: { 'x-api-key': SHEETS_CONFIG.MW_API_KEY || '' } })
          .then(function (r) { return r.json(); })
          .then(function (data) {
            if (!resultsEl) return;
            var contacts = (data.contacts || []).slice(0, 8);
            if (!contacts.length) {
              resultsEl.innerHTML = '<div style="padding:0.4rem 0.6rem;color:#888;font-size:0.88rem;">No results</div>';
              return;
            }
            var html = '';
            contacts.forEach(function (c) {
              html += '<div class="kiosk-customer-result-row" data-id="' + escapeHTML(c.contact_id || '') + '">' +
                '<strong>' + escapeHTML(c.contact_name || c.name || '') + '</strong>' +
                (c.email ? ' <span style="color:#666;">' + escapeHTML(c.email) + '</span>' : '') +
                '</div>';
            });
            resultsEl.innerHTML = html;
            Array.prototype.forEach.call(resultsEl.querySelectorAll('.kiosk-customer-result-row'), function (row) {
              row.onclick = function () {
                var idx = Array.prototype.indexOf.call(resultsEl.querySelectorAll('.kiosk-customer-result-row'), row);
                var c = contacts[idx];
                kioskSelectCustomer({
                  contact_id: c.contact_id || '',
                  name: c.contact_name || c.name || '',
                  email: c.email || ''
                });
              };
            });
          })
          .catch(function () {
            if (resultsEl) resultsEl.innerHTML = '<div style="padding:0.4rem 0.6rem;color:#888;font-size:0.88rem;">Search failed</div>';
          });
        }, 300);
      });

      searchInput.addEventListener('focus', function () {
        var el = searchInput;
        setTimeout(function () {
          if (el.scrollIntoView) {
            el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          }
        }, 350);
      });
    }

    var newFormInputIds = ['kiosk-new-name', 'kiosk-new-email', 'kiosk-new-phone'];
    newFormInputIds.forEach(function (inputId) {
      var el = document.getElementById(inputId);
      if (!el) return;
      el.addEventListener('focus', function () {
        var target = el;
        setTimeout(function () {
          if (target.scrollIntoView) {
            target.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          }
        }, 350);
      });
    });
  }

  function kioskProceedToPayment() {
    var totals = kioskCalcTotals();
    var mwUrl = kioskMwUrl();
    if (!mwUrl) {
      showToast('Middleware URL not configured', 'error');
      return;
    }

    var items = Object.keys(_kioskCart).map(function (id) {
      var entry = _kioskCart[id];
      // GIFTCARD-01: gift_cert lines forward cert info; server prices via KIOSK_GIFT_CARD_ITEM_ID (D-05)
      if (entry.item.gift_cert) {
        return {
          gift_cert: true,
          gift_action: entry.item.gift_action,
          cert_number: entry.item.cert_number,
          quantity: 1,
          rate: parseFloat(entry.item.rate) || 0
        };
      }
      // D-04/D-08: custom lines forward description/note/taxable — no item_id
      if (entry.item.custom) {
        return {
          custom: true,
          description: entry.item.description || '',
          note: entry.item.note || '',
          quantity: entry.qty,
          rate: parseFloat(entry.item.rate) || 0,
          taxable: entry.item.taxable !== false
        };
      }
      return {
        item_id: entry.item.item_id,
        name: entry.item.name || '',
        sku: entry.item.sku || '',
        quantity: entry.qty,
        rate: parseFloat(entry.item.rate) || 0,
        product_type: entry.item.product_type || '',
        cf_type: entry.item.cf_type || ''
      };
    });

    // === CHECKOUT FORK: imported SO vs new sale (D-02, D-08) ===
    if (_kioskImportedSoId && !_kioskImportedSoUpdated) {
      // Step 1: Update SO line items in Zoho first, then collect payment
      kioskShowView('payment');
      var amountEl = document.getElementById('kiosk-payment-amount');
      var msgEl = document.getElementById('kiosk-terminal-msg');
      var spinnerEl = document.getElementById('kiosk-spinner');
      if (amountEl) amountEl.textContent = kioskFmt(totals.total);
      if (msgEl) msgEl.textContent = 'Updating order ' + escapeHTML(_kioskImportedSoNumber) + '...';
      if (spinnerEl) spinnerEl.style.display = '';

      fetch(mwUrl + '/api/kiosk/salesorder-update', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'x-api-key': SHEETS_CONFIG.MW_API_KEY || '' },
        body: JSON.stringify({ salesorder_id: _kioskImportedSoId, items: items })
      })
      .then(function (r) { return r.json().then(function (d) { return { status: r.status, data: d }; }); })
      .then(function (result) {
        if (result.data && result.data.ok) {
          _kioskImportedSoUpdated = true;
          // Update balance in local SO list so kioskCollectPayment uses correct amount
          for (var j = 0; j < _kioskSalesOrders.length; j++) {
            if (_kioskSalesOrders[j].salesorder_id === _kioskImportedSoId) {
              _kioskSalesOrders[j].balance = result.data.balance || 0;
              _kioskSalesOrders[j].total = result.data.total || 0;
              break;
            }
          }
          kioskCollectPayment(_kioskImportedSoId);
        } else {
          // D-02: SO update failed — do NOT proceed to terminal
          kioskShowSoError('Order Update Failed',
            'Order update failed — payment not taken. Check connection and retry.', true);
        }
      })
      .catch(function () {
        kioskShowSoError('Connection Error',
          'Order update failed — payment not taken. Check connection and retry.', true);
      });
      return;

    } else if (_kioskImportedSoId && _kioskImportedSoUpdated) {
      // D-08: Retry after terminal failure — SO already updated, skip update
      kioskCollectPayment(_kioskImportedSoId);
      return;
    }

    // === New-sale flow: push to terminal, poll status, confirm on approval ===
    kioskShowView('payment');

    var amountEl = document.getElementById('kiosk-payment-amount');
    var msgEl = document.getElementById('kiosk-terminal-msg');
    var spinnerEl = document.getElementById('kiosk-spinner');
    var itemsEl = document.getElementById('kiosk-payment-items');
    var cancelBtn = document.getElementById('kiosk-cancel-payment');

    if (amountEl) amountEl.textContent = kioskFmt(totals.total);
    if (msgEl) msgEl.textContent = '';
    if (spinnerEl) spinnerEl.style.display = 'none';

    if (itemsEl) {
      var itemHtml = '';
      items.forEach(function (it) {
        itemHtml += '<div class="kiosk-payment-item-row">';
        itemHtml += '<span>' + (it.name || '') + ' x' + (it.quantity || 1) + '</span>';
        itemHtml += '<span>' + kioskFmt((it.rate || 0) * (it.quantity || 1)) + '</span>';
        itemHtml += '</div>';
      });
      if (totals.discount > 0) {
        itemHtml += '<div class="kiosk-payment-item-row"><span>Discount: ' + escapeHTML(_kioskDiscount ? _kioskDiscount.name : '') + '</span><span>-' + kioskFmt(totals.discount) + '</span></div>';
      }
      if (totals.tax > 0) {
        itemHtml += '<div class="kiosk-payment-item-row"><span>Tax</span><span>' + kioskFmt(totals.tax) + '</span></div>';
      }
      itemsEl.innerHTML = itemHtml;
    }

    var cancelled = false;
    // Phase 44: Before terminal push, Cancel just returns to browse (no terminal to cancel yet)
    if (cancelBtn) {
      cancelBtn.disabled = false;
      cancelBtn.onclick = function () {
        cancelled = true;
        kioskShowView('browse');
      };
    }

    var refNumber = 'KIOSK-' + Date.now();
    var saleCompleted = false;
    var pollTimer = null;
    var pollStart = Date.now();
    var POLL_TIMEOUT_MS = 45000;

    // Determine sale endpoint: recipe sale or standard kiosk sale
    var isRecipeSale = !!_kioskRecipeContext;
    var saleUrl = isRecipeSale
      ? mwUrl + '/api/kiosk/recipe-sale'
      : mwUrl + '/api/kiosk/sale';
    var recipeSaleBody = isRecipeSale ? {
      recipe_id: _kioskRecipeContext.recipe_id,
      sale_type: _kioskRecipeContext.sale_type,
      mill_grain: _kioskRecipeContext.mill_grain,
      // Forward the selected batch size + ingredient edits so the SERVER charges
      // the scaled/modified total shown in the cart (not the base 1× recipe).
      target_volume_l: _kioskRecipeContext.target_volume_l,
      modified_ingredients: Array.isArray(_kioskModifiedIngredients) ? _kioskModifiedIngredients : undefined,
      customer_name: (_kioskCustomer && _kioskCustomer.name) || '',
      contact_id: (_kioskCustomer && _kioskCustomer.contact_id) || '',
      reference_number: refNumber,
      idempotency_key: refNumber,
      discount: _kioskDiscount ? { preset_id: _kioskDiscount.presetId, name: _kioskDiscount.name, type: _kioskDiscount.type, value: _kioskDiscount.value, scope: _kioskDiscount.scope } : undefined
    } : null;
    // Phase 44 (D-05): gift_card set inside _kioskPushToTerminal after the GC panel step
    var standardSaleBody = {
      items: items,
      reference_number: refNumber,
      idempotency_key: refNumber,
      discount: _kioskDiscount ? { preset_id: _kioskDiscount.presetId, name: _kioskDiscount.name, type: _kioskDiscount.type, value: _kioskDiscount.value, scope: _kioskDiscount.scope } : undefined,
      gift_card: undefined
    };
    var saleBody = isRecipeSale ? recipeSaleBody : standardSaleBody;

    var confirmBtn = document.getElementById('kiosk-confirm-payment');
    if (confirmBtn) confirmBtn.style.display = 'none';

    function handleSaleResult(result) {
      if (cancelled || saleCompleted) return;
      saleCompleted = true;
      if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
      if (spinnerEl) spinnerEl.style.display = 'none';
      if (confirmBtn) confirmBtn.style.display = 'none';
      if (result.status === 201 && result.data.ok) {
        // T-44-G11: If gift cert activation failed post-payment, show prominent blocking staff alert
        if (result.data.gift_card_activation_failed) {
          var certNums = items.filter(function (it) { return it.gift_cert; }).map(function (it) { return it.cert_number; }).join(', ');
          alert('STAFF ALERT: Gift cert activation FAILED — payment was taken. Record the certificate number(s) and activate manually before the customer leaves.' + (certNums ? '\nCertificate(s): ' + certNums : ''));
        }
        _kioskSaleData = result.data;
        var kitItems = items.filter(function (it) { return kioskGetItemType(it) === 'kit'; });
        if (kitItems.length > 0) {
          kioskShowBatchReview(result.data, totals, items, kitItems);
        } else {
          kioskShowReceipt(result.data, totals, items, []);
          kioskClearCart();
        }
      } else {
        if (result.data && result.data.payment_voided) {
          kioskShowError('Payment Voided',
            'Your payment was automatically reversed. No charge was made to the customer.',
            true, { txnId: result.data.voided_transaction_id || '' });
        } else {
          kioskShowError('Sale Error', (result.data && result.data.error) || 'Failed to create invoice.', true);
        }
      }
    }

    function confirmSale(txnId) {
      if (cancelled || saleCompleted) return;
      if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
      if (msgEl) msgEl.textContent = 'Creating invoice...';
      if (spinnerEl) spinnerEl.style.display = '';
      if (confirmBtn) confirmBtn.style.display = 'none';
      if (cancelBtn) cancelBtn.disabled = true;

      if (isRecipeSale) {
        var confirmBody = {
          recipe_id: recipeSaleBody.recipe_id,
          sale_type: recipeSaleBody.sale_type,
          mill_grain: recipeSaleBody.mill_grain,
          // Mirror the sale request so the invoice + charge match the cart total.
          target_volume_l: recipeSaleBody.target_volume_l,
          modified_ingredients: recipeSaleBody.modified_ingredients,
          customer_name: recipeSaleBody.customer_name || '',
          contact_id: recipeSaleBody.contact_id || '',
          reference: refNumber,
          transaction_id: txnId,
          // CR-01: deterministic replay key so the server can short-circuit a duplicate confirm
          idempotency_key: refNumber,
          discount: recipeSaleBody.discount
        };
        fetch(mwUrl + '/api/kiosk/recipe-sale/confirm', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': SHEETS_CONFIG.MW_API_KEY || '' },
          body: JSON.stringify(confirmBody)
        })
        .then(function (r) { return r.json().then(function (d) { return { status: r.status, data: d }; }); })
        .then(function (result) {
          if (cancelled || saleCompleted) return;
          saleCompleted = true;
          if (spinnerEl) spinnerEl.style.display = 'none';
          if (result.status === 201 && result.data.ok) {
            _kioskSaleData = result.data;
            kioskShowReceipt(result.data, totals, items, []);
            kioskClearCart();
          } else if (result.data && result.data.payment_voided) {
            kioskShowError('Sale Could Not Complete',
              (result.data.error || 'Payment was taken but could not be recorded. Payment has been voided.'),
              false);
          } else {
            kioskShowError('Sale Error',
              (result.data && result.data.error) || 'An error occurred. Please try again.',
              true);
          }
        })
        .catch(function () {
          if (cancelled || saleCompleted) return;
          if (spinnerEl) spinnerEl.style.display = 'none';
          kioskShowError('Connection Error', 'Could not confirm the recipe sale. Contact staff for assistance.', false);
        });
        return;
      }

      // Phase 44 (D-05): include gift_card in confirm body so server records split payment
      fetch(mwUrl + '/api/kiosk/sale/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': SHEETS_CONFIG.MW_API_KEY || '' },
        body: JSON.stringify({
          items: items,
          reference_number: refNumber,
          transaction_id: txnId,
          // CR-01: deterministic replay key so the server can short-circuit a duplicate confirm
          idempotency_key: refNumber,
          customer_name: _kioskCustomer ? _kioskCustomer.name : '',
          contact_id: _kioskCustomer ? _kioskCustomer.contact_id : '',
          discount: _kioskDiscount ? { preset_id: _kioskDiscount.presetId, name: _kioskDiscount.name, type: _kioskDiscount.type, value: _kioskDiscount.value, scope: _kioskDiscount.scope } : undefined,
          gift_card: _kioskGiftCard ? { cert_number: _kioskGiftCard.cert_number, amount_applied: _kioskGiftCard.amount_applied } : undefined
        })
      })
      .then(function (r) { return r.json().then(function (d) { return { status: r.status, data: d }; }); })
      .then(function (result) { handleSaleResult(result); })
      .catch(function () {
        if (cancelled || saleCompleted) return;
        if (spinnerEl) spinnerEl.style.display = 'none';
        kioskShowError('Connection Error', 'Could not reach the server. Please try again.', true);
      });
    }

    // Phase 44: _kioskPushToTerminal — called by GC panel "Proceed" / "Skip" buttons (or immediately for recipe sales).
    // Hides GC panel, switches cancel to terminal-cancel, updates amount display, then starts terminal push + poll.
    var _kioskPushToTerminal = function () {
      // Update standardSaleBody with the current gift card state (D-05: client-side clamp already applied in GC panel)
      if (!isRecipeSale) {
        standardSaleBody.gift_card = _kioskGiftCard
          ? { cert_number: _kioskGiftCard.cert_number, amount_applied: _kioskGiftCard.amount_applied }
          : undefined;
      }

      // Update amount display to terminal amount (total minus gift card)
      var terminalAmtDisplay = (!isRecipeSale && _kioskGiftCard)
        ? Math.max(0, Math.round((totals.total - _kioskGiftCard.amount_applied) * 100) / 100)
        : totals.total;
      if (amountEl) amountEl.textContent = kioskFmt(terminalAmtDisplay);

      // Hide GC panel
      var gcPanelEl = document.getElementById('kiosk-gc-panel');
      if (gcPanelEl) gcPanelEl.style.display = 'none';

      // Switch cancel button to terminal-cancel behavior
      if (cancelBtn) {
        cancelBtn.disabled = false;
        cancelBtn.onclick = function () {
          cancelled = true;
          cancelBtn.disabled = true;
          if (msgEl) msgEl.textContent = 'Cancelling...';
          fetch(mwUrl + '/api/pos/cancel', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': SHEETS_CONFIG.MW_API_KEY || '' }
          }).catch(function () {}).then(function () {
            kioskShowView('browse');
          });
        };
      }

      // Show terminal UI
      if (msgEl) msgEl.textContent = (terminalAmtDisplay > 0) ? 'Tap, insert, or swipe card on terminal...' : 'Processing gift card payment...';
      if (spinnerEl) spinnerEl.style.display = '';

      // Step 1: Push payment to terminal via backend (gift_card_only path skips terminal)
      fetch(saleUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': SHEETS_CONFIG.MW_API_KEY || '' },
        body: JSON.stringify(saleBody)
      })
      .then(function (r) { return r.json().then(function (d) { return { status: r.status, data: d }; }); })
      .then(function (result) {
        if (cancelled || saleCompleted) return;
        // Phase 44: gift-card-only path (full coverage, no terminal charge needed)
        if (result.status === 202 && result.data && result.data.gift_card_only) {
          confirmSale(undefined); // no transaction_id — terminal was not charged
          return;
        }
        if (result.status !== 202 || !result.data.pending) {
          if (spinnerEl) spinnerEl.style.display = 'none';
          kioskShowError('Terminal Error', (result.data && result.data.error) || 'Failed to push to terminal.', true);
          return;
        }

        // Step 2: Poll for terminal result every 3 seconds
        var pollRef = result.data.reference;
        pollTimer = setInterval(function () {
          if (cancelled || saleCompleted) { clearInterval(pollTimer); pollTimer = null; return; }
          if (Date.now() - pollStart >= POLL_TIMEOUT_MS) {
            if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
            if (spinnerEl) spinnerEl.style.display = 'none';
            if (msgEl) msgEl.textContent = 'Terminal did not respond. Confirm manually if payment was taken, or cancel.';
            if (confirmBtn) { confirmBtn.style.display = ''; confirmBtn.disabled = false; confirmBtn.textContent = 'Confirm Manually'; }
            return;
          }
          fetch(mwUrl + '/api/kiosk/sale/status?ref=' + encodeURIComponent(pollRef), {
            headers: { 'x-api-key': SHEETS_CONFIG.MW_API_KEY || '' }
          })
          .then(function (r) { return r.json(); })
          .then(function (statusData) {
            if (cancelled || saleCompleted) return;
            if (statusData.status === 'approved') {
              confirmSale(statusData.transaction_id);
            } else if (statusData.status === 'declined') {
              if (saleCompleted) return;
              saleCompleted = true;
              if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
              if (spinnerEl) spinnerEl.style.display = 'none';
              if (confirmBtn) confirmBtn.style.display = 'none';
              kioskShowError('Payment Declined', 'The card was declined or cancelled on the terminal. Please try again.', true);
            }
          })
          .catch(function () {});
        }, 3000);
      })
      .catch(function () {
        if (cancelled || saleCompleted) return;
        if (spinnerEl) spinnerEl.style.display = 'none';
        if (msgEl) msgEl.textContent = 'Terminal connection lost. Confirm manually if payment was taken.';
      });

      // Show manual confirm fallback after 15 seconds
      setTimeout(function () {
        if (cancelled || saleCompleted) return;
        if (confirmBtn) {
          confirmBtn.style.display = '';
          confirmBtn.disabled = false;
          confirmBtn.textContent = 'Confirm Manually';
        }
        if (msgEl) msgEl.textContent = 'Waiting for terminal... or confirm manually if payment was taken.';
      }, 15000);
    };

    if (confirmBtn) {
      confirmBtn.onclick = function () {
        if (saleCompleted) return;
        confirmBtn.disabled = true;
        if (cancelBtn) cancelBtn.disabled = true;
        confirmSale('manual-confirm');
      };
    }

    // === Phase 44: Gift Card Tender Panel — inject for non-recipe standard sales only ===
    // For recipe sales, push to terminal immediately (no GC tender on recipe path).
    if (isRecipeSale) {
      _kioskPushToTerminal();
    } else {
      // Inject GC panel between kiosk-payment-items and payment footer
      if (itemsEl && itemsEl.parentNode) {
        var gcPanelEl2 = document.getElementById('kiosk-gc-panel');
        if (!gcPanelEl2) {
          gcPanelEl2 = document.createElement('div');
          gcPanelEl2.id = 'kiosk-gc-panel';
          gcPanelEl2.style.cssText = 'margin:0.75rem 0;padding:0.75rem;border:1px solid #e0e0e0;border-radius:8px;background:#fafafa;';
          itemsEl.parentNode.insertBefore(gcPanelEl2, itemsEl.nextSibling);
        }
        gcPanelEl2.style.display = '';
        gcPanelEl2.innerHTML = [
          '<div id="kgcr-initial-row" style="display:flex;gap:0.5rem;flex-wrap:wrap;">',
          '<button type="button" id="kgcr-open-btn" style="flex:1;min-width:110px;padding:0.5rem 0.75rem;background:#fff;border:1px solid #bbb;border-radius:6px;cursor:pointer;font-size:0.9rem;">Apply Gift Card</button>',
          '<button type="button" id="kgcr-skip-btn" style="flex:2;min-width:110px;padding:0.5rem 0.75rem;background:var(--cellar-green,#2e7d32);color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:0.9rem;">Proceed to Terminal &#x2192;</button>',
          '</div>',
          '<div id="kgcr-form" style="display:none;margin-top:0.5rem;">',
          '<div style="display:flex;gap:0.5rem;margin-bottom:0.5rem;">',
          '<input type="text" id="kgcr-cert" placeholder="GC-000000" autocomplete="off" ',
          'style="flex:1;padding:0.4rem 0.6rem;font-size:1rem;border:1px solid #ccc;border-radius:4px;text-transform:uppercase;" />',
          '<button type="button" id="kgcr-lookup-btn" style="padding:0.4rem 0.8rem;background:#fff;border:1px solid #bbb;border-radius:4px;cursor:pointer;font-size:0.9rem;">Look Up</button>',
          '</div>',
          '<div id="kgcr-balance-info" style="display:none;margin-bottom:0.5rem;padding:0.4rem 0.6rem;background:#f0f4f0;border-radius:4px;font-size:0.9rem;"></div>',
          '<div id="kgcr-amount-wrap" style="display:none;">',
          '<div style="display:flex;gap:0.5rem;margin-bottom:0.5rem;align-items:center;">',
          '<input type="number" id="kgcr-amount" placeholder="0.00" step="0.01" min="0.01" ',
          'style="flex:1;padding:0.4rem 0.6rem;font-size:1rem;border:1px solid #ccc;border-radius:4px;" />',
          '<button type="button" id="kgcr-confirm-btn" style="padding:0.4rem 0.8rem;background:var(--cellar-green,#2e7d32);color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:0.9rem;">Apply</button>',
          '</div>',
          '</div>',
          '<div id="kgcr-error" style="display:none;color:#c00;font-size:0.88rem;margin-bottom:0.4rem;"></div>',
          '<button type="button" id="kgcr-back-btn" style="background:none;border:none;cursor:pointer;color:#666;font-size:0.85rem;padding:0;">&#x2190; Back</button>',
          '</div>',
          '<div id="kgcr-applied" style="display:none;margin-top:0.5rem;">',
          '<div id="kgcr-split-display" style="font-size:0.92rem;padding:0.3rem 0;margin-bottom:0.5rem;"></div>',
          '<div style="display:flex;gap:0.5rem;">',
          '<button type="button" id="kgcr-remove-btn" style="flex:1;padding:0.5rem;background:#fff;border:1px solid #bbb;border-radius:6px;cursor:pointer;font-size:0.85rem;">Remove</button>',
          '<button type="button" id="kgcr-proceed-btn" style="flex:2;padding:0.5rem;background:var(--cellar-green,#2e7d32);color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:0.9rem;">Proceed to Terminal &#x2192;</button>',
          '</div>',
          '</div>'
        ].join('');

        var _gcLookedUpBalance = 0;
        var gcInitialRow = document.getElementById('kgcr-initial-row');
        var gcForm = document.getElementById('kgcr-form');
        var gcApplied = document.getElementById('kgcr-applied');
        var gcBalanceInfo = document.getElementById('kgcr-balance-info');
        var gcAmountWrap = document.getElementById('kgcr-amount-wrap');
        var gcErrorEl = document.getElementById('kgcr-error');
        var gcSplitDisplay = document.getElementById('kgcr-split-display');
        var gcOpenBtn = document.getElementById('kgcr-open-btn');
        var gcSkipBtn = document.getElementById('kgcr-skip-btn');
        var gcLookupBtn = document.getElementById('kgcr-lookup-btn');
        var gcConfirmBtn = document.getElementById('kgcr-confirm-btn');
        var gcBackBtn = document.getElementById('kgcr-back-btn');
        var gcRemoveBtn = document.getElementById('kgcr-remove-btn');
        var gcProceedBtn = document.getElementById('kgcr-proceed-btn');

        if (gcOpenBtn) {
          gcOpenBtn.onclick = function () {
            if (gcInitialRow) gcInitialRow.style.display = 'none';
            if (gcApplied) gcApplied.style.display = 'none';
            if (gcErrorEl) { gcErrorEl.style.display = 'none'; gcErrorEl.textContent = ''; }
            if (gcBalanceInfo) gcBalanceInfo.style.display = 'none';
            if (gcAmountWrap) gcAmountWrap.style.display = 'none';
            if (gcForm) gcForm.style.display = '';
            var ci = document.getElementById('kgcr-cert');
            if (ci) ci.focus();
          };
        }

        if (gcSkipBtn) {
          gcSkipBtn.onclick = function () { _kioskGiftCard = null; _kioskPushToTerminal(); };
        }

        if (gcBackBtn) {
          gcBackBtn.onclick = function () {
            if (gcForm) gcForm.style.display = 'none';
            if (gcApplied) gcApplied.style.display = 'none';
            if (gcInitialRow) gcInitialRow.style.display = 'flex';
            if (gcErrorEl) { gcErrorEl.style.display = 'none'; gcErrorEl.textContent = ''; }
          };
        }

        if (gcLookupBtn) {
          gcLookupBtn.onclick = function () {
            var ci = document.getElementById('kgcr-cert');
            var cert2 = ci ? ci.value.trim().toUpperCase() : '';
            if (!cert2) {
              if (gcErrorEl) { gcErrorEl.textContent = 'Enter a certificate number.'; gcErrorEl.style.display = ''; }
              return;
            }
            if (gcErrorEl) { gcErrorEl.style.display = 'none'; gcErrorEl.textContent = ''; }
            if (gcBalanceInfo) gcBalanceInfo.style.display = 'none';
            if (gcAmountWrap) gcAmountWrap.style.display = 'none';
            gcLookupBtn.disabled = true; gcLookupBtn.textContent = 'Looking up...';
            fetch(mwUrl + '/api/kiosk/gift-card/lookup?cert_number=' + encodeURIComponent(cert2), {
              headers: { 'x-api-key': SHEETS_CONFIG.MW_API_KEY || '' }
            })
            .then(function (r) { return r.json().then(function (d) { return { status: r.status, data: d }; }); })
            .then(function (res2) {
              gcLookupBtn.disabled = false; gcLookupBtn.textContent = 'Look Up';
              if (res2.status === 404 || !res2.data.ok) {
                if (gcErrorEl) { gcErrorEl.textContent = 'Certificate not found.'; gcErrorEl.style.display = ''; }
                return;
              }
              var d2 = res2.data.data || {};
              if (d2.status && d2.status !== 'active') {
                if (gcErrorEl) { gcErrorEl.textContent = 'Certificate is ' + d2.status + ' and cannot be redeemed.'; gcErrorEl.style.display = ''; }
                return;
              }
              _gcLookedUpBalance = parseFloat(d2.current_balance) || 0;
              if (_gcLookedUpBalance <= 0) {
                if (gcErrorEl) { gcErrorEl.textContent = 'Certificate has a zero balance.'; gcErrorEl.style.display = ''; }
                return;
              }
              if (gcBalanceInfo) {
                gcBalanceInfo.textContent = 'Balance: ' + kioskFmt(_gcLookedUpBalance) +
                  (d2.face_value ? ' (Face: ' + kioskFmt(parseFloat(d2.face_value)) + ')' : '');
                gcBalanceInfo.style.display = '';
              }
              var defAmt = Math.round(Math.min(_gcLookedUpBalance, totals.total) * 100) / 100;
              var ai = document.getElementById('kgcr-amount');
              if (ai) ai.value = defAmt.toFixed(2);
              if (gcAmountWrap) gcAmountWrap.style.display = '';
            })
            .catch(function () {
              gcLookupBtn.disabled = false; gcLookupBtn.textContent = 'Look Up';
              if (gcErrorEl) { gcErrorEl.textContent = 'Lookup failed. Check connection and try again.'; gcErrorEl.style.display = ''; }
            });
          };
        }

        if (gcConfirmBtn) {
          gcConfirmBtn.onclick = function () {
            var ci = document.getElementById('kgcr-cert');
            var ai = document.getElementById('kgcr-amount');
            var cert2 = ci ? ci.value.trim().toUpperCase() : '';
            var applied2 = parseFloat(ai ? ai.value : 0) || 0;
            // D-05: clamp to min(balance, total) client-side; server re-clamps
            applied2 = Math.round(Math.min(applied2, _gcLookedUpBalance, totals.total) * 100) / 100;
            if (applied2 <= 0) {
              if (gcErrorEl) { gcErrorEl.textContent = 'Amount must be greater than zero.'; gcErrorEl.style.display = ''; }
              return;
            }
            _kioskGiftCard = { cert_number: cert2, amount_applied: applied2, balance: _gcLookedUpBalance };
            var termAmt2 = Math.max(0, Math.round((totals.total - applied2) * 100) / 100);
            if (gcSplitDisplay) {
              gcSplitDisplay.innerHTML = '<strong>Gift Card:</strong> ' + kioskFmt(applied2) +
                (termAmt2 > 0
                  ? ' &nbsp;&nbsp; <strong>Terminal:</strong> ' + kioskFmt(termAmt2)
                  : ' &nbsp;&nbsp; <em>(Full coverage — no terminal charge)</em>');
            }
            if (amountEl) amountEl.textContent = kioskFmt(termAmt2 > 0 ? termAmt2 : totals.total);
            if (gcForm) gcForm.style.display = 'none';
            if (gcInitialRow) gcInitialRow.style.display = 'none';
            if (gcApplied) gcApplied.style.display = '';
            if (gcProceedBtn) gcProceedBtn.textContent = termAmt2 > 0 ? 'Proceed to Terminal →' : 'Complete Gift Card Payment →';
          };
        }

        if (gcRemoveBtn) {
          gcRemoveBtn.onclick = function () {
            _kioskGiftCard = null;
            if (amountEl) amountEl.textContent = kioskFmt(totals.total);
            if (gcApplied) gcApplied.style.display = 'none';
            if (gcInitialRow) gcInitialRow.style.display = 'flex';
            if (gcErrorEl) { gcErrorEl.style.display = 'none'; gcErrorEl.textContent = ''; }
          };
        }

        if (gcProceedBtn) {
          gcProceedBtn.onclick = function () { _kioskPushToTerminal(); };
        }
      } else {
        // GC panel injection failed (unexpected DOM state) — fall through to terminal immediately
        _kioskPushToTerminal();
      }
    }
  }

  // ===== Batch Review (NEW) =====

  function kioskShowBatchReview(saleData, totals, items, kitItems) {
    kioskShowView('review-batches');
    var today = new Date().toISOString().slice(0, 10);
    var formList = document.getElementById('kiosk-batch-form-list');
    if (!formList) return;

    // Expand kits by quantity into individual batch entries
    var batchEntries = [];
    kitItems.forEach(function (it) {
      for (var q = 0; q < (it.quantity || 1); q++) {
        batchEntries.push({ name: it.name, sku: it.item_id || '' });
      }
    });

    var html = '';
    batchEntries.forEach(function (be, i) {
      html += '<div class="kiosk-batch-form-card" data-idx="' + i + '">';
      html += '<div class="kiosk-batch-form-title">' + escapeHTML(be.name) + '</div>';
      if (_kioskCustomer) {
        html += '<div class="kiosk-batch-form-customer">Customer: ' + escapeHTML(_kioskCustomer.name) + '</div>';
      }
      html += '<div class="form-group"><label>Start Date</label>' +
        '<input type="date" class="admin-input kiosk-batch-start-date" value="' + today + '"></div>';
      html += '<div class="form-group"><label>Vessel <span class="optional">(optional)</span></label>' +
        '<input type="text" class="admin-input kiosk-batch-vessel" placeholder="Leave blank to assign later"></div>';
      html += '<div class="form-group"><label>Schedule Template <span class="optional">(optional)</span></label>' +
        '<input type="text" class="admin-input kiosk-batch-schedule" placeholder="e.g. FS-0001"></div>';
      html += '</div>';
    });
    formList.innerHTML = html;

    var saveBtn = document.getElementById('kiosk-save-batches-btn');
    var skipBtn = document.getElementById('kiosk-skip-batches-btn');

    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.onclick = function () {
        saveBtn.disabled = true;
        var cards = formList.querySelectorAll('.kiosk-batch-form-card');
        var promises = batchEntries.map(function (be, i) {
          var card = cards[i];
          var startDate = card.querySelector('.kiosk-batch-start-date').value || today;
          var vessel = card.querySelector('.kiosk-batch-vessel').value.trim();
          var schedule = card.querySelector('.kiosk-batch-schedule').value.trim();
          return adminApiPost('create_batch', {
            product_name: be.name,
            product_sku: be.sku,
            customer_name: _kioskCustomer ? _kioskCustomer.name : 'Walk-In',
            customer_email: _kioskCustomer ? (_kioskCustomer.email || '') : '',
            start_date: startDate,
            vessel_id: vessel,
            schedule_id: schedule
          }).catch(function (err) {
            console.error('[kiosk] batch creation failed:', err);
            return null;
          });
        });
        Promise.all(promises).then(function (results) {
          var batches = results.filter(function (b) { return b && b.batch_id; });
          if (batches.length < promises.length) {
            showToast('Some batches could not be saved', 'warn');
          }
          kioskShowReceipt(saleData, totals, items, batches);
          kioskClearCart();
        });
      };
    }

    if (skipBtn) {
      skipBtn.onclick = function () {
        kioskShowReceipt(saleData, totals, items, []);
        kioskClearCart();
      };
    }
  }

  // ===== Receipt =====

  function kioskShowReceipt(saleData, totals, items, batches) {
    kioskShowView('receipt');
    batches = batches || [];

    var body = document.getElementById('kiosk-receipt-body');
    if (!body) return;

    var html = '';

    items.forEach(function (it) {
      html += '<div class="kiosk-receipt-row">';
      html += '<span>' + (it.name || '') + ' x' + (it.quantity || 1) + '</span>';
      html += '<span>' + kioskFmt((it.rate || 0) * (it.quantity || 1)) + '</span>';
      html += '</div>';
    });

    if (totals.tax > 0) {
      html += '<div class="kiosk-receipt-row"><span>Tax</span><span>' + kioskFmt(totals.tax) + '</span></div>';
    }

    html += '<div class="kiosk-receipt-row" style="font-weight:700;font-size:1.05rem;">';
    html += '<strong>Total</strong><strong>' + kioskFmt(saleData.total || totals.total) + '</strong>';
    html += '</div>';

    if (saleData.invoice_number) {
      html += '<div class="kiosk-receipt-row"><span>Invoice</span><span>' + saleData.invoice_number + '</span></div>';
    }
    if (saleData.transaction_id) {
      html += '<div class="kiosk-receipt-row"><span>Transaction</span><span style="font-size:0.8rem;font-family:monospace;">' + saleData.transaction_id + '</span></div>';
    }
    if (saleData.auth_code) {
      html += '<div class="kiosk-receipt-row"><span>Auth Code</span><span>' + saleData.auth_code + '</span></div>';
    }
    if (saleData.date) {
      html += '<div class="kiosk-receipt-row"><span>Date</span><span>' + saleData.date + '</span></div>';
    }

    if (batches.length > 0) {
      html += '<div class="kiosk-receipt-batches">';
      html += '<div class="kiosk-receipt-section-title">Batches Created</div>';
      batches.forEach(function (b, i) {
        html += '<div class="kiosk-receipt-batch-row">';
        html += '<span>' + (b.batch_id || '') + '</span>';
        html += '<button type="button" class="btn admin-btn-sm kiosk-save-label-btn" data-batch-idx="' + i + '">Save Label</button>';
        html += '</div>';
      });
      html += '</div>';
    }

    body.innerHTML = html;

    if (batches.length > 0) {
      Array.prototype.forEach.call(body.querySelectorAll('.kiosk-save-label-btn'), function (btn) {
        btn.onclick = function () {
          var idx = parseInt(btn.getAttribute('data-batch-idx'), 10);
          var b = batches[idx];
          if (!b) return;
          var today = new Date().toISOString().slice(0, 10);
          var qrSvg = '';
          if (typeof qrcode !== 'undefined' && b.batch_id && b.access_token) {
            var qr = generateBatchQR(b.batch_id, b.access_token);
            qrSvg = qr.createSvgTag(4);
          }
          var labelHtml = buildBatchLabelHTML({
            batch: {
              batch_id: b.batch_id,
              customer_name: _kioskCustomer ? _kioskCustomer.name : 'Walk-In',
              customer_email: _kioskCustomer ? (_kioskCustomer.email || '') : '',
              start_date: b.start_date || today
            },
            tasks: [],
            qrSvg: qrSvg
          });
          var pw = window.open('', '_blank');
          if (pw) {
            pw.document.write(labelHtml);
            pw.document.close();
            setTimeout(function () { pw.print(); }, 250);
          }
        };
      });
    }

    var newSaleBtn = document.getElementById('kiosk-new-sale-btn');
    if (newSaleBtn) {
      newSaleBtn.onclick = function () {
        kioskLoadProducts(true);
        _kioskCustomer = null;
        kioskClearImportedSo();
        kioskShowView('browse');
      };
    }
  }

  // ===== Error View =====

  function kioskShowError(title, msg, canRetry, extra) {
    kioskShowView('error');

    var titleEl = document.getElementById('kiosk-error-title');
    var msgEl = document.getElementById('kiosk-error-msg');
    var retryBtn = document.getElementById('kiosk-retry-btn');
    var backBtn = document.getElementById('kiosk-back-btn');
    var detailEl = document.getElementById('kiosk-error-detail');

    if (titleEl) titleEl.textContent = title;
    if (msgEl) msgEl.textContent = msg;

    if (detailEl) {
      if (extra && extra.txnId) {
        detailEl.textContent = 'Ref: ' + extra.txnId;
        detailEl.style.display = '';
      } else {
        detailEl.style.display = 'none';
      }
    }

    if (retryBtn) {
      retryBtn.style.display = canRetry ? '' : 'none';
      retryBtn.onclick = function () {
        kioskShowView('browse');
        kioskStartCheckout();
      };
    }

    if (backBtn) {
      backBtn.onclick = function () {
        kioskShowView('browse');
      };
    }
  }

  // ===== Sales Orders / Collect Payment =====

  function kioskShowCollect() {
    kioskShowView('collect');
    kioskLoadSalesOrders();
  }

  function kioskLoadSalesOrders() {
    var mwUrl = kioskMwUrl();
    if (!mwUrl) {
      var list = document.getElementById('kiosk-so-list');
      if (list) list.innerHTML = '<p class="kiosk-loading">Middleware URL not configured.</p>';
      return;
    }

    var list = document.getElementById('kiosk-so-list');
    if (list) {
      list.innerHTML = '<div class="kiosk-so-skeleton"><div class="kiosk-so-skeleton-card"></div>' +
        '<div class="kiosk-so-skeleton-card"></div><div class="kiosk-so-skeleton-card"></div></div>';
    }

    fetch(mwUrl + '/api/kiosk/salesorders', {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      _kioskSalesOrders = data.salesorders || [];
      kioskRenderSoChips();
      kioskRenderSoList();
    })
    .catch(function (err) {
      if (list) list.innerHTML = '<p class="kiosk-loading">Could not load sales orders. Check connection and try again.</p>';
    });
  }

  function kioskRenderSoList() {
    var list = document.getElementById('kiosk-so-list');
    if (!list) return;

    // Step 1: Chip filter (client-side, no re-fetch -- per D-09 discretion)
    var chipFiltered = _kioskSalesOrders;
    if (_kioskSoActiveChips.indexOf('all') === -1) {
      chipFiltered = _kioskSalesOrders.filter(function (so) {
        // Map Zoho 'confirmed' status to our 'paid' chip
        var displayStatus = (so.status === 'confirmed' || so.status === 'invoiced') ? 'paid' : so.status;
        return _kioskSoActiveChips.indexOf(displayStatus) !== -1;
      });
    }

    // Step 2: Search filter (existing pattern)
    var searchTerm = (document.getElementById('kiosk-so-search') || {}).value || '';
    searchTerm = searchTerm.toLowerCase().trim();
    var filtered = chipFiltered;
    if (searchTerm) {
      filtered = chipFiltered.filter(function (so) {
        var haystack = ((so.customer_name || '') + ' ' + (so.salesorder_number || '')).toLowerCase();
        return haystack.indexOf(searchTerm) !== -1;
      });
    }

    // Step 3: Empty state
    if (filtered.length === 0) {
      if (_kioskSoActiveChips.indexOf('all') !== -1 && _kioskSalesOrders.length === 0) {
        list.innerHTML = '<div class="kiosk-so-empty"><h3>No sales orders</h3><p>Create a new order to get started.</p></div>';
      } else {
        list.innerHTML = '<div class="kiosk-so-empty"><h3>No orders match this filter</h3><p>Try a different filter or search, or create a new order.</p></div>';
      }
      return;
    }

    // Step 4: Render cards
    var html = '';
    filtered.forEach(function (so) {
      var total = parseFloat(so.total) || 0;
      var balance = parseFloat(so.balance) || 0;
      var displayAmount = balance > 0 ? balance : total;
      var lineItems = so.line_items || [];
      var displayStatus = (so.status === 'confirmed' || so.status === 'invoiced') ? 'paid' : so.status;
      var isActionable = displayStatus === 'open' || displayStatus === 'draft';

      html += '<div class="kiosk-so-card" data-so-id="' + escapeHTML(so.salesorder_id) + '">';
      html += '<div class="kiosk-so-card-header">';
      html += '<span class="kiosk-so-number">' + escapeHTML(so.salesorder_number || '') + '</span>';
      html += '<span class="kiosk-so-balance">' + kioskFmt(displayAmount) + '</span>';
      html += '</div>';
      html += '<div class="kiosk-so-card-body">';
      html += '<span class="kiosk-so-customer">' + escapeHTML(so.customer_name || 'Unknown') + '</span>';
      html += '<span class="kiosk-so-date">' + escapeHTML(so.date || '') + '</span>';
      html += '</div>';

      html += '<div class="kiosk-so-card-detail" data-so-detail="' + escapeHTML(so.salesorder_id) + '" style="display:none;"></div>';
      html += '<button type="button" class="kiosk-so-toggle-btn" data-so-id="' + escapeHTML(so.salesorder_id) + '">View Items &#9662;</button>';

      // Action row (per D-05, D-11)
      html += '<div class="kiosk-so-card-actions">';
      if (isActionable) {
        if (displayAmount > 0) {
          html += '<button type="button" class="btn kiosk-so-pay-btn" data-so-id="' + escapeHTML(so.salesorder_id) + '">';
          html += 'Collect ' + kioskFmt(displayAmount);
          html += '</button>';
        } else {
          html += '<div class="kiosk-so-paid-badge">Paid</div>';
        }
        html += '<button type="button" class="btn-secondary kiosk-so-import-btn" data-so-id="' + escapeHTML(so.salesorder_id) + '">';
        html += 'Import to Cart';
        html += '</button>';
      } else {
        // D-11: closed/paid SO -- Reorder button
        html += '<div class="kiosk-so-paid-badge">' + escapeHTML(displayStatus.charAt(0).toUpperCase() + displayStatus.slice(1)) + '</div>';
        html += '<button type="button" class="btn-secondary kiosk-so-reorder-btn" data-so-id="' + escapeHTML(so.salesorder_id) + '">';
        html += 'Reorder Items';
        html += '</button>';
      }
      html += '</div>';

      html += '</div>';
    });

    list.innerHTML = html;

    // Wire pay buttons (existing pattern)
    Array.prototype.forEach.call(list.querySelectorAll('.kiosk-so-pay-btn'), function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        kioskCollectPayment(btn.getAttribute('data-so-id'));
      });
    });

    // Wire import buttons (D-01)
    Array.prototype.forEach.call(list.querySelectorAll('.kiosk-so-import-btn'), function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        kioskImportSoToCart(btn.getAttribute('data-so-id'));
      });
    });

    // Wire reorder buttons (D-11)
    Array.prototype.forEach.call(list.querySelectorAll('.kiosk-so-reorder-btn'), function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        kioskReorderSo(btn.getAttribute('data-so-id'));
      });
    });

    // Wire view-items toggle buttons
    Array.prototype.forEach.call(list.querySelectorAll('.kiosk-so-toggle-btn'), function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var soId = btn.getAttribute('data-so-id');
        var detailEl = list.querySelector('[data-so-detail="' + soId + '"]');
        if (!detailEl) return;

        if (detailEl.style.display !== 'none') {
          detailEl.style.display = 'none';
          btn.innerHTML = 'View Items &#9662;';
          return;
        }

        if (detailEl.getAttribute('data-loaded')) {
          detailEl.style.display = '';
          btn.innerHTML = 'Hide Items &#9652;';
          return;
        }

        btn.innerHTML = 'Loading...';
        var mwUrl = kioskMwUrl();
        fetch(mwUrl + '/api/kiosk/salesorder/' + encodeURIComponent(soId), {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' }
        })
        .then(function (r) { return r.json(); })
        .then(function (detail) {
          var items = detail.line_items || [];
          if (items.length === 0) {
            detailEl.innerHTML = '<div class="kiosk-so-detail-empty">No line items</div>';
          } else {
            var itemsHtml = '';
            items.forEach(function (li) {
              itemsHtml += '<div class="kiosk-so-detail-row">';
              itemsHtml += '<span class="kiosk-so-detail-name">' + escapeHTML(li.name || '') + '</span>';
              itemsHtml += '<span class="kiosk-so-detail-qty">&times; ' + (li.quantity || 1) + '</span>';
              itemsHtml += '<span class="kiosk-so-detail-rate">' + kioskFmt(li.rate || 0) + '</span>';
              itemsHtml += '</div>';
            });
            detailEl.innerHTML = itemsHtml;
          }
          detailEl.setAttribute('data-loaded', 'true');
          detailEl.style.display = '';
          btn.innerHTML = 'Hide Items &#9652;';
        })
        .catch(function () {
          detailEl.innerHTML = '<div class="kiosk-so-detail-empty">Could not load items</div>';
          detailEl.style.display = '';
          btn.innerHTML = 'View Items &#9662;';
        });
      });
    });
  }

  // ===== Status Chip Filter (D-09, D-10) =====

  function kioskRenderSoChips() {
    Array.prototype.forEach.call(document.querySelectorAll('.kiosk-so-chip'), function (chip) {
      var status = chip.getAttribute('data-status');
      if (_kioskSoActiveChips.indexOf(status) !== -1 ||
          (_kioskSoActiveChips.indexOf('all') !== -1 && status === 'all')) {
        chip.classList.add('active');
      } else {
        chip.classList.remove('active');
      }
    });
  }

  function kioskWireSoChips() {
    Array.prototype.forEach.call(document.querySelectorAll('.kiosk-so-chip'), function (chip) {
      chip.addEventListener('click', function () {
        var status = chip.getAttribute('data-status');
        if (status === 'all') {
          _kioskSoActiveChips = ['all'];
        } else {
          var allIdx = _kioskSoActiveChips.indexOf('all');
          if (allIdx !== -1) _kioskSoActiveChips.splice(allIdx, 1);
          var i = _kioskSoActiveChips.indexOf(status);
          if (i !== -1) {
            if (_kioskSoActiveChips.length > 1) _kioskSoActiveChips.splice(i, 1);
          } else {
            _kioskSoActiveChips.push(status);
          }
        }
        kioskRenderSoChips();
        kioskRenderSoList();
      });
    });
  }

  // ===== Import SO to Cart (D-01, D-02, D-03, D-04) =====

  function kioskImportSoToCart(soId) {
    var so = null;
    for (var i = 0; i < _kioskSalesOrders.length; i++) {
      if (_kioskSalesOrders[i].salesorder_id === soId) { so = _kioskSalesOrders[i]; break; }
    }
    if (!so) { showToast('Order not found', 'error'); return; }

    // D-03: confirm if cart non-empty
    if (Object.keys(_kioskCart).length > 0) {
      if (!confirm('Replace current cart with items from ' + (so.salesorder_number || '') + '? Current cart will be cleared.')) return;
    }

    if (!_kioskProductsLoaded) {
      showToast('Products are still loading. Please wait and try again.', 'info');
      return;
    }

    showToast('Loading order items...', 'info');

    var mwUrl = kioskMwUrl();
    fetch(mwUrl + '/api/kiosk/salesorder/' + encodeURIComponent(soId), {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    })
    .then(function (r) { return r.json(); })
    .then(function (detail) {
      var lineItems = detail.line_items || [];
      if (lineItems.length === 0) {
        showToast('This order has no line items to import', 'warning');
        return;
      }

      _kioskCart = {};
      _kioskDiscount = null;
      var skipped = 0;

      lineItems.forEach(function (li) {
        if (!li.item_id) { skipped++; return; }
        var product = kioskFindProductById(li.item_id);
        if (product) {
          _kioskCart[product.item_id] = { item: product, qty: li.quantity || 1 };
        } else {
          skipped++;
        }
      });

      _kioskImportedSoId = so.salesorder_id;
      _kioskImportedSoNumber = so.salesorder_number || '';
      _kioskImportedSoUpdated = false;

      if (skipped > 0) {
        showToast(skipped + ' item(s) not found in current catalog — skipped', 'warning');
      }

      kioskSyncKitFees();
      kioskRenderCart();
      kioskRenderProducts();
      kioskShowView('browse');
    })
    .catch(function () {
      showToast('Could not load order details — check connection', 'error');
    });
  }

  // ===== Reorder SO (D-11) =====

  function kioskReorderSo(soId) {
    var so = null;
    for (var i = 0; i < _kioskSalesOrders.length; i++) {
      if (_kioskSalesOrders[i].salesorder_id === soId) { so = _kioskSalesOrders[i]; break; }
    }
    if (!so) { showToast('Order not found', 'error'); return; }

    if (!confirm('Create a new order with the same items as ' + (so.salesorder_number || '') + '?')) return;

    var mwUrl = kioskMwUrl();
    if (!mwUrl) { showToast('Middleware URL not configured', 'error'); return; }

    showToast('Loading order items...', 'info');

    fetch(mwUrl + '/api/kiosk/salesorder/' + encodeURIComponent(soId), {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    })
    .then(function (r) { return r.json(); })
    .then(function (detail) {
      var lineItems = (detail.line_items || []).filter(function (li) { return !!li.item_id; });

      if (lineItems.length === 0) {
        showToast('No items could be copied from this order', 'error');
        return;
      }

      var payload = {
        customer_id: so.customer_id,
        items: lineItems.map(function (li) {
          return { item_id: li.item_id, name: li.name, quantity: li.quantity, rate: li.rate };
        })
      };

      return fetch(mwUrl + '/api/kiosk/salesorder-create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': SHEETS_CONFIG.MW_API_KEY || '' },
        body: JSON.stringify(payload)
      })
      .then(function (r) { return r.json().then(function (d) { return { status: r.status, data: d }; }); })
      .then(function (result) {
        if (result.data && result.data.ok) {
          showToast('New order created: ' + escapeHTML(result.data.salesorder_number || ''), 'success');
          kioskLoadSalesOrders();
        } else {
          showToast((result.data && result.data.error) || 'Could not create order', 'error');
        }
      });
    })
    .catch(function () {
      showToast('Could not create order — network error', 'error');
    });
  }

  // ===== Clear Imported SO State =====

  function kioskClearImportedSo() {
    _kioskImportedSoId = null;
    _kioskImportedSoNumber = null;
    _kioskImportedSoUpdated = false;
  }

  function kioskCollectPayment(soId) {
    var so = null;
    for (var i = 0; i < _kioskSalesOrders.length; i++) {
      if (_kioskSalesOrders[i].salesorder_id === soId) { so = _kioskSalesOrders[i]; break; }
    }
    if (!so) {
      showToast('Sales order not found', 'error');
      return;
    }

    _kioskSoPayingId = soId;
    var balance = parseFloat(so.balance) || 0;
    var mwUrl = kioskMwUrl();
    if (!mwUrl) {
      showToast('Middleware URL not configured', 'error');
      return;
    }

    if (!_kioskTerminalReady) {
      showToast('POS terminal is not ready. Check terminal status below.', 'error');
      return;
    }

    // Show payment view
    kioskShowView('payment');

    var amountEl = document.getElementById('kiosk-payment-amount');
    var msgEl = document.getElementById('kiosk-terminal-msg');
    var spinnerEl = document.getElementById('kiosk-spinner');
    var itemsEl = document.getElementById('kiosk-payment-items');
    var cancelBtn = document.getElementById('kiosk-cancel-payment');

    if (amountEl) amountEl.textContent = kioskFmt(balance);
    if (msgEl) msgEl.textContent = 'Collecting payment for ' + escapeHTML(so.salesorder_number || '') + '...';
    if (spinnerEl) spinnerEl.style.display = '';

    if (itemsEl) {
      var itemHtml = '<div class="kiosk-payment-item-row"><span>Order</span><span>' + escapeHTML(so.salesorder_number || '') + '</span></div>';
      itemHtml += '<div class="kiosk-payment-item-row"><span>Customer</span><span>' + escapeHTML(so.customer_name || '') + '</span></div>';
      var lineItems = so.line_items || [];
      lineItems.forEach(function (li) {
        itemHtml += '<div class="kiosk-payment-item-row">';
        itemHtml += '<span>' + escapeHTML(li.name || li.description || '') + ' x' + (li.quantity || 1) + '</span>';
        itemHtml += '<span>' + kioskFmt((parseFloat(li.rate) || 0) * (li.quantity || 1)) + '</span>';
        itemHtml += '</div>';
      });
      itemsEl.innerHTML = itemHtml;
    }

    var cancelled = false;
    if (cancelBtn) {
      cancelBtn.disabled = false;
      cancelBtn.onclick = function () {
        cancelled = true;
        kioskShowCollect();
      };
    }

    fetch(mwUrl + '/api/kiosk/salesorder-pay', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': SHEETS_CONFIG.MW_API_KEY || '' },
      body: JSON.stringify({ salesorder_id: soId })
    })
    .then(function (r) { return r.json().then(function (d) { return { status: r.status, data: d }; }); })
    .then(function (result) {
      if (cancelled) return;
      if (spinnerEl) spinnerEl.style.display = 'none';

      if (result.data && result.data.ok) {
        // Show a simplified receipt for SO payment
        kioskShowView('receipt');
        var body = document.getElementById('kiosk-receipt-body');
        if (body) {
          var html = '';
          html += '<div class="kiosk-receipt-row"><span>Order</span><span>' + escapeHTML(result.data.salesorder_number || so.salesorder_number || '') + '</span></div>';
          html += '<div class="kiosk-receipt-row" style="font-weight:700;font-size:1.05rem;">';
          html += '<strong>Amount</strong><strong>' + kioskFmt(result.data.amount || balance) + '</strong>';
          html += '</div>';
          if (result.data.transaction_id) {
            html += '<div class="kiosk-receipt-row"><span>Transaction</span><span style="font-size:0.8rem;font-family:monospace;">' + escapeHTML(result.data.transaction_id) + '</span></div>';
          }
          if (result.data.card_type) {
            html += '<div class="kiosk-receipt-row"><span>Card</span><span>' + escapeHTML(result.data.card_type) + '</span></div>';
          }
          body.innerHTML = html;
        }
        var newSaleBtn = document.getElementById('kiosk-new-sale-btn');
        if (newSaleBtn) {
          newSaleBtn.onclick = function () {
            kioskLoadProducts(true);
            _kioskSoPayingId = null;
            if (_kioskImportedSoId) {
              // D-07: Return to empty cart/product grid after SO payment
              kioskClearImportedSo();
              _kioskCart = {};
              _kioskDiscount = null;
              kioskRenderCart();
              kioskShowView('browse');
            } else {
              kioskShowCollect();
            }
          };
        }
      } else if (result.status === 402) {
        kioskShowSoError('Payment Declined', result.data.error || 'Card was declined. Please try a different payment method.', true);
      } else if (result.status === 504) {
        kioskShowSoError('Terminal Timeout', result.data.error || 'Terminal did not respond in time. Please try again.', true);
      } else if (result.data && result.data.payment_voided) {
        kioskShowSoError('Payment Voided',
          'Your payment was automatically reversed. No charge was made to the customer.',
          true, { txnId: result.data.voided_transaction_id || '' });
      } else {
        kioskShowSoError('Payment Error', (result.data && result.data.error) || 'An error occurred. Please try again.', true);
      }
    })
    .catch(function () {
      if (cancelled) return;
      if (spinnerEl) spinnerEl.style.display = 'none';
      kioskShowSoError('Connection Error', 'Could not reach the payment server. Please try again.', true);
    });
  }

  function kioskShowSoError(title, msg, canRetry, extra) {
    kioskShowView('error');

    var titleEl = document.getElementById('kiosk-error-title');
    var msgEl = document.getElementById('kiosk-error-msg');
    var retryBtn = document.getElementById('kiosk-retry-btn');
    var backBtn = document.getElementById('kiosk-back-btn');
    var detailEl = document.getElementById('kiosk-error-detail');

    if (titleEl) titleEl.textContent = title;
    if (msgEl) msgEl.textContent = msg;

    if (detailEl) {
      if (extra && extra.txnId) {
        detailEl.textContent = 'Ref: ' + extra.txnId;
        detailEl.style.display = '';
      } else {
        detailEl.style.display = 'none';
      }
    }

    if (retryBtn) {
      retryBtn.style.display = canRetry ? '' : 'none';
      retryBtn.onclick = function () {
        if (_kioskSoPayingId) {
          kioskCollectPayment(_kioskSoPayingId);
        } else {
          kioskShowCollect();
        }
      };
    }

    if (backBtn) {
      backBtn.textContent = 'Back to Orders';
      backBtn.onclick = function () {
        _kioskSoPayingId = null;
        kioskShowCollect();
      };
    }
  }

  // ===== Create Sales Order =====

  function kioskShowCreateSo() {
    kioskShowView('create-so');
    _kioskSoItems = [];
    _kioskSoCustomer = null;

    // Reset UI
    var custSearch = document.getElementById('kiosk-so-customer-search');
    var custDropdown = document.getElementById('kiosk-so-customer-dropdown');
    var custInfo = document.getElementById('kiosk-so-customer-info');
    var itemSearch = document.getElementById('kiosk-so-item-search');
    var itemDropdown = document.getElementById('kiosk-so-item-dropdown');
    var itemsList = document.getElementById('kiosk-so-items-list');
    var totalEl = document.getElementById('kiosk-so-total');
    var notesEl = document.getElementById('kiosk-so-notes');

    if (custSearch) custSearch.value = '';
    if (custDropdown) { custDropdown.style.display = 'none'; custDropdown.innerHTML = ''; }
    if (custInfo) { custInfo.style.display = 'none'; custInfo.innerHTML = ''; }
    if (itemSearch) itemSearch.value = '';
    if (itemDropdown) { itemDropdown.style.display = 'none'; itemDropdown.innerHTML = ''; }
    if (itemsList) itemsList.innerHTML = '';
    if (totalEl) totalEl.textContent = '$0.00';
    if (notesEl) notesEl.value = '';

    // Ensure products are loaded
    if (!_kioskProductsLoaded && !_kioskProductsLoading) {
      kioskLoadProducts();
    }

    // Wire customer search
    var custTimer = null;
    if (custSearch) {
      custSearch.oninput = function () {
        clearTimeout(custTimer);
        var q = custSearch.value.trim();
        if (!q) { if (custDropdown) custDropdown.style.display = 'none'; return; }
        custTimer = setTimeout(function () {
          var mwUrl = kioskMwUrl();
          fetch(mwUrl + '/api/contacts?search=' + encodeURIComponent(q), { headers: { 'x-api-key': SHEETS_CONFIG.MW_API_KEY || '' } })
          .then(function (r) { return r.json(); })
          .then(function (data) {
            if (!custDropdown) return;
            var contacts = (data.contacts || []).slice(0, 8);
            if (!contacts.length) {
              custDropdown.innerHTML = '<div class="kiosk-dropdown-item" style="color:var(--ink-muted);">No results</div>';
              custDropdown.style.display = '';
              return;
            }
            var html = '';
            contacts.forEach(function (c) {
              html += '<div class="kiosk-dropdown-item" data-cid="' + escapeHTML(c.contact_id || '') + '" data-name="' + escapeHTML(c.contact_name || c.name || '') + '" data-email="' + escapeHTML(c.email || '') + '">';
              html += '<strong>' + escapeHTML(c.contact_name || c.name || '') + '</strong>';
              if (c.email) html += ' <span style="color:var(--ink-tertiary);">' + escapeHTML(c.email) + '</span>';
              html += '</div>';
            });
            custDropdown.innerHTML = html;
            custDropdown.style.display = '';
            Array.prototype.forEach.call(custDropdown.querySelectorAll('.kiosk-dropdown-item'), function (item) {
              item.addEventListener('click', function () {
                _kioskSoCustomer = {
                  contact_id: item.getAttribute('data-cid'),
                  name: item.getAttribute('data-name'),
                  email: item.getAttribute('data-email')
                };
                custDropdown.style.display = 'none';
                custSearch.value = '';
                kioskRenderSoCustomerInfo();
              });
            });
          })
          .catch(function () {
            if (custDropdown) {
              custDropdown.innerHTML = '<div class="kiosk-dropdown-item" style="color:var(--ink-muted);">Search failed</div>';
              custDropdown.style.display = '';
            }
          });
        }, 300);
      };
    }

    // Wire item search
    if (itemSearch) {
      itemSearch.oninput = function () {
        var q = itemSearch.value.trim().toLowerCase();
        if (!q) { if (itemDropdown) itemDropdown.style.display = 'none'; return; }
        var matches = _kioskProducts.filter(function (p) {
          var haystack = ((p.name || '') + ' ' + (p.sku || '')).toLowerCase();
          return haystack.indexOf(q) !== -1;
        }).slice(0, 10);
        if (!itemDropdown) return;
        if (!matches.length) {
          itemDropdown.innerHTML = '<div class="kiosk-dropdown-item" style="color:var(--ink-muted);">No products found</div>';
          itemDropdown.style.display = '';
          return;
        }
        var html = '';
        matches.forEach(function (p) {
          html += '<div class="kiosk-dropdown-item" data-item-id="' + escapeHTML(p.item_id) + '">';
          html += escapeHTML(p.name || '') + ' <span style="color:var(--ink-tertiary);">' + kioskFmt(parseFloat(p.rate) || 0) + '</span>';
          html += '</div>';
        });
        itemDropdown.innerHTML = html;
        itemDropdown.style.display = '';
        Array.prototype.forEach.call(itemDropdown.querySelectorAll('.kiosk-dropdown-item'), function (item) {
          item.addEventListener('click', function () {
            var itemId = item.getAttribute('data-item-id');
            var product = null;
            for (var i = 0; i < _kioskProducts.length; i++) {
              if (_kioskProducts[i].item_id === itemId) { product = _kioskProducts[i]; break; }
            }
            if (product) kioskAddSoItem(product);
            itemDropdown.style.display = 'none';
            itemSearch.value = '';
          });
        });
      };
    }

    // Wire footer buttons
    var backBtn = document.getElementById('kiosk-create-so-back');
    var saveBtn = document.getElementById('kiosk-create-so-save');
    var payBtn = document.getElementById('kiosk-create-so-pay');

    if (backBtn) backBtn.onclick = function () { kioskShowCollect(); };
    if (saveBtn) saveBtn.onclick = function () { kioskCreateSalesOrder(false); };
    if (payBtn) payBtn.onclick = function () { kioskCreateSalesOrder(true); };
  }

  function kioskRenderSoCustomerInfo() {
    var custInfo = document.getElementById('kiosk-so-customer-info');
    if (!custInfo) return;
    if (!_kioskSoCustomer) {
      custInfo.style.display = 'none';
      custInfo.innerHTML = '';
      return;
    }
    custInfo.style.display = '';
    custInfo.innerHTML = '<div class="kiosk-so-customer-selected">' +
      '<span>' + escapeHTML(_kioskSoCustomer.name || '') +
      (_kioskSoCustomer.email ? ' &mdash; ' + escapeHTML(_kioskSoCustomer.email) : '') +
      '</span>' +
      '<button type="button" class="kiosk-so-customer-clear" id="kiosk-so-clear-customer">&times;</button>' +
      '</div>';
    var clearBtn = document.getElementById('kiosk-so-clear-customer');
    if (clearBtn) {
      clearBtn.onclick = function () {
        _kioskSoCustomer = null;
        kioskRenderSoCustomerInfo();
      };
    }
  }

  function kioskAddSoItem(product) {
    var existing = null;
    for (var i = 0; i < _kioskSoItems.length; i++) {
      if (_kioskSoItems[i].item_id === product.item_id) { existing = _kioskSoItems[i]; break; }
    }
    if (existing) {
      existing.quantity += 1;
    } else {
      _kioskSoItems.push({
        item_id: product.item_id,
        name: product.name || '',
        rate: parseFloat(product.rate) || 0,
        quantity: 1
      });
    }
    kioskRenderSoItems();
  }

  function kioskRemoveSoItem(itemId) {
    _kioskSoItems = _kioskSoItems.filter(function (it) { return it.item_id !== itemId; });
    kioskRenderSoItems();
  }

  function kioskRenderSoItems() {
    var listEl = document.getElementById('kiosk-so-items-list');
    var totalEl = document.getElementById('kiosk-so-total');
    if (!listEl) return;

    if (_kioskSoItems.length === 0) {
      listEl.innerHTML = '<p style="color:var(--ink-muted);font-size:0.9rem;padding:0.5rem 0;">No items added yet.</p>';
      if (totalEl) totalEl.textContent = '$0.00';
      return;
    }

    var total = 0;
    var html = '';
    _kioskSoItems.forEach(function (it) {
      var lineTotal = (parseFloat(it.rate) || 0) * (it.quantity || 1);
      total += lineTotal;
      html += '<div class="kiosk-so-item-row">';
      html += '<div class="kiosk-so-item-name">' + escapeHTML(it.name) + '</div>';
      html += '<div class="kiosk-so-item-controls">';
      html += '<button type="button" class="kiosk-qty-btn kiosk-so-qty-dec" data-item-id="' + escapeHTML(it.item_id) + '">-</button>';
      html += '<span class="kiosk-qty-val">' + it.quantity + '</span>';
      html += '<button type="button" class="kiosk-qty-btn kiosk-so-qty-inc" data-item-id="' + escapeHTML(it.item_id) + '">+</button>';
      html += '<span class="kiosk-so-item-total">' + kioskFmt(lineTotal) + '</span>';
      html += '<button type="button" class="kiosk-so-item-remove" data-item-id="' + escapeHTML(it.item_id) + '">&times;</button>';
      html += '</div>';
      html += '</div>';
    });
    listEl.innerHTML = html;
    if (totalEl) totalEl.textContent = kioskFmt(total);

    // Wire qty buttons
    Array.prototype.forEach.call(listEl.querySelectorAll('.kiosk-so-qty-dec'), function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-item-id');
        for (var i = 0; i < _kioskSoItems.length; i++) {
          if (_kioskSoItems[i].item_id === id) {
            _kioskSoItems[i].quantity -= 1;
            if (_kioskSoItems[i].quantity <= 0) { _kioskSoItems.splice(i, 1); }
            break;
          }
        }
        kioskRenderSoItems();
      });
    });

    Array.prototype.forEach.call(listEl.querySelectorAll('.kiosk-so-qty-inc'), function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-item-id');
        for (var i = 0; i < _kioskSoItems.length; i++) {
          if (_kioskSoItems[i].item_id === id) { _kioskSoItems[i].quantity += 1; break; }
        }
        kioskRenderSoItems();
      });
    });

    Array.prototype.forEach.call(listEl.querySelectorAll('.kiosk-so-item-remove'), function (btn) {
      btn.addEventListener('click', function () {
        kioskRemoveSoItem(btn.getAttribute('data-item-id'));
      });
    });
  }

  function kioskCreateSalesOrder(andPay) {
    if (!_kioskSoCustomer) {
      showToast('Please select a customer', 'error');
      return;
    }
    if (_kioskSoItems.length === 0) {
      showToast('Please add at least one item', 'error');
      return;
    }

    var mwUrl = kioskMwUrl();
    if (!mwUrl) {
      showToast('Middleware URL not configured', 'error');
      return;
    }

    if (andPay && !_kioskTerminalReady) {
      showToast('POS terminal is not ready. Check terminal status below.', 'error');
      return;
    }

    var saveBtn = document.getElementById('kiosk-create-so-save');
    var payBtn = document.getElementById('kiosk-create-so-pay');
    if (saveBtn) saveBtn.disabled = true;
    if (payBtn) payBtn.disabled = true;

    var notesEl = document.getElementById('kiosk-so-notes');
    var notes = notesEl ? notesEl.value.trim() : '';

    var payload = {
      customer_id: _kioskSoCustomer.contact_id,
      items: _kioskSoItems.map(function (it) {
        return { item_id: it.item_id, name: it.name, quantity: it.quantity, rate: it.rate };
      }),
      notes: notes
    };

    fetch(mwUrl + '/api/kiosk/salesorder-create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': SHEETS_CONFIG.MW_API_KEY || '' },
      body: JSON.stringify(payload)
    })
    .then(function (r) { return r.json().then(function (d) { return { status: r.status, data: d }; }); })
    .then(function (result) {
      if (saveBtn) saveBtn.disabled = false;
      if (payBtn) payBtn.disabled = false;

      if (result.data && result.data.ok) {
        if (andPay) {
          // Inject the new SO into local list so kioskCollectPayment can find it
          var newSo = {
            salesorder_id: result.data.salesorder_id,
            salesorder_number: result.data.salesorder_number || '',
            customer_name: _kioskSoCustomer ? _kioskSoCustomer.name : '',
            balance: result.data.balance || result.data.total || 0,
            total: result.data.total || 0,
            date: new Date().toISOString().slice(0, 10),
            line_items: _kioskSoItems.map(function (it) {
              return { name: it.name, quantity: it.quantity, rate: it.rate };
            })
          };
          _kioskSalesOrders.unshift(newSo);
          kioskCollectPayment(result.data.salesorder_id);
        } else {
          showToast('Order ' + (result.data.salesorder_number || '') + ' created', 'success');
          kioskShowCollect();
        }
      } else {
        showToast((result.data && result.data.error) || 'Could not create order', 'error');
      }
    })
    .catch(function () {
      if (saveBtn) saveBtn.disabled = false;
      if (payBtn) payBtn.disabled = false;
      showToast('Could not create order — network error', 'error');
    });
  }

  // ===== Discount System =====

  function kioskLoadDiscountPresets() {
    var mwUrl = kioskMwUrl();
    if (!mwUrl) return;
    fetch(mwUrl + '/api/kiosk/discounts')
      .then(function (r) { return r.json(); })
      .then(function (data) {
        _kioskDiscountPresets = (data.discounts || []).filter(function (d) { return d.active; });
      })
      .catch(function () {});
  }

  function kioskShowDiscountPopover() {
    var popover = document.getElementById('kiosk-discount-popover');
    var list = document.getElementById('kiosk-discount-preset-list');
    if (!popover || !list) return;

    var html = '';
    _kioskDiscountPresets.forEach(function (p) {
      var detail = p.type === 'percentage' ? (p.value + '% off') : ('$' + parseFloat(p.value).toFixed(2) + ' off');
      detail += ' (' + kioskDiscountScopeLabel(p) + ')';
      html += '<div class="kiosk-discount-preset-row" data-preset-id="' + escapeHTML(p.id) + '">';
      html += '<span class="kiosk-discount-preset-name">' + escapeHTML(p.name) + '</span>';
      html += '<span class="kiosk-discount-preset-detail">' + detail + '</span>';
      html += '</div>';
    });
    if (!_kioskDiscountPresets.length) {
      html = '<div style="padding:1rem;color:var(--ink-tertiary);text-align:center;">No presets configured</div>';
    }
    list.innerHTML = html;

    list.querySelectorAll('.kiosk-discount-preset-row').forEach(function (row) {
      row.addEventListener('click', function () {
        var id = row.getAttribute('data-preset-id');
        var preset = null;
        for (var i = 0; i < _kioskDiscountPresets.length; i++) {
          if (_kioskDiscountPresets[i].id === id) { preset = _kioskDiscountPresets[i]; break; }
        }
        if (preset) kioskApplyDiscount(preset);
      });
    });

    popover.style.display = '';
  }

  function kioskApplyDiscount(preset) {
    _kioskDiscount = {
      presetId: preset.id,
      name: preset.name,
      type: preset.type,
      value: preset.value,
      scope: preset.scope,
      applies_to: preset.applies_to || null
    };

    document.getElementById('kiosk-discount-popover').style.display = 'none';
    kioskRefreshAfterDiscountChange();
  }

  function kioskRemoveDiscount() {
    _kioskDiscount = null;
    kioskRefreshAfterDiscountChange();
  }

  // Recompute the displayed total after a discount changes. For recipe carts the
  // discount is server-authoritative, so re-fetch the (discount-aware) quote first.
  function kioskRefreshAfterDiscountChange() {
    if (_kioskSelectedRecipe && typeof kioskFetchRecipeQuote === 'function') {
      var p = kioskFetchRecipeQuote();
      if (p && typeof p.then === 'function') {
        p.then(function () { kioskUpdateDiscountDisplay(); kioskRenderCart(); });
        return;
      }
    }
    kioskUpdateDiscountDisplay();
    kioskRenderCart();
  }

  function kioskUpdateDiscountDisplay() {
    var btn = document.getElementById('kiosk-discount-btn');
    var applied = document.getElementById('kiosk-discount-applied');
    var nameEl = document.getElementById('kiosk-discount-applied-name');
    var amountEl = document.getElementById('kiosk-discount-applied-amount');
    var discountRow = document.getElementById('kiosk-discount-total-row');
    var discountLabel = document.getElementById('kiosk-discount-total-label');
    var discountAmount = document.getElementById('kiosk-discount-total-amount');

    if (_kioskDiscount) {
      if (btn) btn.style.display = 'none';
      if (applied) applied.style.display = '';
      if (nameEl) nameEl.textContent = _kioskDiscount.name;

      var savings = kioskCalcDiscountAmount();
      if (amountEl) amountEl.textContent = '-' + kioskFmt(savings);
      if (discountRow) discountRow.style.display = '';
      if (discountLabel) discountLabel.textContent = 'Discount: ' + _kioskDiscount.name;
      if (discountAmount) discountAmount.textContent = '-' + kioskFmt(savings);
    } else {
      if (btn) { btn.style.display = ''; btn.disabled = kioskCartIsEmpty(); }
      if (applied) applied.style.display = 'none';
      if (discountRow) discountRow.style.display = 'none';
    }
  }

  function kioskCalcDiscountAmount() {
    if (!_kioskDiscount) return 0;
    return kioskCalcTotals().discount;
  }

  // Collect the selected applies_to tokens from the two-tier checkbox panel.
  // A fully-selected group collapses to its group token ('kit'/'ingredient').
  function kioskCollectAppliesTo() {
    var panel = document.getElementById('kiosk-discount-types');
    if (!panel) return [];
    var tokens = [];
    panel.querySelectorAll('input[data-group]').forEach(function (parent) {
      var group = parent.getAttribute('data-group');
      if (parent.checked) {
        tokens.push(group);
      } else {
        panel.querySelectorAll('input[data-token]').forEach(function (c) {
          if (c.getAttribute('data-token').indexOf(group + ':') === 0 && c.checked) {
            tokens.push(c.getAttribute('data-token'));
          }
        });
      }
    });
    panel.querySelectorAll('input[data-token]').forEach(function (c) {
      var t = c.getAttribute('data-token');
      if (t.indexOf(':') === -1 && c.checked) tokens.push(t); // service / recipe
    });
    return tokens;
  }

  // Load an existing preset into the Add/Edit form for editing.
  function kioskPopulateDiscountForm(preset) {
    var modal = document.getElementById('kiosk-discount-mgmt-modal');
    var form = document.getElementById('kiosk-discount-form');
    if (!modal || !form || !preset) return;

    _kioskEditingDiscountId = preset.id;
    document.getElementById('kiosk-discount-form-name').value = preset.name || '';
    document.getElementById('kiosk-discount-form-value').value = preset.value != null ? preset.value : '';

    modal.querySelectorAll('.kiosk-discount-type-btn').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-type') === (preset.type || 'percentage'));
    });
    var scope = (preset.scope === 'type') ? 'type' : 'cart';
    modal.querySelectorAll('.kiosk-discount-scope-btn').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-scope') === scope);
    });

    var tp = document.getElementById('kiosk-discount-types');
    if (tp) {
      tp.querySelectorAll('input[type="checkbox"]').forEach(function (c) { c.checked = false; });
      tp.style.display = (scope === 'type') ? '' : 'none';
      if (scope === 'type') {
        var at = preset.applies_to || [];
        // Group tokens (kit/ingredient) tick the parent + all its children.
        at.forEach(function (tok) {
          var parent = tp.querySelector('input[data-group="' + tok + '"]');
          if (parent) {
            parent.checked = true;
            tp.querySelectorAll('input[data-token]').forEach(function (c) {
              if (c.getAttribute('data-token').indexOf(tok + ':') === 0) c.checked = true;
            });
          }
          var leaf = tp.querySelector('input[data-token="' + tok + '"]');
          if (leaf) leaf.checked = true;
        });
        // Reflect "all children selected" back onto each parent checkbox.
        tp.querySelectorAll('input[data-group]').forEach(function (parent) {
          var group = parent.getAttribute('data-group');
          var all = true, any = false;
          tp.querySelectorAll('input[data-token]').forEach(function (c) {
            if (c.getAttribute('data-token').indexOf(group + ':') === 0) { any = true; if (!c.checked) all = false; }
          });
          if (any) parent.checked = all;
        });
      }
    }

    form.style.display = '';
    var addBtn = document.getElementById('kiosk-discount-add-btn');
    if (addBtn) addBtn.style.display = 'none';
    var saveBtn = document.getElementById('kiosk-discount-save-btn');
    if (saveBtn) saveBtn.textContent = 'Update';
  }

  // Human-readable summary of a preset's targeting (for popover + mgmt list).
  function kioskDiscountScopeLabel(p) {
    if (!p || p.scope !== 'type') return 'Cart';
    var at = p.applies_to || [];
    if (!at.length) return 'Types';
    var labelMap = {
      kit: 'All Kits', ingredient: 'All Ingredients', service: 'Services', recipe: 'Recipes',
      'kit:wine': 'Wine', 'kit:beer': 'Beer', 'kit:cider': 'Cider', 'kit:seltzer': 'Seltzer',
      'ingredient:hops': 'Hops', 'ingredient:grain': 'Grain', 'ingredient:yeast': 'Yeast',
      'ingredient:additive': 'Additive', 'ingredient:packaging': 'Packaging',
      'ingredient:equipment': 'Equipment', 'ingredient:cleaning': 'Cleaning'
    };
    return at.map(function (t) { return labelMap[t] || t; }).join(', ');
  }

  function kioskShowDiscountMgmt() {
    var modal = document.getElementById('kiosk-discount-mgmt-modal');
    if (!modal) return;
    modal.style.display = '';
    kioskRenderDiscountMgmtList();

    var closeBtn = document.getElementById('kiosk-discount-mgmt-close');
    if (closeBtn) closeBtn.onclick = function () { modal.style.display = 'none'; };

    var addBtn = document.getElementById('kiosk-discount-add-btn');
    var form = document.getElementById('kiosk-discount-form');
    if (addBtn && form) {
      addBtn.onclick = function () {
        _kioskEditingDiscountId = null; // creating a new preset
        var sb = document.getElementById('kiosk-discount-save-btn');
        if (sb) sb.textContent = 'Save';
        form.style.display = '';
        addBtn.style.display = 'none';
        document.getElementById('kiosk-discount-form-name').value = '';
        document.getElementById('kiosk-discount-form-value').value = '';
        // Reset scope to "Whole Cart" and clear the type checkboxes
        modal.querySelectorAll('.kiosk-discount-scope-btn').forEach(function (b) {
          b.classList.toggle('active', b.getAttribute('data-scope') === 'cart');
        });
        var tp = document.getElementById('kiosk-discount-types');
        if (tp) {
          tp.style.display = 'none';
          tp.querySelectorAll('input[type="checkbox"]').forEach(function (c) { c.checked = false; });
        }
        // Reset type to percentage
        modal.querySelectorAll('.kiosk-discount-type-btn').forEach(function (b) {
          b.classList.toggle('active', b.getAttribute('data-type') === 'percentage');
        });
      };
    }

    var typeBtns = modal.querySelectorAll('.kiosk-discount-type-btn');
    typeBtns.forEach(function (btn) {
      btn.onclick = function () {
        typeBtns.forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
      };
    });

    var typesPanel = document.getElementById('kiosk-discount-types');
    var scopeBtns = modal.querySelectorAll('.kiosk-discount-scope-btn');
    scopeBtns.forEach(function (btn) {
      btn.onclick = function () {
        scopeBtns.forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        if (typesPanel) typesPanel.style.display = (btn.getAttribute('data-scope') === 'type') ? '' : 'none';
      };
    });

    // Two-tier checkbox sync: a parent ("All Kits"/"All Ingredients") toggles its
    // children; unchecking a child unchecks the parent.
    if (typesPanel) {
      typesPanel.querySelectorAll('input[data-group]').forEach(function (parent) {
        var group = parent.getAttribute('data-group');
        parent.onchange = function () {
          typesPanel.querySelectorAll('input[data-token]').forEach(function (c) {
            if (c.getAttribute('data-token').indexOf(group + ':') === 0) c.checked = parent.checked;
          });
        };
      });
      typesPanel.querySelectorAll('input[data-token]').forEach(function (c) {
        var t = c.getAttribute('data-token');
        if (t.indexOf(':') === -1) return; // single tokens (service/recipe) have no parent
        var group = t.split(':')[0];
        c.onchange = function () {
          var parent = typesPanel.querySelector('input[data-group="' + group + '"]');
          if (!parent) return;
          var all = true;
          typesPanel.querySelectorAll('input[data-token]').forEach(function (cc) {
            if (cc.getAttribute('data-token').indexOf(group + ':') === 0 && !cc.checked) all = false;
          });
          parent.checked = all;
        };
      });
    }

    var saveBtn = document.getElementById('kiosk-discount-save-btn');
    if (saveBtn) {
      saveBtn.onclick = function () {
        var name = (document.getElementById('kiosk-discount-form-name').value || '').trim();
        var value = parseFloat(document.getElementById('kiosk-discount-form-value').value);
        var typeBtn = modal.querySelector('.kiosk-discount-type-btn.active');
        var scopeBtn = modal.querySelector('.kiosk-discount-scope-btn.active');
        var type = typeBtn ? typeBtn.getAttribute('data-type') : 'percentage';
        var scope = scopeBtn ? scopeBtn.getAttribute('data-scope') : 'cart';

        if (!name) { showToast('Enter a discount name', 'error'); return; }
        if (!isFinite(value) || value <= 0) { showToast('Enter a valid value', 'error'); return; }
        if (type === 'percentage' && value > 100) { showToast('Percentage cannot exceed 100%', 'error'); return; }

        var payload = { name: name, type: type, value: value, scope: scope };
        if (scope === 'type') {
          payload.applies_to = kioskCollectAppliesTo();
          if (!payload.applies_to.length) { showToast('Pick at least one product type', 'error'); return; }
        }

        var mwUrl = kioskMwUrl();
        var editingId = _kioskEditingDiscountId;
        var url = editingId
          ? mwUrl + '/api/kiosk/discounts/' + encodeURIComponent(editingId)
          : mwUrl + '/api/kiosk/discounts';
        fetch(url, {
          method: editingId ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': SHEETS_CONFIG.MW_API_KEY || '' },
          body: JSON.stringify(payload)
        })
        .then(function (r) { return r.json(); })
        .then(function (data) {
          if (data.ok) {
            showToast(editingId ? 'Preset updated' : 'Preset saved', 'success');
            _kioskEditingDiscountId = null;
            saveBtn.textContent = 'Save';
            kioskLoadDiscountPresets();
            form.style.display = 'none';
            document.getElementById('kiosk-discount-add-btn').style.display = '';
            kioskRenderDiscountMgmtList();
            setTimeout(function () { kioskRenderDiscountMgmtList(); }, 500);
          } else {
            showToast(data.error || 'Failed to save', 'error');
          }
        })
        .catch(function () { showToast('Network error', 'error'); });
      };
    }

    var cancelFormBtn = document.getElementById('kiosk-discount-cancel-btn');
    if (cancelFormBtn) {
      cancelFormBtn.onclick = function () {
        _kioskEditingDiscountId = null;
        var sb = document.getElementById('kiosk-discount-save-btn');
        if (sb) sb.textContent = 'Save';
        form.style.display = 'none';
        document.getElementById('kiosk-discount-add-btn').style.display = '';
      };
    }
  }

  function kioskRenderDiscountMgmtList() {
    var list = document.getElementById('kiosk-discount-mgmt-list');
    if (!list) return;

    var mwUrl = kioskMwUrl();
    fetch(mwUrl + '/api/kiosk/discounts')
      .then(function (r) { return r.json(); })
      .then(function (data) {
        var presets = data.discounts || [];
        _kioskDiscountPresets = presets.filter(function (d) { return d.active; });

        if (!presets.length) {
          list.innerHTML = '<p style="padding:0.75rem 0;color:var(--ink-tertiary);text-align:center;">No presets yet</p>';
          return;
        }

        var html = '';
        presets.forEach(function (p) {
          var detail = p.type === 'percentage' ? (p.value + '%') : ('$' + parseFloat(p.value).toFixed(2));
          detail += ' \u00b7 ' + kioskDiscountScopeLabel(p);
          var isActive = p.active !== false;
          html += '<div class="kiosk-discount-mgmt-row' + (isActive ? '' : ' kiosk-discount-mgmt-row--inactive') + '" data-id="' + escapeHTML(p.id) + '">';
          html += '<span class="kiosk-discount-mgmt-name">' + escapeHTML(p.name) + '</span>';
          html += '<span class="kiosk-discount-mgmt-info">' + detail + '</span>';
          html += '<button type="button" class="kiosk-discount-mgmt-toggle' + (isActive ? ' is-active' : '') + '" data-id="' + escapeHTML(p.id) + '" data-active="' + isActive + '">' + (isActive ? 'Active' : 'Paused') + '</button>';
          html += '<button type="button" class="kiosk-discount-mgmt-edit" data-id="' + escapeHTML(p.id) + '">Edit</button>';
          html += '<button type="button" class="kiosk-discount-mgmt-delete" data-id="' + escapeHTML(p.id) + '">&times;</button>';
          html += '</div>';
        });
        list.innerHTML = html;

        list.querySelectorAll('.kiosk-discount-mgmt-toggle').forEach(function (btn) {
          btn.addEventListener('click', function () {
            var id = btn.getAttribute('data-id');
            var nowActive = btn.getAttribute('data-active') === 'true';
            fetch(mwUrl + '/api/kiosk/discounts/' + encodeURIComponent(id), {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json', 'x-api-key': SHEETS_CONFIG.MW_API_KEY || '' },
              body: JSON.stringify({ active: !nowActive })
            })
            .then(function (r) { return r.json(); })
            .then(function (data) {
              if (data.ok) {
                showToast(!nowActive ? 'Preset activated' : 'Preset paused', 'success');
                kioskLoadDiscountPresets();
                kioskRenderDiscountMgmtList();
              } else {
                showToast(data.error || 'Failed to update', 'error');
              }
            })
            .catch(function () { showToast('Network error', 'error'); });
          });
        });

        list.querySelectorAll('.kiosk-discount-mgmt-edit').forEach(function (btn) {
          btn.addEventListener('click', function () {
            var id = btn.getAttribute('data-id');
            var preset = null;
            for (var i = 0; i < presets.length; i++) {
              if (presets[i].id === id) { preset = presets[i]; break; }
            }
            if (preset) kioskPopulateDiscountForm(preset);
          });
        });

        list.querySelectorAll('.kiosk-discount-mgmt-delete').forEach(function (btn) {
          btn.addEventListener('click', function () {
            var id = btn.getAttribute('data-id');
            if (!confirm('Delete this preset?')) return;
            fetch(mwUrl + '/api/kiosk/discounts/' + encodeURIComponent(id), {
              method: 'DELETE',
              headers: { 'Content-Type': 'application/json', 'x-api-key': SHEETS_CONFIG.MW_API_KEY || '' }
            })
            .then(function () {
              showToast('Preset deleted', 'success');
              kioskLoadDiscountPresets();
              kioskRenderDiscountMgmtList();
            })
            .catch(function () { showToast('Failed to delete', 'error'); });
          });
        });
      })
      .catch(function () {
        list.innerHTML = '<p style="padding:0.75rem 0;color:#c00;">Failed to load presets</p>';
      });
  }

  // ===== Init Kiosk Tab =====

  function initKioskSaleTab() {
    // Search input
    var searchInput = document.getElementById('kiosk-search');
    if (searchInput) {
      searchInput.addEventListener('input', function () {
        clearTimeout(_kioskSearchTimer);
        _kioskFilters.search = searchInput.value;
        _kioskSearchTimer = setTimeout(kioskRenderProducts, 200);
      });
    }

    // Category filter
    var catFilter = document.getElementById('kiosk-category-filter');
    if (catFilter) {
      catFilter.addEventListener('change', function () {
        _kioskFilters.category = catFilter.value;
        kioskRenderProducts();
      });
    }

    // Type filter
    var typeFilter = document.getElementById('kiosk-type-filter');
    if (typeFilter) {
      typeFilter.addEventListener('change', function () {
        _kioskFilters.type = typeFilter.value;
        kioskPopulateCategories();
        kioskRenderProducts();
      });
    }

    // Stock status filter
    var stockFilter = document.getElementById('kiosk-stock-filter');
    if (stockFilter) {
      stockFilter.addEventListener('change', function () {
        _kioskFilters.stockStatus = stockFilter.value;
        kioskRenderProducts();
      });
    }

    // Sort select
    var sortSelect = document.getElementById('kiosk-sort');
    if (sortSelect) {
      sortSelect.addEventListener('change', function () {
        _kioskFilters.sort = sortSelect.value;
        kioskRenderProducts();
      });
    }

    var refreshBtn = document.getElementById('kiosk-products-refresh');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', function () {
        _kioskProductsLoaded = false;
        kioskLoadProducts(true);
      });
    }

    var clearBtn = document.getElementById('kiosk-cart-clear');
    if (clearBtn) {
      clearBtn.addEventListener('click', function () {
        if (kioskCartIsEmpty()) return;
        kioskClearCart();
      });
    }

    // Cart customer selector
    var custBtn = document.getElementById('kiosk-cart-customer-btn');
    var custSearchPanel = document.getElementById('kiosk-cart-customer-search');
    var custInput = document.getElementById('kiosk-cart-cust-input');
    var custResults = document.getElementById('kiosk-cart-cust-results');
    var custLabel = document.getElementById('kiosk-cart-customer-label');
    var custSearchTimer = null;

    function updateCustomerLabel() {
      if (!custLabel) return;
      if (_kioskCustomer) {
        custLabel.textContent = 'Customer: ' + (_kioskCustomer.name || _kioskCustomer.email || 'Selected');
        if (custBtn) custBtn.textContent = 'Change';
      } else {
        custLabel.textContent = 'Customer: Walk-in';
        if (custBtn) custBtn.textContent = 'Select';
      }
    }

    if (custBtn) {
      custBtn.addEventListener('click', function () {
        if (custSearchPanel.style.display === 'none') {
          custSearchPanel.style.display = '';
          if (custInput) { custInput.value = ''; custInput.focus(); }
          if (custResults) custResults.innerHTML = '';
        } else {
          custSearchPanel.style.display = 'none';
        }
      });
    }

    if (custInput) {
      custInput.addEventListener('input', function () {
        clearTimeout(custSearchTimer);
        var q = custInput.value.trim();
        if (!q) { if (custResults) custResults.innerHTML = ''; return; }
        custSearchTimer = setTimeout(function () {
          var mwUrl = kioskMwUrl();
          fetch(mwUrl + '/api/contacts?search=' + encodeURIComponent(q), { headers: { 'x-api-key': SHEETS_CONFIG.MW_API_KEY || '' } })
            .then(function (r) { return r.json(); })
            .then(function (data) {
              if (!custResults) return;
              var contacts = (data.contacts || []).slice(0, 6);
              if (!contacts.length) {
                custResults.innerHTML = '<div class="kiosk-cart-cust-row" style="color:var(--ink-tertiary);">No results</div>';
                return;
              }
              var html = '';
              contacts.forEach(function (c) {
                html += '<div class="kiosk-cart-cust-row" data-id="' + escapeHTML(c.contact_id || '') + '">';
                html += '<div class="kiosk-cart-cust-name">' + escapeHTML(c.contact_name || c.name || '') + '</div>';
                if (c.email) html += '<div class="kiosk-cart-cust-email">' + escapeHTML(c.email) + '</div>';
                html += '</div>';
              });
              custResults.innerHTML = html;
              Array.prototype.forEach.call(custResults.querySelectorAll('.kiosk-cart-cust-row[data-id]'), function (row) {
                row.addEventListener('click', function () {
                  var cid = row.getAttribute('data-id');
                  var contact = null;
                  for (var ci = 0; ci < contacts.length; ci++) {
                    if ((contacts[ci].contact_id || '') === cid) { contact = contacts[ci]; break; }
                  }
                  if (contact) {
                    _kioskCustomer = {
                      contact_id: contact.contact_id || '',
                      name: contact.contact_name || contact.name || '',
                      email: contact.email || ''
                    };
                  }
                  custSearchPanel.style.display = 'none';
                  updateCustomerLabel();
                });
              });
            });
        }, 250);
      });
    }

    updateCustomerLabel();

    // Hide out-of-stock toggle
    var oosToggle = document.getElementById('kiosk-hide-oos');
    if (oosToggle) {
      oosToggle.addEventListener('change', function () {
        _kioskHideOutOfStock = oosToggle.checked;
        _kioskFilters.hideOos = oosToggle.checked;
        kioskRenderProducts();
      });
    }

    // View mode toggle
    var viewBtns = document.querySelectorAll('.kiosk-view-btn');
    viewBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var view = btn.getAttribute('data-view');
        if (view === _kioskViewMode) return;
        _kioskViewMode = view;
        localStorage.setItem('sv-kiosk-view-mode', view);
        viewBtns.forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-view') === view); });
        kioskRenderProducts();
      });
    });
    // Set initial active state for view toggle
    viewBtns.forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-view') === _kioskViewMode); });

    var checkoutBtn = document.getElementById('kiosk-checkout-btn');
    if (checkoutBtn) {
      checkoutBtn.addEventListener('click', kioskStartCheckout);
    }

    // Customer browse mode wiring
    var browseModeBtn = document.getElementById('kiosk-browse-mode-btn');
    if (browseModeBtn) {
      browseModeBtn.addEventListener('click', kioskShowCustomerBrowse);
    }

    var cbBackBtn = document.getElementById('kiosk-cb-back-btn');
    if (cbBackBtn) {
      cbBackBtn.addEventListener('click', kioskExitCustomerBrowse);
    }

    var cbSearch = document.getElementById('kiosk-cb-search');
    if (cbSearch) {
      cbSearch.addEventListener('input', function () {
        clearTimeout(_kioskCbSearchTimer);
        _kioskCbSearch = cbSearch.value;
        _kioskCbSearchTimer = setTimeout(kioskRenderCbGrid, 200);
      });
    }

    Array.prototype.forEach.call(document.querySelectorAll('.kiosk-cb-tab'), function (tab) {
      tab.addEventListener('click', function () {
        _kioskCbTab = tab.getAttribute('data-cb-tab');
        Array.prototype.forEach.call(document.querySelectorAll('.kiosk-cb-tab'), function (t) {
          t.classList.remove('active');
        });
        tab.classList.add('active');
        var note = document.getElementById('kiosk-cb-kits-note');
        if (note) note.style.display = _kioskCbTab === 'kits' ? '' : 'none';
        kioskRenderCbGrid();
      });
    });

    var startPurchaseBtn = document.getElementById('kiosk-cb-start-purchase-btn');
    if (startPurchaseBtn) {
      startPurchaseBtn.addEventListener('click', kioskExitCustomerBrowse);
    }

    // Sales Orders / Collect Payment wiring
    var soBtn = document.getElementById('kiosk-orders-btn');
    if (soBtn) {
      soBtn.addEventListener('click', kioskShowCollect);
    }

    kioskWireSoChips();

    var soSearch = document.getElementById('kiosk-so-search');
    if (soSearch) {
      soSearch.addEventListener('input', function () {
        clearTimeout(_kioskSoSearchTimer);
        _kioskSoSearchTimer = setTimeout(function () {
          kioskRenderSoList();
        }, 300);
      });
    }

    var soRefresh = document.getElementById('kiosk-so-refresh');
    if (soRefresh) {
      soRefresh.addEventListener('click', function () { kioskLoadSalesOrders(); });
    }

    var soCreateBtn = document.getElementById('kiosk-so-create-btn');
    if (soCreateBtn) {
      soCreateBtn.addEventListener('click', kioskShowCreateSo);
    }

    var collectBack = document.getElementById('kiosk-collect-back');
    if (collectBack) {
      collectBack.addEventListener('click', function () { kioskShowView('browse'); });
    }

    // Discount popover
    var discountBtnInit = document.getElementById('kiosk-discount-btn');
    if (discountBtnInit) {
      discountBtnInit.addEventListener('click', kioskShowDiscountPopover);
    }
    var discountCloseBtn = document.getElementById('kiosk-discount-close-btn');
    if (discountCloseBtn) {
      discountCloseBtn.addEventListener('click', function () {
        document.getElementById('kiosk-discount-popover').style.display = 'none';
      });
    }
    var discountRemoveBtn = document.getElementById('kiosk-discount-remove-btn');
    if (discountRemoveBtn) {
      discountRemoveBtn.addEventListener('click', kioskRemoveDiscount);
    }

    // Discount management
    var discountManageBtn = document.getElementById('kiosk-discount-manage-btn');
    if (discountManageBtn) {
      discountManageBtn.addEventListener('click', function () {
        document.getElementById('kiosk-discount-popover').style.display = 'none';
        kioskShowDiscountMgmt();
      });
    }

    // Load discount presets
    kioskLoadDiscountPresets();

    // Mode toggle
    var modeProdsBtn = document.getElementById('kiosk-mode-products');
    var modeRecipesBtn = document.getElementById('kiosk-mode-recipes');
    if (modeProdsBtn) modeProdsBtn.addEventListener('click', function () { kioskSetMode('products'); });
    if (modeRecipesBtn) modeRecipesBtn.addEventListener('click', function () { kioskSetMode('recipes'); });

    // Recipe prompt buttons
    var recipeBackBtn = document.getElementById('kiosk-recipe-back');
    if (recipeBackBtn) recipeBackBtn.addEventListener('click', function () {
      var prompt = document.getElementById('kiosk-recipe-prompt');
      var recipeGrid = document.getElementById('kiosk-recipe-grid');
      if (prompt) {
        prompt.style.display = 'none';
        prompt.classList.remove('kiosk-recipe-prompt-view'); // GAP-5 36-15
      }
      if (recipeGrid) recipeGrid.style.display = 'grid';
      _kioskSelectedRecipe = null;
      _kioskSaleType = null;
      // Phase 35+36: reset quote and modify state on Back
      _kioskQuote = null;
      _kioskModifiedIngredients = null;
      _kioskModifyPanelOpen = false;
      _kioskTargetVolumeL = null;
    });

    var inStoreSaleBtn = document.getElementById('kiosk-btn-in-store');
    if (inStoreSaleBtn) inStoreSaleBtn.addEventListener('click', function () { kioskSelectSaleType('in-store'); });

    var takeOutSaleBtn = document.getElementById('kiosk-btn-take-out');
    if (takeOutSaleBtn) takeOutSaleBtn.addEventListener('click', function () { kioskSelectSaleType('take-out'); });

    var millCheckboxEl = document.getElementById('kiosk-mill-grain');
    if (millCheckboxEl) millCheckboxEl.addEventListener('change', function () {
      _kioskMillGrain = millCheckboxEl.checked;
      kioskUpdateSummaryPrice();
      kioskUpdateAddToCartButton();
    });

    var addRecipeBtn = document.getElementById('kiosk-add-recipe-to-cart');
    if (addRecipeBtn) addRecipeBtn.addEventListener('click', kioskAddRecipeToCart);
  }

  // ===== Bootstrap =====

  document.addEventListener('DOMContentLoaded', function () {
    // waitForGoogleIdentity defined in js/lib/auth.js
    waitForGoogleIdentity(initGoogleAuth);
    initKioskSaleTab();
  });

  // ===== Test Exports (kiosk.js — mirrors admin.js export pattern) =====
  // Exposed only under Node/Jest — not bundled into production traffic.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Object.assign(module.exports || {}, {
      // Phase 35 state accessors
      _kioskGetQuote: function () { return _kioskQuote; },
      _kioskSetQuote: function (q) { _kioskQuote = q; },
      _kioskGetSelectedRecipe: function () { return _kioskSelectedRecipe; },
      _kioskSetSelectedRecipe: function (r) { _kioskSelectedRecipe = r; },
      _kioskGetSaleType: function () { return _kioskSaleType; },
      _kioskSetSaleType: function (s) { _kioskSaleType = s; },
      _kioskGetTargetVolumeL: function () { return _kioskTargetVolumeL; },
      _kioskSetTargetVolumeL: function (v) { _kioskTargetVolumeL = v; },
      _kioskGetCart: function () { return _kioskCart; },
      _kioskClearCart: function () { _kioskCart = {}; },
      _kioskSetRecipeAvailability: function (a) { _kioskRecipeAvailability = a; },
      kioskFetchRecipeQuote: kioskFetchRecipeQuote,
      kioskUpdateAddToCartButton: kioskUpdateAddToCartButton,
      kioskShowRecipePrompt: kioskShowRecipePrompt,
      // GAP-3: _kioskShowRecipePrompt alias for test-hook consistency with admin-recipe-volume-factor.test.js
      _kioskShowRecipePrompt: function (r) { return kioskShowRecipePrompt(r); },
      // Phase 36 state accessors
      _kioskGetModifiedIngredients: function () { return _kioskModifiedIngredients; },
      _kioskSetModifiedIngredients: function (v) { _kioskModifiedIngredients = v; },
      renderKioskModifyRows: renderKioskModifyRows
      // Note: kioskSaveAsNewRecipe is intentionally NOT exported — not exposed on kiosk (UI-SPEC §2)
    });
  }

})();
