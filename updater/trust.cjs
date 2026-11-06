const crypto = require('node:crypto');
const semver = require('semver');
function githubRepository(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*\/[a-zA-Z0-9_.-]+$/.test(value) || value.includes('..')) throw new Error('Configure um repositório GitHub válido.');
  return value;
}
function assetURL(repository, tag, name) {
  githubRepository(repository);
  if (typeof name !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]+$/.test(name)) throw new Error('Nome do artefato inválido.');
  return `https://github.com/${repository}/releases/download/${encodeURIComponent(tag)}/${name}`;
}
function validateAsset(asset, repository, tag) {
  if (!asset || asset.browser_download_url !== assetURL(repository, tag, asset.name)) throw new Error('Origem do artefato não autorizada.');
  if (!Number.isSafeInteger(asset.size) || asset.size <= 0 || asset.size > 2 * 1024 ** 3) throw new Error('Tamanho do artefato inválido.');
  return asset;
}
function verifyManifest(bytes, signature, publicKeys, context) {
  if (!Array.isArray(publicKeys) || !publicKeys.length) throw new Error('As chaves públicas de atualização ainda não foram incorporadas ao aplicativo. Configure a assinatura e gere um novo instalador.');
  const valid = publicKeys.some(key => { try { return crypto.verify(null, bytes, key, Buffer.from(signature.trim(), 'base64')); } catch { return false; } });
  if (!valid) throw new Error('Assinatura do manifesto inválida. A atualização foi bloqueada.');
  let m;
  try { m = JSON.parse(bytes.toString('utf8')); } catch { throw new Error('Manifesto inválido.'); }
  if (m.schema !== 1 || m.repository !== context.repository || m.tag !== context.tag || !semver.valid(m.version) || `v${m.version}` !== m.tag || m.channel !== context.channel) throw new Error('O manifesto não corresponde à versão ou canal selecionado.');
  if (!semver.gt(m.version, context.currentVersion)) throw new Error('Downgrade ou reinstalação não autorizado.');
  if (!semver.valid(m.minimumVersion) || semver.gt(m.minimumVersion, context.currentVersion)) throw new Error('Esta atualização exige uma versão intermediária. Consulte as notas de versão.');
  if (typeof m.mandatory !== 'boolean' || typeof m.reason !== 'string' || typeof m.notes !== 'string' || m.notes.length > 100000 || !Number.isFinite(Date.parse(m.publishedAt)) || !Array.isArray(m.files)) throw new Error('Metadados incompletos.');
  if (m.mandatory && !m.reason.trim()) throw new Error('Uma atualização obrigatória deve informar o motivo.');
  const prerelease = semver.prerelease(m.version);
  if ((m.channel === 'stable' && prerelease) || (m.channel === 'beta' && prerelease?.[0] !== 'beta') || (m.channel === 'development' && prerelease?.[0] !== 'dev')) throw new Error('Versionamento incompatível com o canal.');
  const file = m.files.find(f => f.platform === context.platform && f.arch === context.arch);
  const extension = { win32: '.exe', linux: '.AppImage', darwin: '.dmg' }[context.platform];
  if (!file || !extension || !file.name?.endsWith(extension) || !/^[a-f0-9]{64}$/.test(file.sha256) || !Number.isSafeInteger(file.bytes) || file.bytes <= 0) throw new Error('Nenhum instalador compatível com este computador.');
  const asset = context.assets.find(a => a.name === file.name);
  validateAsset(asset, context.repository, context.tag);
  if (asset.size !== file.bytes) throw new Error('O tamanho publicado difere do manifesto assinado.');
  return { manifest: m, file, asset };
}
module.exports = { githubRepository, assetURL, validateAsset, verifyManifest };
