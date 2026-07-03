// ===== Steins & Vines Kiosk Core (shared cart/payment/void logic) =====
// Extracted, environment-agnostic core shared by the standalone kiosk
// (js/kiosk.js) and the admin-embedded kiosk tab (js/admin.js). Phase 48
// de-fork: this file is the single source of truth for kiosk cart/payment/
// void logic (D-01). Attaches window.KioskCore in the browser and
// module.exports under Node/Jest.
//
// This is a SKELETON (48-01) — no migrated logic yet. Later plans in this
// phase populate KioskCore with the ~37 promoted functions + 12 discount
// functions (D-06 naming: prefix dropped on the public namespace).

(function () {
  'use strict';

  // ===== Environment injection seam (D-06) =====
  // The one real difference between the two consumers is how auth options
  // are built for outgoing fetch calls (kiosk.js: x-device-token header;
  // admin.js: credentials:'include' cookie). Consumers call
  // KioskCore.init(env) once at startup to inject their own env.
  var _kcEnv = {
    mwUrl: '',
    buildAuthOptions: function () {
      return {};
    }
  };

  function kcInit(env) {
    if (!env) {
      return;
    }
    if (typeof env.mwUrl !== 'undefined') {
      _kcEnv.mwUrl = env.mwUrl;
    }
    if (typeof env.buildAuthOptions === 'function') {
      _kcEnv.buildAuthOptions = env.buildAuthOptions;
    }
  }

  // ===== Public namespace =====
  // No migrated kiosk* logic yet — this is the skeleton seam that later
  // plans in this phase populate.
  var KioskCore = {
    init: kcInit
  };

  // ===== Dual-mode export (D-01) =====
  // window.KioskCore is the real, permanent public surface (not test-only).
  // Attached unconditionally in the browser; module.exports is attached
  // conditionally so Node/Jest can require('./kiosk-core.js') (see the
  // Node-only guard added to the tops of kiosk.js/admin.js in 48-01 Task 2).
  if (typeof window !== 'undefined') {
    window.KioskCore = KioskCore;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = KioskCore;
  }

})();
