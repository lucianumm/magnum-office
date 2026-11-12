// Interface test of the 1.11 screens: limitation notice, board by phase, hours and billing, trash,
// liquidation, signing card, daily summary and the program password with lock and unlock.
import { _electron as electron, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { prepareTestApp } from './test-helpers.mjs';
const base = path.resolve('work/new-features-smoke');
await fs.mkdir(base, { recursive: true });
const root = await fs.mkdtemp(path.join(base, 'run-'));
const shots = base;
const env = { ...process.env, ADVOCACIA_TEST_DATA: root };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ['.'], env });
const errors = [];
const step = async (name, task) => {
  try {
    await task();
    console.log('OK   ', name);
  } catch (e) {
    errors.push(name);
    console.log('FALHA', name, '-', e.message.split('\n')[0]);
  }
};
const home = page => page.getByRole('heading', { name: /Bom dia|Boa tarde|Boa noite/ }).waitFor();
try {
  const page = await app.firstWindow();
  globalThis.currentPage = page;
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await home(page);
  await prepareTestApp(page);
  const client = await page.evaluate(() =>
    window.advocacia.save({
      kind: 'clients',
      entity: { name: 'Ana Souza', phone: '5564999990000', status: 'Ativo', emailPreference: 'Receber' },
    }),
  );
  const caseItem = await page.evaluate(
    id =>
      window.advocacia.save({
        kind: 'cases',
        entity: {
          title: 'Reclamação trabalhista',
          status: 'Em andamento',
          area: 'Trabalhista',
          clientId: id,
          phase: 'Conhecimento',
          factDate: '2025-01-20',
          limitationRule: 'trabalhista',
        },
      }),
    client.id,
  );
  await page.reload();
  await home(page);
  await step('aviso de prescrição no início', async () => {
    await page
      .getByRole('button', { name: /avisos|Avisos|notifica/i })
      .first()
      .click();
    await expect(page.getByText(/prazo de prescrição próximo/)).toBeVisible();
    await page.keyboard.press('Escape');
  });
  await page.screenshot({ path: path.join(shots, 'inicio.png') });
  await step('quadro por fase', async () => {
    await page.getByRole('button', { name: 'Processos', exact: true }).first().click();
    await page.getByRole('button', { name: 'Ver quadro por fase' }).click();
    const card = page.locator('.board-card', { hasText: 'Reclamação trabalhista' });
    await expect(card).toBeVisible();
    await card.focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('.board-column', { hasText: 'Recursal' }).locator('.board-card')).toHaveCount(1);
    await page.screenshot({ path: path.join(shots, 'quadro.png') });
    await page.getByRole('button', { name: 'Ver em lista' }).click();
  });
  await step('horas e cobrança', async () => {
    await page.evaluate(
      id =>
        window.advocacia.save({
          kind: 'time',
          entity: {
            caseId: id,
            date: '2026-11-10',
            minutes: '90',
            description: 'Petição inicial',
            lawyer: 'Pessoa de Teste',
            rate: '300,00',
          },
        }),
      caseItem.id,
    );
    await page.reload();
    await home(page);
    await page.getByRole('button', { name: 'Processos', exact: true }).first().click();
    await page.getByText('Reclamação trabalhista').first().click();
    await page.getByRole('tab', { name: /Horas/ }).click();
    await expect(page.getByText('A cobrar: 1h30 · R$ 450,00')).toBeVisible();
    await page.screenshot({ path: path.join(shots, 'horas.png') });
    await page.getByRole('button', { name: 'Gerar cobrança' }).click();
    await expect(page.getByText(/cobrado/)).toBeVisible();
    const fin = (await page.evaluate(() => window.advocacia.state())).entities.finance;
    if (fin.length !== 1 || fin[0].amount !== '450.00') throw new Error('cobrança: ' + JSON.stringify(fin));
  });
  await step('lixeira com restauração', async () => {
    const note = await page.evaluate(() =>
      window.advocacia.save({ kind: 'notes', entity: { title: 'Nota para excluir', content: 'x' } }),
    );
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({ response: 1 });
    });
    await page.evaluate(id => window.advocacia.remove({ kind: 'notes', id }), note.id);
    const trash = await page.evaluate(() => window.advocacia.trashList());
    if (trash.length !== 1) throw new Error('lixeira vazia');
    await page.evaluate(id => window.advocacia.restoreTrash(id), note.id);
    if ((await page.evaluate(() => window.advocacia.state())).entities.notes.length !== 1)
      throw new Error('não restaurou');
  });
  await step('liquidação', async () => {
    await page.getByRole('button', { name: 'Liquidação', exact: true }).first().click();
    await page.getByLabel('Salário mensal', { exact: true }).fill('2.200,00');
    await page.getByLabel('Horas extras por mês (média)', { exact: true }).fill('20');
    await page.getByLabel('Dias de aviso indenizado', { exact: true }).fill('30');
    await expect(page.locator('.deadline-answer strong')).toHaveText('R$ 5.915,47');
    await page.screenshot({ path: path.join(shots, 'liquidacao.png') });
  });
  const click = async locator => {
    console.log('  clicando', String(locator));
    await locator.click({ timeout: 8000 });
  };
  await step('assinatura, resumo, lixeira e senha nas telas', async () => {
    await click(page.getByRole('button', { name: 'PDF', exact: true }).first());
    await expect(page.getByText('Assinar PDF com certificado A1')).toBeVisible();
    await click(page.getByRole('button', { name: 'Configurações', exact: true }).first());
    const later = page.getByRole('button', { name: 'Agora não' });
    if (await later.isVisible().catch(() => false)) await later.click();
    console.log('  abas:', (await page.getByRole('tab').allTextContents()).join(', '));
    await click(page.getByRole('tab', { name: 'Resumo diário' }));
    await click(page.getByRole('button', { name: 'Ver o resumo de hoje' }));
    await expect(page.locator('.digest-preview')).toContainText('Bom dia!');
    await page.screenshot({ path: path.join(shots, 'resumo.png') });
    await click(page.getByRole('tab', { name: 'Lixeira' }));
    await expect(page.getByText('A lixeira está vazia')).toBeVisible();
    await click(page.getByRole('tab', { name: 'Senha do programa' }));
    await page.getByLabel('Senha', { exact: true }).fill('segredo1');
    await page.getByLabel('Confirme a senha', { exact: true }).fill('segredo1');
    await click(page.getByRole('button', { name: 'Ativar senha' }));
    await expect(page.getByRole('button', { name: 'Bloquear agora' })).toBeVisible();
  });
  await step('bloqueio e desbloqueio', async () => {
    await page.keyboard.press('Control+l');
    await expect(page.getByRole('heading', { name: /está bloqueado/ })).toBeVisible();
    const blocked = await page.evaluate(() =>
      window.advocacia.trashList().then(
        () => 'liberado',
        e => e.message,
      ),
    );
    if (!/bloqueado/.test(blocked)) throw new Error('IPC não bloqueado: ' + blocked);
    await page.screenshot({ path: path.join(shots, 'bloqueio.png') });
    await page.getByLabel('Senha').fill('errada');
    await page.getByRole('button', { name: 'Desbloquear' }).click();
    await expect(page.getByText('Senha incorreta.')).toBeVisible();
    await page.getByLabel('Senha').fill('segredo1');
    await page.getByRole('button', { name: 'Desbloquear' }).click();
    await expect(page.getByRole('heading', { name: /está bloqueado/ })).toHaveCount(0);
  });
} finally {
  await app.close();
  if (errors.length) {
    console.log('ERROS: ' + errors.join(' | '));
    process.exitCode = 1;
  } else
    console.log(
      'Funções da 1.11 verificadas: prescrição, quadro, horas, lixeira, liquidação, assinatura, resumo e senha.',
    );
}
