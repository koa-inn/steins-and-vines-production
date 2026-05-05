var bp = require('../../js/brewpad');

describe('buildLifecycleTimeline', function () {
  test('renders four timeline items', function () {
    var batch = { zoho_so_number: '', created_at: null, fermentation_started_at: null, completed_at: null };
    var html = bp.buildLifecycleTimeline(batch, null);
    var count = (html.match(/bp-timeline-item"/g) || []).length;
    expect(count).toBe(4);
  });

  test('marks completed events with bp-timeline-item--done class', function () {
    var batch = { zoho_so_number: 'INV-001', created_at: '2026-01-01', fermentation_started_at: null, completed_at: null };
    var html = bp.buildLifecycleTimeline(batch, '2026-01-01');
    var doneCount = (html.match(/bp-timeline-item--done/g) || []).length;
    expect(doneCount).toBe(2);
  });

  test('renders pending note for events without dates', function () {
    var batch = { zoho_so_number: '', created_at: '2026-01-01', fermentation_started_at: null, completed_at: null };
    var html = bp.buildLifecycleTimeline(batch, null);
    var pendingCount = (html.match(/\(pending\)/g) || []).length;
    expect(pendingCount).toBe(3);
  });

  test('renders filled dot for completed and hollow dot for pending events', function () {
    var batch = { zoho_so_number: 'INV-001', created_at: '2026-01-15', fermentation_started_at: '2026-01-20', completed_at: null };
    var html = bp.buildLifecycleTimeline(batch, '2026-01-10');
    var filledDots = (html.match(/bp-timeline-dot--done/g) || []).length;
    var hollowDots = (html.match(/bp-timeline-dot--pending/g) || []).length;
    expect(filledDots).toBe(3);
    expect(hollowDots).toBe(1);
  });

  test('includes SO number in Sale event label when present', function () {
    var batch = { zoho_so_number: 'INV-12345', created_at: null, fermentation_started_at: null, completed_at: null };
    var html = bp.buildLifecycleTimeline(batch, null);
    expect(html).toContain('INV-12345');
    expect(html).toContain('Sale & Invoice Created');
  });

  test('all four events done when all dates provided', function () {
    var batch = { zoho_so_number: 'INV-001', created_at: '2026-01-15', fermentation_started_at: '2026-01-20', completed_at: '2026-03-01' };
    var html = bp.buildLifecycleTimeline(batch, '2026-01-10');
    var doneCount = (html.match(/bp-timeline-item--done/g) || []).length;
    expect(doneCount).toBe(4);
    expect(html).not.toContain('(pending)');
  });

  test('escapes HTML in SO number', function () {
    var batch = { zoho_so_number: '<script>alert(1)</script>', created_at: null, fermentation_started_at: null, completed_at: null };
    var html = bp.buildLifecycleTimeline(batch, null);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
