// Interface test: WhatsApp e E-mail em painéis separados (cada um com seus modelos) e financeiro com senha e meses retráteis.
import { _electron as electron, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { prepareTestApp } from './test-helpers.mjs';
const base = path.resolve('work/panels-smoke');
await fs.mkdir(base, { recursive: true });
const root = await fs.mkdtemp(path.join(base, 'run-'));
const executablePath = process.argv[2] ? path.resolve(process.argv[2]) : null;
const env = { ...process.env, ADVOCACIA_TEST_DATA: root };
delete env.ELECTRON_RUN_AS_NODE;
let app;
try {
  app = await electron.launch({
    ...(executablePath ? { executablePath, args: [`--data-dir=${root}`] } : { args: ['.'] }),
    env,
  });
  const page = await app.firstWindow();
  await page.getByRole('heading', { name: /Bom dia|Boa tarde|Boa noite/ }).waitFor();
  await prepareTestApp(page);
  const nav = name => page.getByRole('navigation').getByRole('button', { name, exact: true }).click();

  // Painéis separados
  await nav('WhatsApp');
  await expect(page.getByRole('heading', { name: 'WhatsApp', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Conectar WhatsApp', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Campanhas', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Campanha de e-mail', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Configurar e-mail', exact: true })).toHaveCount(0);
  await page.getByRole('tab', { name: 'Modelos de WhatsApp', exact: true }).click();
  await expect(page.locator('.template-card', { hasText: 'Audiência inicial — presencial' }).first()).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Modelos de e-mail' })).toHaveCount(0);
  await page.screenshot({ path: path.join(base, 'whatsapp.png') });

  await nav('E-mail');
  await expect(page.getByRole('heading', { name: 'E-mail', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Campanha de e-mail', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Configurar e-mail', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Conectar WhatsApp', exact: true })).toHaveCount(0);
  await page.getByRole('tab', { name: 'Modelos de e-mail', exact: true }).click();
  await expect(page.locator('.template-card', { hasText: 'Audiência inicial' })).toHaveCount(0);
  await page.screenshot({ path: path.join(base, 'email.png') });

  await nav('Documentos');
  await expect(page.getByRole('tab', { name: 'Modelos jurídicos', exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Modelos de WhatsApp' })).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'Modelos de e-mail' })).toHaveCount(0);

  // Financeiro com senha
  await page.evaluate(() =>
    window.advocacia.save({
      kind: 'finance',
      entity: {
        description: 'Honorários do contrato',
        direction: 'Receita',
        category: 'Honorário contratual',
        amount: '1500',
        dueDate: new Date().toISOString().slice(0, 10),
      },
    }),
  );
  await page.evaluate(() => window.advocacia.setFinancePassword({ password: 'segredo123' }));
  await page.evaluate(() => window.advocacia.lockFinance());
  await nav('Financeiro');
  await expect(page.getByText('Financeiro protegido por senha')).toBeVisible();
  await expect(page.getByText('Honorários do contrato')).toHaveCount(0);
  assert.equal(
    (await page.evaluate(() => window.advocacia.state())).entities.finance.length,
    0,
    'the money is not handed to the window',
  );
  await nav('Relatórios');
  await expect(page.getByText('Financeiro protegido por senha')).toBeVisible();
  await expect(page.getByText('Recebido', { exact: true })).toHaveCount(0);
  await page.screenshot({ path: path.join(base, 'relatorio-protegido.png') });
  await page.getByLabel('Senha do financeiro').fill('errada');
  await page.getByRole('button', { name: 'Abrir financeiro', exact: true }).click();
  await expect(page.getByText('Senha incorreta.')).toBeVisible();
  await page.getByLabel('Senha do financeiro').fill('segredo123');
  await page.getByRole('button', { name: 'Abrir financeiro', exact: true }).click();
  await expect(page.getByText('Financeiro protegido por senha')).toHaveCount(0);
  await expect(page.getByText('Recebido', { exact: true }).first()).toBeVisible();
  // Meses retráteis: os 3 últimos, todos os 12 e recolher.
  await expect(page.locator('.report-table tbody tr')).toHaveCount(3);
  await page.getByRole('button', { name: /Mostrar os 12 meses/ }).click();
  await expect(page.locator('.report-table tbody tr')).toHaveCount(12);
  await page.getByRole('button', { name: 'Recolher', exact: true }).click();
  await expect(page.locator('.report-table')).toHaveCount(0);
  await page.getByRole('button', { name: 'Expandir', exact: true }).click();
  await expect(page.locator('.report-table')).toBeVisible();
  await nav('Financeiro');
  await expect(page.getByText('Honorários do contrato')).toBeVisible();
  await page.getByRole('button', { name: 'Bloquear financeiro', exact: true }).click();
  await expect(page.getByText('Financeiro protegido por senha')).toBeVisible();
  process.stdout.write('Painéis separados de WhatsApp e E-mail, financeiro com senha e meses retráteis verificados.\n');
} finally {
  if (app) await app.close();
}
