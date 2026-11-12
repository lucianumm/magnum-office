const { test } = require('node:test');
const assert = require('node:assert/strict');
const { addEmailRecipients } = require('../app/email-recipients.mjs');
test('recipient lists deduplicate pasted and saved contacts, respect opt-out and cap the combined list at 100', () => {
  const clients = [
    { id: 'a', email: 'a@example.test', name: 'Ana' },
    { id: 'b', email: 'blocked@example.test', emailPreference: 'Não receber' },
  ];
  const current = [{ email: 'existing@example.test' }];
  const added = addEmailRecipients(
    [
      'a@example.test',
      'A@example.test',
      'blocked@example.test',
      'existing@example.test',
      ...Array.from({ length: 110 }, (_, i) => `c${i}@example.test`),
    ],
    current,
    clients,
  );
  assert.equal(added.recipients.length, 100);
  assert.equal(added.recipients[1].clientId, 'a');
  assert.equal(added.duplicate, 2);
  assert.equal(added.blocked, 1);
  assert.equal(added.overflow, 12);
  assert.equal(
    added.recipients.some(r => r.email === 'blocked@example.test'),
    false,
  );
});
