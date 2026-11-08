// Standard task lists per type of case. Each item becomes a task N calendar days after the start date,
// moved to the next business day when it falls on a weekend or holiday. Offices edit their own lists.
import { addDays, createCalendar, isDateKey } from './deadlines.mjs';

const doc = title => ({ title: `Documento: ${title}`, offset: 0, type: 'Tarefa', priority: 'Normal' });
const task = (title, offset, priority = 'Normal', type = 'Tarefa') => ({ title, offset, type, priority });

// Ids are fixed so the defaults can be told apart from the office's own lists.
export const defaultWorkflows = [
  {
    id: 'previdenciario-beneficio',
    name: 'Benefício previdenciário',
    area: 'Previdenciário',
    items: [
      doc('CNIS atualizado'),
      doc('CTPS e carnês de contribuição'),
      doc('Documentos pessoais e comprovante de residência'),
      doc('Laudos e exames médicos, se houver incapacidade'),
      task('Protocolar requerimento no INSS', 7, 'Alta'),
      task('Acompanhar requerimento no Meu INSS', 37),
      task('Avaliar ação judicial após a decisão do INSS', 60),
    ],
  },
  {
    id: 'trabalhista-reclamacao',
    name: 'Reclamação trabalhista',
    area: 'Trabalhista',
    items: [
      doc('CTPS'),
      doc('Contracheques e termo de rescisão (TRCT)'),
      doc('Extrato do FGTS'),
      doc('Provas: mensagens, testemunhas e controles de ponto'),
      task('Calcular verbas e liquidar pedidos', 5),
      task('Protocolar petição inicial', 10, 'Alta'),
    ],
  },
  {
    id: 'familia-divorcio',
    name: 'Divórcio consensual',
    area: 'Família',
    items: [
      doc('Certidão de casamento atualizada'),
      doc('Documentos pessoais do casal e dos filhos'),
      doc('Relação e documentos dos bens'),
      task('Redigir minuta do acordo', 7),
      task('Colher assinaturas e protocolar', 14, 'Alta'),
    ],
  },
  {
    id: 'civel-procedimento-comum',
    name: 'Ação cível — procedimento comum',
    area: 'Cível',
    items: [
      doc('Contrato, comprovantes e demais provas'),
      task('Notificação extrajudicial, se cabível', 3),
      task('Protocolar petição inicial', 10, 'Alta'),
      task('Conferir citação do réu', 40),
    ],
  },
  {
    id: 'cumprimento-sentenca',
    name: 'Cumprimento de sentença',
    area: '',
    items: [
      task('Conferir trânsito em julgado', 0),
      task('Calcular débito atualizado', 3),
      task('Protocolar pedido de cumprimento', 7, 'Alta'),
      task('Acompanhar intimação do devedor', 30),
    ],
  },
];

// Tasks for one workflow: [{ title, due: 'YYYY-MM-DDTHH:mm', type, priority }].
export function planWorkflow(workflow, start, calendarOptions = {}, time = '09:00') {
  if (!isDateKey(start)) throw new Error('Informe a data de início do fluxo.');
  const cal = createCalendar({ ...calendarOptions, recess: false });
  return workflow.items.map(item => {
    let date = addDays(start, item.offset);
    while (!cal.full(date)) date = addDays(date, 1);
    return { title: item.title, type: item.type, priority: item.priority, due: `${date}T${time}` };
  });
}
