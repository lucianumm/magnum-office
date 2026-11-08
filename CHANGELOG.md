# Changelog

## 1.9.1 — 08/11/2026

O sistema agora começa configurado para o seu escritório.

- **Configuração inicial obrigatória**: depois de aceitar os termos, um assistente em três etapas pede o nome do escritório, a cidade e o endereço; o seu nome e os advogados com OAB e UF; e a identidade visual (nome exibido, descrição, logo e cor), com prévia ao vivo. O sistema só é liberado depois disso, e os valores de exemplo "Meu escritório" e "Administrador" não são aceitos.
- Quem atualizar de uma versão anterior passa pelo assistente uma vez, com os dados atuais já preenchidos para conferir.
- Quem ainda não tem logo pode seguir com o ícone padrão e escolher a logo depois em **Configurações → Personalizar**.
- Projeto no GitHub com código de conduta, guia de contribuição, política de segurança e modelos de issue e de pull request.
- Automação de testes e publicação atualizada para as versões atuais das ações do GitHub.

## 1.9.0 — 07/11/2026

A maior atualização do Magnum Office: ferramentas para o trabalho jurídico de todo dia, sem servidor e sem assinatura. As consultas a serviços públicos vêm desligadas.

**Processos e clientes**

- Número CNJ conferido pelo dígito verificador: ao digitar, o sistema mostra tribunal, segmento e ano, e o processo ganha o botão para abrir o portal do tribunal. Numerações antigas ou administrativas continuam aceitas.
- Processo completo: polo do cliente, parte contrária e advogado contrário com OAB, comarca, vara, instância, juiz, fase, classe, valor da causa, distribuição, etiquetas, segredo de justiça e processo relacionado.
- Cliente com qualificação completa (pessoa física ou jurídica, estado civil, profissão, RG, endereço em campos) e parágrafo de qualificação pronto para copiar. CPF e CNPJ conferidos, inclusive o CNPJ alfanumérico.
- Cadastro de **Pessoas** (parte contrária, testemunha, perito, correspondente...) e aviso de **conflito de interesses** quando alguém já aparece do outro lado em algum processo.
- **Atendimentos**: ficha de quem ainda não é cliente, com retorno agendado, e conversão em cliente e processo com um clique.
- Advogados do escritório com OAB e UF, cidade e endereço do escritório.

**Prazos e agenda**

- **Calculadora de prazos** para CPC, CLT, Juizados e CPP, com feriados nacionais e forenses, recesso de 20/12 a 20/01, prazo em dobro, publicação após a disponibilização no Diário eletrônico e expediente reduzido. Mostra a memória de cálculo dia a dia e os fundamentos, e cria o prazo e um prazo interno na agenda.
- Calendário do escritório por tribunal: feriados locais, suspensões e indisponibilidades, inclusive colando uma lista.
- **Fluxos por tipo de ação**: tarefas padrão e documentos a pedir ao cliente criados de uma vez.
- **Aviso de audiência ao cliente** por WhatsApp, refeito se a data mudar e cancelado se o compromisso for concluído.
- Exportação da agenda em `.ics` para Google Agenda, Outlook ou celular.

**Documentos**

- **Gerador de documentos** em Word e PDF, em A4 com margens ABNT, preenchido com os dados do cadastro e salvo criptografado no processo. Cinco modelos iniciais: procuração, substabelecimento, contrato de honorários, declaração de hipossuficiência e recibo.
- **Busca dentro dos documentos** (Ctrl+K) em PDFs com texto, Word, TXT e CSV, com o trecho encontrado.

**Financeiro e cálculos**

- **Financeiro**: honorários, parcelamento, honorário de êxito "a apurar", despesas reembolsáveis, recibo com valor por extenso, cobrança por WhatsApp e exportação para Excel.
- **Atualização de débitos** com índices do Banco Central (IPCA, INPC, IGP-M, IPCA-E, Selic e Taxa Legal da Lei 14.905/2024), multa e honorários, com memória de cálculo em PDF. Reproduz os exemplos oficiais da Calculadora do Cidadão.

**Acompanhamento** (desligado por padrão, em Configurações → Consultas públicas)

- **Andamentos pelo DataJud (CNJ)**, com conferência diária e aviso de movimento novo. Envia ao CNJ apenas o número do processo.
- **Intimações do Diário de Justiça Eletrônico Nacional** em nome dos advogados do escritório, ligadas ao processo e com atalho para calcular o prazo. Envia ao CNJ apenas o número e a UF da OAB.

**Relatórios**

- **Relatório ao cliente** em linguagem simples, editável, para copiar, enviar por WhatsApp ou salvar em PDF.
- Tela **Relatórios** com processos por área, fase e situação, prazos, atendimentos, recebimentos e despesas, e os últimos 12 meses.

**Integrações e desempenho**

- Novas ferramentas de leitura para agentes (API/MCP): resumo do processo, prazos, cálculo de prazo e de débito, prévia de documento, andamentos e intimações.
- A tela atualiza quando algo muda, em vez de recarregar tudo a cada 4 segundos.

**Ao atualizar**: a base de dados recebe novas tabelas e uma cópia de segurança é feita antes. Depois disso, versões anteriores não abrem a base; para voltar, use a recuperação, que restaura a cópia. Confira prazos, cálculos e modelos antes de usar: são ferramentas de apoio e não substituem a conferência do advogado.

## 1.3.0 — 06/11/2026

**Interface nova**

- Tela inicial com prazos atrasados, de hoje e da semana logo ao abrir.
- Página própria para cada cliente e processo, com prazos, documentos, mensagens e anotações.
- Menu reorganizado, barra superior única e central de avisos no sino. Busca com Ctrl+K.
- Agenda e Prazos reunidos em uma tela, com visões de calendário e lista.
- Tabelas com ordenação, mais linhas visíveis e telefones formatados. Formulários com o botão Salvar sempre à vista.
- Textos maiores, mais contraste e tema escuro revisado em todas as cores.
- Configurações em menu lateral. Importar dados e Lucianum Magnum foram para Configurações.

**Atualizações**

- O sistema procura e baixa novas versões sozinho e avisa quando estiver pronto. A instalação continua pedindo confirmação, e pode ficar para quando você sair do programa.
- Downloads retomam de onde pararam e usam o proxy e os certificados do Windows.
- Janela de progresso durante a instalação, novidades depois de atualizar e motivo explicado quando algo falha.
- Limpeza automática das cópias deixadas por atualizações, e exclusão manual de backups.

**Outras melhorias**

- Opção de iniciar com o Windows, para manter lembretes e envios ativos depois de reiniciar.
- Tela de recuperação quando uma tela falha, no lugar de uma janela em branco.

**Quem está nas versões 1.0.0 ou 1.1.0 precisa instalar esta versão manualmente**, pelo instalador oficial. Os cadastros são preservados.

## 1.2.0 — 06/11/2026

- Atualização manual forçada, independente da verificação automática, com novo download validado e opção de repetir uma versão que falhou.

- Lista compacta de destinatários após identificar e-mails, com remoção e sem horários por endereço.
- Um único agendamento para todos na campanha e suporte a colar vários e-mails em Nova mensagem.
- Fechamento pelo X oculta diretamente a janela; serviços permanecem na bandeja mesmo se a janela for destruída.
- Assistente de atualização confirma a inicialização antes de encerrar o aplicativo.

## 1.1.0 — 06/11/2026

- Data de nascimento no cadastro, edição e importação de clientes.
- Modelo pré-cadastrado Mensagem aniversário, finalidade própria e variáveis de nome/escritório.
- Envio anual de WhatsApp por cliente, com ativação opcional, horário e prevenção de duplicatas.
- Regras para 29/02, abertura após o horário e bloqueio de envio em dias posteriores.
- Opção explícita de continuar na bandeja ao clicar no X e reabrir pelo ícone.

## 1.0.0 — 05/11/2026

Primeira versão oficial do Magnum Office.

As próximas alterações serão registradas a partir desta versão.
