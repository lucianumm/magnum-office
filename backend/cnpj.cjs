// Company data from the CNPJ, for the client and opposing-party forms. Only the CNPJ number leaves the
// computer, to BrasilAPI (public Receita Federal data), with minhareceita.org as a fallback. Nothing is
// stored; the form shows what was found and fills only the empty fields.
const { brDocument, documentKey } = require('../app/br-documents.mjs');

const sources = [cnpj => `https://brasilapi.com.br/api/cnpj/v1/${cnpj}`, cnpj => `https://minhareceita.org/${cnpj}`];
const small = new Set(['de', 'da', 'do', 'das', 'dos', 'e']);
const titleCase = value =>
  String(value || '')
    .trim()
    .toLocaleLowerCase('pt-BR')
    .split(/\s+/)
    .filter(Boolean)
    .map((w, i) =>
      // "Torre II", "Sala S101": Roman numerals and codes stay in capitals.
      /\d/.test(w) || /^(x{0,3})(ix|iv|v?i{0,3})[,.;]?$/.test(w)
        ? w.toLocaleUpperCase('pt-BR')
        : i && small.has(w)
          ? w
          : w.charAt(0).toLocaleUpperCase('pt-BR') + w.slice(1),
    )
    .join(' ');
const clip = (value, max) =>
  String(value ?? '')
    .trim()
    .slice(0, max);

class CNPJLookup {
  constructor({ fetch, store = null }) {
    Object.assign(this, { fetch, store });
  }
  async request(url) {
    let response;
    try {
      response = await this.fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
    } catch {
      return { failure: 'network' };
    }
    if (response.status === 404) return { missing: true };
    if (response.status === 429) return { failure: 'rate' };
    if (!response.ok) return { failure: 'status' };
    try {
      return { data: await response.json() };
    } catch {
      return { failure: 'status' };
    }
  }
  async lookup(value) {
    const parsed = brDocument(String(value || '').slice(0, 32));
    if (parsed.type !== 'CNPJ' || !parsed.valid)
      throw new Error('Informe um CNPJ válido para buscar os dados da empresa.');
    const cnpj = documentKey(parsed.formatted);
    let failure = '';
    let missing = false;
    for (const source of sources) {
      const result = await this.request(source(cnpj));
      if (result.data?.razao_social) {
        this.store?.audit('cnpj.lookup', {});
        return map(result.data, parsed.formatted);
      }
      if (result.missing) missing = true;
      else failure ||= result.failure || 'status';
    }
    if (missing && !failure) return { found: false, document: parsed.formatted };
    if (failure === 'rate')
      throw new Error('Muitas consultas de CNPJ em pouco tempo. Tente de novo em alguns minutos.');
    if (failure === 'network')
      throw new Error('Sem conexão com o serviço de CNPJ. Verifique a internet e tente de novo.');
    if (missing) return { found: false, document: parsed.formatted };
    throw new Error('O serviço de CNPJ não respondeu. Tente mais tarde ou preencha os dados à mão.');
  }
}

function map(d, formatted) {
  const kind = clip(d.descricao_tipo_de_logradouro, 30);
  const street = clip(d.logradouro, 170);
  const partners = Array.isArray(d.qsa) ? d.qsa : [];
  const manager =
    partners.find(p => /administrador|diretor|presidente/i.test(String(p.qualificacao_socio || ''))) || partners[0];
  const zip = String(d.cep || '').replace(/\D/g, '');
  const situation = clip(d.descricao_situacao_cadastral, 40);
  return {
    found: true,
    document: formatted,
    name: clip(d.razao_social, 160),
    tradeName: clip(d.nome_fantasia, 160),
    situation,
    active: !situation || /^ativa$/i.test(situation),
    address: {
      street:
        kind && street && !street.toLowerCase().startsWith(kind.toLowerCase())
          ? `${titleCase(kind)} ${titleCase(street)}`
          : titleCase(street),
      addressNumber: clip(d.numero, 20),
      complement: titleCase(clip(d.complemento, 120)),
      district: titleCase(clip(d.bairro, 120)),
      city: titleCase(clip(d.municipio, 120)),
      state: clip(d.uf, 2).toUpperCase(),
      zip: zip.length === 8 ? `${zip.slice(0, 5)}-${zip.slice(5)}` : '',
    },
    legalRepresentative: manager?.nome_socio ? titleCase(clip(manager.nome_socio, 200)) : '',
  };
}

module.exports = { CNPJLookup };
