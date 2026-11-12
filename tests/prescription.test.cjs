const { test } = require('node:test');
const assert = require('node:assert/strict');
const { addYears, caseLimitation, limitationAlerts, suggestedRule } = require('../app/prescription.mjs');

test('limitation deadlines and alerts for unfiled cases and expiring documents', () => {
  assert.equal(addYears('2024-02-29', 2), '2026-02-28');
  assert.equal(addYears('2023-11-30', 3), '2026-11-30');
  assert.equal(suggestedRule('Trabalhista'), 'trabalhista');
  const today = '2026-11-12';
  const l = caseLimitation({ factDate: '2025-01-20', limitationRule: 'trabalhista' }, today);
  assert.deepEqual([l.deadline, l.days], ['2027-01-20', 69]);
  const alerts = limitationAlerts({
    today,
    cases: [
      { id: 'a', title: 'Reclamação', factDate: '2025-01-20', limitationRule: 'trabalhista', status: 'Em andamento' },
      {
        id: 'b',
        title: 'Já ajuizado',
        number: '0000001-63.2024.8.09.0051',
        factDate: '2025-01-20',
        limitationRule: 'trabalhista',
      },
      { id: 'c', title: 'Longe', factDate: '2026-01-01', limitationRule: 'geral' },
      { id: 'd', title: 'Vencido', factDate: '2023-11-01', limitationRule: 'reparacao' },
    ],
    documents: [
      { id: 'p', name: 'Procuração.pdf', validUntil: '2026-11-30' },
      { id: 'q', name: 'Contrato.pdf', validUntil: '2027-06-01' },
    ],
  });
  assert.deepEqual(
    alerts.map(a => [a.id, a.days]),
    [
      ['d', -11],
      ['p', 18],
      ['a', 69],
    ],
  );
});
