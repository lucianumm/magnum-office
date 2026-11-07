import fs from 'node:fs/promises';
for (const name of await fs.readdir('migrations')) {
  if (!name.endsWith('.sql')) continue;
  const sql = await fs.readFile('migrations/' + name, 'utf8');
  if (/\b(DROP\s+(TABLE|COLUMN)|DELETE\s+FROM|TRUNCATE)\b/i.test(sql)) throw new Error(`Migração destrutiva bloqueada: ${name}. Implemente um fluxo de confirmação e recuperação antes de aprovar essa alteração.`);
}
process.stdout.write('Migrações verificadas: nenhuma remoção de dados.\n');
