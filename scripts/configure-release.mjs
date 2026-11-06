import fs from 'node:fs/promises';
import { createPublicKey } from 'node:crypto';
const repository = process.env.GITHUB_REPOSITORY;
const key = process.env.UPDATE_PUBLIC_KEY;
const publisherName = process.env.WINDOWS_PUBLISHER_NAME || '';
if (repository!=='lucianumm/magnum-office' || !key || createPublicKey(key).asymmetricKeyType !== 'ed25519') throw new Error('Configure o repositório oficial e UPDATE_PUBLIC_KEY Ed25519 antes de gerar uma release.');
await fs.writeFile('app/build-config.json', JSON.stringify({ repository, trustedUpdateKeys: [key], publisherName, windowsVerification:publisherName?'authenticode':'signed-manifest', releaseBuild: true }, null, 2));
