# Magnum Office

<img src="frontend/public/app-icon.png" alt="Magnum Office" width="96" />

**Gestão para escritórios de advocacia, gratuita e com os dados no seu computador.**

Clientes, processos, prazos, documentos, modelos, WhatsApp e e-mail em um só programa. Não precisa de servidor nem de assinatura.

**Windows x64 · Versão 1.3.0**

[Baixar](https://github.com/lucianumm/magnum-office/releases/latest) · [Novidades](CHANGELOG.md) · [Instalação](docs/INSTALACAO.md) · [Atualizações](docs/ATUALIZACOES.md) · [Privacidade](docs/PRIVACIDADE.md)

![Tela inicial com prazos atrasados, compromissos do dia e agenda](docs/images/inicio.png)

## Já usa o programa?

| Sua versão | Como atualizar |
| --- | --- |
| **1.2.0 ou mais nova** | Abra **Configurações → Atualizações → Forçar atualização agora** e depois **Instalar atualização**. A partir da 1.3.0, o sistema procura e baixa sozinho e avisa quando estiver pronto. |
| **1.0.0 ou 1.1.0** | O atualizador dessas versões não conclui a instalação. Encerre por **Sair do sistema** na bandeja e use a [instalação rápida](#instalar) ou o instalador. |

Seus cadastros são preservados. Não desinstale o programa nem apague a pasta `%APPDATA%\AdvocaciaGestao`.

## O que ele faz

**No dia a dia**

- **Início:** prazos atrasados, compromissos de hoje e da semana logo ao abrir.
- **Clientes e processos:** uma página para cada um, reunindo prazos, documentos, mensagens e anotações.
- **Agenda:** calendário e lista, com compromissos e envios agendados. Prazos processuais são cadastrados manualmente.
- **Documentos e modelos:** arquivos criptografados e modelos jurídicos, de WhatsApp e de e-mail.
- **Busca:** em todo o escritório, com `Ctrl+K`.
- **Avisos:** o sino reúne prazos vencidos, envios com falha, WhatsApp desconectado e atualizações.

![Página de um processo com seus prazos e dados](docs/images/processo.png)

**Comunicação**

- **WhatsApp:** conexão por QR Code, modelos, agendamento e recorrência. Usa Baileys, uma integração não oficial: cada instalação usa sua própria conta.
- **Aniversários:** mensagem anual opcional por cliente, sem duplicar.
- **E-mail:** Resend com domínio próprio, editor com formatação, anexos e campanhas para até 100 destinatários, cada um recebendo uma mensagem individual.

**Ferramentas**

- **PDF:** imagens em PDF/A-2b, conversão, união e divisão, tudo neste computador.
- **Tribunais:** diretório de links oficiais de PJe, TJ, TRF, TRT e outros, por estado.
- **Importação:** contatos e agenda em CSV, TSV e XLSX, com prévia e detecção de duplicados.
- **API e MCP:** integração local para agentes, desligada por padrão.

**Segurança e dados**

- **Criptografia:** dados e documentos com AES-256-GCM, com a chave protegida pelo cofre do Windows.
- **Backups:** cópia semanal local, cópias antes de atualizar e arquivo portátil protegido por senha.
- **Atualizações assinadas:** se uma versão nova não abrir, o sistema volta sozinho à anterior e restaura os dados.
- **LGPD:** exportação, correção de cadastros e informações sobre integrações. Esses recursos não constituem certificação de conformidade.

## Instalar

Abra o **PowerShell** e cole o bloco abaixo. Ele baixa a versão oficial, confere o SHA-256 informado pelo GitHub e abre o assistente. Não precisa de Node.js, npm ou Git.

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

Se preferir, baixe o `.exe` na [página de releases](https://github.com/lucianumm/magnum-office/releases/latest). Baixe somente do repositório oficial. [Veja o código da instalação](installers/quick-install.ps1).

O instalador não possui certificado de editor Windows, então o Windows pode mostrar um alerta de editor desconhecido. O Smart App Control, onde estiver ativo, bloqueia o programa. A integridade é garantida pelo SHA-256 e, nas atualizações, pela assinatura Ed25519.

## Primeiros passos

1. Abra pelo atalho **Magnum Office** e aceite os termos.
2. Em **Configurações → Personalizar**, informe nome e logo.
3. Cadastre clientes ou use **Configurações → Importar dados**.
4. Em **Mensagens**, conecte o WhatsApp pelo QR Code.
5. Em **Configurações → E-mail**, configure seu domínio e a API Key do Resend, se for enviar e-mails.
6. Em **Configurações → Backups e recuperação**, escolha a rotina de cópias, guarde uma cópia fora do computador e teste uma restauração.

## O que você precisa saber

- **Envios automáticos dependem do programa aberto.** Mensagens, lembretes e backups só funcionam com o computador ligado e o programa aberto ou na bandeja. Fechar a janela mantém na bandeja; **Sair do sistema** interrompe as rotinas. Em **Configurações → Escritório**, a opção **Iniciar com o Windows** mantém tudo ativo depois de reiniciar.
- **O que sai do computador.** WhatsApp, Resend, GitHub e agentes são usados só quando você configura ou aciona. A verificação de atualizações vem ligada e informa ao GitHub apenas o endereço IP; pode ser desligada. Veja a [política de privacidade](docs/PRIVACIDADE.md).
- **Perder os dados e todas as cópias pode ser irreversível.** Uma cópia portátil não pode ser recuperada sem a senha. Veja [backup e recuperação](docs/RECUPERACAO.md).
- **Backups entre computadores.** Backups locais dependem do cofre da mesma conta e do mesmo computador. Para outra máquina, use a cópia portátil ou a exportação legível. Chaves do Resend e sessão do WhatsApp precisam ser configuradas de novo, e disparos restaurados ficam em revisão.
- **PDF/A.** As páginas viram imagens de até 180 dpi: texto pesquisável, links, formulários e assinaturas digitais não são preservados nas cópias. Os originais ficam intactos.
- **Serviços externos.** Resend e outros serviços podem ter limites e custos próprios.

## Me pague um café ☕

Projeto independente e sem custo. Todos os recursos continuam disponíveis sem contribuição. Confira o recebedor no seu banco antes de concluir.

<img src="frontend/public/me-pague-um-cafe.png" alt="QR Code Pix — Me pague um café" width="220" />

## Desenvolvimento

Requisitos: Node.js 24, npm e Windows para gerar e testar o instalador.

```sh
npm ci
npm run check
node scripts/run-smokes.mjs
npm run test:update-e2e
npm run dev
```

`npm run test:update-e2e` gera instaladores reais e testa atualização e reversão em uma instalação separada, sem tocar na sua. Veja [arquitetura](docs/ARQUITETURA.md), [atualizações](docs/ATUALIZACOES.md), [publicação](docs/PUBLICACAO.md) e [API/MCP](docs/API-MCP.md).

## Licença

**É proibido comercializar, vender, revender ou cobrar pela licença ou pelo acesso ao próprio sistema.** O uso profissional gratuito no escritório é permitido. A licença é própria, conforme [LICENSE](LICENSE). Dependências de terceiros mantêm suas próprias licenças.

GitHub: [lucianumm](https://github.com/lucianumm) · Instagram: [@lucianum](https://www.instagram.com/lucianum/)
