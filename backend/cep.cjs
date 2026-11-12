// Address from the CEP for the client form. Only the 8 digits of the CEP leave the computer, to
// BrasilAPI, with ViaCEP as a fallback. Nothing is stored; the form fills only empty fields.
const sources = [
  cep => ({
    url: `https://brasilapi.com.br/api/cep/v2/${cep}`,
    map: d => ({ street: d.street, district: d.neighborhood, city: d.city, state: d.state }),
  }),
  cep => ({
    url: `https://viacep.com.br/ws/${cep}/json/`,
    map: d => (d.erro ? null : { street: d.logradouro, district: d.bairro, city: d.localidade, state: d.uf }),
  }),
];
const clip = (value, max) =>
  String(value ?? '')
    .trim()
    .slice(0, max);

class CEPLookup {
  constructor({ fetch, store = null }) {
    Object.assign(this, { fetch, store });
  }
  async lookup(value) {
    const cep = String(value || '').replace(/\D/g, '');
    if (cep.length !== 8) throw new Error('Informe um CEP com 8 dígitos.');
    let failure = '';
    let missing = false;
    for (const source of sources) {
      const { url, map } = source(cep);
      let response;
      try {
        response = await this.fetch(url, {
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(15000),
        });
      } catch {
        failure ||= 'network';
        continue;
      }
      if (response.status === 404 || response.status === 400) {
        missing = true;
        continue;
      }
      if (!response.ok) {
        failure ||= response.status === 429 ? 'rate' : 'status';
        continue;
      }
      let mapped = null;
      try {
        mapped = map(await response.json());
      } catch {
        failure ||= 'status';
        continue;
      }
      if (!mapped) {
        missing = true;
        continue;
      }
      this.store?.audit('cep.lookup', {});
      return {
        found: true,
        zip: `${cep.slice(0, 5)}-${cep.slice(5)}`,
        street: clip(mapped.street, 200),
        district: clip(mapped.district, 120),
        city: clip(mapped.city, 120),
        state: clip(mapped.state, 2).toUpperCase(),
      };
    }
    if (missing && failure !== 'network') return { found: false, zip: `${cep.slice(0, 5)}-${cep.slice(5)}` };
    if (failure === 'rate') throw new Error('Muitas consultas de CEP em pouco tempo. Tente de novo em alguns minutos.');
    if (failure === 'network')
      throw new Error('Sem conexão com o serviço de CEP. Verifique a internet e tente de novo.');
    throw new Error('O serviço de CEP não respondeu. Preencha o endereço à mão.');
  }
}

module.exports = { CEPLookup };
