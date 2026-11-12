import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import semver from 'semver';
const pkg = JSON.parse(await fs.readFile('package.json', 'utf8'));
const version = pkg.version;
const tag = process.env.RELEASE_TAG || process.env.GITHUB_REF_NAME || `v${version}`;
const repository = process.env.GITHUB_REPOSITORY;
const signingKey = process.env.UPDATE_PRIVATE_KEY;
if (tag !== `v${version}`) throw new Error(`A tag ${tag} não corresponde à versão ${version} do package.json.`);
if (!repository) throw new Error('GITHUB_REPOSITORY não está definido.');
if (!signingKey) throw new Error('UPDATE_PRIVATE_KEY não está definida.');
if (crypto.createPrivateKey(signingKey).asymmetricKeyType !== 'ed25519')
  throw new Error('A chave privada não é Ed25519.');
if (
  process.env.UPDATE_PUBLIC_KEY &&
  crypto.createPublicKey(signingKey).export({ type: 'spki', format: 'pem' }) !==
    crypto.createPublicKey(process.env.UPDATE_PUBLIC_KEY).export({ type: 'spki', format: 'pem' })
)
  throw new Error('As chaves de publicação não correspondem.');
const pre = semver.prerelease(version);
const channel = pre ? (pre[0] === 'beta' ? 'beta' : pre[0] === 'dev' ? 'development' : null) : 'stable';
if (!channel) throw new Error('Use versão estável, -beta.N ou -dev.N.');
const dir = process.argv[2] || 'installers/artifacts';
const files = [];
const checksums = [];
for (const name of (await fs.readdir(dir)).sort()) {
  if (!/\.(exe|AppImage|deb|dmg|zip)$/.test(name)) continue;
  const data = await fs.readFile(path.join(dir, name));
  const sha256 = crypto.createHash('sha256').update(data).digest('hex');
  checksums.push(`${sha256}  ${name}`);
  if (name.endsWith('.deb') || name.endsWith('.zip')) continue;
  files.push({
    name,
    sha256,
    bytes: data.length,
    platform: name.endsWith('.exe') ? 'win32' : name.endsWith('.AppImage') ? 'linux' : 'darwin',
    arch: name.includes('arm64') ? 'arm64' : 'x64',
  });
}
if (!files.length) throw new Error('Nenhum instalador foi encontrado.');
const changelog = await fs.readFile('CHANGELOG.md', 'utf8');
const section = changelog
  .split(/^## /m)
  .find(part => part.startsWith(`${version} `) || part.startsWith(`${version}\n`));
if (!section) throw new Error(`Adicione a seção da versão ${version} ao CHANGELOG.md.`);
const notes = section.slice(section.indexOf('\n') + 1).trim();
const metadata = {
  schema: 1,
  repository,
  tag,
  version,
  channel,
  publishedAt: new Date().toISOString(),
  minimumVersion: process.env.MINIMUM_VERSION || '0.1.0',
  mandatory: process.env.MANDATORY_UPDATE === 'true',
  reason: process.env.UPDATE_REASON || '',
  notes,
  files,
};
if (metadata.mandatory && !metadata.reason) throw new Error('Informe UPDATE_REASON para uma atualização obrigatória.');
const bytes = Buffer.from(JSON.stringify(metadata, null, 2));
await fs.writeFile(path.join(dir, `release-${channel}.json`), bytes);
await fs.writeFile(
  path.join(dir, `release-${channel}.json.sig`),
  crypto.sign(null, bytes, signingKey).toString('base64'),
);
await fs.writeFile(path.join(dir, 'checksums.txt'), checksums.join('\n') + '\n');
process.stdout.write(`Manifesto ${version} assinado. Canal: ${channel}.\n`);
