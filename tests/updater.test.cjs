const { test } = require('node:test');
const assert = require('node:assert/strict');
const { generateKeyPairSync, sign } = require('node:crypto');
const { verifyManifest, validateAsset } = require('../updater/trust.cjs');
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
function fixture(changes = {}, contextChanges = {}) {
  const file = { platform: 'win32', arch: 'x64', name: 'advocacia-gestao-setup-0.2.0-x64.exe', bytes: 1234, sha256: 'a'.repeat(64) };
  const m = { schema: 1, repository: 'office/gestao', tag: 'v0.2.0', version: '0.2.0', channel: 'stable', minimumVersion: '0.1.0', mandatory: false, reason: '', notes: 'Correções', publishedAt: '2026-11-05T00:00:00Z', files: [file], ...changes };
  const context = { repository: 'office/gestao', tag: 'v0.2.0', channel: 'stable', currentVersion: '0.1.0', platform: 'win32', arch: 'x64', assets: [{ name: file.name, size: file.bytes, browser_download_url: 'https://github.com/office/gestao/releases/download/v0.2.0/' + file.name }], ...contextChanges };
  const bytes = Buffer.from(JSON.stringify(m)); const signature = sign(null, bytes, privateKey).toString('base64');
  return { bytes, signature, context };
}
function verify(f) { return verifyManifest(f.bytes, f.signature, [publicKey], f.context); }
test('authentic, compatible GitHub release is accepted', () => { assert.equal(verify(fixture()).manifest.version, '0.2.0'); });
test('tampered metadata and unknown signing keys are rejected', () => {
  const f = fixture(); assert.throws(() => verify({ ...f, bytes: Buffer.from(f.bytes.toString().replace('Correções', 'Malware')) }), /Assinatura/);
  const other = generateKeyPairSync('ed25519'); assert.throws(() => verifyManifest(f.bytes, f.signature, [other.publicKey], f.context), /Assinatura/);
  assert.throws(() => verifyManifest(f.bytes, f.signature, [], f.context), /chaves públicas/);
});
test('downgrades, wrong channel, newer minimum version and wrong OS are rejected', () => {
  assert.throws(() => verify(fixture({}, { currentVersion: '0.2.0' })), /Downgrade/);
  assert.throws(() => verify(fixture({ channel: 'development' })), /canal/);
  assert.throws(() => verify(fixture({ minimumVersion: '0.1.9' })), /intermediária/);
  assert.throws(() => verify(fixture({}, { arch: 'arm64' })), /compatível/);
});
test('signed malicious origins, mismatched sizes and main branch downloads are rejected', () => {
  const f = fixture(); f.context.assets[0].browser_download_url = 'https://example.test/payload.exe'; assert.throws(() => verify(f), /Origem/);
  const size = fixture(); size.context.assets[0].size++; assert.throws(() => verify(size), /tamanho/);
  assert.throws(() => validateAsset({ name: 'file.exe', size: 10, browser_download_url: 'https://github.com/office/gestao/raw/main/file.exe' }, 'office/gestao', 'v0.2.0'), /Origem/);
});
test('mandatory update requires a reason and stable channel rejects prerelease', () => {
  assert.throws(() => verify(fixture({ mandatory: true })), /motivo/);
  assert.throws(() => verify(fixture({ version: '0.2.0-beta.1', tag: 'v0.2.0-beta.1' }, { tag: 'v0.2.0-beta.1' })), /canal/);
});
