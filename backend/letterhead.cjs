// Letterheads (papel timbrado): a header and footer with an image and text in up to three columns, page
// numbers, a different first page, a watermark, paper and margins. Kept encrypted; images are checked by their
// real content (PNG or JPEG), limited in size and never loaded from the internet.
const { randomUUID } = require('node:crypto');

const KEY = 'letterheads';
const MAX_IMAGE = 2 * 1024 * 1024;
const MAX_SIDE = 4000;
const MAX_LETTERHEADS = 20;
const aligns = ['left', 'center', 'right'];

// Type and size from the file's own bytes: { mime, width, height }.
function inspectImage(bytes) {
  const b = Buffer.from(bytes);
  if (b.length > MAX_IMAGE) throw new Error('A imagem deve ter até 2 MB.');
  if (b.length > 24 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return check({ mime: 'image/png', width: b.readUInt32BE(16), height: b.readUInt32BE(20) });
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let at = 2;
    while (at + 9 < b.length) {
      if (b[at] !== 0xff) {
        at++;
        continue;
      }
      const marker = b[at + 1];
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker))
        return check({ mime: 'image/jpeg', height: b.readUInt16BE(at + 5), width: b.readUInt16BE(at + 7) });
      at += 2 + b.readUInt16BE(at + 2);
    }
  }
  throw new Error('Use uma imagem PNG ou JPG.');
}
function check(info) {
  if (!(info.width >= 16 && info.height >= 16 && info.width <= MAX_SIDE && info.height <= MAX_SIDE))
    throw new Error(`A imagem deve ter de 16 a ${MAX_SIDE} pixels de cada lado.`);
  return info;
}
const number = (value, min, max, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) && value !== '' && value !== null ? Math.min(max, Math.max(min, n)) : fallback;
};
const text = (value, max, what) => {
  const s = String(value ?? '');
  if (s.length > max || s.includes('\0')) throw new Error(`${what}: até ${max} caracteres.`);
  if (s.split('\n').length > 4) throw new Error(`${what}: até 4 linhas por coluna.`);
  return s.replace(/\r/g, '').trim();
};
const cols = (list, what) => [0, 1, 2].map(i => text((list || [])[i], 300, what));

class Letterheads {
  constructor({ store }) {
    this.store = store;
  }
  all() {
    return this.store.secret(KEY) || [];
  }
  write(list) {
    this.store.secret(KEY, list);
  }
  // For the screens: everything except the image bytes.
  list() {
    return this.all().map(l => ({
      ...l,
      header: { ...l.header, image: l.header.image ? this.describe(l.header.image) : null },
      footer: { ...l.footer, image: l.footer.image ? this.describe(l.footer.image) : null },
    }));
  }
  describe(ref) {
    const stored = this.store.secret('letterhead-image:' + ref.id);
    return { ...ref, mime: stored?.mime || '', width: stored?.width || 0, height: stored?.height || 0 };
  }
  image(id) {
    const stored = this.store.secret('letterhead-image:' + id);
    if (!stored) return null;
    return {
      bytes: Buffer.from(stored.base64, 'base64'),
      mime: stored.mime,
      width: stored.width,
      height: stored.height,
    };
  }
  // Checks an image the person picked (base64) and returns what the screen needs to show it.
  async inspect(base64) {
    if (typeof base64 !== 'string' || base64.length > Math.ceil((MAX_IMAGE * 4) / 3) + 8)
      throw new Error('A imagem deve ter até 2 MB.');
    const bytes = Buffer.from(base64, 'base64');
    const info = inspectImage(bytes);
    // The PDF must be able to embed it: try it now, not when the document is generated.
    const { PDFDocument } = require('pdf-lib');
    const probe = await PDFDocument.create();
    try {
      if (info.mime === 'image/png') await probe.embedPng(bytes);
      else await probe.embedJpg(bytes);
    } catch {
      throw new Error('Não foi possível ler esta imagem. Tente salvá-la de novo como PNG ou JPG.');
    }
    return { ...info, bytes };
  }
  async band(input, previous, key) {
    const band = { cols: cols(input?.cols, key === 'header' ? 'Cabeçalho' : 'Rodapé'), image: null };
    const ref = input?.image;
    if (!ref) return band;
    const settings = {
      heightMm: number(ref.heightMm, 5, 40, 20),
      align: aligns.includes(ref.align) ? ref.align : 'left',
    };
    if (ref.data) {
      const info = await this.inspect(ref.data);
      const id = randomUUID();
      this.store.secret('letterhead-image:' + id, {
        mime: info.mime,
        width: info.width,
        height: info.height,
        base64: info.bytes.toString('base64'),
      });
      band.image = { id, ...settings };
    } else if (ref.id && previous?.image?.id === ref.id) band.image = { id: ref.id, ...settings };
    return band;
  }
  async save(input) {
    const list = this.all();
    const name = String(input?.name || '').trim();
    if (!name || name.length > 80) throw new Error('Dê um nome ao papel timbrado (até 80 caracteres).');
    const previous = input.id ? list.find(l => l.id === input.id) : null;
    if (input.id && !previous) throw new Error('Papel timbrado não encontrado.');
    if (!previous && list.length >= MAX_LETTERHEADS)
      throw new Error(`Cadastre até ${MAX_LETTERHEADS} papéis timbrados.`);
    const margins = input.margins || {};
    const item = {
      id: previous?.id || randomUUID(),
      name,
      isDefault: previous?.isDefault || list.length === 0,
      paper: ['a4', 'oficio'].includes(input.paper) ? input.paper : 'a4',
      margins: {
        top: number(margins.top, 1, 6, 3),
        right: number(margins.right, 1, 6, 2),
        bottom: number(margins.bottom, 1, 6, 2),
        left: number(margins.left, 1, 6, 3),
      },
      firstPageDifferent: input.firstPageDifferent === true,
      pageNumbers: ['none', 'all', 'skipFirst'].includes(input.pageNumbers) ? input.pageNumbers : 'none',
      pageNumberAlign: aligns.includes(input.pageNumberAlign) ? input.pageNumberAlign : 'center',
      watermark: text(input.watermark || '', 30, "Marca d'água"),
      header: await this.band(input.header, previous?.header, 'header'),
      continuation: { cols: cols(input.continuation?.cols, 'Cabeçalho das páginas seguintes') },
      footer: await this.band(input.footer, previous?.footer, 'footer'),
    };
    this.write(previous ? list.map(l => (l.id === item.id ? item : l)) : [...list, item]);
    // Images no longer used are removed.
    const used = new Set(
      this.all()
        .flatMap(l => [l.header.image?.id, l.footer.image?.id])
        .filter(Boolean),
    );
    for (const old of [previous?.header.image?.id, previous?.footer.image?.id].filter(Boolean))
      if (!used.has(old)) this.store.secret('letterhead-image:' + old, null);
    this.store.audit('letterhead.saved', { id: item.id });
    return this.list().find(l => l.id === item.id);
  }
  setDefault(id) {
    const list = this.all();
    if (!list.some(l => l.id === id)) throw new Error('Papel timbrado não encontrado.');
    this.write(list.map(l => ({ ...l, isDefault: l.id === id })));
    return true;
  }
  remove(id) {
    const list = this.all();
    const found = list.find(l => l.id === id);
    if (!found) throw new Error('Papel timbrado não encontrado.');
    const rest = list.filter(l => l.id !== id);
    if (found.isDefault && rest.length) rest[0].isDefault = true;
    this.write(rest);
    for (const ref of [found.header.image, found.footer.image].filter(Boolean))
      this.store.secret('letterhead-image:' + ref.id, null);
    this.store.audit('letterhead.removed', { id });
    return true;
  }
  // The letterhead ready for the document writers: images loaded, variables ({cliente.nome}...) filled.
  resolve(id, values = {}) {
    if (!id) return null;
    const l = this.all().find(x => x.id === id);
    if (!l) throw new Error('Papel timbrado não encontrado.');
    const fill = s =>
      String(s).replace(/\{([a-z_.]+)\}/g, (all, key) => (key in values ? String(values[key] ?? '') : all));
    const withImage = band => {
      const loaded = band.image ? this.image(band.image.id) : null;
      return {
        cols: band.cols.map(fill),
        image: loaded ? { ...loaded, heightMm: band.image.heightMm, align: band.image.align } : null,
      };
    };
    return {
      paper: l.paper,
      margins: l.margins,
      firstPageDifferent: l.firstPageDifferent,
      pageNumbers: l.pageNumbers,
      pageNumberAlign: l.pageNumberAlign,
      watermark: fill(l.watermark),
      header: withImage(l.header),
      continuation: { cols: l.continuation.cols.map(fill) },
      footer: withImage(l.footer),
    };
  }
  defaultId() {
    return this.all().find(l => l.isDefault)?.id || '';
  }
}
module.exports = { Letterheads, inspectImage };
