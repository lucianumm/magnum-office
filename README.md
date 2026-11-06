# Magnum Office — Advocacia Gestão

<img src="frontend/public/app-icon.png" alt="Magnum Office" width="120" />

**Dados e processamento no seu computador.** Sistema desktop gratuito e independente para organizar um escritório de advocacia. Clientes, processos, agenda, documentos, modelos e comunicação ficam no computador do usuário.

**Windows x64 · Versão oficial 1.1.0**
[Baixar instalador](https://github.com/lucianumm/magnum-office/releases/latest) · [Changelog](CHANGELOG.md) · [Instalação](docs/INSTALACAO.md) · [API/MCP](docs/API-MCP.md)

> Baixe o aplicativo e suas atualizações somente pela release do repositório oficial.

## Funciona localmente

O aplicativo é instalado no computador. Cadastros, processos, agenda, anotações, modelos, documentos e ferramentas de PDF rodam e ficam armazenados localmente. Não é necessário contratar um servidor para usar essas funções. WhatsApp, Resend, envio de backup por e-mail, GitHub e agentes utilizam os serviços externos correspondentes quando você os configura ou aciona.

**Disparos, mensagens, lembretes e backups automáticos só funcionam com o sistema aberto ou na bandeja e o computador ligado.** As funções externas também precisam de internet. O funcionamento em segundo plano vem ativado: fechar a janela mantém o programa na bandeja; sair do programa interrompe as rotinas.

## Recursos

- **Clientes e processos:** cadastros, vínculos, contatos, preferência de recebimento e busca no escritório.
- **Aniversários:** data de nascimento opcional, modelo Mensagem aniversário e envio anual de WhatsApp com ativação por cliente, horário, variáveis e proteção contra duplicatas.
- **Agenda e prazos:** compromissos, anotações, notificações no computador e disparos únicos ou recorrentes em datas específicas, semanas ou meses, com quantidade e intervalo definidos. Prazos processuais são cadastrados manualmente.
- **Documentos e modelos:** biblioteca única com arquivos criptografados, grupos de modelos jurídicos, mensagens de WhatsApp e e-mails, com importação e edição interna. Não há limite de quantidade de modelos imposto pelo aplicativo; o armazenamento depende do espaço do computador.
- **WhatsApp:** conexão Baileys individual por instalação, QR Code, reconexão, modelos de mensagem e agendamento simplificado com histórico de resultados.
- **Design de e-mail:** prévia para computador e celular, cabeçalho, bordas, cores, imagem, botão e assinatura personalizáveis. O layout padrão já vem pronto e pode ser salvo por modelo ou para os próximos e-mails.
- **E-mail:** Resend com domínio próprio, confirmação da configuração Resend/Cloudflare, editor com formatação e anexos. Campanhas para até 100 destinatários distintos, com seleção e horários individuais.
- **Colar e-mails:** identificação em textos misturados, normalização de domínios, remoção de repetidos e revisão de destinatários antes do envio.
- **Importação:** contatos e agenda em CSV, TSV e Excel XLSX, com escolha de planilha, associação de colunas, prévia, validação, duplicados e backup antes da gravação.
- **Backups semanais:** cópia local automática, aviso diário com a data real do último backup e opção de envio protegido por senha para um único responsável pelo escritório. Cópias portáteis podem ser importadas em outra instalação.
- **Privacidade e LGPD:** termo curto de aceite, política acessível no sistema, exportação, correção de cadastros e informações sobre integrações e retenção. Esses recursos não constituem certificação de conformidade.
- **PDF local:** imagens PNG/JPG em PDF/A-2b, conversão de PDF para PDF/A, união e divisão por tamanho ou número de páginas. Processamento separado, progresso e cancelamento, sem enviar arquivos a serviços externos.
- **Personalização:** nome, descrição abaixo da marca, logo do escritório, oito cores, modo claro/escuro/sistema e densidade visual.
- **Tribunais e sistemas:** diretório que só exibe resultados após a escolha do estado, com pesquisa, filtros e favoritos para links oficiais de PJe, TJ, TRF, TRT e outros serviços.
- **API e MCP:** integração local autenticada para agentes gerenciarem contatos, compromissos, processos, anotações e modelos. Edição é opcional; propostas de disparo exigem revisão local.
- **Proteção e portabilidade:** dados e documentos criptografados, backups autenticados, exportação legível, auditoria técnica, migrações e recuperação de atualização.

## Instalação rápida no Windows

Abra o **PowerShell** e cole o bloco abaixo. Ele baixa a versão oficial mais recente, confere o SHA-256 informado pelo GitHub e abre o assistente de instalação. Não precisa de Node.js, npm ou Git. No assistente, escolha a pasta e conclua; o atalho **Magnum Office** será criado no desktop e no menu Iniciar.

```powershell
& {
    $ErrorActionPreference = 'Stop'
    if (-not [Environment]::Is64BitOperatingSystem) { throw 'Use Windows de 64 bits.' }
    $api = 'https://api.github.com/repos/lucianumm/magnum-office/releases/latest'
    $release = Invoke-RestMethod -Uri $api -Headers @{ 'User-Agent' = 'MagnumOffice-Installer'; Accept = 'application/vnd.github+json' }
    if ($release.draft -or $release.prerelease -or $release.tag_name -notmatch '^v(\d+\.\d+\.\d+)$') { throw 'Nenhuma versao oficial valida foi encontrada.' }
    $version = $Matches[1]
    $name = "advocacia-gestao-setup-$version-x64.exe"
    $assets = @($release.assets | Where-Object { $_.name -ceq $name })
    if ($assets.Count -ne 1 -or $assets[0].digest -notmatch '^sha256:[a-fA-F0-9]{64}$') { throw 'Instalador ou SHA-256 indisponivel. Baixe pela pagina oficial de releases.' }
    $expected = $assets[0].digest.Substring(7)
    $url = "https://github.com/lucianumm/magnum-office/releases/download/$($release.tag_name)/$name"
    if ($assets[0].browser_download_url -cne $url) { throw 'Origem do download nao autorizada.' }
    $folder = Join-Path ([IO.Path]::GetTempPath()) ('MagnumOffice-' + [Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $folder | Out-Null
    $installer = Join-Path $folder $name
    Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $installer
    $stream = [IO.File]::OpenRead($installer)
    $hasher = [Security.Cryptography.SHA256]::Create()
    try { $actual = ([BitConverter]::ToString($hasher.ComputeHash($stream))).Replace('-', '') }
    finally { $stream.Dispose(); $hasher.Dispose() }
    if ($actual -ine $expected) {
        Remove-Item -LiteralPath $installer -Force
        throw 'O arquivo falhou na verificacao SHA-256. A instalacao foi interrompida.'
    }
    Write-Host 'Download verificado. Siga o assistente para instalar o Magnum Office.'
    Start-Process -FilePath $installer -Wait
}
```

Se o download não estiver disponível, use o [instalador pela página de releases](https://github.com/lucianumm/magnum-office/releases/latest); repositórios privados exigem login autorizado. O pacote atual não possui certificado Authenticode de editor Windows. A conferência SHA-256 verifica a integridade do download a partir dos metadados da release oficial. [Código de instalação](installers/quick-install.ps1).

## Começar

1. Baixe o `.exe` em [Releases](https://github.com/lucianumm/magnum-office/releases/latest) ou use a instalação rápida acima. Abra pelo atalho **Magnum Office**, criado no desktop e no menu Iniciar.
2. Na primeira abertura, leia e aceite os termos curtos e consulte a política de privacidade.
3. Personalize o nome, a descrição e a logo em **Configurações → Personalizar**.
4. Cadastre clientes com WhatsApp e DDD obrigatórios ou use **Importar dados**.
5. Para WhatsApp, abra **Mensagens**, conecte o celular pelo QR Code e clique em **Agendar WhatsApp**.
6. Para e-mail, configure seu domínio próprio e sua API Key em **Configurações → E-mail**. As instruções de Resend/Cloudflare estão na própria tela.
7. Em **Configurações → Backups e recuperação**, escolha cópia semanal local ou envio ao único responsável pelo escritório. Para envio, configure o Resend e uma senha de backup.
8. Guarde uma cópia fora do computador, preserve a senha em local separado e teste uma restauração.

Os envios agendados e lembretes exigem computador ligado, conexão disponível e aplicativo aberto ou na bandeja. A integração Baileys é não oficial; cada usuário usa sua própria sessão e conta. Resend e outros serviços externos podem ter limites e custos próprios, independentemente da gratuidade deste projeto.

As ferramentas de PDF usam CPU e memória e podem deixar o computador lento. As saídas são PDF/A-2b com páginas renderizadas como imagens, até 180 dpi, perfil sRGB e metadados de arquivamento. Originais são preservados; texto pesquisável, links, formulários e assinaturas digitais não são preservados nas cópias. Uma página maior que o limite escolhido é exportada inteira com aviso.

## Mensagem de aniversário

Em **Clientes → Novo cliente** ou **Editar**, informe a data de nascimento e ative **Enviar mensagem de aniversário automaticamente**. Selecione um modelo e o horário. O envio usa o WhatsApp do cadastro e fica na agenda e na fila de mensagens.

O modelo **Mensagem aniversário** já vem cadastrado em **Documentos e modelos → Modelos de WhatsApp**. Edite-o ou crie outros com a finalidade **Mensagem aniversário**:

| Variável | Substituição |
| --- | --- |
| `{1}` | Nome completo do cliente |
| `{2}` | Primeiro nome |
| `{3}` | Nome do escritório |

O envio é opcional e ocorre uma vez por cliente e por ano. Se o programa abrir após o horário, pode enviar no mesmo dia; aniversários de dias anteriores não são enviados automaticamente. Para nascimento em 29/02, considera 28/02 nos anos sem esse dia. Cliente inativo, recebimento desativado ou modelo removido impedem o envio. Confira a base legal e a preferência do cliente antes de ativar. Ao restaurar uma cópia portátil, revise e reative essa opção no cadastro.

Em **Configurações → Escritório**, a opção **Ao fechar (X), continuar funcionando em segundo plano** mantém o aplicativo na bandeja. Clique no ícone para reabrir e use **Sair do sistema** no menu do ícone para encerrar. O computador precisa permanecer ligado e o WhatsApp conectado para o envio.

## Atualizações e dados

O repositório de atualização é fixo: [lucianumm/magnum-office](https://github.com/lucianumm/magnum-office). Manifestos Ed25519 e SHA-256 validam a origem e a integridade dos instaladores. O pacote atual não possui certificado Authenticode de editor Windows. Veja [atualizações](docs/ATUALIZACOES.md), [recuperação](docs/RECUPERACAO.md) e [publicação](docs/PUBLICACAO.md).

**Perder os dados originais e todas as cópias pode ser irreversível. Uma cópia portátil protegida não pode ser recuperada sem a senha.** O envio semanal por e-mail tem limite de 18 MB para o arquivo protegido e depende dos limites e da disponibilidade do Resend. Se o arquivo for maior ou houver falha de envio, o backup local permanece disponível.

Os dados permanecem no perfil local do usuário. Conexões com WhatsApp, Resend e GitHub são usadas somente para suas respectivas funções. O sistema não sincroniza automaticamente os dados entre escritórios. Backups locais completos dependem do cofre da mesma conta e computador. Para outra máquina, use a cópia portátil protegida por senha ou a exportação legível. As chaves do Resend e a sessão WhatsApp não entram na cópia portátil; integrações precisam ser configuradas novamente e disparos restaurados ficam em revisão.

O histórico público começa na versão oficial 1.0.0. Consulte o [changelog](CHANGELOG.md) para as próximas alterações.

## Desenvolvimento

Requisitos: Node.js 24, npm e Windows para gerar/testar o instalador Windows.

```sh
npm ci
npm run check
npm run test:desktop
npm run test:features
npm run test:email
npm run test:workspace
npm run test:release-features
npm run test:privacy-email-backup
npm run test:corrections
npm run test:birthdays
npm run dev
```

`npm run assets` regenera o ícone oficial a partir da imagem incluída. `npm run dist:win` gera o instalador. Veja [arquitetura](docs/ARQUITETURA.md) e [publicação](docs/PUBLICACAO.md).

## Me pague um café ☕

**Esse é um projeto independente e 100% sem custo.** Se ele ajuda no seu dia a dia, você pode contribuir voluntariamente com sua continuidade. Todos os recursos permanecem disponíveis sem contribuição.

<img src="frontend/public/me-pague-um-cafe.png" alt="QR Code Pix — Me pague um café" width="260" />

O QR Code e o Pix copia e cola também ficam em **Configurações → Apoie o projeto**. Confira o recebedor no seu banco antes de concluir a contribuição.

## Licença

**É proibido comercializar, vender, revender ou cobrar pela licença ou pelo acesso ao próprio sistema.** O uso profissional gratuito no escritório é permitido. O projeto usa uma licença própria, conforme [LICENSE](LICENSE), e não a AGPL. Leia também a [política de privacidade e LGPD](docs/PRIVACIDADE.md). Dependências de terceiros mantêm suas próprias licenças.


GitHub: [lucianumm](https://github.com/lucianumm) · Instagram: [@lucianum](https://www.instagram.com/lucianum/).
