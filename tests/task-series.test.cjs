const { test } = require('node:test');
const assert = require('node:assert/strict');
const { seriesDates } = require('../app/task-series.mjs');

test('repeating appointments: weekly, working days, monthly at month end, limits', () => {
  assert.deepEqual(seriesDates('2026-11-12T09:00', 'weekly', '2026-12-03'), [
    '2026-11-12T09:00',
    '2026-11-19T09:00',
    '2026-11-26T09:00',
    '2026-12-03T09:00',
  ]);
  assert.deepEqual(seriesDates('2026-11-13T08:30', 'daily', '2026-11-17'), [
    '2026-11-13T08:30',
    '2026-11-16T08:30',
    '2026-11-17T08:30',
  ]);
  assert.deepEqual(seriesDates('2026-01-31T10:00', 'monthly', '2026-04-30'), [
    '2026-01-31T10:00',
    '2026-02-28T10:00',
    '2026-03-31T10:00',
    '2026-04-30T10:00',
  ]);
  assert.throws(() => seriesDates('2026-01-01T10:00', 'daily', '2027-01-01'), /até 60/);
  assert.throws(() => seriesDates('2026-01-01T10:00', 'weekly', '2026-01-03'), /pelo menos duas/);
  assert.throws(() => seriesDates('2026-01-01T10:00', 'hourly', '2026-02-01'), /se repete/);
});
