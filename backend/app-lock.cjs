// Optional password that locks the program: after N minutes without use, when it goes to the tray,
// when Windows locks the session or on request. The password is stored only as a scrypt hash in the
// encrypted secrets. Without it the data can still be recovered with a portable backup and its own
// password; there is no other way back, and the screen says so.
const { scryptSync, randomBytes, timingSafeEqual } = require('node:crypto');

const SECRET = 'app-lock';
const MIN_LENGTH = 6;
const MAX_ATTEMPTS = 5;
const WAIT_MS = 30000;

class AppLock {
  constructor({ store, settings, clock = Date.now }) {
    Object.assign(this, { store, settings, clock });
    this.locked = this.enabled();
    this.failures = 0;
    this.blockedUntil = 0;
  }
  enabled() {
    return Boolean(this.store.secret(SECRET));
  }
  config() {
    const s = this.settings.get();
    return {
      enabled: this.enabled(),
      idleMinutes: Number(s.lockIdleMinutes) || 0,
      onHide: Boolean(s.lockOnHide),
      locked: this.locked,
    };
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
  // Turns the lock on or changes the password; changing requires the current one.
  setPassword({ current = '', password }) {
    if (typeof password !== 'string' || password.length < MIN_LENGTH || password.length > 200)
      throw new Error(`Use uma senha de ${MIN_LENGTH} a 200 caracteres.`);
    if (this.enabled() && !this.check(current)) throw new Error('A senha atual não confere.');
    const salt = randomBytes(16);
    this.store.secret(SECRET, { salt: salt.toString('base64'), hash: this.hash(password, salt).toString('base64') });
    this.store.audit('lock.password.set');
    return this.config();
  }
  disable({ current = '' }) {
    if (!this.enabled()) return this.config();
    if (!this.check(current)) throw new Error('A senha atual não confere.');
    this.store.secret(SECRET, null);
    this.locked = false;
    this.store.audit('lock.disabled');
    return this.config();
  }
  configure({ idleMinutes, onHide }) {
    const minutes = Number(idleMinutes);
    if (![0, 5, 10, 15, 30, 60].includes(minutes)) throw new Error('Tempo de bloqueio inválido.');
    this.settings.internal({ lockIdleMinutes: minutes, lockOnHide: Boolean(onHide) });
    return this.config();
  }
  lock() {
    if (!this.enabled() || this.locked) return false;
    this.locked = true;
    this.store.audit('lock.locked');
    return true;
  }
  unlock(password) {
    if (!this.locked) return true;
    const now = this.clock();
    if (now < this.blockedUntil)
      throw new Error(`Muitas tentativas. Aguarde ${Math.ceil((this.blockedUntil - now) / 1000)} segundos.`);
    if (!this.check(password)) {
      this.failures++;
      if (this.failures >= MAX_ATTEMPTS) {
        this.blockedUntil = now + WAIT_MS;
        this.failures = 0;
      }
      this.store.audit('lock.failed');
      throw new Error('Senha incorreta.');
    }
    this.failures = 0;
    this.locked = false;
    this.store.audit('lock.unlocked');
    return true;
  }
  // Called about every 30 s with the system idle time in seconds.
  idle(seconds) {
    const { idleMinutes } = this.config();
    if (idleMinutes && seconds >= idleMinutes * 60) return this.lock();
    return false;
  }
}

module.exports = { AppLock, MIN_LENGTH };
