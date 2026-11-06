# Arquitetura

Electron reúne Chromium e Node.js num instalador independente. Essa escolha prioriza integração com Baileys e portabilidade; seu consumo de memória é maior que o de uma interface Tauri nativa, mas dispensa um runtime Node separado e simplifica os serviços internos.

```text
Electron
├── Renderer React: arquivos locais, sem Node.js
├── Preload: comandos permitidos, sem acesso genérico a IPC
└── Processo principal
    ├── SQLite nativo do Node
    ├── Cofre AES-256-GCM + safeStorage do sistema
    ├── Documentos criptografados
    ├── Agenda e notificações
    ├── Fila de e-mail/WhatsApp
    ├── Backups autenticados
    └── Atualizador e recuperação independente
```

Não há servidor HTTP aberto, porta de API local ou banco externo. O backend é um conjunto de serviços internos acessados por IPC. `contextIsolation`, sandbox, CSP, bloqueio de navegação e validação de remetente IPC protegem a fronteira com a interface.

Dados pessoais são serializados e criptografados nos campos `payload`. Identificadores, categoria, datas de alteração, estado das filas e eventos técnicos permanecem estruturados para agendamento e auditoria. Busca de conteúdo é feita em memória após descriptografia. Esta versão prioriza escritórios locais de pequeno porte; cargas grandes devem ser medidas antes da distribuição.

Operações críticas registram atividade num coordenador. Backup, restauração e preparação de instalação usam exclusão mútua. A fila só inicia novos envios fora de manutenção. Mensagens com resultado desconhecido após falha ou queda não são reenviadas automaticamente.

Migrações recebem checksum imutável, são aplicadas em ordem dentro de transação e são precedidas por backup SQLite. A base é verificada com `integrity_check` e `foreign_key_check`. Uma versão antiga que não reconheça migrações mais recentes é recusada, exigindo restauração de backup compatível.

Backups contêm banco consistente, documentos cifrados, configurações e chave envolvida pelo cofre do OS. Um manifesto cifrado autenticado protege a lista de hashes. Para uma atualização Windows, o diretório do programa também é copiado, permitindo executar o programa anterior mesmo se a instalação principal falhar.

Não existe segredo embutido no frontend. API Keys, sessão WhatsApp e chave privada de assinatura de releases não entram no diagnóstico. Chaves privadas de publicação pertencem exclusivamente aos Secrets/serviço de assinatura da organização.


## Biblioteca e PDF (0.5.0)

A biblioteca criptografada reúne modelos documentais, de WhatsApp e e-mail. Cada modelo possui tipo, grupo e conteúdo; os modelos de e-mail podem guardar assunto e HTML sanitizado. Arquivos e modelos compartilham uma área de navegação, preservando as tabelas e os vínculos existentes.

PDFs são processados por worker_threads com limites de entrada, progresso e cancelamento. A UI envia somente a operação e os limites; os caminhos são escolhidos em diálogos nativos do processo principal, sem expor leitura arbitrária ao renderer ou à API de agentes. Uma operação ativa impede manutenção/atualização. O worker usa PDFium WebAssembly local para renderizar as páginas e pdf-lib para gerar PDF/A-2b com bitmaps RGB, perfil sRGB2014 e XMP. A rasterização evita carregar fontes ou recursos ativos do original para a saída; texto pesquisável e assinaturas não são preservados. Cada parte recebe perfil e metadados próprios e a divisão verifica seu tamanho final serializado. O WASM e o perfil acompanham o instalador; não há download em tempo de uso.

O repositório é fixo. A chave privada de publicação nunca integra o pacote; a pública fixa autentica os manifestos de atualização.


## Prévia visual, termos e rotina de backup

E-mails usam um gerador único de HTML com tabelas e estilos inline. Conteúdo é sanitizado; textos do cabeçalho e rodapé são escapados e os controles visuais são validados. A prévia fica em iframe sem scripts e usa o mesmo gerador do envio. Imagens selecionadas são incorporadas por CID no envio, sem exigir URLs públicas.

A versão atual dos termos é aceita pelo usuário no aplicativo. Antes disso, mutações, integrações e processamento automático ficam bloqueados; a exportação dos dados permanece disponível. O aceite contém apenas versão e data local.

A rotina semanal mantém um backup completo local. O envio por e-mail é opcional, dirigido a um único responsável e respeita a pausa de envios. Uma resposta de resultado incerto bloqueia novas tentativas automáticas. O aviso diário exibe a data efetiva da última cópia.

A cópia portátil serializa cadastros, documentos, modelos, histórico e anexos, sem chaves de integração ou sessão WhatsApp. O conteúdo é comprimido e criptografado com AES-256-GCM e chave derivada de senha por scrypt (N=16384, r=8, p=1), com salt e IV aleatórios. A importação valida e prepara um backup no cofre do destino antes da restauração normal, preservando o estado anterior. Mensagens pendentes são restauradas em revisão.

Recorrências são expandidas e validadas antes da gravação em uma transação única. Cada ocorrência tem horário UTC, identificador de série e resultado próprios no payload criptografado; o cálculo respeita fuso IANA e ajuste de mês curto, sem cálculo de prazo processual. A edição altera uma ocorrência; o cancelamento de série preserva envios iniciados/concluídos.
