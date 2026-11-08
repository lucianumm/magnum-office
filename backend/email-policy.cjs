const { domainToASCII } = require('node:url');
const free = new Set(['gmail.com', 'googlemail.com', 'outlook.com', 'outlook.com.br', 'hotmail.com', 'hotmail.com.br', 'live.com', 'live.com.br', 'msn.com', 'yahoo.com', 'yahoo.com.br', 'icloud.com', 'me.com', 'aol.com', 'proton.me', 'protonmail.com', 'pm.me', 'resend.dev', 'example.com', 'example.org', 'example.net']);
function ownDomain(input, optional = false) {
  if (!input && optional) return '';
  if (typeof input !== 'string' || /[\s/@:\\?#]/.test(input)) throw new Error('Informe apenas seu domínio próprio, como escritorio.com.br.');
  const domain = domainToASCII(input.toLowerCase());
  if (!domain || domain.length > 253 || domain.split('.').length < 2 || !domain.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) || [...free].some(d => domain === d || domain.endsWith('.' + d))) throw new Error('Use um domínio próprio. Provedores gratuitos e o domínio de teste do Resend não são permitidos como remetentes.');
  return domain;
}
function sender(from, domain) {
  const normalized = ownDomain(domain);
  if (typeof from !== 'string' || !/^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9.-]+$/.test(from) || from.length > 254 || from.split('@')[1].toLowerCase() !== normalized) throw new Error('O remetente deve pertencer exatamente ao domínio próprio configurado.');
  return from;
}
module.exports = { ownDomain, sender };
