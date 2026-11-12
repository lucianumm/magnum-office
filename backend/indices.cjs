// Price indices and rates from the Banco Central (SGS), cached on disk so calculations work offline.
// Only public data travels: the request carries the series code and dates, nothing about the office.
const fs = require('node:fs');
const path = require('node:path');
const { indexSeries } = require('../app/debt.mjs');

const FIRST_YEAR = 1995; // after the Plano Real
class Indices {
  constructor({ root, fetch, store = null, clock = Date.now }) {
    this.file = path.join(root, 'indices.json');
    Object.assign(this, { fetch, store, clock });
  }
  read() {
    try {
      return JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch {
      return { updatedAt: null, series: {} };
    }
  }
  status() {
    const data = this.read();
    return {
      updatedAt: data.updatedAt,
      series: Object.fromEntries(
        Object.keys(indexSeries).map(k => {
          const months = Object.keys(data.series[k] || {}).sort();
          return [k, { last: months.at(-1) || null, count: months.length }];
        }),
      ),
    };
  }
  values(keys) {
    const data = this.read();
    return Object.fromEntries(keys.map(k => [k, data.series[k] || {}]));
  }
  // The SGS API accepts at most 10 years per request.
  async download(key) {
    const { code } = indexSeries[key];
    const now = new Date(this.clock());
    const values = {};
    for (let year = FIRST_YEAR; year <= now.getFullYear(); year += 10) {
      const last = Math.min(year + 9, now.getFullYear());
      const url = `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${code}/dados?formato=json&dataInicial=01/01/${year}&dataFinal=31/12/${last}`;
      const response = await this.fetch(url, { headers: { Accept: 'application/json' } });
      // Series that start later (Taxa Legal, 2024) answer 404 for older windows.
      if (response.status === 404) continue;
      if (!response.ok) throw new Error(`O Banco Central não respondeu (código ${response.status}). Tente mais tarde.`);
      const list = await response.json();
      if (!Array.isArray(list)) throw new Error('Resposta inesperada do Banco Central.');
      for (const item of list) {
        const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(item?.data));
        const value = Number(item?.valor);
        if (m && Number.isFinite(value)) values[`${m[3]}-${m[2]}`] = value;
      }
    }
    if (!Object.keys(values).length)
      throw new Error(`O Banco Central não devolveu dados de ${indexSeries[key].label}.`);
    return values;
  }
  async update(keys = Object.keys(indexSeries)) {
    const data = this.read();
    for (const key of keys) data.series[key] = await this.download(key);
    data.updatedAt = new Date(this.clock()).toISOString();
    fs.writeFileSync(this.file + '.tmp', JSON.stringify(data), { mode: 0o600 });
    fs.renameSync(this.file + '.tmp', this.file);
    this.store?.audit('indices.updated');
    return this.status();
  }
}
module.exports = { Indices };
