const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Settings } = require('../backend/settings.cjs');

const base = path.resolve('work', 'tests');
fs.mkdirSync(base, { recursive: true });
function fixture(t, stored) {
  const root = fs.mkdtempSync(path.join(base, 'setup-'));
  if (stored) fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify(stored));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, settings: new Settings(root) };
}
const office = {
  officeName: 'Lima Advocacia',
  userName: 'Ana Lima',
  officeCity: 'Rio Verde/GO',
  officeAddress: '',
  appName: 'Lima Advocacia',
  appDescription: 'Advocacia cível',
  lawyers: [{ name: 'Ana Lima', oab: '54.321', uf: 'go', email: '' }],
  noLogo: true,
};

test('a new installation must be configured once, and the result survives a restart', t => {
  const { root, settings } = fixture(t);
  assert.equal(settings.setupRequired(), true);
  const saved = settings.completeSetup({ ...office, theme: 'navy' });
  assert.equal(saved.officeName, 'Lima Advocacia');
  assert.equal(saved.theme, 'navy');
  assert.deepEqual(saved.lawyers, [{ name: 'Ana Lima', oab: '54321', uf: 'GO', email: '' }]);
  assert.ok(saved.setupCompletedAt);
  assert.equal(new Settings(root).setupRequired(), false);
});

test('placeholders, missing lawyers, missing fields and an unanswered logo are refused', t => {
  const { settings } = fixture(t);
  assert.throws(() => settings.completeSetup({ ...office, officeName: 'meu escritório' }), /nome do seu escritório/);
  assert.throws(() => settings.completeSetup({ ...office, userName: 'Administrador' }), /seu nome/);
  assert.throws(() => settings.completeSetup({ ...office, officeCity: ' ' }), /cidade/);
  assert.throws(() => settings.completeSetup({ ...office, appDescription: '' }), /descrição/);
  assert.throws(() => settings.completeSetup({ ...office, appName: 'x'.repeat(61) }), /até 60/);
  assert.throws(() => settings.completeSetup({ ...office, lawyers: [] }), /pelo menos um advogado/);
  assert.throws(() => settings.completeSetup({ ...office, lawyers: [{ name: 'Ana', oab: '', uf: 'GO' }] }), /OAB/);
  assert.throws(() => settings.completeSetup({ ...office, noLogo: false }), /logo/);
  assert.throws(() => settings.completeSetup({ ...office, officeName: 'Lima\nAdvocacia' }), /nome do escritório/);
  assert.equal(settings.setupRequired(), true, 'nothing was marked as done');
  assert.equal(settings.get().officeName, 'Meu escritório', 'nothing was saved');
  assert.ok(
    settings.completeSetup({ ...office, noLogo: false }, { hasLogo: true }).setupCompletedAt,
    'a chosen logo is enough',
  );
});

test('installations updated from older versions also go through the setup once', t => {
  const { settings } = fixture(t, { officeName: 'Escritório Antigo', termsAcceptedVersion: '1' });
  assert.equal(settings.setupRequired(), true);
  assert.equal(settings.get().officeName, 'Escritório Antigo', 'their values stay to be confirmed');
});
