# Plano de melhoria — Magnum Office 1.10.0

Origem: relato de uso (print do "Gerar documento" com o modelo ENTREVISTA) e pedidos de 11/11/2026.
Situação: todos os itens implementados; 1 a 5 ainda não publicados (versão 1.9.1). Item 6 aplicado no GitHub em 11/11/2026.

| # | Item | Tipo | Prioridade | Esforço |
|---|------|------|-----------|---------|
| 1 | Atualização baixa, "instala", reinicia e continua na versão antiga | Correção | Crítica | M |
| 2 | Perguntas do modelo ficam unificadas num único campo | Correção | Alta | P |
| 3 | Gerar documento a partir do modelo sem cadastrar processo | Melhoria | Alta | M |
| 4 | Ao informar o número do processo / CNPJ, buscar os dados automaticamente | Melhoria | Média | M |
| 5 | Calculadora trabalhista de verbas rescisórias simples | Nova função | Média | G |
| 6 | Remover versões antigas do release | Limpeza | Baixa | P |

Ordem sugerida: **1 → 2 → 3 → 4 → 5 → 6**. O item 1 vem primeiro porque, enquanto a atualização
automática falhar, nenhuma das outras correções chega aos usuários.

---

## 1. Atualização não conclui (crítico)

### Sintoma
O download termina, o sistema avisa que vai instalar, fecha e reabre, mas continua na versão anterior.

### Como funciona hoje (resumo)
1. `updater/updater.cjs → install()` cria backup, grava `pending-update.json` e chama `startGuardian()`.
2. `updater/guardian.cjs` roda a partir da **cópia preservada da versão antiga**, espera o app fechar
   e executa o instalador com `/S --updated` (silencioso, sem informar pasta).
3. Depois abre `previousExe` (o executável **antigo**, no caminho antigo) com `--guardian-launch`.
4. A nova versão grava `health.json`; se em 3 min a versão não bater, o guardião restaura o backup,
   bloqueia a versão (`blockedVersions`) e grava `recovery-notice.json`.

### Causas prováveis (a confirmar na etapa 1.1)
- **H1 — Pasta de instalação diferente (mais provável).** O instalador é assistido
  (`oneClick: false`, `perMachine: false`), então na primeira instalação o usuário pode escolher
  "para todos os usuários" (Program Files) ou outra pasta. Na atualização o guardião chama o
  instalador em modo silencioso **sem `/D=` nem `/allusers`/`/currentuser`**: o NSIS pode instalar
  em `%LOCALAPPDATA%\Programs\…` (por usuário), devolver código 0 ("instalou") e o guardião
  reabre o `.exe` antigo da pasta original → mesma versão → falha no health check → reversão.
- **H2 — Instalação por máquina sem elevação.** Se a instalação original é em Program Files, o
  instalador silencioso sem UAC falha (código ≠ 0) e o guardião reverte.
- **H3 — Bloqueio do instalador não assinado** (Smart App Control / antivírus), sem
  certificado Authenticode → código ≠ 0 → reversão.
- **H4 — App não fecha em 120 s** (operação presa, bandeja) → guardião aborta em silêncio
  (`update.guardian.aborted`) e o próximo início só diz que a atualização "não terminou".

### Etapas
1.1 **Diagnóstico na máquina afetada** (antes de codificar):
   - Copiar `%APPDATA%\AdvocaciaGestao\logs\recovery.jsonl`, `update-progress.json`,
     `recovery-notice.json` e os eventos `update.*` da auditoria.
   - Ver onde o programa está instalado (atalho → "Abrir local do arquivo") e se existem duas
     instalações (`C:\Program Files\Advocacia Gestao` e `%LOCALAPPDATA%\Programs\advocacia-gestao`).
   - Registro: `HKCU` e `HKLM\Software\Microsoft\Windows\CurrentVersion\Uninstall\*` → `InstallLocation`.

1.2 **Instalador (`installers/custom.nsh`) — vale até para quem está na versão antiga**, pois o
   instalador usado é o **novo**:
   - Em `customInit`, no modo silencioso, ler o `InstallLocation` existente (HKCU, depois HKLM) e
     forçar `$INSTDIR` para a mesma pasta e o mesmo modo (por usuário/por máquina).
   - Registrar no log do instalador a pasta final e o modo usados.

1.3 **Guardião (`updater/guardian.cjs`) e `updater/recovery.cjs`:**
   - Passar `/D=<pasta de previousExe>` como último argumento e `/currentuser` ou `/allusers`
     conforme a instalação atual.
   - Se a instalação atual for por máquina, executar o instalador com elevação visível
     (UAC) em vez de oculto.
   - Depois do instalador, conferir a versão do `.exe` na pasta-alvo (`FileVersion`) **antes** de
     reabrir; se não bater, procurar o `InstallLocation` real no registro e abrir esse `.exe`.
   - Registrar em `recovery.jsonl`: código de saída do instalador, pasta, versão encontrada e
     o `.exe` reaberto.

1.4 **Mensagens e saída manual (`frontend/src/Settings.jsx`, `App.jsx`):**
   - Mostrar o motivo real da falha (instalador recusado, pasta diferente, não fechou a tempo).
   - Botão **"Instalar manualmente"** que abre o instalador já baixado e verificado em modo
     normal (com telas), para concluir na mesma pasta.
   - Botão **"Copiar diagnóstico da atualização"** (usa `backend/diagnostics.cjs`).

1.5 **Testes:** ampliar `scripts/update-e2e.mjs` com instalação inicial em pasta personalizada e
   em modo "todos os usuários", e conferir que a atualização mantém a pasta.

> **Importante:** o guardião que roda é o da versão **instalada** (antiga). A correção 1.3 só vale
> a partir das atualizações feitas **pela 1.10.0**. Para quem está na 1.9.x com o problema, a
> 1.10.0 deve ser instalada **uma vez manualmente** (instalador ou `quick-install.ps1`), a menos
> que a correção 1.2 resolva sozinha. Avisar isso nas notas da release.

---

## 2. Perguntas do modelo ficam unificadas

### Causa (confirmada no código)
Em `app/document-template.mjs`, a chave da pergunta é o próprio rótulo
(`{?Pergunta}` → `key: "Pergunta"`). A ajuda do editor (`frontend/src/Templates.jsx:258`) mostra
literalmente `{?Pergunta}` como exemplo; o modelo ENTREVISTA usou esse mesmo texto em todos os
campos (Telefone, Nº de funcionários, CTPS etc.). Todas viram **uma única pergunta**, e a
resposta "asdadasd" aparece em todos os lugares — exatamente o que o print mostra.

### Etapas
2.1 **Motor (`app/document-template.mjs`):**
   - Para perguntas genéricas (`{?}`, `{?Pergunta}`, `{?Resposta}`, etc.), deduzir o rótulo do
     texto imediatamente anterior no parágrafo (ex.: "Telefone / WhatsApp:" → "Telefone / WhatsApp")
     e gerar uma chave por ocorrência (`Pergunta#3`). Assim o modelo ENTREVISTA atual passa a
     funcionar **sem precisar ser reeditado**.
   - Perguntas com nome próprio repetido (ex.: `{?Nome do réu}` duas vezes) continuam
     compartilhando a resposta — isso é intencional e fica documentado.
   - Manter a ordem das perguntas igual à ordem no documento.

2.2 **Editor de modelos (`Templates.jsx` / `EmailEditor.jsx`):**
   - Botão **"Inserir pergunta"** que pede o rótulo e insere `{?Rótulo}`.
   - Trocar o exemplo da ajuda para algo como `{?Nome do reclamante}` e explicar que
     o mesmo rótulo = mesma resposta.
   - Ao salvar, avisar quando um rótulo genérico aparece várias vezes.

2.3 **Formulário (`GenerateDocument.jsx`):**
   - Campo de texto maior (textarea) para respostas longas; indicar "usada em N lugares".
   - Clicar no trecho destacado da prévia leva ao campo correspondente.

2.4 **Testes:** casos em `tests/documents-people.test.cjs` para rótulo genérico repetido,
   rótulo deduzido, rótulo próprio repetido e `:moeda`.

---

## 3. Gerar documento sem cadastrar processo

Hoje o "Gerar documento" só abre a partir do detalhe de um cliente/processo e do Financeiro.

### Etapas
3.1 **Novos pontos de entrada:** botão **"Gerar documento"** em cada cartão de modelo
   (Documentos → Modelos) e **"Gerar documento avulso"** no topo da tela Documentos.

3.2 **`GenerateDocument.jsx`:**
   - Seletor **Cliente** opcional ("Nenhum" + clientes cadastrados) quando não vier fixo.
   - Seletor **Processo** opcional (do cliente escolhido; "Sem processo").
   - Seção **"Preencher manualmente"**: toda variável do modelo sem dado (`{cliente.nome}`,
     `{processo.numero}`…) vira um campo editável, além das perguntas `{?…}`. É o caso do
     "Reclamante: ____" do print.

3.3 **Backend (`backend/document-generator.cjs`):**
   - Aceitar `values` manuais apenas para chaves existentes em `documentVariables`,
     com o mesmo limite de 4.000 caracteres; valor manual tem prioridade sobre o cadastro.
   - Sem cliente/processo, salvar o documento sem vínculo (`documents.save` já aceita) e
     oferecer também **"Salvar no computador"** direto.

3.4 **Opcional:** botão "Criar cadastro com estes dados" depois de gerar, para aproveitar o
   que foi digitado.

---

## 4. Busca automática pelo número do processo / CNPJ

> O pedido diz "buscar na API do CNPJ" ao informar o número do processo. Como o número do processo
> é consultado no **DataJud (CNJ)** e o CNPJ na **Receita (BrasilAPI)**, o plano cobre os dois.
> **Confirmar qual era a intenção.**

### 4A. Número do processo → DataJud (CNJ)
- Novo `datajud.lookup(number)` em `backend/datajud.cjs`, reaproveitando `query()`, sem gravar nada.
- Em `EntityForm.jsx`, ao sair do campo "Número do processo" com CNJ válido (e DataJud ativo),
  consultar e preencher **apenas campos vazios**: classe/rito, vara/órgão julgador, comarca
  (deduzida do órgão), data de ajuizamento, instância (grau), área (pelo segmento do CNJ),
  assuntos. Mostrar "Encontrado no DataJud — Aplicar / Ignorar".
- Limitação: a API pública do DataJud **não informa as partes** (nomes); por isso o 4B.
- Ao salvar um processo novo, importar os andamentos automaticamente.

### 4B. CNPJ → dados da empresa
- Novo `backend/cnpj.cjs` usando a rede do Chromium (`publicFetch`): BrasilAPI
  (`/api/cnpj/v1/{cnpj}`) com reserva em minhareceita.org.
- Ao informar CNPJ válido em **Parte contrária** (processo) ou em **Cliente pessoa jurídica**:
  preencher razão social, endereço completo e, no cliente, o sócio-administrador como
  representante legal. Alertar se a situação cadastral não for "ATIVA".
- Chave em Configurações → Consultas públicas ("Consulta de CNPJ"), atualizar
  `docs/PRIVACIDADE.md` (envia só o número do CNPJ). Tratar CNPJ alfanumérico (pode não ser
  aceito pela API: mensagem clara).

### Testes
Respostas simuladas (fetch falso) para DataJud e CNPJ: encontrado, não encontrado, sem rede,
limite de consultas; e garantia de que campos já preenchidos não são sobrescritos.

---

## 5. Calculadora trabalhista (verbas rescisórias simples)

### Estrutura
- `app/labor.mjs` — cálculo puro em centavos (reusa `app/money.mjs`), testável.
- `frontend/src/LaborCalculator.jsx` — nova tela no menu (ao lado de Débitos e Prazos) e botão
  "Calcular rescisão" no detalhe do processo.
- `tests/labor.test.cjs` — casos conferidos manualmente.

### Entradas
Admissão, último dia trabalhado, modalidade, salário mensal + médias habituais, aviso
(trabalhado / indenizado / dispensado), períodos de férias vencidas (e se estão em dobro),
saldo do FGTS na conta (ou estimativa de 8% sobre a remuneração), dias do mês já pagos.

### Modalidades e verbas
| Verba | Sem justa causa | Pedido de demissão | Justa causa | Acordo (art. 484-A) | Fim de contrato a prazo |
|---|---|---|---|---|---|
| Saldo de salário | sim | sim | sim | sim | sim |
| Aviso prévio indenizado (30 + 3/ano, máx. 90 — Lei 12.506/11) | sim | desconto opcional de 30 dias (art. 487 §2º) | não | metade | não |
| 13º proporcional (mês com ≥15 dias = 1/12) | sim | sim | não | sim | sim |
| Férias vencidas + 1/3 (dobro se vencido o concessivo — art. 137) | sim | sim | sim | sim | sim |
| Férias proporcionais + 1/3 (Súm. 171 e 261 TST) | sim | sim | não | sim | sim |
| FGTS do mês e sobre aviso indenizado/13º (Súm. 305; não incide sobre férias indenizadas — OJ 195) | sim | sim | sim | sim | sim |
| Multa do FGTS | 40% | — | — | 20% | — |

- Projeção do aviso indenizado no tempo de serviço para 13º e férias (art. 487 §1º; OJ 82 SDI-1).
- Opcionais: multa do art. 477 §8º (atraso no pagamento) e do art. 467.

### Saída
Tabela "verba / referência (dias ou avos) / valor", total bruto, FGTS a depositar e multa,
com aviso: *"Estimativa. Não inclui INSS, IRRF, horas extras ou adicionais não informados,
correção e juros."* Exportar memória de cálculo em DOCX/PDF (reusa `backend/document-files.cjs`)
e salvar no processo.

### Fase 2 (fora do escopo "simples")
Descontos de INSS e IRRF com tabelas anuais, rescisão antecipada de contrato a prazo
(arts. 479/480), integração do total como variável em modelos (`{calculo.total}`).

---

## 6. Remover versões antigas do release

Situação atual no GitHub (`lucianumm/magnum-office`): só existe a release **v1.9.1**; continuam
as **tags** `v1.0.0`, `v1.1.0`, `v1.2.0`, `v1.3.0` e `v1.9.0`.

### Etapas (confirmar o escopo antes, pois apagar tags não tem volta)
6.1 Apagar as tags antigas no GitHub e localmente (`git push --delete origin vX` / `git tag -d vX`).
6.2 Ajustar `.github/workflows/release.yml` para, depois de publicar, manter só as **2 releases
   mais recentes** (a anterior serve de base para o teste de atualização `test:update-e2e`).
6.3 Remover de `docs/ATUALIZACOES.md` e do `README.md` a seção sobre as versões 1.0.0/1.1.0.
6.4 Limpeza local: atalhos `Abrir Advocacia Gestao 0.2.lnk`, builds antigos em
   `installers/artifacts` e `work/` (bundles e `published-1.2.0`).
6.5 No app, a retenção de `%APPDATA%\AdvocaciaGestao\installers` já mantém atual + anterior —
   sem mudança.

---

## Entrega
- Versão **1.10.0**, com `CHANGELOG.md` explicando as correções.
- Antes de publicar: `npm run check`, `node scripts/run-smokes.mjs`, `npm run test:update-e2e`
  com os novos cenários de pasta.
- Notas da release: orientar quem está na 1.9.x com a atualização travada a instalar a 1.10.0
  manualmente uma vez.

## Pontos para confirmar
1. Item 4: era o **número do processo (DataJud)**, o **CNPJ da parte**, ou os dois?
2. Item 6: "versões antigas do release" = apagar as **tags antigas** do GitHub (e manter só as
   2 últimas releases daqui pra frente)?
3. Item 1: dá para pegar o `recovery.jsonl` da máquina onde a atualização falhou?
