// Fills a document template with the client, case and lawyers and saves DOCX/PDF in the encrypted
// documents of the case (or client). All data is read here, never trusted from the screen.
const { uuid, text } = require('./validation.cjs');
const { templateBlocks, templateQuestions, fillBlocks, documentContext, blocksText } = require('../app/document-template.mjs');
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
      if (!input.answers || typeof input.answers !== 'object' || Array.isArray(input.answers)) throw new Error('Respostas inválidas.');
      for (const [key, value] of Object.entries(input.answers)) answers[text(key, 200)] = text(String(value ?? ''), 4000);
    }
    const blocks = templateBlocks(template);
    const values = documentContext({ client, caseItem, lawyers: chosen.map(i => all[i]), settings: this.settings.get(), courts: this.courts });
    return { template, client, caseItem, questions: templateQuestions(blocks), ...fillBlocks(blocks, values, answers) };
  }
  preview(input) {
    const { blocks, missing, invalid, questions } = this.prepare(input);
    return { blocks, missing, invalid, questions };
  }
  async generate(input) {
    const formats = Array.isArray(input?.formats) ? [...new Set(input.formats)] : [];
    if (!formats.length || formats.some(f => !['docx', 'pdf'].includes(f))) throw new Error('Escolha DOCX, PDF ou os dois.');
    const { template, client, caseItem, blocks, invalid } = this.prepare(input);
    if (invalid.length) throw new Error(`Valor inválido em: ${invalid.join(', ')}. Use, por exemplo, 1.500,00.`);
    if (!blocksText(blocks).trim()) throw new Error('O modelo está vazio.');
    const subject = client?.name || caseItem?.title || '';
    // Characters Windows does not accept in file names, and control characters.
    // eslint-disable-next-line no-control-regex -- removing them is the point
    const base = `${template.title}${subject ? ' - ' + subject : ''}`.replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
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
