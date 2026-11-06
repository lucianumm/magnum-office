# Atualizações pelo GitHub

O repositório é fixo: `lucianumm/magnum-office`. O atualizador consulta Releases e seleciona versões mais novas compatíveis com plataforma, arquitetura e canal, sem reinstalar versões bloqueadas ou fazer downgrade.

Cada release publica instalador, `release-stable.json` (ou canal correspondente), assinatura `.sig` e `checksums.txt`. O aplicativo incorpora a chave pública Ed25519 do mantenedor. Metadados alterados, origem diferente, chave desconhecida, tamanho ou SHA-256 incorretos são rejeitados. Nunca se obtém um executável a partir de URLs arbitrárias ou de arquivos da branch main.

No Windows, a versão oficial utiliza verificação pelo manifesto assinado. Não há certificado Authenticode no instalador atual. Se um futuro build incorporar `WINDOWS_PUBLISHER_NAME`, passa a exigir adicionalmente a assinatura Authenticode desse editor. As duas assinaturas são diferentes: a primeira autentica atualizações dentro do aplicativo; a segunda identifica o editor para o Windows.

Antes de instalar, o sistema espera operações concluírem, pausa manutenção, verifica espaço, preserva dados e runtime anteriores em backup e registra a tentativa. A ferramenta de recuperação independente acompanha a confirmação da inicialização. Se uma atualização falhar, há recuperação dos dados e do runtime preservados; veja [RECUPERACAO.md](RECUPERACAO.md).

A instalação automática fora do expediente é opcional e depende de autorização nas configurações. A instalação manual pede confirmação. Enquanto o repositório estiver privado, a consulta pública não funciona; torne-o público quando desejar distribuir as atualizações. Credenciais de publicação nunca são distribuídas no aplicativo.

Leia [PUBLICACAO.md](PUBLICACAO.md) para gerar, assinar e publicar versões futuras. Preserve a chave privada fora do repositório e mantenha backup protegido dela.
