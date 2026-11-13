// WhatsApp: audiência com aviso ao cliente (janela de confirmação), modelos por finalidade e campanhas.
import { _electron as electron, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { prepareTestApp } from './test-helpers.mjs';
const base = path.resolve('work/whatsapp-smoke');
await fs.mkdir(base, { recursive: true });
const root = await fs.mkdtemp(path.join(base, 'run-'));
const env = { ...process.env, ADVOCACIA_TEST_DATA: root };
delete env.ELECTRON_RUN_AS_NODE;
const executablePath = process.argv[2] ? path.resolve(process.argv[2]) : null;
const pad = n => String(n).padStart(2, '0');
const inDays = n => {
  const d = new Date(Date.now() + n * 86400000);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
let app;
try {
  app = await electron.launch({
    ...(executablePath ? { executablePath, args: [`--data-dir=${root}`] } : { args: ['.'] }),
    env,
  });
  const page = await app.firstWindow();
  await page.getByRole('heading', { name: /Bom dia|Boa tarde|Boa noite/ }).waitFor();
  await prepareTestApp(page);
  await page.evaluate(() => window.advocacia.saveSettings({ queuePaused: true, officeName: 'Escritório de teste' }));
  const nav = async name => page.getByRole('navigation').getByRole('button', { name, exact: true }).click();
  await page.evaluate(() =>
    window.advocacia.save({
      kind: 'clients',
      entity: { name: 'Ana Souza', phone: '5564999990000', status: 'Ativo', emailPreference: 'Receber' },
    }),
  );

  // Audiência com aviso: a janela mostra a confirmação e os lembretes antes de agendar.
  await nav('Agenda');
  await page.getByRole('tab', { name: 'Lista', exact: true }).click();
  await page.getByRole('button', { name: 'Novo compromisso', exact: true }).click();
  await page.getByLabel('Título do compromisso').fill('Audiência de instrução');
  await page.getByLabel('Data e horário').fill(`${inDays(12)}T14:30`);
  await page.locator('label.field', { hasText: /^Tipo/ }).locator('select').selectOption('Audiência');
  await page.getByLabel('Espécie').selectOption('de instrução e julgamento');
  await page.getByLabel('Modalidade').selectOption('presencial');
  await page.getByLabel('Local ou endereço').fill('Fórum de Goiânia, sala 3');
  await page.getByLabel('Cliente vinculado').selectOption({ label: 'Ana Souza' });
  await page.getByRole('switch', { name: /Avisar o cliente por WhatsApp/ }).check();
  await page.getByRole('button', { name: 'Salvar compromisso', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Avisar o cliente' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Ana Souza')).toBeVisible();
  await expect(dialog.locator('textarea').first()).toHaveValue(
    /audiência de instrução e julgamento.*Fórum de Goiânia, sala 3/s,
  );
  await page.screenshot({ path: path.join(base, 'aviso-ao-cliente.png') });
  await dialog.getByRole('button', { name: 'Agendar avisos', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  let state = await page.evaluate(() => window.advocacia.state());
  const mine = state.messages.filter(m => m.status === 'pending');
  assert.equal(mine.length, 4, 'confirmação + lembretes de 7 dias, 1 dia e 2 horas');
  assert.equal(mine.filter(m => !m.scheduledFor).length, 1);
  const task = state.entities.tasks.find(t => t.title === 'Audiência de instrução');
  assert.equal(task.confirmationStatus, 'awaiting');

  // Modelos por finalidade
  await nav('Documentos');
  await page.getByRole('tab', { name: 'Modelos de WhatsApp', exact: true }).click();
  await page.getByRole('button', { name: 'Redigir modelo', exact: true }).click();
  await page.getByLabel('Finalidade do modelo').selectOption('event-reminder');
  await page.getByLabel('Texto do modelo de WhatsApp').fill('Oi {nome_cliente}');
  await page.getByLabel('Título do modelo').fill('Lembrete errado');
  await page.getByRole('button', { name: 'Salvar modelo', exact: true }).click();
  await expect(page.getByText(/Variável desconhecida: \{nome_cliente\}/)).toBeVisible();
  await page.getByLabel('Texto do modelo de WhatsApp').fill('Oi {primeiro_nome}, {evento} em {data}.');
  await page.getByRole('button', { name: 'Salvar modelo', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // Campanhas
  await nav('Mensagens');
  await page.getByRole('button', { name: 'Campanhas', exact: true }).click();
  const campaigns = page.getByRole('dialog', { name: 'Campanhas de WhatsApp' });
  await expect(campaigns.getByText('Nenhuma campanha ainda')).toBeVisible();
  await campaigns.getByRole('button', { name: 'Nova campanha', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Nova campanha' });
  await editor.getByLabel('Nome da campanha').fill('Dia do Advogado');
  await editor.locator('textarea').first().fill('Olá, {primeiro_nome}! Feliz Dia do Advogado.');
  await editor.getByLabel('Quando enviar').selectOption('calendar');
  await editor
    .locator('label.field', { hasText: /^Data comemorativa/ })
    .locator('select')
    .selectOption('lawyer');
  await editor.getByRole('button', { name: 'Ver quem recebe', exact: true }).click();
  await expect(editor.getByText(/Vai para 1 cliente/)).toBeVisible();
  await page.screenshot({ path: path.join(base, 'campanha.png') });
  await editor.getByRole('button', { name: 'Salvar campanha', exact: true }).click();
  await expect(campaigns.getByText('Dia do Advogado', { exact: true })).toBeVisible();
  await campaigns.getByRole('button', { name: 'Ativar', exact: true }).click();
  await expect(campaigns.getByText('Ativa', { exact: true })).toBeVisible();
  await campaigns
    .getByRole('tab', { name: /Próximos 30 dias/ })
    .or(campaigns.getByRole('button', { name: /Próximos 30 dias/ }))
    .click();
  state = await page.evaluate(() => window.advocacia.campaignList());
  assert.equal(state.length, 1);
  assert.equal(state[0].status, 'active');
  process.stdout.write('WhatsApp: aviso ao cliente na agenda, modelos por finalidade e campanhas verificados.\n');
} finally {
  if (app) await app.close();
}
