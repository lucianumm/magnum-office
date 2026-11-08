# Política de segurança

O Magnum Office guarda dados de clientes e processos de escritórios de advocacia. Falhas de segurança são tratadas com prioridade.

## Versões atendidas

Correções de segurança são publicadas somente na versão mais recente, entregue pelo atualizador do próprio aplicativo. Mantenha a atualização automática ligada em **Configurações → Atualizações**.

| Versão                  | Recebe correções                  |
| ----------------------- | --------------------------------- |
| Última versão publicada | Sim                               |
| Versões anteriores      | Não, atualize para a mais recente |

## Como relatar uma vulnerabilidade

**Não abra issue pública.** Use o relato privado do GitHub:

1. Abra a aba [**Security**](https://github.com/lucianumm/magnum-office/security) do repositório.
2. Clique em **Report a vulnerability**.
3. Descreva o problema, a versão afetada, os passos para reproduzir e o impacto esperado.

Não envie dados reais de clientes. Se precisar demonstrar o problema, use uma instalação de teste com dados fictícios.

## O que acontece depois

- Confirmação do recebimento em até 5 dias úteis.
- Avaliação e, se a falha for confirmada, correção publicada como nova versão assinada.
- Crédito a quem relatou nas notas da versão, se desejar.

Pedimos que a falha não seja divulgada antes de a correção estar disponível.

## Escopo

Interessam especialmente:

- acesso aos dados do cofre local (banco, documentos, backups) sem a chave do sistema;
- execução de código a partir de documentos, modelos, e-mails ou mensagens importadas;
- falhas na verificação das atualizações (manifesto Ed25519 e SHA-256);
- a API local de agentes (REST e MCP) aceitando acesso sem token ou de fora do computador;
- envio de dados a terceiros sem ação do usuário.

Ficam fora do escopo ataques que exigem acesso de administrador ao computador já comprometido, e problemas nos serviços externos (Resend, WhatsApp, DataJud, DJEN), que devem ser relatados aos próprios fornecedores.
