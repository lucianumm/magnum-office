const { randomBytes, createCipheriv, createDecipheriv } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

class Vault {
  constructor(key) {
    if (!Buffer.isBuffer(key) || key.length !== 32) throw new Error('Chave de armazenamento inválida.');
    this.key = key;
  }
  static async open(root, safeStorage) {
    if (!safeStorage.isEncryptionAvailable() || (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')) {
      throw new Error('O cofre do sistema operacional está indisponível. Ative o chaveiro de credenciais antes de abrir o sistema.');
    }
    const file = path.join(root, 'vault.bin');
    if (!fs.existsSync(file)) {
      const key = randomBytes(32);
      fs.writeFileSync(file, await safeStorage.encryptStringAsync(key.toString('base64')), { mode: 0o600, flag: 'wx' });
    }
    const decrypted = await safeStorage.decryptStringAsync(fs.readFileSync(file));
    if (decrypted.shouldReEncrypt) {
      fs.writeFileSync(file + '.tmp', await safeStorage.encryptStringAsync(decrypted.result), { mode: 0o600 });
      fs.renameSync(file + '.tmp', file);
    }
    return new Vault(Buffer.from(decrypted.result, 'base64'));
  }
  seal(value) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value));
    const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
    return Buffer.concat([Buffer.from('AG01'), iv, cipher.getAuthTag(), encrypted]);
  }
  unseal(data, raw = false) {
    const bytes = Buffer.from(data);
    if (bytes.length < 32 || bytes.subarray(0, 4).toString() !== 'AG01') throw new Error('Arquivo criptografado inválido.');
    const decipher = createDecipheriv('aes-256-gcm', this.key, bytes.subarray(4, 16));
    decipher.setAuthTag(bytes.subarray(16, 32));
    const result = Buffer.concat([decipher.update(bytes.subarray(32)), decipher.final()]);
    return raw ? result : JSON.parse(result.toString('utf8'));
  }
}
module.exports = { Vault };
