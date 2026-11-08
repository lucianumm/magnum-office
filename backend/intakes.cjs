// Turns an intake (first consultation) into a client and a case in one step.
const { uuid } = require('./validation.cjs');

class Intakes {
  constructor({ store }) {
    this.store = store;
  }
  convert(id, { createCase = true } = {}) {
    const intake = this.store.get('intakes', uuid(id));
    if (intake.convertedClientId) throw new Error('Este atendimento já virou cliente.');
    this.store.db.exec('BEGIN IMMEDIATE');
    try {
      // The client form requires a WhatsApp number; the intake may have it in any format.
      const client = this.store.save('clients', {
        name: intake.name,
        phone: intake.phone,
        email: intake.email,
        document: intake.document,
        notes: [intake.subject && `Primeiro atendimento: ${intake.subject}`, intake.notes].filter(Boolean).join('\n\n').slice(0, 12000),
        status: 'Ativo',
      });
      const caseItem = createCase
        ? this.store.save('cases', {
            title: (intake.subject || `Atendimento de ${intake.name}`).split('\n')[0].slice(0, 200),
            clientId: client.id,
            area: intake.area || 'Outros',
            status: 'Em andamento',
            phase: 'Pré-processual',
          })
        : null;
      const { id: intakeId, createdAt, updatedAt, ...payload } = intake;
      void createdAt;
      void updatedAt;
      this.store.save('intakes', { ...payload, id: intakeId, status: 'Contratado', convertedClientId: client.id, convertedCaseId: caseItem?.id || '' });
      this.store.db.exec('COMMIT');
      return { client, case: caseItem };
    } catch (error) {
      this.store.db.exec('ROLLBACK');
      throw error;
    }
  }
}
module.exports = { Intakes };
