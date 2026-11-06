# Publicação e manutenção

O repositório oficial é `lucianumm/magnum-office`. A versão 1.0.0 é distribuída primeiro para Windows x64. A licença é própria, de uso gratuito e com comercialização do próprio sistema proibida, conforme LICENSE.

## O que publicar

Publique código, dependências declaradas/lockfile, imagens oficiais, migrações, scripts de verificação/build, documentação e workflows. Instaladores ficam em **GitHub Releases**, sem binários compilados no histórico Git. Não publique `node_modules`, `work`, bancos SQLite, cópias de segurança, logs, dados de clientes, chaves privadas ou arquivos `.env`.

## Chaves de atualização

O aplicativo incorpora somente a chave **pública** Ed25519 em `app/build-config.json`. A chave privada local permanece fora do repositório, em `%LOCALAPPDATA%\MagnumOfficePublisher`, e precisa de uma cópia de segurança protegida do mantenedor. Ela autentica novas versões; perdê-la impede a publicação de atualizações reconhecidas por instalações existentes. Nunca a substitua sem um plano de transição.

GitHub Actions usa os secrets `UPDATE_PRIVATE_KEY` e `UPDATE_PUBLIC_KEY`. Opcionalmente, configure `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD` e `WINDOWS_PUBLISHER_NAME` para assinatura Authenticode do Windows. Sem certificado Windows, a autenticidade das atualizações é verificada pelo manifesto Ed25519 e SHA-256; o instalador poderá ser identificado pelo Windows como editor desconhecido. Assinatura Ed25519 de atualização não é um certificado Authenticode.

## Gerar localmente

1. Atualize `package.json`, lockfile e CHANGELOG.
2. Execute `npm ci`, `npm run check`, os testes de interface e `node scripts/validate-migrations.mjs`.
3. Execute `node scripts/release-local.mjs configure` para incorporar a chave pública local.
4. Gere o instalador: `npx electron-builder --win nsis --x64 --publish never --config.directories.output=installers/artifacts/v1.0.0` (ajuste a versão).
5. Teste o executável empacotado com os scripts smoke, incluindo recuperação.
6. Execute `node scripts/release-local.mjs manifest installers/artifacts/v1.0.0`.
7. Publique tag, instalador, `release-stable.json`, assinatura `.sig` e `checksums.txt` em uma Release. Nunca substitua um instalador já publicado pela mesma versão.

O workflow **Gerar release Windows** permite preparar futuras releases manualmente pelo GitHub Actions, informando uma tag já existente. O resultado é um rascunho para revisão do mantenedor.

## Repositório privado

Enquanto estiver privado, fonte e downloads exigem acesso GitHub autorizado. O atualizador dos aplicativos não armazena credenciais de publicação e não consulta releases privadas. Ao tornar o repositório público, as URLs e a chave pública já incorporadas passam a permitir consulta e download de futuras versões. Não é necessário mudar o repositório no aplicativo.


A versão 1.0.0 é a primeira release oficial: publique sem `--prerelease`, marque como mais recente e use `release-stable.json` com sua assinatura. O changelog começa nesta versão; prévias de desenvolvimento não integram o histórico público.
