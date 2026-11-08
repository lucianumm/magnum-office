# Atualizações pelo GitHub

O repositório é fixo: `lucianumm/magnum-office`. O atualizador consulta as Releases e seleciona a versão válida mais nova compatível com plataforma, arquitetura e canal, sem fazer downgrade. Versões que falharam ficam bloqueadas para tentativas automáticas.

## O que acontece no uso normal

1. **Verificação:** ao iniciar e a cada 24 horas com o programa aberto ou na bandeja. Em caso de falha, tenta de novo com espera crescente (5 minutos até 6 horas).
2. **Download em segundo plano:** retoma de onde parou se a conexão cair. O instalador conferido é reaproveitado depois de reiniciar o programa.
3. **Aviso:** notificação do Windows, contador no sino e cartão em Configurações → Atualizações.
4. **Instalação:** sempre com confirmação, em **Instalar atualização** ou **Instalar ao sair**. A exceção é a opção de instalação automática fora do expediente, que vem desligada.
5. **Janela de progresso:** o programa fecha e uma janela pequena acompanha a instalação.
6. **Confirmação:** a nova versão abre, confere o banco e avisa o guardião. As novidades aparecem uma vez.

A verificação e o download automáticos vêm ligados. O GitHub recebe apenas o endereço IP da conexão. Tudo pode ser desligado em Configurações → Atualizações.

## Segurança

Cada release publica instalador, `release-stable.json` (ou canal correspondente), assinatura `.sig` e `checksums.txt`. O aplicativo incorpora a chave pública Ed25519 do mantenedor. Metadados alterados, origem diferente, chave desconhecida, tamanho ou SHA-256 incorretos são rejeitados. Nunca se obtém um executável de URLs arbitrárias ou de arquivos da branch main.

No Windows, a versão oficial utiliza verificação pelo manifesto assinado. Não há certificado Authenticode no instalador atual. Se um futuro build incorporar `WINDOWS_PUBLISHER_NAME`, passa a exigir também a assinatura Authenticode desse editor. Sem certificado, o Windows pode exibir alerta de editor desconhecido, e o Smart App Control bloqueia o programa onde estiver ativo.

## Rede

A consulta usa a rede do Chromium, que respeita o proxy e os certificados do Windows. A API do GitHub limita 60 consultas por hora por IP. Quando esse limite é atingido no canal estável, o sistema usa a URL estática da última release, com a mesma verificação de assinatura.

## Canais

| Canal | Recebe |
| --- | --- |
| Stable | Somente versões estáveis |
| Beta | Versões beta e estáveis |
| Development | Versões dev, beta e estáveis |

## Falhas

Antes de instalar, o sistema espera operações terminarem, verifica o espaço, preserva dados e programa em uma cópia e registra a tentativa. O guardião roda a partir da cópia preservada. Se o instalador falhar ou a nova versão não confirmar a inicialização em 3 minutos (10 minutos durante migração do banco), volta à versão anterior, restaura os dados e explica o motivo. Nenhuma mensagem é enviada antes da confirmação da nova versão.

Se a instalação for interrompida, por exemplo por queda de energia, o próximo início avisa que ela não terminou. Veja [RECUPERACAO.md](RECUPERACAO.md).

O registro técnico fica em `logs/recovery.jsonl`, com etapa e motivo da falha.

## Espaço em disco

| Item | Regra |
| --- | --- |
| Instalador em `updates/` | Mantido só enquanto for o da próxima atualização |
| Instaladores em `installers/` | Versão atual e anterior |
| Cópia do programa | Só a mais recente, apagada 7 dias depois da atualização confirmada |
| Dados das cópias antes da atualização | As 3 mais recentes |
| Cópias `pre-migration-*.sqlite` | As 5 mais recentes |
| Backups manuais, semanais e `before-restore-*` | Nunca apagados automaticamente; podem ser excluídos em Configurações → Backups |

## Forçar atualização manual

Em **Configurações → Atualizações → Forçar atualização agora**, confirme **Buscar e baixar**. A consulta ocorre na hora e o instalador é baixado novamente. Uma tentativa manual também pode repetir uma versão bloqueada após falha, mantendo as validações.

Para reinstalar a mesma versão, clique em **Baixar instalador pelo GitHub**, encerre por **Sair do sistema** na bandeja e execute o instalador na pasta atual. Isso preserva `%APPDATA%\AdvocaciaGestao`. Não desinstale nem apague essa pasta.

## Versões 1.0.0 e 1.1.0

Essas versões usam o guardião antigo, em PowerShell, que não concluiu nenhuma das 3 tentativas registradas em teste real. **Quem está nelas deve instalar a versão nova manualmente**, pelo instalador oficial ou pelo [comando de instalação rápida](../README.md#instalação-rápida-no-windows). Os cadastros são preservados. A partir da 1.2.0 a atualização pelo aplicativo funciona.

## Testes

```bash
npm run test:update-e2e
```

Gera instaladores reais com identidade de teste separada, instala em uma pasta temporária e percorre: atualização a partir da 1.2.0, atualização entre versões novas e reversão de uma versão defeituosa. Não altera a instalação real. Leia [PUBLICACAO.md](PUBLICACAO.md) para publicar.
