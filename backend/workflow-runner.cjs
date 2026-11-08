// Applies a workflow (standard task list) to a case, creating every task at once.
const { uuid } = require('./validation.cjs');
const { planWorkflow } = require('../app/workflows.mjs');

class WorkflowRunner {
  constructor({ store, settings }) {
    Object.assign(this, { store, settings });
  }
  preview({ caseId, workflowId, start }) {
    const caseItem = this.store.get('cases', uuid(caseId));
    const cfg = this.settings.get();
    const workflow = (cfg.workflows || []).find(w => w.id === workflowId);
    if (!workflow) throw new Error('Escolha um fluxo.');
    const tasks = planWorkflow(workflow, start, { custom: cfg.courtCalendar || [] });
    return { caseItem, workflow, tasks: tasks.map(t => ({ ...t, caseId: caseItem.id, clientId: caseItem.clientId || '', status: 'Pendente', notes: `Fluxo: ${workflow.name}` })) };
  }
  apply(input) {
    const { tasks } = this.preview(input);
    this.store.db.exec('BEGIN IMMEDIATE');
    try {
      const saved = tasks.map(t => this.store.save('tasks', t));
      this.store.db.exec('COMMIT');
      return { count: saved.length };
    } catch (error) {
      this.store.db.exec('ROLLBACK');
      throw error;
    }
  }
}
module.exports = { WorkflowRunner };
