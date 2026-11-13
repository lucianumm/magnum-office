# Plano de melhoria — 1.12 em diante (WhatsApp, agenda, intimações e documentos)

Data: 13/11/2026 · Base: `main` na versão 1.11.0 (publicada).
Situação: **apenas planejamento**. Nada deste plano foi implementado.

**Ajustado em 13/11/2026** (itens 4 e 5): no PDF, usar as **fontes instaladas no Windows**; nas intimações, entram as quatro prioridades (agrupar por processo, destacar prazo e data, certidão e busca avulsa, criar audiência e avisar o cliente) e a busca **também por número de OAB**. Nos demais itens valem os padrões recomendados: respostas automáticas em modo *revisar antes de enviar*, número de WhatsApp só do escritório e os limites propostos.

Origem: lista de melhorias enviada pelo escritório, com 7 pedidos. Cada item abaixo diz **o que existe hoje
no código**, **o que muda**, **como fica a segurança** (quando há dados de clientes), **arquivos** e
**como será testado**. Esforço: P = até 1 dia, M = 2 a 4 dias, G = 1 a 2 semanas.

## Resumo e ordem

| Fase | Entrega | Pedidos | Versão | Esforço |
|---|---|---|---|---|
| A | WhatsApp enxuto: só enviar e receber, limpeza e limites de envio | 3 | 1.12.0 | M |
| B | Modelos de WhatsApp por finalidade e eventos da agenda com confirmação | 6, 1 | 1.12.0 | G |
| C | Disparos: frequências, datas específicas, regras e janela de envio | 2 | 1.12.0 | G |
| D | Respostas automáticas e consulta de andamento por WhatsApp | 6.1 | 1.13.0 | G |
| E | Intimações organizadas (API do DJEN completa) | 4 | 1.13.0 | M |
| F | Documentos com cabeçalho, rodapé, imagens e fontes | 5 | 1.14.0 | G |

A ordem existe por dependência: o **A** prepara o programa para *receber* mensagens (o **D** precisa disso)
e coloca os limites de envio de que o **B**, o **C** e o **D** dependem. O **B** cria os eventos e os modelos
que o **C** e o **D** reaproveitam. **E** e **F** não dependem dos outros e podem ser feitos em paralelo.

## O que não dá para esconder: dois riscos que mudam o desenho

1. **O Baileys é um cliente não oficial do WhatsApp.** Contas que enviam em volume, em horários
   estranhos, ou que respondem automaticamente a muita gente têm risco real de **banimento do número**.
   Por isso o plano trata limite de envio, intervalo variável, janela de horário, "sair" do cliente e
   número dedicado como **requisitos**, não como enfeite. A alternativa oficial (WhatsApp Business Cloud API,
   da Meta) tem custo por conversa e exige empresa verificada; fica como opção futura, fora deste plano.
2. **O pedido 6.1 (cliente informa o CPF e recebe o andamento) não pode confiar só no CPF.** O CPF de uma
   pessoa não é segredo: quem o souber poderia pedir o andamento do processo dela. Isso é dado protegido
   pelo sigilo profissional (Estatuto da OAB) e pela LGPD. O desenho abaixo exige **o número que escreve ser
   o cadastrado do cliente *e* o CPF bater**, só envia o que for público, respeita segredo de justiça e deixa
   o escritório escolher entre responder sozinho ou revisar antes. Detalhes no item 6.1.

---

## Fase A — Item 3: Baileys só para enviar e receber, com limpeza

### O que existe hoje
- `backend/messaging.cjs` abre o `makeWASocket` com poucas opções (`markOnlineOnConnect: false`,
  `syncFullHistory: false`) e o *logger* já é `pino({ level: 'silent' })`: **o Baileys não grava log**.
- O programa **só envia**: não existe nenhum ouvinte de mensagem recebida.
- As chaves da sessão (criptografia do WhatsApp) ficam na tabela `secrets` como `wa:<tipo>:<id>`
  (`session`, `sender-key`, `pre-key`, `app-state-sync-key`...). Nada apaga as que deixam de servir, então a
  tabela só cresce.
- O envio roda a cada 5 segundos e manda **uma mensagem por ciclo**, sem teto por hora ou dia, sem intervalo
  variável e sem janela de horário: com 100 mensagens agendadas para o mesmo minuto, todas saem em cerca de 8 minutos.
- A conexão do WhatsApp (QR Code) fica na tela **Mensagens**; não existe uma aba de configurações do WhatsApp.

### O que muda
**A1. Soquete enxuto** (nomes conferidos nos tipos da versão instalada, `7.0.0-rc14`):
- `shouldSyncHistoryMessage: () => false` e `syncFullHistory: false`: não baixar histórico.
- `shouldIgnoreJid`: ignorar grupos (`@g.us`), *status* e *broadcast* (`@broadcast`), canais (`@newsletter`).
  Só conversas individuais entram.
- `generateHighQualityLinkPreview: false`, `emitOwnEvents: false`, `markOnlineOnConnect: false`.
- Ouvir **só** `messages.upsert` (para o item 6.1), `connection.update` e `creds.update`. Nenhum ouvinte de
  presença, contatos, chats ou grupos.
- Mídia recebida (foto, áudio, documento) **não é baixada**: o programa guarda só "recebeu mídia" e avisa o
  escritório. Menos memória, menos disco e menos dado pessoal parado.

**A2. Limpeza**
- Primeiro **medir**: um relatório de quantas chaves existem por tipo e quanto ocupam (Configurações → WhatsApp).
- Limpeza segura, uma vez por semana e depois de cada reconexão: remover `sender-key` e `sender-key-memory`
  (só servem a grupos, que ignoramos) e `session` de contatos sem mensagem há mais de 90 dias, que o
  WhatsApp refaz sozinho quando a pessoa escrever de novo. **Nunca** tocar em `creds`, `pre-key`,
  `identity-key` nem `app-state-sync-*` (apagar essas desconecta o número).
- Botão "Limpar agora" e um contador, numa **nova aba Configurações → WhatsApp**, que também reúne os limites, os
  modelos por evento e as respostas automáticas dos itens seguintes.
- (continua) Cada limpeza vai para a auditoria com a quantidade removida.
- "Logs do Baileys": como o log já é silencioso, o que se limpa são **os rastros do programa**:
  `logs/audit.jsonl` e `logs/recovery.jsonl` ganham rotação (por tamanho e por 180 dias).

**A3. Limites de envio** (valem para todos os disparos; ver Fase C)
- Teto por hora e por dia (padrão 30 e 200), intervalo aleatório entre mensagens (padrão 8 a 25 s),
  e janela de horário (padrão 8h–19h, sem domingo). O que sobra espera a próxima janela.
- Pausa automática se o WhatsApp devolver erro de limite ou se a conexão cair várias vezes seguidas.

### Segurança e privacidade
Nada novo sai do computador. O que entra (mensagens recebidas) é guardado cifrado, com o mínimo necessário
(item 6.1). O soquete passa a *receber* texto, então a política de privacidade ganha uma linha.

### Arquivos
`backend/messaging.cjs`, novo `backend/wa-hygiene.cjs`, `backend/store.cjs` (rotação de logs),
`frontend/src/Services.jsx`, `docs/PRIVACIDADE.md`, `tests/messaging-*.test.cjs`.

### Testes
Teste unitário da limpeza com chaves de todos os tipos (só os seguros somem), do limitador (teto, janela,
intervalo) com relógio simulado, e do filtro de JID. O soquete real não roda em teste automático; o
comportamento é verificado com um falso `makeWASocket`.

---

## Fase B — Itens 6 e 1: modelos de WhatsApp por finalidade e audiência/perícia na agenda

### O que existe hoje
- Modelos de WhatsApp têm só `purpose: 'general' | 'birthday'`. Variáveis: `{1}` nome, `{2}` primeiro nome,
  `{3}` escritório, e `{4}` data, `{5}` hora, `{6}` título só no lembrete de audiência.
- A agenda já tem tipo "Audiência" e "Reunião" e "Avisar o cliente por WhatsApp" (`HearingReminders`),
  mas é **um único lembrete**, N dias antes, com texto padrão curto. Não há confirmação no ato do
  agendamento, nem local, modalidade (presencial ou virtual), link, nem "Perícia".
- Os modelos ficam em listas soltas, sem ligação com o evento que os dispara.

### O que muda — modelos
**B1. Finalidades de modelo** (campo `purpose` ampliado): `confirmacao-evento`, `lembrete-evento`,
`reagendamento`, `cancelamento`, `andamento`, `cobranca`, `aniversario`, `boas-vindas`,
`resposta-automatica`, `geral`. A tela de modelos mostra **grupos por finalidade**, com um modelo
**padrão** por finalidade (o programa traz um texto pronto bem redigido, editável) e a prévia com dados
de exemplo. O modelo escolhido para cada evento fica em Configurações → WhatsApp.

**B2. Variáveis nomeadas e completas**, com seletor para inserir e conferência na hora de salvar (variável
desconhecida avisa):
`{cliente}`, `{primeiro_nome}`, `{escritorio}`, `{advogado}`, `{processo}`, `{numero_processo}`,
`{evento}` (Audiência de instrução, Perícia...), `{data}`, `{dia_semana}`, `{hora}`, `{local}`, `{modalidade}`,
`{link_sala}`, `{vara}`, `{comarca}`, `{valor}`, `{vencimento}`, `{ultimo_andamento}`, `{data_andamento}`.
As variáveis antigas `{1}…{6}` continuam funcionando (nenhum modelo existente quebra).

### O que muda — agenda (pedido 1)
**B3. Tipos e campos do evento**: tipos **Audiência**, **Perícia**, **Reunião**, **Diligência**, além de
Prazo e Tarefa. Para os quatro primeiros, campos novos: **subtipo** (conciliação, instrução e julgamento,
una, perícia médica, perícia contábil...), **modalidade** (presencial, videoconferência), **local ou
endereço**, **link da sala**, **vara/órgão**, **observações para o cliente** (o que levar, a que horas chegar).
Vindo do processo, o programa já preenche vara, comarca e juiz.

**B4. Confirmação do evento e disparo ao cliente**
Ao salvar um evento com cliente:
1. Abre uma **janela de conferência** com a mensagem pronta (modelo `confirmacao-evento`), os campos
   preenchidos e o número do cliente. O advogado vê, edita se quiser e escolhe **Enviar agora**,
   **Enviar mais tarde** ou **Não avisar**. (Nada sai sem esse passo; o modo "enviar sem perguntar" é uma
   opção que o escritório liga, e não vem ligado.)
2. Cria os **lembretes** escolhidos (padrão: 7 dias, 1 dia e 2 horas antes), cada um com seu modelo.
3. Se o evento **mudar de data ou hora**, envia o modelo `reagendamento`; se for **cancelado ou concluído
   antes**, cancela os lembretes pendentes e (opcional) envia `cancelamento`.
4. O cliente pode **responder "1" para confirmar presença ou "2" para pedir contato** (ligação com o 6.1);
   a resposta aparece no evento ("Cliente confirmou em 12/11, 14:05").
O estado do aviso fica visível no evento: *a enviar*, *enviado*, *confirmado pelo cliente*, *sem WhatsApp*.

### Arquivos
`backend/hearing-reminders.cjs` (vira `event-messages.cjs`), `backend/library.cjs`, `app/message-variables.mjs`,
`backend/validation.cjs` (campos novos do compromisso), `frontend/src/EntityForm.jsx`,
`frontend/src/Templates.jsx`, nova janela `frontend/src/EventNotice.jsx`, `docs/ATUALIZACOES.md`.
Migração: não precisa de tabela nova (campos entram no registro cifrado); as tarefas antigas continuam válidas.

### Testes
Variáveis (todas substituem, desconhecida avisa, antigas intactas); lembretes múltiplos sem duplicar ao
editar; reagendamento e cancelamento; evento sem WhatsApp do cliente; teste de interface do fluxo
"salvar audiência → conferir mensagem → enviar".

---

## Fase C — Item 2: disparos melhores (frequência, datas, regras)

### O que existe hoje
Série de mensagens com `weekly`, `monthly` e `dates` (`recurrence.cjs`), aniversário automático anual
(`birthdays.cjs`), campanhas de e-mail e lembrete de audiência. Cada um com sua lógica; não há regra de
horário, limite nem opção de "sair".

### O que muda — um só **motor de campanhas** (`backend/campaigns.cjs`)
**C1. Gatilhos** (o que dispara a mensagem):
- **Data fixa anual**: aniversário do cliente (já existe), aniversário de **cliente do escritório** (desde a
  contratação), datas do calendário: Dia do Advogado (11/08), Natal, Ano-Novo, Dia da Justiça, Páscoa etc., e
  datas **escolhidas pelo escritório**.
- **Datas específicas**: uma lista (já existe) com edição.
- **Recorrência**: diária (dias úteis), semanal, quinzenal, mensal, **trimestral**, semestral, **anual**, com
  data de fim ou número de ocorrências.
- **Relativos ao evento**: X dias antes ou depois de uma audiência, perícia, prazo ou vencimento de parcela.
- **Eventos do sistema**: processo cadastrado (boas-vindas), processo concluído (satisfação / pedido de
  avaliação), honorário vencido (cobrança gentil, no máximo 2 avisos), documento pendente do cliente.

**C2. Quem recebe** (segmentos): todos os clientes ativos; por **área** (trabalhista, família...); por
**etiqueta** do processo; por **fase**; por **processo**; lista **escolhida à mão**. Mostra a contagem antes
de ativar ("vai para 83 clientes").

**C3. Regras de proteção** (valem para todos os gatilhos):
- **Janela de horário** e dias da semana (padrão 8h–19h, sem domingo), e fuso do escritório.
- **Limites** por hora e por dia e **intervalo aleatório** entre mensagens (da Fase A).
- **Descadastro**: o cliente que responder SAIR/PARAR deixa de receber campanhas e a marca fica no
  cadastro ("Não receber campanhas"); mensagens do **processo** (audiência, andamento pedido) continuam.
- **Sem duplicar**: a mesma campanha não vai duas vezes ao mesmo cliente no mesmo período.
- **Prévia e teste**: "enviar uma amostra para mim" antes de ativar, e a lista exata dos próximos envios.
- **Calendário de envios**: tela com o que vai sair nos próximos 30 dias, por dia, com pausar uma
  campanha ou um envio isolado.

**C4. Migração**: o aniversário automático atual vira a campanha "Aniversário" (sem mudar o comportamento
para quem já usa). Séries já agendadas continuam e aparecem no calendário.

### Arquivos
Novo `backend/campaigns.cjs` e `app/campaign-rules.mjs` (cálculo das datas, testável sem relógio real),
`backend/birthdays.cjs`, `backend/recurrence.cjs`, `backend/messaging.cjs`, `frontend/src/Campaigns.jsx`,
`migrations/011-campaigns.sql` (campanhas e descadastros; sem remover dados).

### Testes
Cálculo de datas: anual em 29/02, mensal em 31, feriados móveis (Páscoa), fuso e horário de verão;
segmentos; janela e limites; descadastro; não duplicar; migração do aniversário.

---

## Fase D — Item 6.1: resposta automática e andamento pelo WhatsApp

### O que existe hoje
Nada recebe mensagem. O andamento dos processos (DataJud) já fica guardado e cifrado
(`datajud.movements`), e o cliente tem WhatsApp cadastrado.

### O que muda
**D1. Receber e classificar** (usa o ouvinte da Fase A): só conversa individual com **número que é de
cliente cadastrado**. De número desconhecido: uma resposta curta e fixa ("Aqui é o escritório X. Para
atendimento, fale com a equipe") **uma vez por 24 h**, e aviso ao escritório. Grupos e canais, nunca.

**D2. Fluxo de respostas** (`backend/wa-flows.cjs`): um menu simples por palavras-chave, configurável em
Configurações → WhatsApp → Respostas:

| Cliente escreve | O sistema faz |
|---|---|
| `1` ou "andamento" | Fluxo de **andamento** (abaixo) |
| `2` ou "audiência" | Informa a **próxima audiência/perícia** do cliente (data, hora, local, link) |
| `3` ou "falar com o escritório" | Avisa a equipe (notificação no programa) e responde que retornam no expediente |
| `SIM`/`CONFIRMO` depois de um lembrete | Marca **presença confirmada** no evento |
| `SAIR`/`PARAR` | Descadastro de campanhas |
| Qualquer outra coisa | Resposta padrão com o menu; no máximo 1 vez a cada 30 min por número |
Fora do horário, responde "retornamos no próximo dia útil". Tudo isso é **editável** (textos e palavras).

**D3. Andamento por CPF — com verificação em duas camadas**
1. O número que escreveu **tem de ser o cadastrado do cliente** (comparação tolerante ao 9º dígito e ao +55).
2. O cliente informa o **CPF**; o sistema confere com o do cadastro. Errou 3 vezes: bloqueia por 24 h e
   avisa o escritório.
3. O cliente precisa estar com **"Autoriza consulta de andamento por WhatsApp"** marcado no cadastro
   (opt-in; vem **desligado**).
4. Se o cliente tem vários processos, mostra a lista numerada para ele escolher.
5. Resposta: **último andamento público** com data, em linguagem simples, e a data da última atualização.
   Nunca envia teor de decisão, nome de parte contrária nem valor.
6. **Segredo de justiça**: processo marcado como sigiloso **não é respondido** ("fale com o escritório").
7. Limite de 5 consultas por cliente por dia.
8. Cada resposta vai para a **auditoria** (quem, qual processo, quando), sem guardar o CPF digitado.
**Modo de aprovação**: o escritório escolhe **Responder sozinho** ou **Revisar antes de enviar** (a resposta
vai para a tela Mensagens como rascunho e um clique envia). O padrão é **revisar**.

**D4. "Atualizar andamento" a pedido**: se o último DataJud for antigo (> 12 h), o fluxo consulta o DataJud
**uma vez** antes de responder (usa a ativação do DataJud já existente; sem ela, responde com o último
andamento registrado e a data dele). O escritório também pode **registrar um andamento à mão** e ele
entra no fluxo.

### Segurança e privacidade (resumo para a política)
Resposta automática só a número cadastrado; CPF não é guardado; dado enviado é só o público e o mínimo;
opt-in por cliente; segredo de justiça excluído; limite de consultas; auditoria; modo de revisão como padrão.
Recomendação: usar um **número de WhatsApp só do escritório**, não o pessoal do advogado.

### Arquivos
Novo `backend/wa-inbox.cjs` (recebimento e caixa de entrada cifrada), `backend/wa-flows.cjs`,
`backend/messaging.cjs`, `backend/datajud.cjs`, `frontend/src/Inbox.jsx` (nova aba em Mensagens),
`frontend/src/EntityForm.jsx` (opt-in), `migrations/012-inbox.sql`, `docs/PRIVACIDADE.md`.

### Testes
Comparação de número (com e sem 9, +55); CPF certo, errado e bloqueio; opt-in desligado; segredo de justiça;
vários processos; limite diário; modo de revisão; descadastro; resposta fora do horário; nenhuma resposta a
grupo ou número desconhecido (exceto a padrão única). Um **teste de segurança** explícito: número certo com
CPF de outro cliente, número de outro cliente com o CPF certo, CPF certo sem opt-in.

---

## Fase E — Item 4: intimações bem organizadas (API do DJEN)

### O que existe hoje
A integração com `comunicaapi.pje.jus.br` já existe (`backend/djen.cjs`): busca diária por **OAB e UF** de
cada advogado, guarda cifrado e mostra uma **lista corrida** com abas Nova/Tratada/Descartada, botão
"Calcular prazo" e ligação com o processo pelo número CNJ.

### O que a documentação oficial da API oferece (lida em `swagger/djen.yml`, versão 1.0.4)
- `GET /api/v1/comunicacao` com filtros por OAB, nome do advogado, **nome da parte**, **número do processo**,
  **sigla do tribunal**, intervalo de datas, **meio** (Diário `D` ou Edital `E`) e número da comunicação;
  páginas de 5 ou 100; **cabeçalhos de limite de taxa** (`x-ratelimit-remaining`); erro 429 pede esperar
  1 minuto.
- `GET /api/v1/comunicacao/{hash}/certidao`: **certidão** da comunicação.
- `GET /api/v1/comunicacao/tribunal`: **lista de tribunais**.
- `GET /api/v1/caderno/{sigla}/{data}/{meio}`: caderno completo (não usaremos; pesado e sem necessidade).
- Cada comunicação traz **tipo** (citação, intimação, edital, pauta de julgamento, lista de distribuição,
  ata), **classe**, **órgão**, **destinatários com polo** (A, P, T, D) e **advogados**.

### O que muda
**E1. Tela organizada** (mesma API, melhor apresentação):
- **Agrupar por processo**: um cartão por processo com todas as comunicações dele em linha do tempo, em vez de
  uma lista corrida.
- **Cabeçalho do cartão**: número com máscara, cliente (se cadastrado), classe, órgão, tribunal e **polo do
  cliente**; faixa colorida por urgência.
- **Etiquetas de tipo** com cor (Citação em vermelho, Intimação em âmbar, Pauta, Edital...), e **"disponibilizada
  em / publicada em"** com a data da regra de contagem (dia útil seguinte).
- **Filtros**: situação, tipo, tribunal, advogado (OAB), período, "com processo cadastrado / sem", busca por
  número, parte ou texto. Contadores nos filtros e ordenação por data ou urgência.
- **Texto legível**: o teor é dividido em parágrafos, com **destaque automático** de prazo ("prazo de 15
  dias", "em 5 dias úteis"), data de audiência e valores; "Ler tudo" expande.
- **Ações no cartão**: Calcular prazo (já preenchido com dias e regra sugeridos pelo texto), **Criar
  audiência na agenda** (quando o teor traz data e hora), **Baixar certidão** (PDF), Abrir no tribunal,
  Marcar como tratada/descartada, **Avisar o cliente** (com o modelo de andamento da Fase B).
**E2. Busca avulsa**: botão "Buscar publicações" por **número de OAB e UF** (de qualquer advogado, não só dos cadastrados no escritório: colega, correspondente, sócio novo), **nome do advogado**, **nome da parte**, **número do processo** ou **tribunal**, com intervalo de datas e tipo (Diário ou Edital), usando os mesmos filtros da API. O resultado aparece numa lista à parte, **sem entrar na caixa de intimações**: cada publicação tem "Guardar" (entra na lista e liga ao processo) ou "Cadastrar o advogado do escritório" (passa a ser consultado todo dia). Pesquisa por OAB ou nome é limitada a 10 mil resultados pela API e conta no limite de requisições; o programa avisa e mostra quantas restam.
**E3. Cadastrar processo a partir da intimação**: processo que ainda não existe vira cadastro com os dados
da comunicação (número, classe, órgão, partes pelos destinatários).
**E4. Respeito ao limite da API**: ler `x-ratelimit-remaining`, espaçar as páginas, esperar 1 minuto no
429 e guardar o horário da próxima tentativa. Falha de um advogado não impede os outros.
**E5. Saúde da integração**: "Última consulta, quantas novas, erros" visível na tela; aviso se a consulta
falhar por 3 dias seguidos (o risco real é perder uma intimação).

### Arquivos
`backend/djen.cjs` (filtros, certidão, tribunais, limite de taxa), novo `app/intimation-text.mjs` (detecção
de prazo e data no texto, sem rede), `frontend/src/Intimations.jsx` (reescrita), `desktop/ipc/public.cjs`,
`docs/API-MCP.md` (ferramenta de busca para agentes), `tests/public-data.test.cjs`.

### Testes
Detecção de prazo e data em textos reais anonimizados (15 dias, 5 dias úteis, "em 20/11/2026 às 14h");
agrupamento; limite de taxa e 429 com o relógio simulado; certidão com resposta simulada; um teste de
interface com 3 processos e vários tipos.

---

## Fase F — Item 5: documentos com cabeçalho, rodapé, imagens e fontes

### O que existe hoje
O gerador (`backend/document-files.cjs`) monta o DOCX à mão e o PDF com `pdf-lib`, a partir de parágrafos
simples. **Não há** cabeçalho nem rodapé, imagem, escolha de fonte (fixo Times New Roman 12), tamanho,
espaçamento, margens ou numeração de página. No PDF, as fontes são as 14 padrão (só Latin-1). O editor de
modelos (`EmailEditor`) é o mesmo dos e-mails: negrito, itálico, sublinhado, listas, alinhamento, tamanho
(4 níveis) e cor.

### O que muda
**F1. Papel timbrado** (Configurações → Documentos, com **vários papéis**; um padrão):
- **Cabeçalho** e **rodapé** com **imagem** (logo, faixa; PNG ou JPG, até 2 MB, com altura máxima) e **texto**
  (nome do escritório, OAB, endereço, telefone, site) em até 3 colunas; alinhamento esquerda, centro ou direita.
- **Numeração de página** ("Página 1 de 5"), com opção de não numerar a primeira.
- **Marca d'água** de texto ou imagem (opcional, discreta).
- **Margens** (padrão ABNT 3/3/2/2 cm, editável), **papel** A4 ou Ofício.
- **Primeira página diferente**: cabeçalho completo só na primeira, e um simples nas seguintes.
- O papel é escolhido ao **gerar o documento** (e pode ser fixado no modelo). Variáveis valem no
  cabeçalho e no rodapé (`{cliente}`, `{numero_processo}`, `{data}`).

**F2. Fontes e formatação** (no editor de modelos e no gerador):
- **Família**: lista **as fontes instaladas no computador** (lidas do Windows), com as clássicas em destaque (Times New Roman, Arial, Calibri, Cambria, Garamond, Georgia, Verdana, Tahoma, Courier New). No **DOCX** vai o **nome** da fonte e o Word usa a instalada. No **PDF** o programa lê o arquivo da fonte instalada (`C:\Windows\Fonts` e a pasta de fontes do usuário), incorpora **só os caracteres usados** (subconjunto) pelo pacote `@pdf-lib/fontkit`, e o PDF fica com o mesmo visual do Word, texto selecionável e acentos e símbolos além do Latin-1. Detalhes que o desenho respeita:
  - **Permissão da fonte:** cada fonte traz um indicador de incorporação (`fsType`). Se ela proibir incorporar, o programa **não a usa no PDF** e avisa.
  - **Coleções (`.ttc`)**, como a Cambria: o arquivo é aberto pelo nome da fonte dentro da coleção.
  - **Fonte que não existe no computador** (um modelo vindo de outro computador): troca por uma equivalente (Times New Roman → Times, Arial → Helvetica, Courier New → Courier, que já vêm no PDF) e **avisa na prévia** qual fonte foi usada no lugar. Calibri, Cambria, Garamond, Georgia, Verdana e Tahoma ausentes caem em Times ou Helvetica, com o aviso. Nenhuma fonte é empacotada no programa, então o instalador não cresce.
  - **Só Windows** por enquanto; no Linux o PDF usa as fontes padrão do PDF e o aviso aparece.
- **Tamanho** em pontos (8 a 72), **entrelinhas** (simples, 1,15, 1,5, 2), **espaço entre parágrafos**,
  **recuo da primeira linha** e recuo esquerdo (citações), **cor do texto**, **realce**, **tachado**,
  sobrescrito/subscrito, **maiúsculas**.
- **Listas** numeradas e com marcadores, com níveis; **tabelas** simples (linhas, colunas, bordas, cabeçalho);
  **quebra de página**; **linha horizontal**; **imagens no corpo** (assinatura, quadro, foto).
- **Estilos salvos** (Título, Subtítulo, Corpo, Citação) e "copiar formatação".
- **Modelos prontos** mantêm o visual atual (nenhum documento existente muda sem ser escolhido).

**F3. Prévia fiel**: a tela "Gerar documento" mostra a página (A4 com cabeçalho, rodapé e margens), com
quebra de página, para conferir antes de gerar. A mesma estrutura alimenta o DOCX e o PDF, para os dois
saírem iguais.

### Segurança
Imagens são validadas (tipo real pelo conteúdo, tamanho, dimensões), reencodadas e guardadas cifradas;
nenhuma imagem remota (nada de URL externa). Fontes só são **lidas** do próprio computador, nunca copiadas para fora nem baixadas; o PDF leva só o subconjunto usado.

### Arquivos
`backend/document-files.cjs` (DOCX com `header`/`footer`/imagens/tabelas; PDF com fontkit), novo
`backend/letterhead.cjs` e `app/page-layout.mjs` (quebra de página e medidas, sem I/O), `app/document-template.mjs`
(estilos e tabelas no HTML permitido), `frontend/src/Letterhead.jsx`, `frontend/src/DocumentEditor.jsx`
(barra de formatação própria, separada do e-mail), `frontend/src/GenerateDocument.jsx`, `electron-builder.yml`
dependência `@pdf-lib/fontkit` e novo `backend/system-fonts.cjs` (lista as fontes instaladas, lê `fsType` e coleções). Nenhuma fonte é empacotada.

### Testes
Abrir o DOCX gerado com `mammoth` e conferir cabeçalho, rodapé, imagem e tabela; PDF com número de páginas
correto, texto extraível com acentos, fontes incorporadas em subconjunto (`pdf-lib` lista as fontes), fonte com `fsType` restrito recusada e fonte ausente trocada com aviso; quebra de página com
texto longo e tabela; o mesmo documento nos dois formatos com a mesma contagem de páginas (tolerância
pequena). Teste de interface: criar papel timbrado, gerar e conferir a prévia.

---

## Decisões que dependem de você

1. **6.1 — modo padrão das respostas automáticas:** *revisar antes de enviar* (recomendado) ou *responder
   sozinho*? E confirma o desenho de **número + CPF + opt-in** em vez de só CPF?
2. **Número de WhatsApp:** você vai usar um número **só do escritório** para os disparos e respostas
   (recomendado, por causa do risco de banimento)? Ou o mesmo do advogado?
3. **Limites de envio:** os padrões propostos (30 por hora, 200 por dia, 8h–19h, sem domingo) servem?
4. **Campanhas de datas comemorativas:** quais entram de fábrica (Dia do Advogado, Natal, Ano-Novo, Dia da
   Justiça, Páscoa)? Mensagem de **cobrança** automática entra ou fica manual?
5. ~~**Fontes no PDF**~~ **Decidido:** usar as fontes instaladas no Windows (item 5, F2).
6. **Ordem:** posso seguir A → B → C → D → E → F? Os itens E e F podem andar antes se preferir.

## Como cada entrega será verificada
`npm run check`, validação de migrações, todos os testes de interface e o teste real de atualização antes
de cada release. Toda função nova que fale com serviço externo ou com clientes nasce **desligada**, com o
que é enviado descrito em `docs/PRIVACIDADE.md`. Migrações só acrescentam.
