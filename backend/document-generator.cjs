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
  constructor({ store, library, settings, documents, courts }) {
    Object.assign(this, { store, library, settings, documents, courts });
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
    const recorded = documentContext({
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
      template,
      client,
      caseItem,
      blanks,
      subject: values['cliente.nome'] || values['processo.titulo'] || '',
      questions: templateQuestions(blocks),
      ...fillBlocks(blocks, values, answers),
    };
  }
  preview(input) {
    const { blocks, missing, invalid, questions, blanks } = this.prepare(input);
    return { blocks, missing, invalid, questions, blanks };
  }
  async generate(input) {
    const formats = Array.isArray(input?.formats) ? [...new Set(input.formats)] : [];
    if (!formats.length || formats.some(f => !['docx', 'pdf'].includes(f)))
      throw new Error('Escolha DOCX, PDF ou os dois.');
    const { template, client, caseItem, blocks, invalid, subject } = this.prepare(input);
    if (invalid.length) throw new Error(`Valor inválido em: ${invalid.join(', ')}. Use, por exemplo, 1.500,00.`);
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
      const content = format === 'docx' ? docx(blocks, meta) : await pdf(blocks, meta);
      saved.push(await this.documents.save(`${base}.${format}`, content, links));
    }
    this.store.audit('document.generated', { id: template.id });
    return saved;
  }
}
module.exports = { DocumentGenerator };
