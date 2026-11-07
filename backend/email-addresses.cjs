const { domainToASCII } = require('node:url');
function extractEmails(input) {
  if (typeof input !== 'string' || input.length > 100000) throw new Error('Cole até 100 mil caracteres.');
  const emails = [], seen = new Set(); let duplicates = 0;
  const candidates = input.match(/[\p{L}\p{N}.!#$%&'*+/=?^_`{|}~-]+@(?:[\p{L}\p{N}-]+\.)+[\p{L}\p{N}-]+/gu) || [];
  for (let candidate of candidates) {
    candidate = candidate.replace(/[.,;]+$/g, '');
    const at = candidate.lastIndexOf('@'), local = candidate.slice(0, at), domain = domainToASCII(candidate.slice(at + 1)).toLowerCase();
    if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/i.test(local) || local.startsWith('.') || local.endsWith('.') || local.includes('..') || local.length > 64 || !domain || domain.split('.').some(s => !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(s))) continue;
    const email = local + '@' + domain;
    if (email.length > 254) continue;
    if (seen.has(email.toLowerCase())) { duplicates++; continue; }
    seen.add(email.toLowerCase()); emails.push(email);
  }
  return { emails, duplicates, unrecognized: Math.max(0, (input.match(/@/g) || []).length - emails.length - duplicates) };
}
module.exports = { extractEmails };
