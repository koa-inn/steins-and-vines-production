'use strict';

var spike = require('../scripts/spike-past-sales-shapes');

describe('spike sanitizer', function () {
  var raw = {
    customerpayments: [{
      payment_id: '5555555555555550001',
      payment_number: '42',
      customer_id: '7777777777777770001',
      customer_name: 'SENTINEL_NAME',
      email: 'sentinel@example.com',
      phone: '6045550199',
      billing_address: { address: '1 Secret St' },
      notes: 'Kiosk SO payment. Terminal txn: 987654321',
      reference_number: '987654321',
      payment_mode: 'creditcard',
      amount: 12.5,
      date: '2026-10-15',
      custom_fields: [{ label: 'Pet', value: 'SENTINEL_NAME' }],
      invoices: [{ invoice_id: '9999999999999990001', invoice_number: 'INV-000171' }]
    }],
    invoices: [{
      invoice_id: '9999999999999990001',
      invoice_number: 'INV-000171',
      customer_name: 'SENTINEL_NAME',
      status: 'paid',
      total: 10
    }],
    many: [1, 2, 3, 4, 5, 6, 7, 8]
  };

  it('strips PII sentinels', function () {
    var out = JSON.stringify(spike.sanitizeFixture(raw));
    ['SENTINEL_NAME', 'sentinel@example.com', '6045550199', '987654321', '1 Secret St'].forEach(function (s) {
      expect(out).not.toContain(s);
    });
  });

  it('keeps payment fields verbatim', function () {
    var out = spike.sanitizeFixture(raw);
    expect(out.customerpayments[0].payment_mode).toBe('creditcard');
    expect(out.customerpayments[0].date).toBe('2026-10-15');
    expect(out.customerpayments[0].amount).toBe(12.5);
    expect(out.invoices[0].status).toBe('paid');
  });

  it('preserves every key', function () {
    var out = spike.sanitizeFixture(raw);
    expect(Object.keys(out.customerpayments[0]).sort()).toEqual(Object.keys(raw.customerpayments[0]).sort());
  });

  it('maps ids and invoice numbers consistently so joins survive', function () {
    var out = spike.sanitizeFixture(raw);
    expect(out.customerpayments[0].invoices[0].invoice_id).toBe(out.invoices[0].invoice_id);
    expect(out.customerpayments[0].invoices[0].invoice_number).toBe(out.invoices[0].invoice_number);
    expect(out.invoices[0].invoice_number).toMatch(/^INV-9000\d\d$/);
    expect(out.invoices[0].invoice_id).toMatch(/^1000/);
  });

  it('truncates arrays to 5', function () {
    expect(spike.sanitizeFixture(raw).many.length).toBe(5);
  });

  it('redactNote keeps known prefix only', function () {
    expect(spike.redactNote('Kiosk SO payment. Terminal txn: 987654321')).toBe('Kiosk SO payment.');
    expect(spike.redactNote('Customer asked for gift wrap')).toBe('REDACTED_NOTE');
  });

  it('redactReference keeps shape only', function () {
    expect(spike.redactReference('KIOSK-1760650000000')).toBe('KIOSK-0000000000000');
    expect(spike.redactReference('48213377')).toBe('00000000');
    expect(spike.redactReference('')).toBe('');
    expect(spike.redactReference('Bob smith')).toBe('REDACTED_REF');
  });

  it('notesSourceOf finds the key carrying money-path notes', function () {
    expect(spike.notesSourceOf([{ description: 'Kiosk cash payment. Ref: x' }])).toBe('description');
    expect(spike.notesSourceOf([{ notes: 'In-store terminal payment. Helcim txn: 1' }])).toBe('notes');
    expect(spike.notesSourceOf([{ description: 'hello' }])).toBeNull();
    expect(spike.notesSourceOf(undefined)).toBeNull();
  });

  it('deriveJoinMode follows the linkage AND notes rule', function () {
    var d = spike.deriveJoinMode;
    expect(d({ linkage_field: 'invoices', notes_in_list: true, notes_in_detail: false })).toBe('list-join');
    expect(d({ linkage_field: 'invoices', notes_in_list: false, notes_in_detail: true })).toBe('detail-fallback');
    expect(d({ linkage_field: null, notes_in_list: true, notes_in_detail: true })).toBe('detail-fallback');
    expect(d({ linkage_field: null, notes_in_list: true, notes_in_detail: false })).toBe('none');
    expect(d({ linkage_field: 'invoices', notes_in_list: false, notes_in_detail: false })).toBe('none');
  });
});

describe('spike sanitizer: addresses, card digits and custom fields (WR-06)', function () {
  var populated = {
    invoice: {
      invoice_id: '9999999999999990002',
      status: 'paid',
      total: 12,
      last_four_digits: '4242',
      attention: 'SENTINEL_ATTN',
      fax: '6045550100',
      billing_address: {
        address: '1 Secret St', street2: 'SENTINEL_UNIT', city: 'SENTINEL_CITY', state: 'SENTINEL_STATE',
        zip: 'V8B 0K7', country: 'SENTINEL_COUNTRY', fax: '6045550101', attention: 'SENTINEL_ATTN2'
      },
      shipping_address: { street2: 'SENTINEL_SHIP_UNIT', city: 'SENTINEL_SHIP_CITY', zip: 'V6B 1A1' },
      custom_field_hash: { cf_pet_name: 'SENTINEL_CF_HASH', cf_pet_name_unformatted: 'SENTINEL_CF_HASH2' },
      cf_pet_name: 'SENTINEL_CF_TOP',
      cf_pet_name_unformatted: 'SENTINEL_CF_TOP2',
      cf_flag_unformatted: false
    },
    payment: { payment_mode: 'creditcard', last_four_digits: '1881', card_type: 'visa', amount: 5 }
  };

  it('strips populated address, attention, fax, last-four and cf_* values', function () {
    var out = JSON.stringify(spike.sanitizeFixture(populated));
    ['1 Secret St', 'SENTINEL_UNIT', 'SENTINEL_CITY', 'SENTINEL_STATE', 'V8B 0K7', 'SENTINEL_COUNTRY',
      '6045550100', '6045550101', 'SENTINEL_ATTN', 'SENTINEL_ATTN2', 'SENTINEL_SHIP_UNIT', 'SENTINEL_SHIP_CITY',
      'V6B 1A1', 'SENTINEL_CF_HASH', 'SENTINEL_CF_HASH2', 'SENTINEL_CF_TOP', 'SENTINEL_CF_TOP2', '4242', '1881'
    ].forEach(function (v) { expect(out).not.toContain(v); });
  });

  it('keeps the key so the fixture still documents the shape', function () {
    var out = spike.sanitizeFixture(populated);
    expect(Object.keys(out.invoice).sort()).toEqual(Object.keys(populated.invoice).sort());
    expect(out.invoice.billing_address).toEqual({ REDACTED: true });
    expect(out.invoice.custom_field_hash).toEqual({ REDACTED: true });
    expect(out.payment.payment_mode).toBe('creditcard');
    expect(out.payment.amount).toBe(5);
  });

  it('leaves blank values blank (current fixture shape)', function () {
    var out = spike.sanitizeFixture({ last_four_digits: '', attention: '', billing_address: {}, cf_x: '' });
    expect(out).toEqual({ last_four_digits: '', attention: '', billing_address: {}, cf_x: '' });
  });
});

describe('committed fixture', function () {
  var fs = require('fs');
  var path = require('path');
  var file = path.join(__dirname, 'fixtures', 'zoho-past-sales-shapes.json');
  var text = fs.readFileSync(file, 'utf8');
  var fixture = JSON.parse(text);

  it('records a valid join_mode derived from linkage and notes', function () {
    expect(['list-join', 'detail-fallback', 'none']).toContain(fixture._meta.join_mode);
    expect(fixture._meta.join_mode).toBe(spike.deriveJoinMode(fixture._meta));
    expect(['list', 'detail', 'none']).toContain(fixture._meta.notes_available_in);
  });

  it('has the required sections', function () {
    ['_meta', 'customerpayments_list', 'invoices_list', 'invoice_detail'].forEach(function (k) {
      expect(fixture).toHaveProperty(k);
    });
  });

  it('contains no e-mail addresses or phone-like digit runs', function () {
    expect(text).not.toContain('@');
    expect(text).not.toMatch(/\b\d{10}\b/);
  });

  it('redacts every customer_name', function () {
    var names = text.match(/"customer_name": "[^"]*"/g) || [];
    expect(names.length).toBeGreaterThan(0);
    names.forEach(function (n) {
      expect(n).toMatch(/"customer_name": "REDACTED/);
    });
  });
});
