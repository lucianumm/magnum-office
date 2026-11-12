// Interface test of document generation: separate fields for generic questions and a document
// generated from a template without client or case.
import { _electron as electron, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { prepareTestApp } from './test-helpers.mjs';
const base = path.resolve('work/documents-smoke');
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
  const groups = (await page.evaluate(() => window.advocacia.state())).library.groups;
  const html =
    '<h2>FICHA DE ATENDIMENTO</h2><p>Reclamante: {cliente.nome}</p><p>Telefone / WhatsApp: {?Pergunta}</p>' +
    '<p>Reclamada (Empresa): {?Pergunta}</p><p>Nº de Funcionários: {?Pergunta}</p><p>Processo nº {processo.numero}</p>';
  await page.evaluate(
    ([html, groupId]) =>
      window.advocacia.saveTemplate({ title: 'ENTREVISTA', kind: 'document', groupId, html, body: 'Ficha' }),
    [html, groups[0]?.id],
  );
  await page.reload();
  await page.getByRole('heading', { name: /Bom dia|Boa tarde|Boa noite/ }).waitFor();
  await page.getByRole('button', { name: 'Documentos', exact: true }).first().click();
  await page.getByRole('tab', { name: 'Modelos jurídicos' }).click();
  await page
    .locator('.template-card', { hasText: 'ENTREVISTA' })
    .getByRole('button', { name: 'Gerar documento' })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Gerar documento' });
  await dialog.waitFor();
  // Each generic question is its own field, named after the text before it.
  for (const label of ['Telefone / WhatsApp', 'Reclamada (Empresa)', 'Nº de Funcionários'])
    await expect(dialog.getByLabel(label, { exact: true })).toBeVisible();
  await dialog.getByLabel('Nome do cliente', { exact: true }).fill('Maria Teste');
  await dialog.getByLabel('Telefone / WhatsApp', { exact: true }).fill('(62) 99999-0000');
  await dialog.getByLabel('Nº de Funcionários', { exact: true }).fill('40');
  const preview = dialog.locator('.document-preview');
  await expect(preview).toContainText('Reclamante: Maria Teste');
  await expect(preview).toContainText('Telefone / WhatsApp: (62) 99999-0000');
  await expect(preview).toContainText('Nº de Funcionários: 40');
  await expect(preview).toContainText('Reclamada (Empresa): __________');
  await dialog.getByRole('button', { name: 'Gerar e salvar' }).click();
  const done = page.getByRole('dialog', { name: 'Documento gerado' });
  await expect(done).toContainText('sem vínculo com cadastro');
  await expect(done).toContainText('ENTREVISTA - Maria Teste.docx');
  const saved = (await page.evaluate(() => window.advocacia.state())).entities.documents;
  assert.deepEqual(
    saved.map(d => [d.name, d.clientId, d.caseId]),
    [['ENTREVISTA - Maria Teste.docx', '', '']],
  );
  process.stdout.write('Documentos verificados: perguntas separadas e documento gerado sem cadastro.\n');
} finally {
  if (app) await app.close();
}
