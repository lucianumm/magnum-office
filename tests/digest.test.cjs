const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Digest, digestText } = require('../backend/digest.cjs');

test('morning summary lists today, overdue items, intimations and late fees', () => {
  const now = new Date(2026, 10, 12, 8, 5);
  const text = digestText({
    now,
    officeName: 'Escritório Exemplo',
    tasks: [
      { title: 'Audiência de instrução', type: 'Audiência', due: '2026-11-12T14:00', status: 'Pendente' },
      { title: 'Contestação', type: 'Prazo', due: '2026-11-12T09:00', status: 'Pendente' },
      { title: 'Feito', due: '2026-11-12T10:00', status: 'Concluída' },
      { title: 'Atrasado', due: '2026-11-10T10:00', status: 'Pendente' },
      { title: 'Semana', due: '2026-11-15T10:00', status: 'Pendente' },
    ],
    intimations: [{ status: 'new' }, { status: 'done' }],
    finance: [{ direction: 'Receita', amount: '1500.00', dueDate: '2026-11-01', paidDate: '' }],
  });
  assert.match(text, /Hoje \(2\):\n• 09:00 Prazo: Contestação\n• 14:00 Audiência: Audiência de instrução/);
  assert.match(text, /Atrasados: 1/);
  assert.match(text, /Próximos 7 dias: 1\./);
  assert.match(text, /Intimações novas: 1\./);
  assert.match(text, /Honorários atrasados: 1, somando R\$ 1\.500,00\./);
});

test('the summary is queued once a day, after the chosen time', () => {
  const internal = {};
  const queued = [];
  const digest = new Digest({
    store: { list: () => [], audit: () => {} },
    settings: { get: () => ({ ...internal, officeName: '' }), internal: v => Object.assign(internal, v) },
    messaging: { validate: () => {}, enqueue: m => queued.push(m) },
  });
  digest.configure({ enabled: true, channel: 'whatsapp', recipient: '5564999990000', time: '08:00' });
  assert.equal(digest.tick(new Date(2026, 10, 12, 7, 59)), false);
  assert.equal(digest.tick(new Date(2026, 10, 12, 8, 0)), true);
  assert.equal(digest.tick(new Date(2026, 10, 12, 9, 0)), false, 'only once a day');
  assert.equal(digest.tick(new Date(2026, 10, 13, 8, 30)), true);
  assert.equal(queued.length, 2);
  assert.equal(queued[0].recipient, '5564999990000');
});
