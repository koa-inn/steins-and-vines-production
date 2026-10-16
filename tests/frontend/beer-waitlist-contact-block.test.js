'use strict';

// Owner note (2026-10-15): the "Ready to Brew?" section looked clunky — a bordered "or call"
// button under the form plus a separate address line. Phone, email and address now sit in one
// quiet text block below the consent statement, and the email field and submit read as one
// joined control on wider screens.

var fs = require('fs');
var path = require('path');
var css = require('./_css-helpers');

function waitlist() {
  var html = fs.readFileSync(path.join(__dirname, '..', '..', 'beer.html'), 'utf8');
  var doc = new DOMParser().parseFromString(html, 'text/html');
  return doc.getElementById('waitlist');
}

describe('beer waitlist contact block', function () {
  test('the section has no second button, only the waitlist submit', function () {
    var s = waitlist();
    expect(s.querySelectorAll('.btn-secondary').length).toBe(0);
    expect(s.querySelectorAll('.btn').length).toBe(1);
  });

  test('phone and email are plain links in the contact block, after the consent statement', function () {
    var s = waitlist();
    var block = s.querySelector('.waitlist-contact');
    expect(block).not.toBeNull();
    expect(block.querySelector('a[href="tel:+16045674565"]')).not.toBeNull();
    expect(block.querySelector('a[href="mailto:hello@steinsandvines.ca"]')).not.toBeNull();
    var consent = s.querySelector('#beer-waitlist-consent');
    expect(consent.compareDocumentPosition(block) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test('email field and submit join into one control above phone width', function () {
    expect(css.decl(css.block('.beer-waitlist-form input[type="email"]', null), 'border-right')).toBe('0');
    expect(css.decl(css.block('.beer-waitlist-form', null), 'gap')).toBe('0');
  });
});
