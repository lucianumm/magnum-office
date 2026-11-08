// Uses the real network: checks GitHub through a local proxy with the program's real network stack,
// and confirms that downloads can resume. Read-only, nothing is installed.
import { _electron as electron } from '@playwright/test';
import assert from 'node:assert/strict';
import { completeTestSetup } from './test-helpers.mjs';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
const hosts = [];
const proxy = http.createServer((_req, res) => { res.writeHead(405); res.end(); });
proxy.on('connect', (req, client, head) => {
  const [host, port] = req.url.split(':');
  hosts.push(host);
  const server = net.connect(Number(port) || 443, host, () => { client.write('HTTP/1.1 200 Connection Established\r\n\r\n'); server.write(head); server.pipe(client); client.pipe(server); });
  server.on('error', () => client.destroy());
  client.on('error', () => server.destroy());
});
await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'magnum-rede-'));
const env = { ...process.env, ADVOCACIA_TEST_DATA: root };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ['.', `--proxy-server=http://127.0.0.1:${proxy.address().port}`], env, timeout: 60000 });
try {
  const page = await app.firstWindow();
  await page.getByRole('heading', { name: /Bom dia|Boa tarde|Boa noite/ }).waitFor({ timeout: 30000 });
  await page.getByRole('switch', { name: /^Li e aceito os termos/ }).check();
  await page.getByRole('button', { name: 'Aceitar e continuar', exact: true }).click();
  await completeTestSetup(page);
  await page.evaluate(() => window.advocacia.saveSettings({ automatic: false, autoDownload: false }));
  const state = await page.evaluate(() => window.advocacia.checkUpdate());
  assert.ok(['current', 'available'].includes(state.status), state.error || state.status);
  assert.ok(hosts.includes('api.github.com'), 'A consulta não passou pelo proxy: ' + hosts.join(', '));
  const before = hosts.length;
  const range = await app.evaluate(async () => {
    const r = await global.fetch('https://github.com/lucianumm/magnum-office/releases/latest/download/release-stable.json', { headers: { Range: 'bytes=10-59', 'User-Agent': 'MagnumOffice-Test' } });
    return { status: r.status, contentRange: r.headers.get('content-range'), bytes: (await r.arrayBuffer()).byteLength };
  });
  assert.equal(range.status, 206); assert.equal(range.bytes, 50);
  assert.ok(hosts.length > before, 'O download não passou pelo proxy');
  process.stdout.write(`Rede real: consulta e download pelo proxy local (${[...new Set(hosts)].join(', ')}); retomada confirmada.\n`);
} finally { await app.close(); proxy.close(); fs.rmSync(root, { recursive: true, force: true }); }
