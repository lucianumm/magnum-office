const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Store } = require('../backend/store.cjs');
const { Vault } = require('../backend/vault.cjs');
const { Settings } = require('../backend/settings.cjs');
const { Operations } = require('../backend/operations.cjs');
const { Backups } = require('../backend/backups.cjs');
const { Updater } = require('../updater/updater.cjs');
const build = require('../app/build-config.json');
const base = path.resolve('work', 'updater-tests'); fs.mkdirSync(base, { recursive: true });
async function setup(t, { corruptedDownload = false, tamperedManifest = false } = {}) {
  const root = fs.mkdtempSync(path.join(base, 'run-'));
  const store = new Store(root, new Vault(crypto.randomBytes(32))); await store.migrate();
  const settings = new Settings(root); settings.save({ repository: 'lucianumm/magnum-office' });
  const operations = new Operations(); const backups = new Backups(store, settings);
  const updater = new Updater({ store, settings, operations, backups, app: { isPackaged: true } }); updater.stop();
  let nativeChecks = 0;
  updater.verifyNative = async () => { nativeChecks++; };
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const previousKeys = build.trustedUpdateKeys; build.trustedUpdateKeys = [publicKey];
  const body = Buffer.from('signed installer fixture, never executable');
  const futureVersion=require('semver').inc(require('../app/version.cjs'),'minor');
  const name = process.platform === 'win32' ? `advocacia-${futureVersion}.exe` : process.platform === 'darwin' ? `advocacia-${futureVersion}.dmg` : `advocacia-${futureVersion}.AppImage`;
  const file = { name, bytes: body.length, sha256: crypto.createHash('sha256').update(body).digest('hex'), platform: process.platform, arch: process.arch };
  const m = { schema: 1, repository: 'lucianumm/magnum-office', tag: `v${futureVersion}`, version: futureVersion, channel: 'stable', minimumVersion: '0.1.0', mandatory: false, reason: '', notes: 'Uma melhoria verificada.', publishedAt: '2026-11-05T12:00:00Z', files: [file] };
  const metadata = Buffer.from(JSON.stringify(m)); const signature = Buffer.from(crypto.sign(null, metadata, privateKey).toString('base64'));
  const url = name => `https://github.com/lucianumm/magnum-office/releases/download/v${futureVersion}/${name}`;
  const assets = [{ name, size: body.length, browser_download_url: url(name) }, { name: 'release-stable.json', size: metadata.length, browser_download_url: url('release-stable.json') }, { name: 'release-stable.json.sig', size: signature.length, browser_download_url: url('release-stable.json.sig') }];
  const releases = Buffer.from(JSON.stringify([{ tag_name: `v${futureVersion}`, prerelease: false, draft: false, assets }]));
  const originalFetch = global.fetch;
  global.fetch = async input => {
    if (input === 'https://api.github.com/repos/lucianumm/magnum-office/releases?per_page=100') return new Response(releases);
    if (input === url('release-stable.json')) return new Response(tamperedManifest ? Buffer.from(metadata.toString().replace('melhoria', 'alteração')) : metadata);
    if (input === url('release-stable.json.sig')) return new Response(signature);
    if (input === url(name)) return new Response(corruptedDownload ? Buffer.alloc(body.length, 1) : body);
    throw new Error('Unexpected network request in test');
  };
  t.after(() => { global.fetch = originalFetch; build.trustedUpdateKeys = previousKeys; updater.stop(); store.close(); if (!root.startsWith(base + path.sep)) throw new Error('Unsafe cleanup'); fs.rmSync(root, { recursive: true, force: true }); });
  return { root, store, settings, operations, updater, file, nativeChecks: () => nativeChecks };
}
test('updater discovers a signed release and only promotes a hash-verified download', async t => {
  const f = await setup(t);
  assert.equal((await f.updater.check()).status, 'available');
  assert.equal((await f.updater.download()).status, 'downloaded');
  assert.equal(f.nativeChecks(), 1);
  assert.ok(fs.existsSync(path.join(f.root, 'updates', f.file.name)));
  assert.equal(f.store.auditList().find(e => e.event === 'update.downloaded').metadata.sha256, f.file.sha256);
});

test('manual retry works with automatic updates disabled and preserves the automatic block list', async t => {
  const f = await setup(t);
  const nextVersion = require('semver').inc(require('../app/version.cjs'), 'minor');
  f.settings.save({ automatic: false });
  f.settings.internal({ blockedVersions: [nextVersion], lastCheck: new Date().toISOString() });
  assert.equal((await f.updater.check()).status, 'current');
  assert.equal((await f.updater.check({ retryBlocked: true })).available.version, nextVersion);
  assert.equal((await f.updater.download()).status, 'downloaded');
  // A new manual attempt fetches and replaces the installer rather than trusting
  // a previous cached download. Automatic retries remain blocked.
  fs.writeFileSync(path.join(f.root, 'updates', f.file.name), 'old partial content');
  await f.updater.check({ retryBlocked: true });
  assert.equal((await f.updater.download()).status, 'downloaded');
  assert.equal(f.settings.get().automatic, false);
  assert.deepEqual(f.settings.get().blockedVersions, [nextVersion]);
  assert.equal((await f.updater.check()).status, 'current');
});

test('forcing a manual retry still rejects a tampered signed manifest', async t => {
  const f = await setup(t, { tamperedManifest: true });
  f.settings.internal({ blockedVersions: [require('semver').inc(require('../app/version.cjs'), 'minor')] });
  await assert.rejects(f.updater.check({ retryBlocked: true }), /Assinatura/);
  assert.equal(f.updater.get().status, 'error');
  assert.equal(f.nativeChecks(), 0);
});
test('corrupted installer is deleted and never sent to native signature verification', async t => {
  const f = await setup(t, { corruptedDownload: true }); await f.updater.check();
  await assert.rejects(f.updater.download(), /Integridade/);
  assert.equal(f.updater.get().status, 'error'); assert.equal(f.nativeChecks(), 0);
  assert.deepEqual(fs.readdirSync(path.join(f.root, 'updates')), []);
});
test('tampered release metadata fails before an installer can be downloaded', async t => {
  const f = await setup(t, { tamperedManifest: true }); await assert.rejects(f.updater.check(), /Assinatura/);
  await assert.rejects(f.updater.download(), /Verifique/); assert.equal(f.nativeChecks(), 0);
});
test('critical operations block installation and changed repositories invalidate a selection', async t => {
  const f = await setup(t); await f.updater.check(); await f.updater.download();
  let release; const active = f.operations.run('Backup em andamento', () => new Promise(resolve => { release = resolve; }));
  await assert.rejects(f.updater.install(), /andamento/); release(); await active;
  f.settings.save({channel:'beta'});
  await assert.rejects(f.updater.download(), /Verifique/);
  assert.equal(fs.existsSync(path.join(f.root, 'pending-update.json')), false);
});

test('Windows manifest policy requires a pinned valid signature even without Authenticode',async t=>{if(process.platform!=='win32')return;const f=await setup(t);const original={publisherName:build.publisherName,windowsVerification:build.windowsVerification};t.after(()=>Object.assign(build,original));build.publisherName='';build.windowsVerification='signed-manifest';f.updater.verifyNative=Updater.prototype.verifyNative.bind(f.updater);await f.updater.check();assert.equal((await f.updater.download()).status,'downloaded');const selected=f.updater.selection;selected.signature=Buffer.alloc(64).toString('base64');await assert.rejects(f.updater.verifyNative('unused'),/Assinatura/);f.updater.selection=null;await assert.rejects(f.updater.verifyNative('unused'),/configurada/);});
