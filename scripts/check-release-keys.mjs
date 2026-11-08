// Checks the publishing keys before spending time on a build. Prints only types and fingerprints, never a key.
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
const build = JSON.parse(await fs.readFile('app/build-config.json', 'utf8'));
const print = value => crypto.createHash('sha256').update(value).digest('hex').slice(0, 16);
const der = key => key.export({ type: 'spki', format: 'der' });
const problems = [];
const pinned = build.trustedUpdateKeys.map(key => print(der(crypto.createPublicKey(key))));
process.stdout.write(`Chaves aceitas pelas instalações: ${pinned.join(', ')}\n`);
function read(name, loader) {
  const value = process.env[name];
  if (!value) { problems.push(`${name} não está definido.`); return null; }
  process.stdout.write(`${name}: ${value.length} caracteres, ${value.trim().split(/\r?\n/).length} linha(s), começa com "${value.trim().slice(0, 27)}"\n`);
  try { return loader(value); } catch (error) { problems.push(`${name} não pôde ser lida: ${error.code || error.message}`); return null; }
}
const publicKey = read('UPDATE_PUBLIC_KEY', crypto.createPublicKey);
const privateKey = read('UPDATE_PRIVATE_KEY', crypto.createPrivateKey);
if (publicKey) {
  process.stdout.write(`UPDATE_PUBLIC_KEY: tipo ${publicKey.asymmetricKeyType}, impressão ${print(der(publicKey))}\n`);
  if (!pinned.includes(print(der(publicKey)))) problems.push('UPDATE_PUBLIC_KEY não é aceita pelas instalações existentes.');
}
if (privateKey) {
  process.stdout.write(`UPDATE_PRIVATE_KEY: tipo ${privateKey.asymmetricKeyType}\n`);
  if (privateKey.asymmetricKeyType !== 'ed25519') problems.push('UPDATE_PRIVATE_KEY não é Ed25519.');
  else {
    const fingerprint = print(der(crypto.createPublicKey(privateKey)));
    process.stdout.write(`UPDATE_PRIVATE_KEY: impressão da pública correspondente ${fingerprint}\n`);
    if (!pinned.includes(fingerprint)) problems.push('UPDATE_PRIVATE_KEY não corresponde a nenhuma chave aceita pelas instalações existentes.');
  }
}
if (problems.length) { process.stdout.write(`\n${problems.join('\n')}\n`); process.exitCode = 1; } else process.stdout.write('\nChaves de publicação corretas.\n');
