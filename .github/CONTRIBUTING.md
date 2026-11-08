# Como contribuir

Obrigado pelo interesse em melhorar o Magnum Office. Antes de começar, leia o [código de conduta](CODE_OF_CONDUCT.md) e a [licença](../LICENSE): o projeto é gratuito, o código é aberto para consulta e adaptação, mas **não é software livre** e não pode ser vendido.

## Relatar um problema ou sugerir uma melhoria

- Use os modelos em **Issues → New issue**. Procure antes se o assunto já foi aberto.
- Informe a versão (em **Configurações → Atualizações**) e a versão do Windows.
- **Nunca anexe dados reais**: nome de cliente, número de processo sigiloso, documento, print com dados pessoais, chave de API ou senha. Use dados fictícios.
- Falhas de segurança não vão em issue pública: siga a [política de segurança](SECURITY.md).

## Preparar o ambiente

Requisitos: Windows 10 ou 11, [Node.js 24](https://nodejs.org) e Git.

```bash
git clone https://github.com/lucianumm/magnum-office.git
cd magnum-office
npm ci
npm run dev
```

`npm run dev` abre o aplicativo com recarga automática da interface. **Atenção:** sem configuração, ele usa a mesma pasta de dados da versão instalada. Para trabalhar com dados separados, aponte uma pasta de teste antes de abrir (no PowerShell):

```powershell
$env:ADVOCACIA_TEST_DATA = "$env:TEMP\magnum-dev"
npm run dev
```

## Antes de abrir um pull request

```bash
npm run check
node scripts/validate-migrations.mjs
node scripts/run-smokes.mjs all
```

`npm run check` roda o lint, os testes unitários e o build. Os smokes abrem o aplicativo de verdade e percorrem as telas principais.

## Regras do projeto

- **Dados no computador do usuário.** Nada de telemetria, servidor próprio ou envio de dados sem ação explícita do usuário. Serviços públicos (DataJud, DJEN, Banco Central) ficam desligados por padrão.
- **Migrações só acrescentam.** Uma migração nunca apaga tabelas, colunas ou linhas; o `validate-migrations` e o próprio aplicativo recusam o que reduzir dados. Migrações já publicadas não são alteradas.
- **Nada de segredos no código.** Chaves privadas, tokens e senhas ficam fora do repositório.
- **Interface em português do Brasil**, com textos claros para quem não é da área de tecnologia.
- **Um assunto por pull request**, com testes para o que mudou.
- Formate com o Prettier do projeto (`npx prettier --write <arquivos>`).

## Direitos sobre as contribuições

Ao enviar uma contribuição, você declara que ela é de sua autoria (ou que tem o direito de enviá-la) e concorda que o titular do projeto a incorpore e distribua nas condições da [licença](../LICENSE) do Magnum Office, mantido o registro da sua autoria no histórico do pull request.
