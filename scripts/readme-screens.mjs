// Screenshots for the README, with fictional data in a temporary profile (your data is never used).
// Usage: node scripts/readme-screens.mjs   (writes docs/images/*.png; downloads BCB indices for "Débitos")
import { _electron as electron } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { cnjCheckDigits, formatCNJ } from '../app/cnj.mjs';
import { completeTestSetup } from './test-helpers.mjs';

const out = path.resolve('docs/images');
fs.mkdirSync(out, { recursive: true });
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'magnum-readme-'));
const env = { ...process.env, ADVOCACIA_TEST_DATA: root };
delete env.ELECTRON_RUN_AS_NODE;
const cnj = (sequence, origin, year = '2025', tr = '09') =>
  formatCNJ(sequence + cnjCheckDigits(sequence, year, '8', tr, origin) + year + '8' + tr + origin);
const pad = n => String(n).padStart(2, '0');
const day = offset => {
  const d = new Date(Date.now() + offset * 86400000);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const sample = {
  numbers: [
    cnj('5012345', '0051'),
    cnj('5023456', '0051'),
    cnj('0800123', '0001', '2024', '18'),
    cnj('5034567', '0051'),
  ],
  days: Object.fromEntries([-2, -1, 0, 1, 2, 3, 5, 8, 12, 20, -40, -25, -10].map(o => [o, day(o)])),
};

const app = await electron.launch({ args: ['.'], env, timeout: 60000 });
const errors = [];
try {
  const page = await app.firstWindow();
  page.on('pageerror', e => errors.push(e.message));
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.setSize(1440, 900);
    win.center();
  });
  await page.getByRole('heading', { name: /Bom dia|Boa tarde|Boa noite/ }).waitFor({ timeout: 30000 });
  await page.getByRole('switch', { name: /^Li e aceito os termos/ }).check();
  await page.getByRole('button', { name: 'Aceitar e continuar', exact: true }).click();
  await completeTestSetup(page, {
    officeName: 'Moreira & Lima Advocacia',
    userName: 'Marina Lima',
    officeCity: 'Goiânia/GO',
    officeAddress: 'Av. T-63, nº 1200, Setor Bueno, Goiânia/GO',
    appName: 'Magnum Office',
    appDescription: 'Gestão jurídica',
    lawyers: [{ name: 'Marina Lima', oab: '28471', uf: 'GO', email: 'marina@exemplo.com' }],
    noLogo: true,
  });
  await page.evaluate(async ({ numbers, days }) => {
    const a = window.advocacia;
    await a.saveSettings({
      automatic: false,
      autoDownload: false,
      officeName: 'Moreira & Lima Advocacia',
      userName: 'Marina Lima',
      officeCity: 'Goiânia/GO',
      officeAddress: 'Av. T-63, nº 1200, Setor Bueno, Goiânia/GO',
      lawyers: [
        { name: 'Marina Lima', oab: '28471', uf: 'GO', email: 'marina@exemplo.com' },
        { name: 'Rafael Moreira', oab: '31055', uf: 'GO', email: 'rafael@exemplo.com' },
      ],
    });
    await a.configureBackups({ enabled: false, dailyNotice: false, mode: 'local', recipient: '', acknowledged: true });
    await a.createBackup();
    const people = [
      ['Ana Beatriz Moreira', '52998224725', 'brasileira', 'casada', 'professora'],
      ['Carlos Eduardo Tavares', '11144477735', 'brasileiro', 'solteiro', 'engenheiro'],
      ['Fernanda Lopes Azevedo', '39053344705', 'brasileira', 'divorciada', 'enfermeira'],
      ['João Pedro Nogueira', '82686213035', 'brasileiro', 'casado', 'motorista'],
    ];
    const clients = [];
    for (const [i, [name, document, nationality, maritalStatus, profession]] of people.entries())
      clients.push(
        await a.save({
          kind: 'clients',
          entity: {
            name,
            document,
            nationality,
            maritalStatus,
            profession,
            phone: `6499910${pad2(i)}00`,
            email: `contato${i}@exemplo.com`,
            street: 'Rua 10',
            addressNumber: String(100 + i),
            district: 'Setor Oeste',
            city: 'Goiânia',
            state: 'GO',
            zip: '74120000',
          },
        }),
      );
    function pad2(n) {
      return String(n).padStart(2, '0');
    }
    const cases = [];
    const caseData = [
      {
        title: 'Ação de indenização por danos morais',
        area: 'Consumidor',
        phase: 'Conhecimento',
        court: '3ª Vara Cível',
        county: 'Goiânia',
        opposingParty: 'Banco Exemplo S.A.',
        claimValue: '25.000,00',
        clientRole: 'Polo ativo',
      },
      {
        title: 'Revisional de aluguel',
        area: 'Cível',
        phase: 'Conhecimento',
        court: '7ª Vara Cível',
        county: 'Goiânia',
        opposingParty: 'Imobiliária Horizonte Ltda',
        claimValue: '12.400,00',
        clientRole: 'Polo passivo',
      },
      {
        title: 'Reclamação trabalhista — horas extras',
        area: 'Trabalhista',
        phase: 'Conhecimento',
        court: '12ª Vara do Trabalho',
        county: 'Goiânia',
        opposingParty: 'Transportes Serra Azul S/A',
        claimValue: '48.000,00',
        clientRole: 'Polo ativo',
      },
      {
        title: 'Divórcio consensual',
        area: 'Família',
        phase: 'Pré-processual',
        court: '2ª Vara de Família',
        county: 'Goiânia',
        clientRole: 'Polo ativo',
      },
    ];
    for (const [i, data] of caseData.entries())
      cases.push(
        await a.save({
          kind: 'cases',
          entity: {
            ...data,
            status: 'Em andamento',
            instance: '1º grau',
            number: numbers[i],
            clientId: clients[i].id,
            filedAt: days[-40],
          },
        }),
      );
    const tasks = [
      ['Apresentar contestação', 'Prazo', -2, 'Urgente', 0],
      ['Juntar procuração e documentos', 'Prazo', -1, 'Alta', 1],
      ['Audiência de conciliação', 'Audiência', 0, 'Alta', 0, '14:00'],
      ['Reunião com o cliente', 'Reunião', 0, 'Normal', 3, '16:30'],
      ['Réplica', 'Prazo', 2, 'Urgente', 0],
      ['Manifestação sobre laudo pericial', 'Prazo', 5, 'Alta', 2],
      ['Audiência de instrução', 'Audiência', 8, 'Alta', 2, '09:30'],
      ['Protocolar acordo de divórcio', 'Tarefa', 3, 'Normal', 3],
    ];
    for (const [title, type, offset, priority, c, time = '23:59'] of tasks)
      await a.save({
        kind: 'tasks',
        entity: {
          title,
          type,
          priority,
          status: 'Pendente',
          due: `${days[offset]}T${type === 'Prazo' ? '23:59' : time}`,
          caseId: cases[c].id,
          clientId: clients[c].id,
        },
      });
    for (const [date, name] of [
      [days[-40], 'Distribuído por sorteio'],
      [days[-25], 'Citação'],
      [days[-10], 'Juntada de Petição'],
      [days[-2], 'Conclusão para decisão'],
    ])
      await a.addMovement({ caseId: cases[0].id, date, name });
    await a.save({ kind: 'people', entity: { name: 'Paulo Henrique Souza', role: 'Testemunha', caseId: cases[0].id } });
    await a.save({
      kind: 'people',
      entity: { name: 'Dr. Carlos Lima', role: 'Advogado da parte contrária', oab: '19876/GO', caseId: cases[0].id },
    });
    await a.createInstallments({
      direction: 'Receita',
      category: 'Honorário contratual',
      description: 'Honorários contratuais',
      amount: '6.000,00',
      dueDate: days[-40],
      installments: 4,
      clientId: clients[0].id,
      caseId: cases[0].id,
    });
    await a.save({
      kind: 'finance',
      entity: {
        direction: 'Receita',
        category: 'Consulta',
        description: 'Consulta inicial',
        amount: '350,00',
        dueDate: days[-1],
        paidDate: days[-1],
        method: 'Pix',
        clientId: clients[1].id,
      },
    });
    await a.save({
      kind: 'finance',
      entity: {
        direction: 'Despesa',
        category: 'Custas processuais',
        description: 'Custas iniciais',
        amount: '412,80',
        dueDate: days[-10],
        paidDate: days[-10],
        reimbursable: true,
        clientId: clients[0].id,
        caseId: cases[0].id,
      },
    });
    await a.save({
      kind: 'finance',
      entity: {
        direction: 'Receita',
        category: 'Honorário de êxito',
        description: 'Êxito — 20% do proveito',
        amount: '',
        dueDate: days[20],
        clientId: clients[2].id,
        caseId: cases[2].id,
      },
    });
    const state = await a.state();
    const fees = state.entities.finance.filter(e => e.seriesId).sort((x, y) => x.dueDate.localeCompare(y.dueDate));
    await a.save({ kind: 'finance', entity: { ...fees[0], paidDate: days[-40], method: 'Pix' } });
    await a.save({ kind: 'finance', entity: { ...fees[1], paidDate: days[-10], method: 'Pix' } });
    await a.save({
      kind: 'intakes',
      entity: {
        name: 'Roberto Vilela Santos',
        phone: '64999112233',
        subject: 'Demissão sem pagamento das verbas rescisórias',
        area: 'Trabalhista',
        source: 'Indicação',
        date: days[-2],
        followUp: days[1],
        status: 'Em análise',
      },
    });
    await a.save({
      kind: 'intakes',
      entity: {
        name: 'Larissa Campos Ribeiro',
        phone: '64999445566',
        subject: 'Inventário dos pais',
        area: 'Família',
        source: 'Site',
        date: days[-10],
        status: 'Proposta enviada',
      },
    });
    await a.save({
      kind: 'intakes',
      entity: {
        name: 'Construtora Horizonte Ltda',
        phone: '6232221100',
        subject: 'Cobrança de contrato de obra',
        area: 'Empresarial',
        source: 'Cliente antigo',
        date: days[-25],
        status: 'Contratado',
      },
    });
  }, sample);
  await page.waitForTimeout(1500);
  const nav = name => page.getByRole('navigation').getByRole('button', { name, exact: true }).click();
  const shot = async name => {
    await page.waitForTimeout(500);
    // Toasts from the setup would cover part of the picture.
    for (const close of await page.getByRole('button', { name: 'Fechar aviso' }).all())
      await close.click().catch(() => {});
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(out, `${name}.png`) });
  };
  await nav('Início');
  await shot('inicio');
  await nav('Processos');
  await page
    .getByRole('button', { name: /Ação de indenização/ })
    .first()
    .click();
  await shot('processo');
  await page.getByRole('button', { name: 'Calcular prazo', exact: true }).first().click();
  await page.getByLabel('Data da intimação / publicação').fill(sample.days[-1]);
  await page.getByLabel('Descrição do prazo').fill('Réplica');
  await shot('prazos');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Gerar documento', exact: true }).click();
  await page
    .locator('.modal label.field')
    .filter({ has: page.locator('span', { hasText: /^Modelo$/ }) })
    .locator('select')
    .selectOption({ label: 'Contrato de honorários advocatícios' });
  await page.waitForTimeout(500);
  await page.getByLabel('Objeto do contrato (serviço a ser prestado)').fill('ação de indenização por danos morais');
  await page.getByLabel('Valor dos honorários').fill('6.000,00');
  await page.getByLabel('Forma de pagamento').fill('em quatro parcelas mensais');
  await shot('documentos');
  await page.keyboard.press('Escape');
  await nav('Financeiro');
  await page.getByLabel('Período').selectOption('all');
  await shot('financeiro');
  await nav('Atendimentos');
  await shot('atendimentos');
  await nav('Débitos');
  await page.getByRole('button', { name: 'Atualizar índices', exact: true }).click();
  await page.getByText(/atualizados em/).waitFor({ timeout: 180000 });
  await page.getByLabel('Valor original').fill('25.000,00');
  await page.getByLabel('Desde', { exact: true }).fill('2024-03-15');
  // Up to a month whose index is already published, so the picture shows no missing-index warning.
  await page.getByLabel('Até', { exact: true }).fill('2026-09-30');
  await page.getByLabel('Multa (%)').fill('10');
  await page.getByLabel('Honorários (%)').fill('10');
  await shot('debitos');
  await nav('Relatórios');
  await shot('relatorios');
  // Dark theme of the start page.
  await page.evaluate(() => window.advocacia.saveSettings({ appearance: 'dark' }));
  await nav('Início');
  await page.waitForTimeout(800);
  await shot('inicio-escuro');
  if (errors.length) throw new Error(errors.join('\n'));
  console.log(`Capturas salvas em ${out}`);
} finally {
  await app.close();
  fs.rmSync(root, { recursive: true, force: true });
}
