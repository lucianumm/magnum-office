const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const semver = require('semver');
const { Store } = require('../backend/store.cjs');
const { Vault } = require('../backend/vault.cjs');
const { Settings } = require('../backend/settings.cjs');
const { Operations } = require('../backend/operations.cjs');
const { Backups, verifyBackup } = require('../backend/backups.cjs');
const { planPreUpdate, planInstallers, applyRetention } = require('../backend/retention.cjs');
const { Updater, friendly, acceptedByChannel } = require('../updater/updater.cjs');
const build = require('../app/build-config.json');
const version = require('../app/version.cjs');
const base = path.resolve('work', 'updater-reliability-tests');
fs.mkdirSync(base, { recursive: true });
const repository = 'lucianumm/magnum-office';
const url = (tag, name) => `https://github.com/${repository}/releases/download/${tag}/${name}`;

function release(
  keys,
  target,
  { body = Buffer.from('installer fixture ' + target), minimumVersion = '0.1.0', broken = false } = {},
) {
  const tag = `v${target}`;
  const channel = semver.prerelease(target) ? 'beta' : 'stable';
  const name = `advocacia-${target}${{ win32: '.exe', darwin: '.dmg', linux: '.AppImage' }[process.platform]}`;
  const file = {
    name,
    bytes: body.length,
    sha256: crypto.createHash('sha256').update(body).digest('hex'),
    platform: process.platform,
    arch: process.arch,
  };
  const manifest = Buffer.from(
    JSON.stringify({
      schema: 1,
      repository,
      tag,
      version: target,
      channel,
      minimumVersion,
      mandatory: false,
      reason: '',
      notes: 'Notas',
      publishedAt: '2026-11-05T12:00:00Z',
      files: [file],
    }),
  );
  const signature = Buffer.from(crypto.sign(null, manifest, keys.privateKey).toString('base64'));
  const assets = [
    [name, body],
    [`release-${channel}.json`, manifest],
    [`release-${channel}.json.sig`, signature],
  ];
  return {
    body,
    file,
    manifest,
    signature,
    tag,
    api: {
      tag_name: tag,
      prerelease: false,
      draft: false,
      assets: broken
        ? []
        : assets.map(([n, bytes]) => ({ name: n, size: bytes.length, browser_download_url: url(tag, n) })),
    },
    files: Object.fromEntries(assets.map(([n, bytes]) => [url(tag, n), bytes])),
  };
}
async function setup(t, releases, keys) {
  const root = fs.mkdtempSync(path.join(base, 'run-'));
  const store = new Store(root, new Vault(crypto.randomBytes(32)));
  await store.migrate();
  const settings = new Settings(root);
  const operations = new Operations();
  const backups = new Backups(store, settings);
  const updater = new Updater({ store, settings, operations, backups, app: { isPackaged: true } });
  updater.stop();
  updater.verifyNative = async () => {};
  const previousKeys = build.trustedUpdateKeys;
  build.trustedUpdateKeys = [keys.publicKey];
  const calls = [];
  const originalFetch = global.fetch;
  const net = { fail: null, files: Object.assign({}, ...releases.map(r => r.files)) };
  global.fetch = async (input, options = {}) => {
    calls.push({ url: input, range: options.headers?.Range });
    if (net.fail) return net.fail(input, options);
    if (String(input).includes('api.github.com')) return new Response(JSON.stringify(releases.map(r => r.api)));
    const bytes = net.files[input];
    if (!bytes) throw new Error('Unexpected network request');
    const range = options.headers?.Range?.match(/bytes=(\d+)-/);
    if (range)
      return new Response(bytes.subarray(Number(range[1])), {
        status: 206,
        headers: { 'content-range': `bytes ${range[1]}-${bytes.length - 1}/${bytes.length}` },
      });
    return new Response(bytes);
  };
  t.after(() => {
    global.fetch = originalFetch;
    build.trustedUpdateKeys = previousKeys;
    updater.stop();
    store.close();
    if (!root.startsWith(base + path.sep)) throw new Error('Unsafe cleanup');
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { root, store, settings, operations, backups, updater, calls, net };
}
const keysPair = () => crypto.generateKeyPairSync('ed25519');
const next = (kind = 'minor') => semver.inc(version, kind);

test('a defective newest release does not block an older valid one', async t => {
  const keys = keysPair();
  const good = release(keys, next('patch'));
  const bad = release(keys, next('minor'), { broken: true });
  const f = await setup(t, [bad, good], keys);
  const state = await f.updater.check();
  assert.equal(state.status, 'available');
  assert.equal(state.available.version, next('patch'));
});
test('a release that requires an intermediate version falls back to the permitted one', async t => {
  const keys = keysPair();
  const good = release(keys, next('patch'));
  const far = release(keys, next('major'), { minimumVersion: next('minor') });
  const f = await setup(t, [far, good], keys);
  assert.equal((await f.updater.check()).available.version, next('patch'));
});
test('a verified installer is reused by a new check and survives a restart', async t => {
  const keys = keysPair();
  const r = release(keys, next());
  const f = await setup(t, [r], keys);
  await f.updater.check();
  await f.updater.download();
  const downloads = () => f.calls.filter(c => c.url === url(r.tag, r.file.name)).length;
  assert.equal(downloads(), 1);
  assert.equal((await f.updater.check()).status, 'downloaded');
  assert.equal(downloads(), 1);
  const restarted = new Updater({
    store: f.store,
    settings: f.settings,
    operations: f.operations,
    backups: f.backups,
    app: { isPackaged: true },
  });
  restarted.stop();
  await restarted.restore();
  assert.equal(restarted.get().status, 'downloaded');
  assert.equal(restarted.get().available.version, next());
  assert.equal(downloads(), 1);
});
test('a forced check downloads the installer again', async t => {
  const keys = keysPair();
  const r = release(keys, next());
  const f = await setup(t, [r], keys);
  await f.updater.check();
  await f.updater.download();
  assert.equal((await f.updater.check({ reuse: false })).status, 'available');
  await f.updater.download();
  assert.equal(f.calls.filter(c => c.url === url(r.tag, r.file.name)).length, 2);
});
test('a failed check keeps the downloaded installer available', async t => {
  const keys = keysPair();
  const r = release(keys, next());
  const f = await setup(t, [r], keys);
  await f.updater.check();
  await f.updater.download();
  f.net.fail = async () => {
    throw new TypeError('fetch failed');
  };
  await assert.rejects(f.updater.check(), /conectar ao GitHub/);
  assert.equal(f.updater.get().status, 'downloaded');
  assert.ok(f.updater.selection);
});
test('an interrupted download resumes from where it stopped', async t => {
  const keys = keysPair();
  const body = crypto.randomBytes(4096);
  const r = release(keys, next(), { body });
  const f = await setup(t, [r], keys);
  await f.updater.check();
  const partial = path.join(f.root, 'updates', `${r.file.name}.${r.file.sha256.slice(0, 12)}.partial`);
  fs.writeFileSync(partial, body.subarray(0, 1000));
  assert.equal((await f.updater.download()).status, 'downloaded');
  assert.equal(f.calls.find(c => c.url === url(r.tag, r.file.name)).range, 'bytes=1000-');
  assert.ok(fs.readFileSync(path.join(f.root, 'updates', r.file.name)).equals(body));
  assert.equal(fs.existsSync(partial), false);
});
test('a server that ignores Range restarts the download cleanly', async t => {
  const keys = keysPair();
  const body = crypto.randomBytes(2048);
  const r = release(keys, next(), { body });
  const f = await setup(t, [r], keys);
  await f.updater.check();
  fs.writeFileSync(
    path.join(f.root, 'updates', `${r.file.name}.${r.file.sha256.slice(0, 12)}.partial`),
    body.subarray(0, 500),
  );
  const original = global.fetch;
  global.fetch = async (input, options = {}) => {
    const { Range: _ignored, ...headers } = options.headers || {};
    return original(input, { ...options, headers });
  };
  t.after(() => {
    global.fetch = original;
  });
  assert.equal((await f.updater.download()).status, 'downloaded');
  assert.ok(fs.readFileSync(path.join(f.root, 'updates', r.file.name)).equals(body));
});
test('a GitHub rate limit falls back to the static stable URL', async t => {
  const keys = keysPair();
  const r = release(keys, next());
  const f = await setup(t, [r], keys);
  f.net.fail = async input => {
    if (String(input).includes('api.github.com')) return new Response('{}', { status: 403 });
    if (String(input).endsWith('releases/latest/download/release-stable.json')) return new Response(r.manifest);
    if (String(input).endsWith('releases/latest/download/release-stable.json.sig')) return new Response(r.signature);
    throw new Error('Unexpected network request');
  };
  const state = await f.updater.check();
  assert.equal(state.status, 'available');
  assert.equal(state.available.version, next());
  assert.equal(f.updater.selection.asset.browser_download_url, url(r.tag, r.file.name));
});
test('the static URL still rejects a tampered manifest', async t => {
  const keys = keysPair();
  const r = release(keys, next());
  const f = await setup(t, [r], keys);
  f.net.fail = async input => {
    if (String(input).includes('api.github.com')) return new Response('{}', { status: 429 });
    if (String(input).endsWith('.json'))
      return new Response(Buffer.from(r.manifest.toString().replace('Notas', 'Alterado')));
    return new Response(r.signature);
  };
  await assert.rejects(f.updater.check(), /Assinatura/);
});
test('network failures become understandable messages and back off', async t => {
  assert.match(friendly(new TypeError('fetch failed')).message, /conectar ao GitHub/);
  assert.match(friendly(new Error('net::ERR_CERT_AUTHORITY_INVALID')).message, /conectar ao GitHub/);
  const keys = keysPair();
  const r = release(keys, next());
  const f = await setup(t, [r], keys);
  f.net.fail = async () => {
    throw new TypeError('fetch failed');
  };
  await f.updater.check().catch(() => {});
  const first = f.updater.nextAttempt;
  assert.ok(first > Date.now() + 4 * 60000);
  const before = f.calls.length;
  await f.updater.scheduled();
  assert.equal(f.calls.length, before);
  await f.updater.check().catch(() => {});
  assert.ok(f.updater.nextAttempt > first + 4 * 60000);
});
test('check frequency respects its interval and installs only when the office is away', () => {
  const u = Updater.prototype;
  const now = Date.parse('2026-11-11T12:00:00');
  assert.equal(u.isCheckDue({ lastCheck: null }, now), true);
  assert.equal(
    u.isCheckDue({ lastCheck: new Date(now - 3600000).toISOString(), checkFrequency: 'startup' }, now),
    false,
  );
  assert.equal(
    u.isCheckDue({ lastCheck: new Date(now - 90000000).toISOString(), checkFrequency: 'startup' }, now),
    true,
  );
  assert.equal(
    u.isCheckDue({ lastCheck: new Date(now - 90000000).toISOString(), checkFrequency: 'weekly' }, now),
    false,
  );
  const cfg = { businessStart: 8, businessEnd: 18 };
  assert.equal(u.isOutsideBusinessHours(cfg, new Date('2026-11-11T12:00:00')), false);
  assert.equal(u.isOutsideBusinessHours(cfg, new Date('2026-11-11T20:00:00')), true);
  assert.equal(u.isOutsideBusinessHours(cfg, new Date('2026-11-14T12:00:00')), true);
});
test('beta users also receive stable versions and stable users do not receive beta', () => {
  assert.equal(acceptedByChannel({ prerelease: false }, '2.0.0', 'beta'), true);
  assert.equal(acceptedByChannel({ prerelease: true }, '2.0.0-beta.1', 'beta'), true);
  assert.equal(acceptedByChannel({ prerelease: true }, '2.0.0-beta.1', 'stable'), false);
  assert.equal(acceptedByChannel({ prerelease: true }, '2.0.0', 'stable'), false);
  assert.equal(acceptedByChannel({ prerelease: true }, '2.0.0-dev.1', 'beta'), false);
  assert.equal(acceptedByChannel({ prerelease: true }, '2.0.0-dev.1', 'development'), true);
});
test('retention keeps recent copies and only one program copy', () => {
  const old = '2026-01-01T00:00:00.000Z';
  const list = [0, 1, 2, 3, 4].map(i => ({
    id: `b${i}`,
    reason: 'pre-update',
    createdAt: `2026-01-0${i + 1}T00:00:00.000Z`,
    runtime: true,
    targetVersion: '1.0.0',
  }));
  const plan = planPreUpdate(
    [
      ...list,
      { id: 'manual', reason: 'manual', createdAt: old, runtime: false },
      { id: 'weekly', reason: 'weekly', createdAt: old, runtime: false },
    ],
    '1.0.0',
    Date.parse('2026-01-05T12:00:00Z'),
  );
  assert.deepEqual(plan.remove.sort(), ['b0', 'b1']);
  assert.deepEqual(plan.strip.sort(), ['b2', 'b3']);
  const later = planPreUpdate(list, '1.0.0', Date.parse('2026-02-01T00:00:00Z'));
  assert.ok(later.strip.includes('b4'));
  const failed = planPreUpdate(
    list.map(b => ({ ...b, targetVersion: '9.0.0' })),
    '1.0.0',
    Date.parse('2026-02-01T00:00:00Z'),
  );
  assert.equal(failed.strip.includes('b4'), false);
  assert.deepEqual(planInstallers(['1.0.0.exe', '1.1.0.exe', '1.2.0.exe', '9.0.0.exe', 'x.exe'], '1.2.0'), [
    '1.0.0.exe',
  ]);
});
test('removing the program copy keeps the backup valid and restorable', async t => {
  const keys = keysPair();
  const f = await setup(t, [], keys);
  const runtime = path.join(f.root, 'fake-runtime');
  fs.mkdirSync(runtime);
  fs.writeFileSync(path.join(runtime, 'program.exe'), 'program');
  const created = await f.backups.create('pre-update', process.platform === 'win32' ? null : null, '9.0.0');
  const dir = path.join(f.root, 'backups', created.id);
  fs.cpSync(runtime, path.join(dir, 'runtime'), { recursive: true });
  const manifest = f.store.vault.unseal(fs.readFileSync(path.join(dir, 'manifest.auth')));
  manifest.runtime = 'program.exe';
  manifest.files.push({
    path: 'runtime/program.exe',
    sha256: crypto.createHash('sha256').update('program').digest('hex'),
    bytes: 7,
  });
  fs.writeFileSync(path.join(dir, 'manifest.auth'), f.store.vault.seal(manifest));
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest));
  await verifyBackup(f.root, created.id, f.store.vault);
  await f.backups.stripRuntime(created.id);
  assert.equal(fs.existsSync(path.join(dir, 'runtime')), false);
  const verified = await verifyBackup(f.root, created.id, f.store.vault);
  assert.equal(verified.runtime, null);
});
test('retention never runs during an update and removes only updater leftovers', async t => {
  const keys = keysPair();
  const f = await setup(t, [], keys);
  const kept = await f.backups.create('manual');
  const updates = path.join(f.root, 'updates');
  fs.writeFileSync(path.join(updates, 'old.exe'), 'x');
  fs.writeFileSync(path.join(updates, 'keep.exe'), 'x');
  const pending = path.join(f.root, 'pending-update.json');
  fs.writeFileSync(pending, '{}');
  assert.equal((await applyRetention({ root: f.root, backups: f.backups, keepUpdate: 'keep.exe' })).skipped, true);
  assert.equal(fs.existsSync(path.join(updates, 'old.exe')), true);
  fs.rmSync(pending);
  for (let i = 1; i <= 7; i++) fs.writeFileSync(path.join(f.root, 'backups', `pre-migration-${i}.sqlite`), 'x');
  await applyRetention({ root: f.root, backups: f.backups, keepUpdate: 'keep.exe' });
  assert.deepEqual(fs.readdirSync(updates), ['keep.exe']);
  assert.ok(fs.existsSync(path.join(f.root, 'backups', kept.id)));
  const left = fs.readdirSync(path.join(f.root, 'backups')).filter(n => n.startsWith('pre-migration-'));
  assert.equal(left.length, 5);
  assert.equal(left.includes('pre-migration-1.sqlite'), false);
});
test('existing installations turn on checking once, and a later choice is respected', t => {
  const root = fs.mkdtempSync(path.join(base, 'policy-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify({ automatic: false, autoDownload: false }));
  const first = new Settings(root);
  assert.equal(first.get().automatic, true);
  assert.equal(first.get().autoDownload, true);
  assert.equal(first.get().installOutsideHours, false);
  first.save({ automatic: false });
  assert.equal(new Settings(root).get().automatic, false);
});
test('an antivirus lock on the downloaded file is retried and the download still completes', async t => {
  const keys = keysPair();
  const r = release(keys, next());
  const f = await setup(t, [r], keys);
  const fsp = require('node:fs/promises');
  const rename = fsp.rename;
  let calls = 0;
  fsp.rename = async (...args) => {
    if (++calls <= 2) throw Object.assign(new Error('rename EBUSY'), { code: 'EBUSY' });
    return rename(...args);
  };
  t.after(() => {
    fsp.rename = rename;
  });
  await f.updater.check();
  assert.equal((await f.updater.download()).status, 'downloaded');
  assert.equal(calls, 3);
});
test('insufficient disk space stops before downloading and nothing is left pending', async t => {
  const keys = keysPair();
  const r = release(keys, next());
  const f = await setup(t, [r], keys);
  const fsp = require('node:fs/promises');
  const statfs = fsp.statfs;
  fsp.statfs = async () => ({ bavail: 10, bsize: 4096 });
  t.after(() => {
    fsp.statfs = statfs;
  });
  await f.updater.check();
  await assert.rejects(f.updater.download(), /Espaço em disco insuficiente/);
  assert.equal(
    f.calls.some(c => c.url === url(r.tag, r.file.name)),
    false,
  );
  assert.equal(fs.existsSync(path.join(f.root, 'pending-update.json')), false);
});
test('the message queue stays closed until the new version is confirmed', async () => {
  const { Messaging } = require('../backend/messaging.cjs');
  let touched = false;
  const guard = {
    canProcess: () => false,
    get running() {
      touched = true;
      return false;
    },
  };
  await Messaging.prototype.process.call(guard);
  assert.equal(touched, false);
});
