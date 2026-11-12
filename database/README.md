# Armazenamento local

SQLite é fornecido pelo runtime Node do Electron. Não há instalação separada de banco. A estrutura é criada pelas migrações em `migrations/`.

`entities`: categoria, UUID e payload AES-256-GCM. `queue`: payload cifrado, estado e tentativas. `secrets`: credenciais e sessão cifradas. `migrations`: checksum e data. `audit`: metadados técnicos sem conteúdo dos cadastros.

Não modifique uma migração aplicada. Acrescente um novo arquivo numerado. Remoções de dados são bloqueadas pelo validador da pipeline até que haja um fluxo explícito de confirmação e recuperação.
