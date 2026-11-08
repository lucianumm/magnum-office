import { useState } from 'react';
import { Check, FileText, MessageCircle, Pencil, Plus, Trash2, Download, Wallet } from 'lucide-react';
import { Badge, Button, DataTable, Empty, PageHeading, Panel, date, dayKey } from './components.jsx';
import { entryStatus, statusLabels, summarize } from '../../app/finance.mjs';
import { formatBRL } from '../../app/money.mjs';

const tones = { paid: 'green', overdue: 'red', open: 'amber', 'pending-amount': 'neutral' };
const monthRange = today => {
  const [y, m] = today.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${today.slice(0, 7)}-01`, to: `${today.slice(0, 7)}-${String(last).padStart(2, '0')}` };
};
const addDaysKey = (key, n) => {
  const d = new Date(key + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

// Fees and expenses: the whole office (page) or one client/case (tab inside its page).
export default function Finance({
  data,
  act,
  create,
  edit,
  remove,
  save,
  composeMessage,
  generateDocument,
  filter = null,
}) {
  const today = dayKey(new Date());
  const [period, setPeriod] = useState(filter ? 'all' : 'month');
  const [status, setStatus] = useState('Todos');
  const [direction, setDirection] = useState('Todos');
  const clients = new Map(data.entities.clients.map(c => [c.id, c]));
  const cases = new Map(data.entities.cases.map(c => [c.id, c]));
  const scoped = (data.entities.finance || []).filter(
    e => !filter || (filter.caseId ? e.caseId === filter.caseId : e.clientId === filter.clientId),
  );
  const month = monthRange(today);
  const range =
    period === 'month'
      ? month
      : period === 'next30'
        ? { from: today, to: addDaysKey(today, 30) }
        : { from: '', to: '' };
  const totals = summarize(scoped, today, filter ? {} : month);
  const statusKey = { 'Em aberto': 'open', Atrasados: 'overdue', Pagos: 'paid', 'A apurar': 'pending-amount' };
  const rows = scoped
    .filter(e => {
      const s = entryStatus(e, today);
      // Overdue entries stay visible in any period: they are what needs attention.
      const inRange =
        s === 'overdue' || ((!range.from || e.dueDate >= range.from) && (!range.to || e.dueDate <= range.to));
      return (
        inRange &&
        (status === 'Todos' || s === statusKey[status]) &&
        (direction === 'Todos' || e.direction === (direction === 'Receitas' ? 'Receita' : 'Despesa'))
      );
    })
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const links = filter
    ? { ...filter, ...(filter.caseId ? { clientId: cases.get(filter.caseId)?.clientId || '' } : {}) }
    : {};
  const remind = e => {
    const client = clients.get(e.clientId);
    const first = (client?.name || '').trim().split(/\s+/)[0];
    composeMessage({
      channel: 'whatsapp',
      clientId: client.id,
      ...(e.caseId ? { caseId: e.caseId } : {}),
      recipient: String(client.phone || '').replace(/\D/g, ''),
      body: `Olá, ${first}! Passando para lembrar que ${e.description} no valor de ${formatBRL(e.amount)} ${
        e.dueDate < today ? 'venceu' : 'vence'
      } em ${date(e.dueDate + 'T12:00', { year: 'numeric' })}. Qualquer dúvida, estamos à disposição.`,
    });
  };
  const tiles = [
    [filter ? 'A receber' : 'A receber no mês', totals.toReceive, ''],
    ['Atrasado', totals.overdue, Number(totals.overdue) ? 'danger' : ''],
    [filter ? 'Recebido' : 'Recebido no mês', totals.received, 'ok'],
    [filter ? 'Despesas' : 'Despesas no mês', totals.expenses, ''],
    ['Reembolsáveis', totals.reimbursable, ''],
  ];
  const table = (
    <>
      <div className="finance-tiles">
        {tiles.map(([label, value, tone]) => (
          <div className={'finance-tile ' + tone} key={label}>
            <span>{label}</span>
            <strong className="tabular">{formatBRL(value)}</strong>
          </div>
        ))}
      </div>
      <div className="list-toolbar finance-filters">
        {[
          [
            period,
            setPeriod,
            [
              ['month', 'Este mês'],
              ['next30', 'Próximos 30 dias'],
              ['all', 'Todos'],
            ],
            'Período',
          ],
          [status, setStatus, ['Todos', 'Em aberto', 'Atrasados', 'Pagos', 'A apurar'].map(s => [s, s]), 'Situação'],
          [direction, setDirection, ['Todos', 'Receitas', 'Despesas'].map(s => [s, s]), 'Tipo'],
        ].map(([value, set, options, label]) => (
          <label className="field" key={label}>
            <span>{label}</span>
            <select value={value} onChange={e => set(e.target.value)}>
              {options.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      {rows.length ? (
        <DataTable
          label="Lançamentos"
          rowKey={e => e.id}
          rows={rows}
          columns={[
            {
              key: 'dueDate',
              label: 'Vencimento',
              value: e => e.dueDate,
              render: e => <span className="tabular">{date(e.dueDate + 'T12:00', { year: 'numeric' })}</span>,
            },
            {
              key: 'description',
              label: 'Lançamento',
              value: e => e.description,
              render: e => (
                <button className="cell-open" onClick={() => edit('finance', e)}>
                  <strong>{e.description}</strong>
                  <small>
                    {[
                      e.category,
                      !filter && clients.get(e.clientId)?.name,
                      !filter?.caseId && cases.get(e.caseId)?.title,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </small>
                </button>
              ),
            },
            {
              key: 'amount',
              label: 'Valor',
              value: e => (e.direction === 'Despesa' ? -1 : 1) * Number(e.amount || 0),
              render: e => (
                <span className={'tabular ' + (e.direction === 'Despesa' ? 'expense-value' : '')}>
                  {e.amount ? (e.direction === 'Despesa' ? '− ' : '') + formatBRL(e.amount) : '—'}
                </span>
              ),
            },
            {
              key: 'status',
              label: 'Situação',
              value: e => entryStatus(e, today),
              render: e => {
                const s = entryStatus(e, today);
                return (
                  <Badge tone={tones[s]}>
                    {statusLabels[s]}
                    {s === 'paid' && e.paidDate ? ` em ${date(e.paidDate + 'T12:00')}` : ''}
                  </Badge>
                );
              },
            },
            {
              key: 'actions',
              label: 'Ações',
              render: e => {
                const s = entryStatus(e, today);
                const client = clients.get(e.clientId);
                return (
                  <div className="row-actions">
                    {['open', 'overdue'].includes(s) && (
                      <button
                        className="icon-button"
                        aria-label={`Marcar ${e.description} como pago`}
                        title="Marcar como pago hoje"
                        onClick={() => act(() => save('finance', { ...e, paidDate: today }), 'Pagamento registrado.')}
                      >
                        <Check size={15} />
                      </button>
                    )}
                    {e.direction === 'Receita' && s !== 'paid' && e.amount && client?.phone && (
                      <button
                        className="icon-button"
                        aria-label={`Cobrar ${e.description} por WhatsApp`}
                        title="Lembrar o cliente por WhatsApp"
                        onClick={() => remind(e)}
                      >
                        <MessageCircle size={15} />
                      </button>
                    )}
                    {e.direction === 'Receita' && s === 'paid' && (
                      <button
                        className="icon-button"
                        aria-label={`Gerar recibo de ${e.description}`}
                        title="Gerar recibo"
                        onClick={() =>
                          generateDocument({
                            clientId: e.clientId,
                            caseId: e.caseId,
                            templateTitle: 'Recibo de honorários',
                            answers: {
                              'Valor recebido:moeda': e.amount.replace('.', ','),
                              'Referente a': e.description,
                            },
                          })
                        }
                      >
                        <FileText size={15} />
                      </button>
                    )}
                    <button
                      className="icon-button"
                      aria-label={`Editar ${e.description}`}
                      onClick={() => edit('finance', e)}
                    >
                      <Pencil size={15} />
                    </button>
                    <button
                      className="icon-button danger"
                      aria-label={`Excluir ${e.description}`}
                      onClick={() => act(() => remove('finance', e.id))}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                );
              },
            },
          ]}
        />
      ) : (
        <Empty
          icon={Wallet}
          title={scoped.length ? 'Nenhum lançamento neste filtro' : 'Nenhum lançamento'}
          description={
            scoped.length
              ? 'Altere o período, a situação ou o tipo.'
              : 'Registre honorários, parcelas e despesas. Parcelas vencidas aparecem nos avisos.'
          }
        />
      )}
    </>
  );
  if (filter)
    return (
      <Panel
        title="Financeiro"
        aside={
          <Button tone="secondary" icon={Plus} onClick={() => create('finance', links)}>
            Novo lançamento
          </Button>
        }
      >
        {table}
      </Panel>
    );
  return (
    <>
      <PageHeading title="Financeiro">
        <Button
          tone="secondary"
          icon={Download}
          title="A planilha é salva fora do cofre, sem criptografia."
          onClick={() => act(() => window.advocacia.exportFinance(), 'Planilha exportada. Ela não é criptografada.')}
        >
          Exportar planilha
        </Button>
        <Button icon={Plus} onClick={() => create('finance')}>
          Novo lançamento
        </Button>
      </PageHeading>
      <Panel>{table}</Panel>
    </>
  );
}
