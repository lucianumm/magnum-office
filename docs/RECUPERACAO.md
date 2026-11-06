# Backup e recuperação

## Backup manual

Em Configurações → Backups e recuperação, selecione **Criar backup agora**. A cópia inclui banco consistente pelo SQLite Backup API, documentos cifrados, configurações e chave protegida pelo OS. Os arquivos recebem hashes SHA-256 e um manifesto autenticado pelo cofre local.

Mantenha também uma cópia dos backups fora do disco principal. A cópia deve incluir a pasta inteira. Guardar backup e dados no mesmo disco não protege contra perda física desse disco. Para transferir dados para outra conta ou outro computador, use a exportação legível, porque o cofre de credenciais é vinculado à conta original.

## Restaurar dados pela interface

1. Encerre aberturas externas de documentos e aguarde envios.
2. Selecione **Restaurar dados** no backup desejado.
3. Confirme a operação. O estado atual será preservado.
4. O programa reinicia e valida a cópia antes de trocar o banco/documentos.

O estado anterior é guardado em `backups/before-restore-*`. Não o apague antes de confirmar os dados restaurados. Cópias corrompidas e caminhos fora da pasta de backup são recusados. Uma versão antiga não abre banco de uma versão mais recente sem restauração compatível.

## Falha de atualização no Windows

Antes da instalação, a aplicação preserva o diretório completo do programa em `backups/ID/runtime`. Um guardião PowerShell independente aguarda a saída do programa, executa o instalador e verifica a confirmação da nova versão. Se ela não confirmar saúde em três minutos, o programa anterior é iniciado a partir da cópia e os dados são restaurados. A versão defeituosa é incluída na lista de bloqueio para evitar novas tentativas automáticas.

Não desligue o computador durante instalação ou restauração. Se houver interrupção de energia, execute a recuperação manual abaixo. O comportamento do guardião deve ser homologado com um par de releases assinadas no ambiente de produção antes da distribuição.

## Recuperação independente

Abra `%APPDATA%\AdvocaciaGestao\backups` no Explorador. Uma cópia `pre-update` contém o atalho **Recuperar Advocacia**: dê dois cliques e confirme para recuperar o programa e os dados, sem usar terminal. Encerre o programa atual antes. O backup também contém `runtime\Advocacia Gestao.exe`, que é o aplicativo anterior completo, sem depender da instalação atual.

Para suporte técnico, o executável aceita os argumentos:

```powershell
& "$env:APPDATA\AdvocaciaGestao\backups\ID\runtime\Advocacia Gestao.exe" "--recover=ID" "--user-data=$env:APPDATA\AdvocaciaGestao" "--rollback-version=VERSAO_COM_FALHA"
```

Substitua `ID` pelo identificador do backup e `VERSAO_COM_FALHA` pela versão que falhou. Encerre o programa atual antes de executar. O backup precisa pertencer à mesma conta do sistema operacional. Também é possível reinstalar o instalador anterior em `installers/` e iniciar a recuperação por argumentos.

Linux: mantenha a AppImage anterior ou reinstale o pacote anterior e use **Restaurar dados**. macOS: reinstale o aplicativo anterior assinado e restaure os dados. A substituição automática do binário no rollback dessas plataformas não foi implementada nesta versão.

## Emergência

Quando o aplicativo abre, use **Exportar dados e documentos** para obter cadastros JSON e arquivos originais, mesmo offline. Caso o cofre do sistema operacional tenha sido apagado, sem exportação prévia os dados cifrados não podem ser descriptografados. Não exclua `vault.bin` nem redefina a conta para tentar resolver falhas de inicialização.

O diagnóstico técnico pode ser exportado em Sobre o sistema. Ele não inclui senhas, tokens, sessão WhatsApp, mensagens ou documentos de clientes. Os logs técnicos ficam em `logs/`.


## Arquivo portátil protegido por senha

Em Configurações → Backups e recuperação, use Restaurar arquivo de backup para selecionar um `.magnumbackup` e informar sua senha. O programa verifica e prepara a cópia, preserva os dados atuais em backup e reinicia para restaurar. O arquivo pode vir de outra instalação, pois os registros e documentos serão criptografados com o cofre do computador de destino.

A cópia portátil não inclui a chave Resend ou a sessão WhatsApp. Configure as conexões novamente; mensagens ainda não enviadas voltarão para revisão, sem envio automático. Preserve arquivo e senha separadamente. A restauração não remove cópias antigas, anexos já entregues por e-mail ou backups externos.
