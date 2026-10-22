// =============================================================================
// newsletter.js — main mailing list signup form
//
// Wires every <form data-newsletter="SOURCE"> on the page (links, home and
// contact pages) to POST /api/newsletter on the middleware, which adds the
// address to the main MailerLite group. The consent statement shown beside the
// form (.newsletter-consent) travels with the signup as the CASL record.
// `company` is a honeypot field hidden from people.
//
// Pushes a `newsletter_signup` dataLayer event on success; like every site
// event it is processed by GTM only once the visitor has accepted cookies.
//
// Plain ES5; not part of the concatenated bundle. Needs js/sheets-config.js
// loaded first for SHEETS_CONFIG.MIDDLEWARE_URL.
// =============================================================================
(function (window, document) {
  'use strict';

  function middlewareUrl() {
    var cfg = window.SHEETS_CONFIG;
    return (cfg && cfg.MIDDLEWARE_URL) || '';
  }

  function textOf(el) {
    return el ? (el.textContent || '').replace(/\s+/g, ' ').trim() : '';
  }

  function wire(form) {
    if (form.getAttribute('data-newsletter-bound') === '1') return;
    form.setAttribute('data-newsletter-bound', '1');

    var box = form.closest ? form.closest('.newsletter-signup') : null;
    var status = box ? box.querySelector('.newsletter-status') : null;
    var btn = form.querySelector('[type="submit"]');
    var btnLabel = btn ? btn.textContent : '';

    function setStatus(msg, isError) {
      if (!status) return;
      status.textContent = msg;
      status.classList.toggle('newsletter-status--error', !!isError);
    }

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var emailEl = form.querySelector('input[name="email"]');
      var email = emailEl ? emailEl.value.trim() : '';
      if (!email || (emailEl.checkValidity && !emailEl.checkValidity())) {
        setStatus('Please enter a valid email address.', true);
        if (emailEl) emailEl.focus();
        return;
      }
      var hp = form.querySelector('input[name="company"]');
      var source = form.getAttribute('data-newsletter') || 'site';

      if (btn) { btn.disabled = true; btn.textContent = 'Signing up...'; }
      setStatus('', false);

      fetch(middlewareUrl() + '/api/newsletter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email,
          source: source,
          company: hp ? hp.value : '',
          consent: true,
          consent_text: textOf(box ? box.querySelector('.newsletter-consent') : null)
        })
      }).then(function (r) {
        return r.json().then(function (d) {
          if (!r.ok || !d || !d.success) throw new Error((d && d.error) || 'Sign-up failed');
        });
      }).then(function () {
        form.hidden = true;
        setStatus('Thanks! You’re on the list.', false);
        try {
          window.dataLayer = window.dataLayer || [];
          window.dataLayer.push({ event: 'newsletter_signup', newsletter_source: source });
        } catch (err) { /* analytics must never break the form */ }
      }).catch(function () {
        if (btn) { btn.disabled = false; btn.textContent = btnLabel; }
        setStatus('Sorry, that didn’t work. Please try again in a moment.', true);
      });
    });
  }

  function init() {
    var forms = document.querySelectorAll('form[data-newsletter]');
    Array.prototype.forEach.call(forms, wire);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.SVNewsletter = { init: init };
})(window, document);
