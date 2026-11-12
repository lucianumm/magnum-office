// Last check before publishing. Runs on the files that will actually be released.
// Usage: node scripts/release-verify.mjs [artifacts folder]
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { verifyManifest } = require('../updater/trust.cjs');
const semver = require('semver');
const pkg = JSON.parse(await fs.readFile('package.json', 'utf8'));
const build = JSON.parse(await fs.readFile('app/build-config.json', 'utf8'));
const dir = process.argv[2] || `installers/artifacts/v${pkg.version}`;
const problems = [];
const check = (ok, message) => {
  process.stdout.write(`${ok ? 'OK   ' : 'ERRO '} ${message}\n`);
  if (!ok) problems.push(message);
};
const pre = semver.prerelease(pkg.version);
const channel = !pre ? 'stable' : pre[0] === 'beta' ? 'beta' : 'development';
const changelog = await fs.readFile('CHANGELOG.md', 'utf8');
check(
  changelog.split(/^## /m).some(part => part.startsWith(`${pkg.version} `) || part.startsWith(`${pkg.version}\n`)),
  `CHANGELOG contém a versão ${pkg.version}`,
);
check(build.repository === 'lucianumm/magnum-office', 'Repositório oficial no build');
check(build.releaseBuild === true, 'Configuração marcada como release');
check(build.trustedUpdateKeys.length >= 1, `${build.trustedUpdateKeys.length} chave(s) pública(s) embutida(s)`);
if (build.trustedUpdateKeys.length < 2)
  process.stdout.write(
    'AVISO Sem chave reserva embutida: perder a chave principal deixa os clientes sem atualização.\n',
  );
const manifestFile = path.join(dir, `release-${channel}.json`);
const bytes = await fs.readFile(manifestFile).catch(() => null);
const signature = await fs.readFile(manifestFile + '.sig', 'ascii').catch(() => null);
check(Boolean(bytes && signature), 'Manifesto e assinatura presentes');
if (bytes && signature) {
  const manifest = JSON.parse(bytes.toString('utf8'));
  check(manifest.version === pkg.version && manifest.tag === `v${pkg.version}`, 'Manifesto corresponde à versão');
  check(manifest.notes.length > 0 && manifest.notes.length < 20000, 'Notas contêm só esta versão');
  const assets = [];
  for (const file of manifest.files) {
    const data = await fs.readFile(path.join(dir, file.name)).catch(() => null);
    check(Boolean(data), `Instalador encontrado: ${file.name}`);
    if (!data) continue;
    check(data.length === file.bytes, 'Tamanho igual ao manifesto');
    check(crypto.createHash('sha256').update(data).digest('hex') === file.sha256, 'SHA-256 igual ao manifesto');
    assets.push({
      name: file.name,
      size: file.bytes,
      browser_download_url: `https://github.com/${manifest.repository}/releases/download/${manifest.tag}/${file.name}`,
    });
  }
  // Same verification an installed client performs, using the keys built into this version.
  try {
    verifyManifest(bytes, signature, build.trustedUpdateKeys, {
      repository: manifest.repository,
      tag: manifest.tag,
      channel,
      currentVersion: '0.1.0',
      platform: 'win32',
      arch: 'x64',
      assets,
    });
    check(true, 'Assinatura aceita pela chave embutida');
  } catch (error) {
    check(false, `Assinatura recusada: ${error.message}`);
  }
  // The same manifest serves the Linux AppImage, when the release has one.
  if (manifest.files.some(f => f.platform === 'linux'))
    try {
      verifyManifest(bytes, signature, build.trustedUpdateKeys, {
        repository: manifest.repository,
        tag: manifest.tag,
        channel,
        currentVersion: '0.1.0',
        platform: 'linux',
        arch: 'x64',
        assets,
      });
      check(true, 'Manifesto aceito também por uma instalação Linux');
    } catch (error) {
      check(false, `Manifesto recusado no Linux: ${error.message}`);
    }
  const unpacked = path.join(dir, 'win-unpacked', 'resources', 'app.asar');
  check(
    await fs.stat(unpacked).then(
      () => true,
      () => false,
    ),
    'Aplicativo empacotado disponível para testes de fumaça',
  );
}
if (problems.length) {
  process.stdout.write(`\n${problems.length} problema(s). Não publique.\n`);
  process.exitCode = 1;
} else
  process.stdout.write(
    '\nPronto para publicar em etapas: rascunho → pré-release em um computador real → mais recente.\n',
  );
