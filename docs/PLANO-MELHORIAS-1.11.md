# Plano de melhoria — depois da 1.10 (correções, melhorias e novas funções)

Data: 12/11/2026 · Base: `main` em `a00ed7e` (código da 1.10 mesclado, versão ainda 1.9.1).
Situação: **implementado na versão 1.11.0** (ainda não publicada), exceto M12 (certificado de assinatura, depende de compra), A1 (uso em rede, depende de decisão) e a parte macOS do N8 (conta da Apple).

Como ler: cada item traz o **problema** (com a evidência no código, quando há), a **proposta**, os
**arquivos** envolvidos, o **critério de aceite** e o **esforço** (P = até 1 dia, M = 2 a 4 dias,
G = 1 a 2 semanas, GG = mais de 2 semanas). Os itens marcados *(sugestão)* não vêm de defeito
encontrado: são ideias de produto e dependem da sua decisão.

## Resumo

| Fase | Objetivo | Itens | Versão |
|---|---|---|---|
| 0 | Publicar o que já está pronto | F0.1 a F0.4 | 1.10.0 |
| 1 | Corrigir e blindar o que foi entregue | C1 a C9 | 1.10.1 |
| 2 | Melhorar o que já existe | M1 a M12 | 1.11.0 |
| 3 | Novas funções | N1 a N9 | 1.12.0 em diante |
| 4 | Mudança de arquitetura | A1 | 2.0 |

Ordem recomendada dentro de cada fase: a da tabela de cada seção (prioridade decrescente).

---

## Fase 0 — Publicar a 1.10.0

O código dos 6 itens do plano anterior está no `main`, mas nenhum usuário recebeu.

### F0.1 Número da versão e CHANGELOG — P
- **Problema:** `package.json` ainda diz `1.9.1` (`app/version.cjs` lê de lá); o CHANGELOG não tem a 1.10.0.
  O `release.yml` monta as notas a partir da seção `## 1.10.0` do CHANGELOG: sem ela, a release sai sem texto.
- **Proposta:** subir para `1.10.0`, escrever a entrada (atualização, perguntas, documento avulso,
  buscas, rescisão) e a linha no histórico do README.
- **Aceite:** `npm run check` passa; `gh release view` mostra as notas certas no rascunho.

### F0.2 Aviso de instalação manual — P
- **Problema:** o guardião que roda na atualização é o da versão **instalada**. Quem está na 1.9.x com
  a atualização travada depende só da correção do `custom.nsh`, que não foi testada com instalação dupla.
- **Proposta:** primeira linha das notas da 1.10.0: "Se a atualização não concluir, baixe o instalador
  e instale por cima, na mesma pasta. Seus dados são preservados." Repetir no README.
- **Aceite:** texto presente nas notas e em `docs/ATUALIZACOES.md`.

### F0.3 Versão dos termos e da política de privacidade — P (decisão sua)
- **Problema:** `docs/PRIVACIDADE.md` ganhou duas consultas novas (número do processo e CNPJ), mas o
  cabeçalho segue "Versão: 1.1.0" e `app/terms.json` segue `1.0.0`. O aceite dos termos é comparado
  por versão (`termsAcceptedVersion`): sem mudar a versão, ninguém é avisado.
- **Proposta:** como as consultas vêm desligadas e só enviam o número digitado, basta subir a versão
  da política (não a dos termos) e citar a mudança nas novidades. Se preferir novo aceite, subir `terms.json`.
- **Aceite:** decisão registrada no CHANGELOG.

### F0.4 Arquivos fora do Git — P (decisão sua)
- **Problema:** `.dockerignore`, `docker/Dockerfile` e `database/README.md` estão na pasta e nunca
  foram commitados. O Dockerfile roda `npm run check` em Linux; o README descreve as tabelas.
- **Proposta:** commitar os três (são úteis e não têm dados) ou apagar. Hoje ficam no limbo.

---

## Fase 1 — Correções e blindagem (1.10.1)

| # | Item | Prioridade | Esforço |
|---|---|---|---|
| C1 | Cenários que o teste de atualização não cobre | Alta | M |
| C2 | Diagnóstico da atualização na tela | Alta | P |
| C3 | Testes de interface das telas novas | Alta | M |
| C4 | Corrida no preenchimento automático | Média | P |
| C5 | Comarca pelo código do município | Média | P |
| C6 | Ajustes da calculadora de rescisão | Média | P |
| C7 | Prévia fixa ao gerar documento | Baixa | P |
| C8 | CSP de produção | Baixa | P |
| C9 | Código em linha única | Baixa | M |

### C1 Cenários que o teste de atualização não cobre — M
- **Problema:** `scripts/update-e2e.mjs` instala sempre em **uma** pasta, por usuário. Três casos ficaram
  sem prova:
  1. registro "para mim" **e** "para todos" ao mesmo tempo (a causa mais provável do defeito relatado);
  2. instalação "para todos os usuários" (Program Files), que pede elevação;
  3. versão nova que instala certo mas **não inicia** — antes coberto pelo cenário "defeituosa", que
     agora cai na etapa `verifying` e deixou a etapa `starting` sem teste.
- **Proposta:** três etapas novas no e2e: (1) gravar uma segunda chave `InstallLocation` em HKCU
  apontando para outra pasta e conferir que a atualização troca a pasta em uso; (2) instalar com
  `/allusers` no runner do GitHub (administrador, sem aviso de UAC); (3) gerar um instalador com a
  versão certa e uma variável de build que faz o início falhar, e esperar `reason: 'starting'`.
- **Arquivos:** `scripts/update-e2e.mjs`, `desktop/main.cjs` (gancho de falha só em build de teste).
- **Aceite:** as três etapas passam no `release.yml`; o `recovery.jsonl` de cada uma vai para o artefato.

### C2 Diagnóstico da atualização na tela — P
- **Problema:** estava no plano anterior (item 1.4) e não foi feito. Para saber por que uma atualização
  falhou, hoje é preciso abrir `%APPDATA%\AdvocaciaGestao\logs\recovery.jsonl` à mão — e foi isso que
  impediu confirmar a causa do defeito original.
- **Proposta:** em Configurações → Atualizações, um bloco "Última tentativa" com etapa, motivo, pasta e
  código do instalador (lidos do `recovery.jsonl`) e o botão **Copiar diagnóstico**, sem dados de cadastro.
- **Arquivos:** `backend/diagnostics.cjs`, `desktop/main.cjs`, `frontend/src/Settings.jsx`.
- **Aceite:** depois de uma reversão no e2e, o bloco mostra `not-replaced` e o texto copiado contém as
  linhas do guardião.

### C3 Testes de interface das telas novas — M
- **Problema:** as telas da 1.10 foram conferidas com scripts temporários, apagados depois. Nenhum dos
  10 testes de `scripts/run-smokes.mjs` abre "Gerar documento", "Rescisão" ou as buscas; uma regressão
  ali passa pelo CI.
- **Proposta:** `scripts/documents-smoke.mjs` (modelo com `{?Pergunta}` repetida → campos separados;
  gerar sem cliente; arquivo sem vínculo) e `scripts/tools-smoke.mjs` (rescisão com o caso de
  R$ 18.996,13 e PDF salvo; buscas com respostas simuladas por variável de ambiente, sem internet).
- **Arquivos:** `scripts/`, `package.json`, `scripts/run-smokes.mjs`, `.github/workflows/ci.yml`,
  `desktop/main.cjs` (fetch simulado só com `ADVOCACIA_TEST_DATA`).
- **Aceite:** os dois entram no CI e falham se o campo "Telefone / WhatsApp" sumir.

### C4 Corrida no preenchimento automático — P
- **Problema:** em `frontend/src/EntityForm.jsx`, `lookupCase` e `lookupCNPJ` decidem o que está vazio
  com o `form` de **antes** da consulta. Se a pessoa digitar num campo durante a busca (1 a 2 s), o
  valor digitado pode ser trocado pelo da consulta, contrariando a regra "nunca substitui".
- **Proposta:** decidir dentro do `setForm(current => …)` e montar o resumo a partir do retorno;
  ignorar a resposta se o número mudou ou o formulário fechou.
- **Aceite:** teste que digita na "Vara" durante uma busca lenta simulada e mantém o texto digitado.

### C5 Comarca pelo código do município — P
- **Problema:** `countyFrom` em `backend/datajud.cjs` adivinha a cidade pelo nome da vara. Falha em
  "VARA CÍVEL DO RIO DE JANEIRO" (devolve vazio) e em nomes sem cidade.
- **Proposta:** usar `orgaoJulgador.codigoMunicipioIBGE` (campo do esquema do DataJud; confirmar numa
  resposta real antes de começar), com a tabela de municípios do IBGE embutida (cerca de 5.570
  linhas, ~150 KB); manter o nome da vara como reserva.
- **Arquivos:** `backend/datajud.cjs`, novo `app/municipios.json`, `tests/public-data.test.cjs`.
- **Aceite:** código 3304557 → "Rio de Janeiro"; sem código, comportamento atual.

### C6 Ajustes da calculadora de rescisão — P
- **Problema:** (a) o adiantamento do 13º não pode ser abatido — só há um aviso; (b) o período de férias
  que se completa **no próprio desligamento** depende de a pessoa lembrar de contar em "férias vencidas";
  (c) não dá para abrir a calculadora já com o processo escolhido.
- **Proposta:** campo "13º já adiantado" (abatimento); aviso automático "o contrato completou N
  períodos; confira as férias vencidas" quando o campo estiver em 0; botão **Calcular rescisão** no
  detalhe do processo trabalhista, levando o `caseId`.
- **Arquivos:** `app/labor.mjs`, `frontend/src/LaborCalculator.jsx`, `frontend/src/Detail.jsx`, `tests/labor.test.cjs`.

### C7 Prévia fixa ao gerar documento — P
- **Problema:** com muitas perguntas, a prévia rola junto e some da tela (visto no teste da ENTREVISTA).
- **Proposta:** prévia com `position: sticky` e rolagem própria; clicar num trecho destacado leva ao campo.
- **Arquivos:** `frontend/src/GenerateDocument.jsx`, `frontend/src/styles/screens.css`.

### C8 CSP de produção — P
- **Problema:** `frontend/index.html` libera `connect-src http://127.0.0.1:5173 ws://127.0.0.1:5173`
  (servidor de desenvolvimento) também no programa instalado.
- **Proposta:** remover essas origens no `vite build` (plugin de transformação do HTML).
- **Aceite:** o `dist/frontend/index.html` não contém `5173`; `npm run dev` continua funcionando.

### C9 Código em linha única — M
- **Problema:** `backend/agent-api.cjs`, `backend/weekly-backups.cjs` e partes de `desktop/main.cjs`
  têm funções inteiras em uma linha de 1.000+ caracteres. Revisar um diff ou localizar um erro nessas
  linhas é caro e arriscado.
- **Proposta:** formatar com o Prettier em um commit só de formatação (sem mudança de lógica),
  adicionar `prettier --check` ao `npm run check`, e depois dividir o `main.cjs` (548 linhas) em
  `desktop/ipc/*.cjs` por assunto.
- **Aceite:** 146 testes e todos os smokes passam sem alteração; diff de formatação separado do de lógica.

---

## Fase 2 — Melhorias no que já existe (1.11.0)

| # | Item | Prioridade | Esforço |
|---|---|---|---|
| M1 | Perguntas com tipo nos modelos | Alta | M |
| M2 | Processo novo já com andamentos | Alta | P |
| M3 | CEP e CNPJ em todos os cadastros | Alta | P |
| M4 | Lixeira (desfazer exclusão) | Alta | M |
| M5 | Bloqueio do programa por senha | Alta | M |
| M6 | Compromissos recorrentes | Média | M |
| M7 | Desempenho com muitos cadastros | Média | G |
| M8 | Rescisão, fase 2 | Média | G |
| M9 | Cálculo dentro do documento | Média | M |
| M10 | Novas ferramentas para agentes (MCP) | Média | P |
| M11 | Resumo diário para o advogado | Baixa | M |
| M12 | Assinatura do instalador | Alta, depende de custo | P + custo |

### M1 Perguntas com tipo nos modelos — M
- **Problema:** `{?…}` só conhece texto e `:moeda`. Fichas como a ENTREVISTA pedem data, sim/não e
  lista de opções; hoje tudo é digitado livremente.
- **Proposta:** `{?Data de admissão:data}`, `{?CTPS anotada:sim/não}`, `{?Estado civil:opções=solteiro|casado|…}`
  e `{?Relato:texto longo}`; o botão "Inserir pergunta" ganha o seletor de tipo. Respostas ficam
  guardadas junto do documento gerado para **gerar de novo** sem redigitar.
- **Arquivos:** `app/document-template.mjs`, `frontend/src/EmailEditor.jsx`, `frontend/src/GenerateDocument.jsx`,
  `backend/document-generator.cjs`.
- **Aceite:** modelos atuais continuam iguais; testes para cada tipo; data sai como dd/mm/aaaa.

### M2 Processo novo já com andamentos — P
- **Problema:** depois de preencher o processo pelo número, os andamentos só entram se a pessoa abrir
  o processo e clicar em "Atualizar pelo DataJud".
- **Proposta:** ao salvar um processo novo cuja busca achou o número, importar os andamentos em seguida
  (como histórico, sem contar como novidade). Também oferecer "Cadastrar a parte contrária em Pessoas".
- **Arquivos:** `frontend/src/EntityForm.jsx`, `desktop/main.cjs`, `backend/datajud.cjs`.

### M3 CEP e CNPJ em todos os cadastros — P
- **Problema:** a busca por CNPJ só existe em Cliente e na parte contrária do processo; Pessoas e
  Atendimentos têm o campo e não buscam. Endereço de pessoa física é todo digitado.
- **Proposta:** mesma busca em Pessoas e Atendimentos; busca por **CEP** (BrasilAPI/ViaCEP) que preenche
  logradouro, bairro, cidade e UF, com o mesmo padrão (desligada por padrão, botão sempre disponível,
  só campos vazios). Atualizar `docs/PRIVACIDADE.md`.
- **Arquivos:** `backend/cnpj.cjs` (ou novo `backend/cep.cjs`), `frontend/src/EntityForm.jsx`, `frontend/src/PublicSettings.jsx`.

### M4 Lixeira — M
- **Problema:** `Store.remove` faz `DELETE` direto (`backend/store.cjs:126`). Um clique errado em
  "Excluir" só se recupera restaurando um backup inteiro.
- **Proposta:** exclusão vira marcação (`deleted_at`) com migração nova; tela **Lixeira** com restaurar
  e esvaziar; limpeza automática depois de 30 dias; aviso "Desfazer" por 10 segundos.
- **Arquivos:** `migrations/009-*.sql`, `backend/store.cjs`, `backend/retention.cjs`, `frontend/src/Records.jsx`.
- **Aceite:** excluir e restaurar um cliente mantém vínculos; `validate-migrations` passa.

### M5 Bloqueio do programa por senha — M
- **Problema:** os dados são criptografados com a chave do Windows, mas qualquer pessoa com a sessão
  aberta abre o programa e vê tudo. Não existe senha nem bloqueio por inatividade.
- **Proposta:** senha ou PIN opcional (hash com scrypt), bloqueio depois de N minutos parado e ao
  minimizar para a bandeja, e a API de agentes parada enquanto bloqueado. Sem a senha, a recuperação é
  pelo backup portátil — deixar isso explícito na tela.
- **Arquivos:** `backend/vault.cjs`, `desktop/main.cjs`, `frontend/src/App.jsx`, `frontend/src/PrivacySettings.jsx`.

### M6 Compromissos recorrentes — M
- **Problema:** a recorrência existe para mensagens (`backend/recurrence.cjs`), não para a agenda.
  Reunião semanal ou conferência mensal de prazos é recadastrada toda vez.
- **Proposta:** "Repetir" no compromisso (diário, semanal, mensal, até uma data), reaproveitando o
  cálculo existente; editar "só este" ou "este e os próximos".

### M7 Desempenho com muitos cadastros — G
- **Problema:** `state()` em `desktop/main.cjs` devolve **todos** os registros de 8 tipos a cada mudança,
  e `Store.list` descriptografa linha por linha. Funciona com centenas; com milhares de clientes e
  documentos tende a travar a cada salvamento.
- **Proposta:** primeiro **medir** (script que cria 10 mil clientes e 30 mil prazos e cronometra
  `state()` e a abertura das listas). Se passar de 300 ms: enviar só o tipo que mudou, paginar as
  listas e manter cache descriptografado em memória.
- **Aceite:** número medido antes e depois; salvar um cadastro com 10 mil registros em menos de 200 ms.

### M8 Rescisão, fase 2 — G
- **Proposta:** descontos de **INSS e IRRF** com tabelas anuais em arquivo próprio (atualizáveis como
  os índices); rescisão antecipada de contrato a prazo (arts. 479 e 480); horas extras e adicionais
  com reflexos; estimativa do seguro-desemprego; saída em DOCX além de PDF.
- **Risco:** tabelas mudam todo ano — precisa de teste que falha quando a tabela do ano corrente não existe.

### M9 Cálculo dentro do documento — M
- **Proposta:** variáveis `{calculo.total}`, `{calculo.verbas}` e `{debito.total}` preenchidas com o
  último cálculo salvo no processo, para petição inicial e acordo saírem com os valores.

### M10 Novas ferramentas para agentes (MCP) — P
- **Problema:** `backend/agent-api.cjs` tem `calculate_deadline` e `calculate_debt`, mas não a rescisão,
  as buscas nem a geração com dados digitados.
- **Proposta:** `calculate_severance`, `lookup_case`, `lookup_cnpj` e o parâmetro `values` em
  `preview_document`. Atualizar `docs/API-MCP.md`.

### M11 Resumo diário para o advogado *(sugestão)* — M
- **Proposta:** mensagem às 8h (WhatsApp ou e-mail) com prazos do dia, audiências, intimações novas e
  cobranças vencidas. Desligado por padrão.

### M12 Assinatura do instalador — P de trabalho, com custo anual
- **Problema:** o instalador não tem certificado (`docs/ATUALIZACOES.md`): o Windows mostra "editor
  desconhecido" e o Smart App Control **bloqueia**. É uma das causas possíveis de atualização que não instala.
- **Proposta:** certificado de assinatura de código (OV ou Azure Trusted Signing); o `release.yml` já
  lê `WIN_CSC_LINK` e `WINDOWS_PUBLISHER_NAME`, então é configurar os segredos.
- **Decisão sua:** há custo recorrente.

---

## Fase 3 — Novas funções (1.12.0 em diante) *(sugestões)*

| # | Item | Para quem | Esforço |
|---|---|---|---|
| N1 | Controle de horas e honorários por hora | Escritórios que cobram por hora | G |
| N2 | Quadro de processos por fase (kanban) | Visão geral da carteira | M |
| N3 | Leitura de PDFs digitalizados (OCR) | Busca em documentos escaneados | G |
| N4 | Assinatura digital de PDF com certificado A1 | Petições e contratos | G |
| N5 | Liquidação trabalhista completa | Área trabalhista | GG |
| N6 | Alertas de prescrição e de documentos a vencer | Controle de risco | M |
| N7 | Importação de outros sistemas | Quem está migrando | M |
| N8 | Versões Linux e macOS | Quem não usa Windows | M |
| N9 | Cópia de segurança em pasta sincronizada | Segurança dos dados | P |

- **N1 Controle de horas:** lançar tempo por processo, com cronômetro, valor da hora por advogado e
  relatório para cobrança, que vira lançamento no Financeiro.
- **N2 Quadro por fase:** colunas pelas fases já cadastradas (`caseChoices.phase`); arrastar muda a
  fase. O mesmo para Atendimentos (novo → retorno → convertido).
- **N3 OCR:** `backend/document-text-worker.cjs` indexa só PDFs com texto. Reconhecimento local
  (tesseract, sem enviar o documento a ninguém) para os digitalizados; pesado, roda em segundo plano.
- **N4 Assinatura digital:** assinar PDF com certificado A1 (PAdES) dentro de Ferramentas → PDF. O
  certificado e a senha nunca saem do computador.
- **N5 Liquidação trabalhista:** juntar rescisão, horas extras com reflexos e atualização (IPCA-E + Selic,
  ADC 58) em um único cálculo com memória.
- **N6 Alertas:** prescrição por tipo de ação a partir da data do fato; procuração e contrato com validade.
- **N7 Importação:** modelos prontos para as planilhas exportadas pelos sistemas mais usados; a
  importação genérica já existe em `backend/imports.cjs`.
- **N8 Linux e macOS:** o `electron-builder.yml` já tem os alvos; faltam o job no `release.yml`, o teste
  de atualização no Linux e a notarização da Apple (custo anual).
- **N9 Pasta sincronizada:** além do e-mail (limite de 18 MB em `weekly-backups.cjs`), gravar o backup
  protegido por senha numa pasta escolhida (OneDrive, Google Drive, rede).

---

## Fase 4 — Arquitetura (2.0) *(sugestão, decisão grande)*

### A1 Mais de uma pessoa usando ao mesmo tempo — GG
- **Problema:** o programa é de um computador e um usuário. Escritório com 2 ou mais pessoas precisa
  escolher uma máquina ou trocar backups.
- **Caminhos:** (a) um computador do escritório como servidor na rede local, os outros como clientes,
  com perfis e permissões; (b) sincronização entre computadores com arquivo criptografado em pasta
  compartilhada. O (a) é mais simples de manter consistente; o (b) funciona fora do escritório.
- **Antes de decidir:** saber quantos escritórios usuários têm mais de uma pessoa. Sem isso, não vale o custo.

---

## Como medir cada entrega
- `npm run check`, `node scripts/validate-migrations.mjs` e todos os smokes no CI.
- Atualização: `npm run test:update-e2e` com os cenários de C1 antes de qualquer release.
- Toda consulta nova a serviço externo: desligada por padrão, só o mínimo enviado, descrita em `docs/PRIVACIDADE.md`.
- Toda migração nova: sem remoção de dados e com teste de ida.

## Decisões que dependem de você
1. **F0.3:** nova versão só da política de privacidade, ou novo aceite dos termos?
2. **F0.4:** commitar ou apagar `docker/`, `database/` e `.dockerignore`?
3. **M12:** vale o custo do certificado de assinatura?
4. **M5:** senha obrigatória ou opcional?
5. **Fase 3:** quais das novas funções interessam, e em que ordem?
6. **A1:** os escritórios que usam têm mais de uma pessoa?
7. O `recovery.jsonl` da máquina onde a atualização falhou continua sendo a prova que falta para fechar a causa.
