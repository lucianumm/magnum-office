# Privacidade, proteção de dados e LGPD

Versão: 1.1.0 · Magnum Office.

## Onde os dados ficam

Clientes, processos, compromissos, anotações, modelos, documentos e histórico de mensagens ficam na base local do computador. Cadastros, documentos e segredos de integração são criptografados; preferências de interface, identidade visual, padrão visual dos e-mails, nome do escritório, e-mail de backup e datas operacionais ficam no arquivo de configuração local. O sistema não inclui coleta automática de telemetria de uso ou envio de cadastros ao autor.

O escritório define a finalidade e as condições do tratamento realizado em sua atividade. É responsável por avaliar as bases legais, limitar dados ao necessário, controlar acessos, corrigir informações e estabelecer períodos de retenção e descarte. O uso do programa não representa certificação automática de conformidade com a LGPD. O aceite do usuário não substitui a informação aos titulares nem a base legal adequada para cada finalidade.

## Quando há comunicação externa

- WhatsApp/Baileys: ao vincular uma conta e realizar comunicações, os dados necessários passam pela infraestrutura do WhatsApp. Baileys é uma integração não oficial.
- Resend: mensagens, endereços e anexos são enviados ao fornecedor quando o responsável configura e utiliza o serviço.
- Backup por e-mail: opção voluntária, com um único e-mail do responsável. O arquivo contém dados de todos os clientes, é protegido por senha e não inclui chaves de integração ou sessão WhatsApp. A senha não é enviada junto. O Resend e o provedor de e-mail tratam metadados necessários à entrega e armazenam a mensagem conforme suas próprias condições.
- Agentes/API/MCP: um agente autorizado pode consultar dados e, se habilitado, alterá-los. O agente e os fornecedores utilizados por ele podem receber as informações consultadas. Revogue o token quando não for mais necessário.
- GitHub: utilizado para consultas de versões e downloads de atualização, que vêm ligados por padrão e podem ser desligados em Configurações → Atualizações. O GitHub recebe o endereço IP da conexão. Nenhum cadastro do escritório integra essas consultas.
- Links e contato: abrir tribunais, páginas externas ou WhatsApp utiliza os serviços escolhidos pelo usuário.
- DataJud (CNJ): desligado por padrão. Quando ativado em Configurações → Consultas públicas, envia ao CNJ apenas o número CNJ dos processos (na consulta manual ou na conferência diária dos processos em andamento) e recebe metadados e movimentos públicos. Nomes de clientes não são enviados.
- Preenchimento do processo pelo número (DataJud/CNJ): desligado por padrão. Ativado, ou pelo botão Buscar no DataJud, envia ao CNJ apenas o número CNJ digitado no cadastro do processo e preenche os campos vazios com classe, vara, comarca, distribuição e instância. Nada é gravado além do que a pessoa salvar no cadastro.
- Preenchimento da empresa pelo CNPJ (dados abertos da Receita Federal): desligado por padrão. Ativado, ou pelo botão Buscar dados da empresa, envia apenas o número do CNPJ à BrasilAPI (brasilapi.com.br) e, se ela falhar, ao minhareceita.org, e preenche os campos vazios com razão social, endereço e sócio administrador. Nomes e CPFs não são enviados.
- Diário de Justiça Eletrônico Nacional (CNJ): desligado por padrão. Quando ativado, envia ao CNJ apenas o número e a UF da OAB dos advogados cadastrados no escritório e recebe as comunicações publicadas em nome deles, que ficam criptografadas no computador.
- Banco Central (SGS): os índices de correção são baixados somente quando o usuário pede, enviando apenas o código da série e o período. Os índices são dados públicos e ficam salvos sem criptografia.
- Planilhas, agenda (.ics) e memórias de cálculo exportadas saem do cofre sem criptografia, no local escolhido pelo usuário.

Avalie os termos, locais de tratamento e eventuais transferências internacionais dos fornecedores antes de utilizá-los. Não ative integrações para dados cujo compartilhamento não esteja autorizado ou amparado por base legal adequada.

## Recursos para apoiar o atendimento aos titulares

Cadastros podem ser consultados e corrigidos. A exportação fornece dados legíveis e documentos originais. A exclusão verifica vínculos para evitar inconsistência; remova ou reorganize os vínculos necessários antes de excluir. Registros históricos e cópias anteriores podem continuar em backups até seu descarte pelo responsável. Avalie obrigações legais de conservação antes de eliminar dados.

A preferência “Não receber e-mails” bloqueia comunicações vinculadas ao destinatário na fila, mas não equivale a uma base legal para todos os demais tratamentos. Pedidos de acesso, correção, eliminação, portabilidade ou outras providências devem ser dirigidos ao escritório que cadastrou os dados e analisados segundo a legislação aplicável.

## Backups e segurança

Backups locais completos dependem do cofre da mesma conta/computador para recuperação. Uma cópia portátil protegida por senha pode ser importada em outra instalação e requer a senha escolhida pelo responsável. Credenciais de integração ficam de fora dessa cópia; disparos ainda não enviados voltam para revisão.

Guarde uma cópia fora do computador e teste a restauração. Se dados originais e todas as cópias forem perdidos, não há recuperação garantida. Arquivo protegido sem a senha não pode ser recuperado pelo programa ou pelo autor. Desativar backup por e-mail interrompe envios futuros; não apaga mensagens e anexos que já tenham sido entregues.

Proteja a conta do sistema operacional, controle quem pode abrir o aplicativo e limite acesso a exportações, pendrives, e-mail e senhas. A API local não substitui políticas de acesso do escritório. O responsável deve manter procedimentos para avaliar e responder a incidentes, considerando as obrigações legais aplicáveis.

## Termos e transparência

O aceite registra versão e data no computador. Disparos, mensagens, lembretes e rotinas de backup exigem o aplicativo aberto ou na bandeja e o computador ligado; funções externas também exigem conexão. O contato com Lucianum é opcional e não concede acesso automático aos dados do escritório.

Fontes oficiais de referência: [LGPD — texto atualizado](https://www2.camara.leg.br/legin/fed/lei/2018/lei-13709-14-agosto-2018-787077-normaatualizada-pl.html) e [Guia de segurança da informação da ANPD](https://www.gov.br/anpd/pt-br/centrais-de-conteudo/materiais-educativos-e-publicacoes/guia-orientativo-sobre-seguranca-da-informacao-para-agentes-de-tratamento-de-pequeno-porte).


## Felicitações de aniversário

A data de nascimento é opcional e permanece no cadastro criptografado. O escritório decide se pode usar esse dado para felicitações e ativa o envio por cliente. Modelos podem utilizar nome completo, primeiro nome e nome do escritório. Ao ativar, o WhatsApp recebe a mensagem personalizada na data programada; desative a opção para interromper envios automáticos futuros. A cópia portátil restaura a automação desativada e preserva o histórico de prevenção de duplicatas.
