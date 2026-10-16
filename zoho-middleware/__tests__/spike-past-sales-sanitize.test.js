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
