# Atualizações pelo GitHub

O repositório é fixo: `lucianumm/magnum-office`. O atualizador consulta Releases e seleciona versões mais novas compatíveis com plataforma, arquitetura e canal, sem fazer downgrade. Na consulta comum, versões que falharam ficam bloqueadas.

Cada release publica instalador, `release-stable.json` (ou canal correspondente), assinatura `.sig` e `checksums.txt`. O aplicativo incorpora a chave pública Ed25519 do mantenedor. Metadados alterados, origem diferente, chave desconhecida, tamanho ou SHA-256 incorretos são rejeitados. Nunca se obtém um executável a partir de URLs arbitrárias ou de arquivos da branch main.

No Windows, a versão oficial utiliza verificação pelo manifesto assinado. Não há certificado Authenticode no instalador atual. Se um futuro build incorporar `WINDOWS_PUBLISHER_NAME`, passa a exigir adicionalmente a assinatura Authenticode desse editor. As duas assinaturas são diferentes: a primeira autentica atualizações dentro do aplicativo; a segunda identifica o editor para o Windows.

Antes de instalar, o sistema espera operações concluírem, pausa manutenção, verifica espaço, preserva dados e runtime anteriores em backup e registra a tentativa. A ferramenta de recuperação independente acompanha a confirmação da inicialização. Se uma atualização falhar, há recuperação dos dados e do runtime preservados; veja [RECUPERACAO.md](RECUPERACAO.md).

A instalação automática fora do expediente é opcional e depende de autorização nas configurações. A instalação manual pede confirmação. Enquanto o repositório estiver privado, a consulta pública não funciona; torne-o público quando desejar distribuir as atualizações. Credenciais de publicação nunca são distribuídas no aplicativo.

Leia [PUBLICACAO.md](PUBLICACAO.md) para gerar, assinar e publicar versões futuras. Preserve a chave privada fora do repositório e mantenha backup protegido dela.

## Forçar atualização manual

Em **Configurações → Atualizações → Forçar atualização agora**, confirme **Buscar e baixar**. A consulta ocorre na hora, sem depender da frequência configurada, do último horário de verificação ou da opção automática. O instalador é baixado novamente e validado. Em seguida, escolha **Instalar atualização**; o sistema faz backup e reinicia após sua confirmação. Uma tentativa manual também pode repetir uma versão bloqueada após falha, mantendo as validações de assinatura, versão, canal e integridade.

Se a versão instalada já for a mais recente, o aplicativo informa isso. Para reinstalar a mesma versão, ou atualizar instalações antigas cujo atualizador não inicia, clique em **Baixar instalador pelo GitHub**, encerre por **Sair do sistema** na bandeja e execute o instalador na pasta atual. Isso preserva `%APPDATA%\AdvocaciaGestao`. Não desinstale nem apague essa pasta. O [comando de instalação rápida do README](../README.md#instalação-rápida-no-windows) também baixa o instalador oficial mais recente e serve para atualização manual; mantenha a pasta instalada durante o assistente.
