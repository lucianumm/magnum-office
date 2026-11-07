// Captures every main screen with fictional data in a temporary profile and measures the layout.
// Usage: node scripts/capture-screens.mjs [output folder]
import { _electron as electron } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
const out = path.resolve(process.argv[2] || 'work/telas');
fs.mkdirSync(out, { recursive: true });
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'magnum-telas-'));
const env = { ...process.env, ADVOCACIA_TEST_DATA: root };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ['.'], env, timeout: 60000 });
const report = {};
try {
  const page = await app.firstWindow();
  page.on('pageerror', e => console.log('PAGEERROR', e.message));
  page.on('console', m => { if (m.type() === 'error') console.log('CONSOLE', m.text().slice(0, 300)); });
  await page.getByRole('heading', { name: /Bom dia|Boa tarde|Boa noite/ }).waitFor({ timeout: 30000 });
  await page.getByRole('switch', { name: /^Li e aceito os termos/ }).check();
  await page.getByRole('button', { name: 'Aceitar e continuar', exact: true }).click();
  await page.evaluate(() => window.advocacia.saveSettings({ automatic: false, autoDownload: false }));
  await page.evaluate(() => window.advocacia.configureBackups({ enabled: false, dailyNotice: false, mode: 'local', recipient: '', acknowledged: true }));
  await page.evaluate(async () => {
    const a = window.advocacia;
    const pad = n => String(n).padStart(2, '0');
    const d = o => { const x = new Date(Date.now() + o * 864e5); return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`; };
    await a.saveSettings({ officeName: 'Escritório Exemplo', userName: 'Marina Exemplo' });
    const names = ['Ana Beatriz Moreira', 'Carlos Eduardo Tavares', 'Construtora Horizonte Ltda', 'Fernanda Lopes Azevedo', 'João Pedro Nogueira', 'Larissa Campos Ribeiro', 'Roberto Vilela Santos', 'Transportes Serra Azul S/A'];
    const base = { area: 'Cível', due: d(1) + 'T09:00', type: 'Prazo', priority: 'Normal', emailPreference: 'Receber' };
    const clients = [];
    for (const [i, name] of names.entries()) clients.push(await a.save({ kind: 'clients', entity: { ...base, name, phone: `64999${100000 + i * 1111}`, email: `contato${i}@exemplo.com`, document: `000.000.00${i}-0${i}`, status: i === 6 ? 'Inativo' : 'Ativo' } }));
    const titles = [['Reclamação trabalhista — horas extras', 'Trabalhista'], ['Ação de cobrança — contrato 118', 'Cível'], ['Divórcio consensual', 'Família'], ['Aposentadoria por idade', 'Previdenciário'], ['Execução fiscal — ISS', 'Tributário'], ['Revisional de aluguel', 'Cível']];
    const cases = [];
    for (const [i, [title, area]] of titles.entries()) cases.push(await a.save({ kind: 'cases', entity: { ...base, title, area, number: `000${i}123-45.2026.8.09.00${pad(i)}`, clientId: clients[i].id, status: i === 3 ? 'Aguardando' : 'Em andamento', court: '2ª Vara Cível' } }));
    const tasks = [['Apresentar contestação', 'Prazo', -2, 'Urgente'], ['Juntar procuração', 'Prazo', -1, 'Alta'], ['Audiência de conciliação', 'Audiência', 0, 'Alta'], ['Reunião com cliente', 'Reunião', 0, 'Normal'], ['Réplica', 'Prazo', 2, 'Urgente'], ['Protocolar recurso', 'Prazo', 5, 'Alta'], ['Calcular honorários', 'Tarefa', 8, 'Normal']];
    for (const [i, [title, type, o, priority]] of tasks.entries()) await a.save({ kind: 'tasks', entity: { title, type, priority, status: 'Pendente', due: d(o) + `T${pad(9 + i)}:30`, caseId: cases[i % cases.length].id, clientId: cases[i % cases.length].clientId } });
    await a.save({ kind: 'notes', entity: { title: 'Atendimento inicial', content: 'Cliente trouxe contrato e comprovantes.', caseId: cases[0].id } });
  });
  await page.waitForTimeout(4500);
  const size = (w, h) => app.evaluate(({ BrowserWindow }, [w, h]) => { const b = BrowserWindow.getAllWindows()[0]; b.unmaximize(); b.setSize(w, h); }, [w, h]);
  const metrics = name => page.evaluate(() => {
    const m = document.querySelector('main');
    const first = m.querySelector('.panel,.today-strip,.connection-strip,.courts-filters,.settings-layout,.pdf-assurances,.workspace-tabs');
    const side = document.querySelector('.sidebar');
    const leaf = [...m.querySelectorAll('*')].filter(e => e.children.length === 0 && e.textContent.trim() && e.getBoundingClientRect().width > 0);
    const sizes = leaf.map(e => parseFloat(getComputedStyle(e).fontSize));
    return { win: [innerWidth, innerHeight], firstY: first ? Math.round(first.getBoundingClientRect().top + scrollY) : null, navHidden: side.scrollHeight - side.clientHeight, overflowX: document.scrollingElement.scrollWidth > document.scrollingElement.clientWidth, under12: sizes.filter(x => x < 12).length, nodes: sizes.length, rows: document.querySelectorAll('tbody tr').length ? [...document.querySelectorAll('tbody tr')].filter(r => r.getBoundingClientRect().bottom < innerHeight).length : undefined };
  }).then(v => { report[name] = v; });
  const nav = n => page.getByRole('navigation').getByRole('button', { name: n, exact: true }).click();
  const shot = async name => { await page.waitForTimeout(300); await metrics(name); await page.screenshot({ path: path.join(out, name + '.png') }); };
  const tab = n => page.getByRole('tab', { name: n }).click();
  await size(1460, 980);
  await page.waitForTimeout(400);
  for (const [n, f] of [['Início', 'inicio'], ['Agenda', 'agenda'], ['Clientes', 'clientes'], ['Processos', 'processos'], ['Documentos', 'documentos'], ['Anotações', 'anotacoes'], ['Mensagens', 'mensagens'], ['Tribunais', 'tribunais'], ['PDF', 'pdf']]) { await nav(n); await shot('d-' + f); }
  await nav('Agenda'); await tab('Lista'); await shot('d-agenda-lista');
  await nav('Clientes'); await page.locator('.person-cell').last().click(); await shot('d-cliente-detalhe');
  await tab(/Prazos/); await shot('d-cliente-prazos');
  await nav('Processos'); await page.locator('.cell-open').first().click(); await shot('d-processo-detalhe');
  await page.getByRole('button', { name: 'Configurações', exact: true }).click(); await page.getByRole('button',{name:'Agora não',exact:true}).click(); await shot('d-config');
  for (const [n, f] of [['Atualizações', 'atualizacoes'], ['Backups e recuperação', 'backups'], ['Personalizar', 'personalizar'], ['Importar dados', 'importar'], ['Sobre o sistema', 'sobre'], ['Lucianum Magnum', 'servicos'], ['Apoie o projeto', 'apoio']]) { await tab(n); await shot('d-' + f); }
  await nav('Clientes'); await page.getByRole('button', { name: 'Novo cliente', exact: true }).click(); await shot('d-novo-cliente'); await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /^Avisos/ }).click(); await shot('d-avisos'); await page.mouse.click(800, 700);
  await page.getByLabel('Buscar em todo o escritório').fill('ana'); await shot('d-busca'); await page.getByLabel('Buscar em todo o escritório').fill('');
  await size(1040, 700);
  await page.waitForTimeout(400);
  for (const [n, f] of [['Início', 'inicio'], ['Clientes', 'clientes'], ['Agenda', 'agenda'], ['Mensagens', 'mensagens']]) { await nav(n); await shot('m-' + f); }
  await size(1460, 980);
  await page.evaluate(() => window.advocacia.saveSettings({ appearance: 'dark', theme: 'purple' }));
  await page.waitForTimeout(4500);
  for (const [n, f] of [['Início', 'inicio'], ['Mensagens', 'mensagens'], ['Clientes', 'clientes']]) { await nav(n); await shot('e-' + f); }
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 1));
  console.log(JSON.stringify(report));
} finally { await app.close(); }
