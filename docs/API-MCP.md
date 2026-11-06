# API/MCP local — prévia 0.6.0-beta.1

Em **Configurações → API / MCP**, escolha a porta (padrão 47831), ative a integração e salve. Copie o token para a configuração do seu agente. A API começa desativada. Sem a opção **Permitir criação, edição e exclusão**, o agente pode apenas consultar.

O aplicativo deve continuar aberto ou na bandeja. O serviço atende exclusivamente em `127.0.0.1`; não publique a porta na internet. Requisições de páginas de navegador com `Origin` são recusadas. Não há CORS. Cada chamada exige `Authorization: Bearer SEU_TOKEN`. O token é criptografado no cofre local; a tela não o exibe. **Gerar / revogar token** invalida imediatamente o anterior. O agente recebe os dados permitidos; use essa permissão apenas com agentes de sua confiança.

## MCP

Transporte Streamable HTTP, endpoint `http://127.0.0.1:47831/mcp`. Exemplo genérico, ajustável ao formato do seu cliente:

```json
{
  "mcpServers": {
    "advocacia": {
      "url": "http://127.0.0.1:47831/mcp",
      "headers": { "Authorization": "Bearer SEU_TOKEN" }
    }
  }
}
```

Não coloque tokens reais em repositórios ou documentos compartilhados. Se a porta estiver ocupada, escolha outra nas configurações e atualize a URL do agente.

## REST

`GET /api/v1` retorna o catálogo de ferramentas e seus JSON Schemas. Execute qualquer ferramenta por `POST /api/v1/tools/NOME`, corpo JSON. Sucesso: `{ "result": ... }`; erro de chamada: HTTP 400 e `{ "error": "..." }`; credenciais/origem inválidas: 401. Corpo limitado a 160 mil bytes.

| Ferramenta | Operação |
|---|---|
| `list_records` | Contatos, agenda, notas ou processos, com busca e paginação |
| `save_record` | Criar ou editar parcialmente um registro pelo ID |
| `delete_record` | Excluir registro, respeitando vínculos |
| `list_templates` | Consultar modelos e grupos |
| `save_template_group` | Criar ou renomear grupo |
| `save_template` | Redigir ou editar modelo com grupo e HTML sanitizado |
| `delete_template` | Excluir modelo ou grupo vazio |
| `list_message_schedules` | Consultar disparos sem conteúdo dos anexos |
| `draft_message_schedule` | Preparar disparo para revisão local |
| `revise_message_schedule` | Alterar disparo, mantendo revisão obrigatória |
| `cancel_message_schedule` | Cancelar disparo pendente |

Os tipos de registro (`kind`) são `clients`, `tasks`, `notes`, `cases`. Os campos de `data` são texto. Para editar, envie `id` ao lado de `kind` e apenas os campos alterados em `data`. Referências `clientId` e `caseId` precisam existir. Atualizações, senhas, chaves do Resend, arquivos arbitrários e execução de programas não são expostos.

Contato:

```json
{"kind":"clients","data":{"name":"Cliente de exemplo","email":"cliente@example.com","phone":"5564999999999"}}
```

Compromisso:

```json
{"kind":"tasks","data":{"title":"Reunião de atendimento","due":"2026-11-10T14:30","type":"Reunião","priority":"Normal","notes":"Conferir documentos"}}
```

Datas da agenda são locais ao computador, sem fuso, em `AAAA-MM-DDTHH:mm`. Para mensagens, `scheduledFor` é uma data ISO UTC futura, por exemplo `2026-11-10T17:30:00.000Z`. O WhatsApp usa país + DDD + número, somente dígitos. E-mail exige domínio próprio e configuração Resend/Cloudflare confirmada no aplicativo.

Mensagens criadas ou alteradas pelo agente ficam com `status: needs_review`. O usuário deve abrir **Mensagens → Editar**, conferir conteúdo, destinatário e horário e confirmar para entrar na fila. A integração não disponibiliza ferramenta para autorizar automaticamente esses envios. Operações ficam bloqueadas durante manutenção e restauração.

## Importações e modelos

**Importar dados** aceita CSV (vírgula, ponto e vírgula ou tabulação), TSV, TXT tabulado e Excel XLSX, até 5 MB e 5.000 linhas por planilha. A primeira linha contém cabeçalhos. Selecione a planilha e associe as colunas, confira a prévia e marque as linhas a importar. Para XLS antigo, salve como XLSX. Fórmulas não são importadas: transforme em valores fixos primeiro.

Datas aceitas: `DD/MM/AAAA`, `AAAA-MM-DD` e células de data do Excel. Use hora `HH:mm`. Sem hora em uma coluna de data separada, é usado 09:00. Importar agenda cria compromissos e não dispara mensagens. Linhas inválidas ou duplicadas são bloqueadas. E-mail/documento identificam contatos repetidos; sem ambos, nome + telefone. Compromissos são comparados por título + horário. Registros existentes não são sobrescritos. Um backup é criado antes de cada importação confirmada.

**Documentos e modelos → Modelos jurídicos** aceita redação com formatação, criação/renomeação de grupos e importação DOCX, TXT ou HTML de até 5 MB. A conversão preserva formatação básica; não reproduz integralmente a diagramação de um documento Word. O arquivo original permanece intacto. O conteúdo dos modelos é criptografado e integra os backups e a exportação geral de dados.

**Mensagens → Campanha de e-mail → Colar vários e-mails** identifica endereços em texto misturado, remove repetidos e permite revisar ou remover cada destinatário, incluindo horário individual. O total combinado com clientes selecionados é de até 100 destinatários distintos. Endereços incompletos não são corrigidos por suposição. O recebimento desativado no cadastro é verificado ao cadastrar e antes de enviar.

Referência do transporte implementado: [SDK MCP oficial — servidor](https://ts.sdk.modelcontextprotocol.io/server).


A biblioteca unificada também inclui modelos de mensagens. `save_template` aceita `kind`: `document`, `whatsapp` ou `email`, além de `subject` para e-mail. Os modelos podem ser editados e excluídos na mesma área. As ferramentas locais de PDF são acionadas pelo usuário na interface; o agente não recebe acesso arbitrário ao sistema de arquivos.


O responsável deve aceitar os termos da versão atual na interface antes de utilizar ferramentas da integração. Modelos de e-mail podem incluir `emailDesign`, com cores, cabeçalho, rodapé e opções validadas. A prévia usa o mesmo gerador visual aplicado no envio. A API não expõe senhas de backup nem configuração de destinatários de cópias de segurança.


## Recorrência e contatos

`save_record` exige `name` e `phone` (WhatsApp com DDD) ao criar contatos. Contatos históricos sem telefone continuam consultáveis; ao editar, informe o campo obrigatório.

`draft_recurring_message_schedule` recebe `message` com o mesmo conteúdo de um disparo e `scheduledFor` ISO UTC obrigatório; `recurrence` tem `frequency` (`weekly`, `monthly` ou `dates`), `timeZone` IANA, `count` e `interval` para repetição ou `dates` ISO UTC extras. Quantidade inclui a primeira ocorrência. Limites: 260 semanais, 60 mensais ou 100 datas específicas, sempre em até cinco anos. Todas as ocorrências ficam em revisão; o agente não autoriza envio automático.


## Aniversários

Contatos aceitam `birthDate` em AAAA-MM-DD. A ativação da automação e a mudança de suas datas/horários exigem confirmação no cadastro local; agentes não podem ativá-la por `save_record`. Modelos de WhatsApp aceitam `purpose: "birthday"`, com `{1}` nome completo, `{2}` primeiro nome e `{3}` escritório. A biblioteca inclui um modelo inicial, editável e removível.
