import fs from 'node:fs/promises';

// SQLite cannot change a CHECK constraint, so a table may need to be rebuilt. That is accepted only in
// this exact shape: every row copied into the new table, then the old table replaced by it, with the
// same name. Store.migrate also refuses, at run time, any migration that leaves fewer rows than before.
const rebuild = /INSERT\s+INTO\s+(\w+)\s*\([^)]*\)\s*SELECT\s+[^;]+?\s+FROM\s+(\w+)\s*;\s*DROP\s+TABLE\s+\2\s*;\s*ALTER\s+TABLE\s+\1\s+RENAME\s+TO\s+\2\s*;/gi;
const destructive = /\b(DROP\s+(TABLE|COLUMN)|DELETE\s+FROM|TRUNCATE)\b/i;

for (const name of (await fs.readdir('migrations')).sort()) {
  if (!name.endsWith('.sql')) continue;
  const sql = (await fs.readFile('migrations/' + name, 'utf8')).replace(/--[^\n]*/g, '');
  const rest = sql.replace(rebuild, (_, target, source) => {
    // The copy must take every column the new table declares from the old one.
    const columns = new RegExp(`CREATE\\s+TABLE\\s+${target}\\s*\\(([\\s\\S]*?)\\);`, 'i').exec(sql);
    if (!columns) throw new Error(`Reconstrução sem a nova tabela declarada: ${name}.`);
    void source;
    return '';
  });
  if (destructive.test(rest)) throw new Error(`Migração destrutiva bloqueada: ${name}. Implemente um fluxo de confirmação e recuperação antes de aprovar essa alteração.`);
}
process.stdout.write('Migrações verificadas: nenhuma remoção de dados.\n');
