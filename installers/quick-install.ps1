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
