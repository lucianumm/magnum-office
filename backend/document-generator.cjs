// Fills a document template with the client, case and lawyers and saves DOCX/PDF in the encrypted
// documents of the case (or client). All data is read here, never trusted from the screen.
const { uuid, text } = require('./validation.cjs');
const {
  templateBlocks,
  templateQuestions,
  templateVariables,
  fillBlocks,
  documentContext,
  blocksText,
  documentVariables,
} = require('../app/document-template.mjs');
const variableLabels = Object.fromEntries(documentVariables);
const { docx, pdf } = require('./document-files.cjs');

class DocumentGenerator {
  constructor({ store, library, settings, documents, courts, letterheads, systemFonts }) {
    Object.assign(this, { store, library, settings, documents, courts, letterheads, systemFonts });
  }
  // Page options chosen when generating: letterhead, font, size and spacing. Nothing chosen = the usual look.
  options(input = {}) {
    const raw = input.layout;
    if (raw === undefined) return { chosen: false };
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Opções de página inválidas.');
    const family = text(String(raw.family || ''), 80);
    const size = raw.size === undefined || raw.size === '' ? 12 : Number(raw.size);
    const lineSpacing = raw.lineSpacing === undefined || raw.lineSpacing === '' ? 1.5 : Number(raw.lineSpacing);
    const paragraphSpacing =
      raw.paragraphSpacing === undefined || raw.paragraphSpacing === '' ? 6 : Number(raw.paragraphSpacing);
    const firstLineIndent =
      raw.firstLineIndent === undefined || raw.firstLineIndent === '' ? 0 : Number(raw.firstLineIndent);
    if (!(size >= 8 && size <= 72)) throw new Error('Tamanho da fonte: de 8 a 72 pontos.');
    if (![1, 1.15, 1.5, 2].includes(lineSpacing)) throw new Error('Entrelinhas: simples, 1,15, 1,5 ou 2.');
    if (!(paragraphSpacing >= 0 && paragraphSpacing <= 36))
      throw new Error('Espaço entre parágrafos: de 0 a 36 pontos.');
    if (!(firstLineIndent >= 0 && firstLineIndent <= 5)) throw new Error('Recuo da primeira linha: de 0 a 5 cm.');
    const letterheadId = raw.letterheadId ? uuid(raw.letterheadId) : '';
    return { chosen: true, family, size, lineSpacing, paragraphSpacing, firstLineIndent, letterheadId };
  }
  // The writers' options for one format, and the warnings to show (font replaced, license...).
  async layoutFor(input, values, format) {
    const o = this.options(input);
    if (!o.chosen) return { layout: {}, warnings: [] };
    const warnings = [];
    const letterhead = o.letterheadId ? this.letterheads.resolve(o.letterheadId, values) : null;
    const layout = {
      font: { family: o.family || 'Times New Roman', size: o.size },
      lineSpacing: o.lineSpacing,
      paragraphSpacing: o.paragraphSpacing,
      firstLineIndent: o.firstLineIndent,
      letterhead,
      paper: letterhead?.paper,
      margins: letterhead?.margins,
    };
    if (format === 'pdf' && o.family) {
      const loaded = await this.systemFonts.load(o.family);
      if (loaded.bytes) layout.fontFiles = loaded.bytes;
      else warnings.push(loaded.warning);
    }
    return { layout, warnings };
  }
  prepare(input = {}) {
    const id = typeof input.templateId === 'string' && input.templateId ? uuid(input.templateId) : '';
    const template = this.library.list().find(t => t.id === id && t.kind === 'document');
    if (!template) throw new Error('Escolha um modelo de documento.');
    const caseItem = input.caseId ? this.store.get('cases', uuid(input.caseId)) : null;
    const clientId = input.clientId || caseItem?.clientId;
    const client = clientId ? this.store.get('clients', uuid(clientId)) : null;
    const all = this.settings.get().lawyers || [];
    const chosen = Array.isArray(input.lawyers) ? input.lawyers : all.map((_, i) => i);
    if (chosen.length > 30 || chosen.some(i => !Number.isInteger(i) || !all[i])) throw new Error('Advogado inválido.');
    const answers = {};
    if (input.answers !== undefined) {
      if (!input.answers || typeof input.answers !== 'object' || Array.isArray(input.answers))
        throw new Error('Respostas inválidas.');
      for (const [key, value] of Object.entries(input.answers))
        answers[text(key, 200)] = text(String(value ?? ''), 4000);
    }
    // Data typed when generating, for a document without a client or case, or with gaps in the record.
    const manual = {};
    if (input.values !== undefined) {
      if (!input.values || typeof input.values !== 'object' || Array.isArray(input.values))
        throw new Error('Dados inválidos.');
      for (const [key, value] of Object.entries(input.values)) {
        if (!(key in variableLabels)) throw new Error('Dado do documento desconhecido.');
        const typed = text(String(value ?? ''), 4000).trim();
        if (typed) manual[key] = typed;
      }
    }
    const blocks = templateBlocks(template);
    // Latest calculations saved in the case (their PDFs carry a summary): {calculo.total}, {debito.total}.
    const calculations = {};
    if (caseItem)
      for (const doc of this.store
        .list('documents')
        .filter(d => d.caseId === caseItem.id && d.calculation)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))) {
        const slot = doc.calculation.type === 'debt' ? 'debt' : 'labor';
        calculations[slot] ||= doc.calculation;
      }
    const recorded = documentContext({
      calculations,
      client,
      caseItem,
      lawyers: chosen.map(i => all[i]),
      settings: this.settings.get(),
      courts: this.courts,
    });
    // Fields to type: every variable of the template that the records leave empty.
    const blanks = templateVariables(blocks).filter(v => !String(recorded[v.key] ?? '').trim());
    const values = { ...recorded, ...manual };
    return {
      // What is needed to generate the same document again later.
      generation: { templateId: template.id, answers, values: manual, lawyers: chosen },
      template,
      client,
      caseItem,
      blanks,
      subject: values['cliente.nome'] || values['processo.titulo'] || '',
      questions: templateQuestions(blocks),
      values,
      ...fillBlocks(blocks, values, answers),
    };
  }
  // What the screen needs to show the page: the letterhead texts filled in (images are fetched apart) and font warnings.
  preview(input) {
    const { blocks, missing, invalid, questions, blanks } = this.prepare(input);
    return { blocks, missing, invalid, questions, blanks };
  }
  async previewPage(input) {
    const { blocks, missing, invalid, questions, blanks, values } = this.prepare(input);
    const o = this.options(input);
    let letterhead = null;
    const warnings = [];
    if (o.chosen) {
      if (o.letterheadId) {
        const lh = this.letterheads.resolve(o.letterheadId, values);
        letterhead = {
          id: o.letterheadId,
          paper: lh.paper,
          margins: lh.margins,
          firstPageDifferent: lh.firstPageDifferent,
          pageNumbers: lh.pageNumbers,
          pageNumberAlign: lh.pageNumberAlign,
          watermark: lh.watermark,
          header: {
            cols: lh.header.cols,
            image: lh.header.image ? { heightMm: lh.header.image.heightMm, align: lh.header.image.align } : null,
          },
          continuation: lh.continuation,
          footer: {
            cols: lh.footer.cols,
            image: lh.footer.image ? { heightMm: lh.footer.image.heightMm, align: lh.footer.image.align } : null,
          },
        };
      }
      if (o.family) {
        const found = await this.systemFonts.find(o.family);
        if (!found)
          warnings.push(
            `A fonte ${o.family} não está instalada neste computador: o PDF usará uma fonte parecida e o Word, a do computador que abrir o arquivo.`,
          );
        else if (!found.embeddable)
          warnings.push(
            `A licença da fonte ${o.family} não permite incorporá-la ao PDF: o PDF usará uma fonte parecida.`,
          );
      }
    }
    return { blocks, missing, invalid, questions, blanks, letterhead, warnings };
  }
  async generate(input) {
    const formats = Array.isArray(input?.formats) ? [...new Set(input.formats)] : [];
    if (!formats.length || formats.some(f => !['docx', 'pdf'].includes(f)))
      throw new Error('Escolha DOCX, PDF ou os dois.');
    const { template, client, caseItem, blocks, invalid, subject, generation, values } = this.prepare(input);
    if (invalid.length)
      throw new Error(
        `Valor inválido em: ${invalid.join(', ')}. Confira valores em reais (ex.: 1.500,00), datas e opções da lista.`,
      );
    if (!blocksText(blocks).trim()) throw new Error('O modelo está vazio.');
    // Characters Windows does not accept in file names, and control characters.
    const base = `${template.title}${subject ? ' - ' + subject : ''}`
      // eslint-disable-next-line no-control-regex -- removing them is the point
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 200);
    const meta = { title: template.title, author: this.settings.get().officeName };
    const links = { caseId: caseItem?.id || '', clientId: client?.id || '' };
    const saved = [];
    for (const format of formats) {
      const { layout, warnings } = await this.layoutFor(input, values, format);
      const content = format === 'docx' ? docx(blocks, meta, layout) : await pdf(blocks, meta, layout);
      const file = await this.documents.save(`${base}.${format}`, content, links, {
        generation: { ...generation, layout: input.layout },
      });
      saved.push({ ...file, warnings });
    }
    this.store.audit('document.generated', { id: template.id });
    return saved;
  }
}
module.exports = { DocumentGenerator };
