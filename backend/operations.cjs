class Operations {
  constructor() {
    this.active = new Map();
    this.maintenance = false;
  }
  async run(name, task) {
    if (this.maintenance) throw new Error('O sistema está em manutenção. Aguarde a conclusão da operação.');
    const token = Symbol(name);
    this.active.set(token, name);
    try {
      return await task();
    } finally {
      this.active.delete(token);
    }
  }
  async exclusive(task) {
    if (this.maintenance || this.active.size)
      throw new Error('Há uma operação em andamento. Aguarde o término antes de continuar.');
    this.maintenance = true;
    try {
      return await task();
    } finally {
      this.maintenance = false;
    }
  }
  status() {
    return { maintenance: this.maintenance, active: [...this.active.values()] };
  }
}
module.exports = { Operations };
