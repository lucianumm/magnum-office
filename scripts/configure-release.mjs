import fs from 'node:fs/promises';
import { createPublicKey } from 'node:crypto';
const repository = process.env.GITHUB_REPOSITORY;
const key = process.env.UPDATE_PUBLIC_KEY;
const backup = process.env.UPDATE_BACKUP_PUBLIC_KEY || '';
const publisherName = process.env.WINDOWS_PUBLISHER_NAME || '';
if (repository !== 'lucianumm/magnum-office' || !key || createPublicKey(key).asymmetricKeyType !== 'ed25519') throw new Error('Configure o repositório oficial e UPDATE_PUBLIC_KEY Ed25519 antes de gerar uma release.');
const der = value => createPublicKey(value).export({ type: 'spki', format: 'der' }).toString('base64');
const current = JSON.parse(await fs.readFile('app/build-config.json', 'utf8'));
// Installed copies only accept keys they already carry. A different key would strand every existing user.
if (current.trustedUpdateKeys.length && !current.trustedUpdateKeys.some(pinned => der(pinned) === der(key))) throw new Error('A chave de publicação não é uma das confiadas pelas instalações existentes. Publicar com ela deixaria os usuários sem atualização.');
const keys = [...new Map([...current.trustedUpdateKeys, key, ...(backup ? [backup] : [])].map(value => [der(value), value])).values()];
await fs.writeFile('app/build-config.json', JSON.stringify({ repository, trustedUpdateKeys: keys, publisherName, windowsVerification: publisherName ? 'authenticode' : 'signed-manifest', releaseBuild: true }, null, 2));
