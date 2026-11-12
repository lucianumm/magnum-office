// Interface test of the severance calculator and of the lookups by case number and CNPJ. The public
// services are simulated inside the main process: the test never uses the internet.
import { _electron as electron, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { prepareTestApp } from './test-helpers.mjs';
const base = path.resolve('work/tools-smoke');
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
  await app.evaluate(({ net }) => {
    net.fetch = async url => {
      const json = body => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
      if (String(url).includes('api-publica.datajud.cnj.jus.br'))
        return json({
          hits: {
            hits: [
              {
                _source: {
                  tribunal: 'TRT18',
                  grau: 'G1',
                  dataAjuizamento: '20240115093000',
                  classe: { nome: 'Ação Trabalhista - Rito Ordinário' },
                  orgaoJulgador: { nome: 'Rio Verde - 01a Vara' },
                  assuntos: [{ nome: 'Horas Extras' }],
                  movimentos: [],
                },
              },
            ],
          },
        });
      if (String(url).includes('brasilapi.com.br'))
        return json({
          razao_social: 'EMPRESA EXEMPLO LTDA',
          descricao_situacao_cadastral: 'ATIVA',
          descricao_tipo_de_logradouro: 'AVENIDA',
          logradouro: 'GOIAS',
          numero: '100',
          bairro: 'SETOR CENTRAL',
          municipio: 'GOIANIA',
          uf: 'GO',
          cep: '74000000',
          qsa: [{ nome_socio: 'MARIA DA SILVA', qualificacao_socio: 'Sócio-Administrador' }],
        });
      throw new Error('Rede inesperada no teste: ' + url);
    };
  });

  // Severance: the hand-checked case of tests/labor.test.cjs, and the PDF in Documents.
  await page.getByRole('button', { name: 'Rescisão', exact: true }).first().click();
  await page.getByLabel('Admissão', { exact: true }).fill('2022-03-10');
  await page.getByLabel('Último dia trabalhado', { exact: true }).fill('2025-08-20');
  await page.getByLabel('Salário mensal', { exact: true }).fill('3.000,00');
  await page.getByLabel('Férias vencidas não gozadas', { exact: true }).fill('1');
  await page.getByLabel(/^Saldo do FGTS para a multa/).fill('9.000,00');
  await expect(page.locator('.deadline-answer strong')).toHaveText('R$ 18.996,13');
  await page.getByRole('button', { name: 'Salvar PDF' }).click();
  await page.getByText('Memória de cálculo da rescisão salva').waitFor();
  const docs = (await page.evaluate(() => window.advocacia.state())).entities.documents.map(d => d.name);
  assert.deepEqual(docs, ['Cálculo de rescisão 20-08-2025.pdf']);

  // Case form: the lookup buttons fill only the empty fields.
  await page.getByRole('button', { name: 'Processos', exact: true }).first().click();
  await page
    .getByRole('button', { name: /Cadastrar processo|Novo processo/ })
    .first()
    .click();
  const form = page.getByRole('dialog');
  await form.getByLabel('Título do processo').fill('Reclamação trabalhista');
  await form.getByLabel(/Vara \/ órgão julgador/).fill('Digitado pelo escritório');
  await form.getByLabel(/Número do processo/).fill('00100016920245180101');
  await form.getByRole('button', { name: 'Buscar no DataJud' }).click();
  await expect(form.locator('.lookup-note').first()).toContainText('Encontrado no DataJud (TRT18)');
  await expect(form.getByLabel(/Comarca/)).toHaveValue('Rio Verde');
  await expect(form.getByLabel(/Classe \/ rito/)).toHaveValue('Ação Trabalhista - Rito Ordinário');
  await expect(form.getByLabel(/Vara \/ órgão julgador/)).toHaveValue('Digitado pelo escritório');
  await form.getByLabel(/CPF \/ CNPJ da parte contrária/).fill('11222333000181');
  await form.getByRole('button', { name: 'Buscar dados da empresa' }).click();
  await expect(form.getByLabel(/^Parte contrária/)).toHaveValue('EMPRESA EXEMPLO LTDA');
  process.stdout.write('Ferramentas verificadas: rescisão com PDF e preenchimento por número do processo e CNPJ.\n');
} finally {
  if (app) await app.close();
}
