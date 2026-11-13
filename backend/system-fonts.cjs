// Fonts installed on this computer, read (never copied out or downloaded) so a PDF can use the same fonts as
// Word. Only the font tables needed to list them are read: the family and style names and the embedding
// permission (fsType). A font whose license forbids embedding or subsetting is never used in a PDF.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const classic = [
  'Times New Roman',
  'Arial',
  'Calibri',
  'Cambria',
  'Garamond',
  'Georgia',
  'Verdana',
  'Tahoma',
  'Courier New',
];
// What the PDF already carries (no embedding needed) when the chosen font is not on this computer.
const standardFor = family => {
  const f = String(family || '').toLowerCase();
  if (/courier|consolas|mono/.test(f)) return 'Courier';
  if (/arial|calibri|verdana|tahoma|helvetica|segoe|trebuchet|sans/.test(f)) return 'Helvetica';
  return 'Times';
};

function directories() {
  const dirs = [];
  if (process.platform === 'win32') {
    dirs.push(path.join(process.env.WINDIR || 'C:\\Windows', 'Fonts'));
    if (process.env.LOCALAPPDATA) dirs.push(path.join(process.env.LOCALAPPDATA, 'Microsoft', 'Windows', 'Fonts'));
  }
  return dirs;
}

async function readAt(handle, position, length) {
  const buffer = Buffer.alloc(length);
  const { bytesRead } = await handle.read(buffer, 0, length, position);
  return buffer.subarray(0, bytesRead);
}
function decodeName(record, data) {
  const raw = data.subarray(record.offset, record.offset + record.length);
  if (record.platform === 3 || record.platform === 0) {
    const out = Buffer.alloc(raw.length);
    for (let i = 0; i + 1 < raw.length; i += 2) {
      out[i] = raw[i + 1];
      out[i + 1] = raw[i];
    }
    return out.toString('utf16le');
  }
  return raw.toString('latin1');
}
// Names and permission of every face in one font file (a .ttc holds several).
async function readFaces(file) {
  const handle = await fsp.open(file, 'r');
  try {
    const head = await readAt(handle, 0, 16);
    if (head.length < 12) return [];
    const offsets = [];
    if (head.toString('latin1', 0, 4) === 'ttcf') {
      const count = Math.min(head.readUInt32BE(8), 64);
      const list = await readAt(handle, 12, count * 4);
      for (let i = 0; i < count; i++) offsets.push(list.readUInt32BE(i * 4));
    } else offsets.push(0);
    const faces = [];
    for (const [index, offset] of offsets.entries()) {
      const dirHead = await readAt(handle, offset, 12);
      const kind = dirHead.toString('latin1', 0, 4);
      if (!['\0\u0001\0\0', 'OTTO', 'true'].includes(kind)) continue;
      const tableCount = dirHead.readUInt16BE(4);
      const dir = await readAt(handle, offset + 12, tableCount * 16);
      const tables = {};
      for (let t = 0; t < tableCount; t++)
        tables[dir.toString('latin1', t * 16, t * 16 + 4)] = {
          offset: dir.readUInt32BE(t * 16 + 8),
          length: dir.readUInt32BE(t * 16 + 12),
        };
      if (!tables.name || !tables['OS/2']) continue;
      const nameTable = await readAt(handle, tables.name.offset, Math.min(tables.name.length, 200000));
      const count = nameTable.readUInt16BE(2);
      const stringsAt = nameTable.readUInt16BE(4);
      const names = {};
      for (let r = 0; r < count; r++) {
        const at = 6 + r * 12;
        if (at + 12 > nameTable.length) break;
        const record = {
          platform: nameTable.readUInt16BE(at),
          language: nameTable.readUInt16BE(at + 4),
          id: nameTable.readUInt16BE(at + 6),
          length: nameTable.readUInt16BE(at + 8),
          offset: stringsAt + nameTable.readUInt16BE(at + 10),
        };
        // Windows English names first, then any Windows name, then Mac.
        const rank = record.platform === 3 ? (record.language === 0x409 ? 0 : 1) : record.platform === 1 ? 2 : 9;
        if (rank < (names[record.id]?.rank ?? 9) + (names[record.id] ? 0 : 1))
          names[record.id] = { rank, text: decodeName(record, nameTable) };
      }
      const os2 = await readAt(handle, tables['OS/2'].offset, 64);
      const fsType = os2.length >= 10 ? os2.readUInt16BE(8) : 0;
      const family = (names[1]?.text || '').trim();
      const subfamily = (names[2]?.text || 'Regular').trim();
      if (!family) continue;
      faces.push({
        file,
        index,
        family,
        subfamily,
        full: (names[4]?.text || '').trim(),
        bold: /\bbold\b/i.test(subfamily),
        italic: /italic|oblique/i.test(subfamily),
        fsType,
        // Restricted license (bit 1) and "no subsetting" (bit 8) forbid what a PDF needs.
        embeddable: !(fsType & 0x0002) && !(fsType & 0x0100),
      });
    }
    return faces;
  } finally {
    await handle.close();
  }
}

// One face as a standalone font file (a face inside a .ttc cannot be embedded as it is).
function extractFace(buffer, index) {
  if (buffer.toString('latin1', 0, 4) !== 'ttcf') return buffer;
  const offset = buffer.readUInt32BE(12 + index * 4);
  const count = buffer.readUInt16BE(offset + 4);
  const entries = [];
  for (let i = 0; i < count; i++) {
    const at = offset + 12 + i * 16;
    entries.push({
      tag: buffer.subarray(at, at + 4),
      checksum: buffer.readUInt32BE(at + 4),
      offset: buffer.readUInt32BE(at + 8),
      length: buffer.readUInt32BE(at + 12),
    });
  }
  const headerSize = 12 + count * 16;
  let cursor = headerSize;
  const parts = [];
  const directory = Buffer.alloc(headerSize);
  buffer.copy(directory, 0, offset, offset + 12);
  entries.forEach((entry, i) => {
    const padded = (entry.length + 3) & ~3;
    const at = 12 + i * 16;
    entry.tag.copy(directory, at);
    directory.writeUInt32BE(entry.checksum, at + 4);
    directory.writeUInt32BE(cursor, at + 8);
    directory.writeUInt32BE(entry.length, at + 12);
    const data = Buffer.alloc(padded);
    buffer.copy(data, 0, entry.offset, entry.offset + entry.length);
    parts.push(data);
    cursor += padded;
  });
  return Buffer.concat([directory, ...parts]);
}

class SystemFonts {
  constructor({ dirs = directories() } = {}) {
    this.dirs = dirs;
    this.cache = null;
  }
  async scan() {
    const faces = [];
    for (const dir of this.dirs) {
      let names = [];
      try {
        names = await fsp.readdir(dir);
      } catch {
        continue;
      }
      for (const name of names.filter(n => /\.(ttf|otf|ttc)$/i.test(n))) {
        try {
          faces.push(...(await readFaces(path.join(dir, name))));
        } catch {
          /* an unreadable file is simply not listed */
        }
      }
    }
    return faces;
  }
  // Families with their four faces, classic ones first.
  async list() {
    if (!this.cache) {
      const families = new Map();
      for (const face of await this.scan()) {
        const entry = families.get(face.family) || { family: face.family, faces: {} };
        const key = face.bold && face.italic ? 'boldItalic' : face.bold ? 'bold' : face.italic ? 'italic' : 'regular';
        if (!entry.faces[key]) entry.faces[key] = face;
        families.set(face.family, entry);
      }
      this.cache = [...families.values()]
        .filter(f => f.faces.regular)
        .map(f => ({
          family: f.family,
          faces: f.faces,
          embeddable: f.faces.regular.embeddable,
          classic: classic.includes(f.family),
        }))
        .sort((a, b) => b.classic - a.classic || a.family.localeCompare(b.family, 'pt-BR'));
    }
    return this.cache;
  }
  // The names for a font picker.
  async names() {
    return (await this.list()).map(f => ({ family: f.family, classic: f.classic, embeddable: f.embeddable }));
  }
  async find(family) {
    const wanted = String(family || '').toLowerCase();
    return (await this.list()).find(f => f.family.toLowerCase() === wanted) || null;
  }
  // The four font files of a family ready to embed, or why it cannot be used: { bytes: {regular,...} } | { warning }.
  async load(family) {
    const found = await this.find(family);
    if (!found)
      return { warning: `A fonte ${family} não está instalada neste computador; o PDF usa uma fonte parecida.` };
    if (!found.embeddable)
      return { warning: `A licença da fonte ${family} não permite incorporá-la ao PDF; o PDF usa uma fonte parecida.` };
    const bytes = {};
    for (const [key, face] of Object.entries(found.faces)) {
      if (!face.embeddable) continue;
      try {
        bytes[key] = extractFace(await fsp.readFile(face.file), face.index);
      } catch {
        /* that style stays missing and falls back to the regular one */
      }
    }
    if (!bytes.regular) return { warning: `Não foi possível ler a fonte ${family}; o PDF usa uma fonte parecida.` };
    return { bytes };
  }
  exists() {
    return this.dirs.some(d => fs.existsSync(d));
  }
}
module.exports = { SystemFonts, readFaces, extractFace, standardFor, classic };
