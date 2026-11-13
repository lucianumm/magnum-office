# Instalação — Windows x64

Baixe o instalador `.exe` da versão mais recente em https://github.com/lucianumm/magnum-office/releases/latest. Enquanto o repositório estiver privado, entre na conta GitHub com acesso ao projeto.

Execute o instalador, escolha a pasta e conclua. Abra pelo atalho **Magnum Office**, criado no desktop e no menu Iniciar. O segundo plano vem ativado; fechar a janela mantém o aplicativo na bandeja. O ícone utiliza a marca oficial de Lucianum Magnum; nome e logo visíveis podem ser personalizados dentro do programa. O instalador atual não tem certificado Authenticode de editor Windows.

## Instalação rápida

O [README](../README.md#instalação-rápida-no-windows) inclui um bloco para colar no PowerShell: baixa a última versão oficial, confere o SHA-256 do GitHub e abre o assistente. O bloco exige que o repositório esteja público. Não é preciso instalar ferramentas de desenvolvimento.

## Linux (experimental)

Cada versão traz um **AppImage** e um pacote **.deb** em [Releases](https://github.com/lucianumm/magnum-office/releases/latest).

- **AppImage:** `chmod +x advocacia-gestao-*.AppImage` e execute.
- **.deb:** `sudo apt install ./advocacia-gestao-*.deb`.
- O programa guarda a chave dos dados no **chaveiro do sistema** (GNOME Keyring ou KWallet). Sem um chaveiro ativo ele não abre, para não deixar a chave em texto simples.
- A atualização automática do AppImage abre a nova versão ao lado da antiga, que fica preservada. Não há retorno automático como no Windows; em caso de problema, volte ao AppImage anterior. Os dados ficam em `~/.config/AdvocaciaGestao` e não são apagados.
- Esta versão não foi testada em várias distribuições. Se algo falhar, abra uma [issue](https://github.com/lucianumm/magnum-office/issues).

## Primeiros passos

- Configurações → Personalizar: nome, descrição, logo e temas.
- Clientes ou Importar dados: cadastros e contatos CSV/TSV/XLSX; WhatsApp com DDD é obrigatório para salvar. Contatos antigos permanecem legíveis, mas precisam desse campo ao editar.
- Documentos e modelos: arquivos, modelos jurídicos, WhatsApp e e-mail.
- Ferramentas PDF: imagens, conversão, união e divisão com saída PDF/A-2b. As páginas viram imagens, sem texto pesquisável ou assinaturas digitais; guarde os originais.
- Agenda → Agendar WhatsApp: escolha Não repetir, Datas específicas, Semanal ou Mensal; informe intervalo e quantidade, confira a prévia das datas e autorize. Cancelar recorrência, na tela Mensagens, preserva envios concluídos e em andamento.
- Mensagens: conecte seu WhatsApp por QR Code e prepare disparos. As instruções ficam na tela.
- Configurações → E-mail: domínio próprio, endereço remetente e API Key Resend; confirme a configuração DNS.
- Configurações → Escritório: notificações no PC, antecedência, teste e funcionamento na bandeja.
- Configurações → Backups e recuperação: crie e confira cópias de segurança.

O aplicativo mantém dados em `%APPDATA%\AdvocaciaGestao`, separados do diretório instalado. A atualização preserva essa pasta. Desinstalar não deve remover os dados automaticamente; mantenha backups e exportações fora da pasta instalada.

O computador precisa estar ligado e o aplicativo aberto ou na bandeja para enviar mensagens e mostrar lembretes. O Windows pode silenciar notificações em Não incomodar ou bloquear sua exibição nas configurações do próprio sistema. O aplicativo não altera essas permissões sozinho.

Os backups criptografados dependem da mesma conta e computador. Antes de migrar de máquina, use Exportar dados e documentos. O programa é local por instalação; dados e sessões não são compartilhados automaticamente com outros usuários.

Para integrações, leia [API/MCP](API-MCP.md). Para problemas após atualização, leia [Recuperação](RECUPERACAO.md).


## Termos e backup semanal

Na primeira abertura, leia o termo curto e a política de privacidade. O uso profissional é gratuito; a comercialização do próprio sistema é proibida conforme a licença própria do projeto.

A rotina semanal cria um backup local na próxima execução disponível. Em Configurações → Backups e recuperação, é possível escolher uma cópia portátil por e-mail para um único responsável. O envio exige Resend, domínio confirmado e senha de pelo menos 12 caracteres. O arquivo e a senha devem ficar em lugares seguros e separados. A senha não acompanha o e-mail.

O aviso diário exibe a data real do último backup. Ele não significa que uma nova cópia foi feita todos os dias. O sistema deve permanecer aberto ou na bandeja, com o computador ligado; para envios, a internet também deve estar disponível.

Para migrar ou recuperar registros em outro computador, use Exportar backup protegido e Restaurar arquivo de backup. Integrações precisarão ser reconfiguradas. Sem a senha, a cópia portátil não pode ser recuperada. Se dados originais e todas as cópias forem perdidos, não há recuperação garantida.


## Se a versão antiga continuar abrindo

Encerre o programa por Sair do sistema no ícone da bandeja, baixe o instalador atual em Releases e instale na pasta utilizada pelo atalho do desktop. Os dados ficam fora da pasta instalada. Não abra executáveis de pastas de recuperação para uso diário. Se a atualização automática não concluir, use Configurações → Atualizações → Instalar manualmente, que abre o instalador já verificado com as telas normais.
