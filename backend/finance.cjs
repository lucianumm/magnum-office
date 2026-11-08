// Installment plans and spreadsheet export of the financial entries.
const { randomUUID } = require('node:crypto');
const { buildInstallments, entryStatus, statusLabels, exportColumns } = require('../app/finance.mjs');
const { parseMoney } = require('../app/money.mjs');

class Finance {
  constructor({ store }) {
    this.store = store;
  }
  // input: the entry form plus installments (count) and amount as the total.
  createInstallments(input) {
    const count = Number(input.installments);
    const { installments, id, ...base } = input;
    void installments;
    if (id) throw new Error('Parcele apenas lançamentos novos.');
    // The form sends the amount as typed ("3.000,00").
    const total = parseMoney(base.amount);
    if (total === null) throw new Error('Informe o valor total em reais, por exemplo 3.000,00.');
    const entries = buildInstallments({ ...base, total, count, firstDue: base.dueDate, seriesId: randomUUID(), paidDate: '' });
    this.store.db.exec('BEGIN IMMEDIATE');
    try {
      const saved = entries.map(e => this.store.save('finance', e));
      this.store.db.exec('COMMIT');
      return saved;
    } catch (error) {
      this.store.db.exec('ROLLBACK');
      throw error;
    }
  }
  async workbook(today) {
    const Excel = require('exceljs');
    const clients = new Map(this.store.list('clients').map(c => [c.id, c.name]));
    const cases = new Map(this.store.list('cases').map(c => [c.id, c.title]));
    const book = new Excel.Workbook();
    book.creator = 'Magnum Office';
    const sheet = book.addWorksheet('Lançamentos');
    sheet.columns = exportColumns.map(([key, header]) => ({ key, header, width: key === 'description' ? 40 : 18 }));
    const rows = this.store.list('finance').sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    for (const e of rows)
      sheet.addRow({
        ...e,
        client: clients.get(e.clientId) || '',
        case: cases.get(e.caseId) || '',
        amount: e.amount ? Number(e.amount) : null,
        status: statusLabels[entryStatus(e, today)],
        reimbursable: e.reimbursable ? 'Sim' : '',
      });
    sheet.getRow(1).font = { bold: true };
    sheet.getColumn('amount').numFmt = '#,##0.00';
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    return Buffer.from(await book.xlsx.writeBuffer());
  }
}
module.exports = { Finance };
