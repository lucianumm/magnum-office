// Optional second password for the financial data (fees, expenses, the money in the reports). It is separate from
// the program password: the office can let staff use the program without seeing the money. While locked, the
// program does not even hand the financial entries to the window. Opens for 30 minutes after the password is
// typed and closes again after that, when the program locks, or on request. Stored as a scrypt hash.
const { scryptSync, randomBytes, timingSafeEqual } = require('node:crypto');

const SECRET = 'finance-lock';
const MIN_LENGTH = 4;
const MAX_ATTEMPTS = 5;
const WAIT_MS = 30000;
const OPEN_MS = 30 * 60000;

class FinanceLock {
  constructor({ store, clock = Date.now }) {
    Object.assign(this, { store, clock });
    this.openedAt = 0;
    this.failures = 0;
    this.blockedUntil = 0;
  }
  enabled() {
    return Boolean(this.store.secret(SECRET));
  }
  // The money is hidden: a password is set and it was not typed recently.
  locked() {
    return this.enabled() && !(this.openedAt && this.clock() - this.openedAt < OPEN_MS);
  }
  config() {
    return { enabled: this.enabled(), locked: this.locked() };
  }
  // Operations that touch the money call this first.
  assertOpen() {
    if (this.locked())
      throw new Error('O financeiro está protegido por senha. Digite a senha em Financeiro para continuar.');
  }
  hash(password, salt) {
    return scryptSync(String(password), salt, 32, { N: 16384, r: 8, p: 1 });
  }
  check(password) {
    const saved = this.store.secret(SECRET);
    if (!saved) return true;
    const expected = Buffer.from(saved.hash, 'base64');
    const given = this.hash(password, Buffer.from(saved.salt, 'base64'));
    return given.length === expected.length && timingSafeEqual(given, expected);
  }
  setPassword({ current = '', password }) {
    if (typeof password !== 'string' || password.length < MIN_LENGTH || password.length > 200)
      throw new Error(`Use uma senha de ${MIN_LENGTH} a 200 caracteres.`);
    if (this.enabled() && !this.check(current)) throw new Error('A senha atual não confere.');
    const salt = randomBytes(16);
    this.store.secret(SECRET, { salt: salt.toString('base64'), hash: this.hash(password, salt).toString('base64') });
    this.openedAt = this.clock();
    this.store.audit('finance.lock.set');
    return this.config();
  }
  disable({ current = '' }) {
    if (!this.enabled()) return this.config();
    if (!this.check(current)) throw new Error('A senha atual não confere.');
    this.store.secret(SECRET, null);
    this.openedAt = 0;
    this.store.audit('finance.lock.disabled');
    return this.config();
  }
  unlock(password) {
    if (!this.locked()) return this.config();
    const now = this.clock();
    if (now < this.blockedUntil)
      throw new Error(`Muitas tentativas. Aguarde ${Math.ceil((this.blockedUntil - now) / 1000)} segundos.`);
    if (!this.check(password)) {
      this.failures++;
      if (this.failures >= MAX_ATTEMPTS) {
        this.blockedUntil = now + WAIT_MS;
        this.failures = 0;
      }
      this.store.audit('finance.lock.failed');
      throw new Error('Senha incorreta.');
    }
    this.failures = 0;
    this.openedAt = now;
    this.store.audit('finance.lock.unlocked');
    return this.config();
  }
  lock() {
    this.openedAt = 0;
    return this.config();
  }
}
module.exports = { FinanceLock, MIN_LENGTH };
