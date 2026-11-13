// Interface test: papel timbrado (cabeçalho, rodapé, imagem, numeração) e opções de fonte ao gerar documentos.
import { _electron as electron, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import assert from 'node:assert/strict';
import { prepareTestApp } from './test-helpers.mjs';
const base = path.resolve('work/letterhead-smoke');
await fs.mkdir(base, { recursive: true });
const root = await fs.mkdtemp(path.join(base, 'run-'));
const executablePath = process.argv[2] ? path.resolve(process.argv[2]) : null;
const env = { ...process.env, ADVOCACIA_TEST_DATA: root };
delete env.ELECTRON_RUN_AS_NODE;

// A small PNG (a red banner) made on the spot.
function png(width, height) {
  const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(body) >>> 0);
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: width }, () => [150, 30, 30]).flat())]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(Buffer.concat(Array.from({ length: height }, () => row)))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
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
    '<h2>PROCURAÇÃO</h2><p>Outorgante: {cliente.nome}</p>' +
    '<p>Texto da procuração com acentuação: ação, “aspas”, § 1º.</p>'.repeat(30);
  await page.evaluate(
    ([html, groupId]) =>
      window.advocacia.saveTemplate({ title: 'CARTA TIMBRADA', kind: 'document', groupId, html, body: 'Procuração' }),
    [html, groups[0]?.id],
  );
  await page.evaluate(() =>
    window.advocacia.save({ kind: 'clients', entity: { name: 'Ana Souza', phone: '5564999990000', status: 'Ativo' } }),
  );
  // Create the letterhead through the screen: Configurações → Papel timbrado.
  await page.getByRole('button', { name: 'Configurações', exact: true }).first().click();
  await page
    .getByRole('button', { name: 'Agora não', exact: true })
    .click({ timeout: 3000 })
    .catch(() => {});
  await page.getByRole('tab', { name: 'Papel timbrado' }).click();
  await expect(page.getByText('Nenhum papel timbrado')).toBeVisible();
  // The image is chosen with a native dialog; the test hands the same data to the saving command instead.
  await page.evaluate(
    data =>
      window.advocacia.saveLetterhead({
        name: 'Papel do escritório',
        paper: 'a4',
        margins: { top: 3, right: 2, bottom: 2, left: 3 },
        firstPageDifferent: true,
        pageNumbers: 'all',
        pageNumberAlign: 'center',
        watermark: '',
        header: { cols: ['Escritório de teste', '', 'OAB/GO 12345'], image: { data, heightMm: 18, align: 'left' } },
        continuation: { cols: ['Escritório de teste', '', '{cliente.nome}'] },
        footer: { cols: ['Rua A, 10 - Goiânia', '', 'www.exemplo.adv.br'], image: null },
      }),
    png(240, 60).toString('base64'),
  );
  await page.reload();
  await page.getByRole('heading', { name: /Bom dia|Boa tarde|Boa noite/ }).waitFor();
  await page.getByRole('button', { name: 'Configurações', exact: true }).first().click();
  await page
    .getByRole('button', { name: 'Agora não', exact: true })
    .click({ timeout: 3000 })
    .catch(() => {});
  await page.getByRole('tab', { name: 'Papel timbrado' }).click();
  await expect(page.getByText('Papel do escritório')).toBeVisible();
  await expect(page.getByText('Padrão', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Editar', exact: true }).click();
  await expect(page.getByLabel('Prévia da página')).toBeVisible();
  await page.screenshot({ path: path.join(base, 'papel-timbrado.png') });
  await page.getByRole('dialog').getByRole('button', { name: 'Fechar' }).click();

  // Generate a document with the letterhead and a chosen font.
  await page.getByRole('button', { name: 'Documentos', exact: true }).first().click();
  await page.getByRole('tab', { name: 'Modelos jurídicos' }).click();
  await page
    .locator('.template-card', { hasText: 'CARTA TIMBRADA' })
    .getByRole('button', { name: 'Gerar documento' })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Gerar documento' });
  await dialog.getByLabel('Cliente').selectOption({ label: 'Ana Souza' });
  await expect(dialog.getByLabel('Papel timbrado')).toHaveValue(/.+/);
  await expect(dialog.getByLabel('Prévia do documento')).toContainText('Escritório de teste');
  await expect(dialog.getByLabel('Prévia do documento')).toContainText('Rua A, 10 - Goiânia');
  await dialog.getByLabel('Fonte').selectOption('Arial');
  await dialog.getByLabel('Entrelinhas').selectOption('1.15');
  await dialog
    .getByLabel('Fonte')
    .selectOption('Fonte Que Nao Existe')
    .catch(() => {});
  await page.screenshot({ path: path.join(base, 'gerar-documento.png') });
  await dialog.getByLabel('Fonte').selectOption('Arial');
  await dialog.getByRole('checkbox', { name: /PDF/ }).check();
  await dialog.getByRole('button', { name: 'Gerar e salvar' }).click();
  await expect(page.getByRole('dialog', { name: 'Documento gerado' })).toBeVisible();
  const state = await page.evaluate(() => window.advocacia.state());
  const generated = state.entities.documents.filter(d => /CARTA TIMBRADA/.test(d.name));
  assert.deepEqual(generated.map(d => d.name.split('.').pop()).sort(), ['docx', 'pdf']);
  assert.ok(generated.every(d => d.generation.layout.family === 'Arial' && d.generation.layout.lineSpacing === 1.15));
  process.stdout.write(
    'Papel timbrado: cadastro, prévia da página e documento gerado em DOCX e PDF com fonte e entrelinhas verificados.\n',
  );
} finally {
  if (app) await app.close();
}
