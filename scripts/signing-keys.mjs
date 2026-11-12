import { generateKeyPairSync } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
const dest = process.argv[2];
if (!dest || !path.isAbsolute(dest))
  throw new Error(
    'Informe uma pasta absoluta protegida fora do repositório. Ex.: npm run release:keys -- D:\\ChavesAdvocacia',
  );
const repo = path.resolve('.');
const target = path.resolve(dest);
if (target === repo || target.startsWith(repo + path.sep))
  throw new Error('As chaves privadas devem ficar fora do repositório.');
const { publicKey, privateKey } = generateKeyPairSync('ed25519', {
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});
await fs.mkdir(target, { recursive: true, mode: 0o700 });
await fs.writeFile(path.join(target, 'update-private.pem'), privateKey, { mode: 0o600, flag: 'wx' });
await fs.writeFile(path.join(target, 'update-public.pem'), publicKey, { mode: 0o600, flag: 'wx' });
process.stdout.write(
  'Chaves criadas na pasta indicada. Mantenha a chave privada em um cofre e configure os GitHub Secrets.\n',
);
