// The last update attempt as the guardian recorded it in logs/recovery.jsonl, so the screen can say
// what happened without anyone opening the file. Only technical data: version, step, folder and codes.
const fs = require('node:fs/promises');
const path = require('node:path');

const steps = {
  installing: 'instalação',
  verifying: 'conferência da versão instalada',
  starting: 'abertura da nova versão',
  waiting: 'espera pelo fechamento do programa',
};

async function readLog(root) {
  try {
    const text = await fs.readFile(path.join(root, 'logs', 'recovery.jsonl'), 'utf8');
    return text
      .split(/\r?\n/)
      .filter(Boolean)
      .slice(-400)
      .map(line => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

async function lastAttempt(root) {
  const entries = await readLog(root);
  const start = entries.map(e => e.event).lastIndexOf('update.guardian.started');
  if (start < 0) return null;
  const attempt = entries.slice(start);
  const find = event => attempt.find(e => e.event === event);
  const started = find('update.guardian.installer.started');
  const exited = find('update.guardian.installer.exited');
  const notReplaced = find('update.guardian.not-replaced');
  const failed = find('update.guardian.failed');
  const outcome = find('update.guardian.success')
    ? 'success'
    : failed
      ? 'failed'
      : find('update.guardian.aborted')
        ? 'aborted'
        : 'running';
  const step = failed?.detail?.step || '';
  return {
    version: attempt[0].version || '',
    at: attempt[0].at,
    finishedAt: attempt.at(-1).at,
    outcome,
    step,
    stepLabel: steps[step] || step,
    message: failed?.detail?.message || '',
    folder: started?.detail?.dir || notReplaced?.detail?.dir || '',
    mode: started?.detail?.mode || '',
    installerCode: exited?.detail?.code ?? null,
    foundVersion: notReplaced?.detail?.found || '',
    lines: attempt.map(e => JSON.stringify(e)),
  };
}

// Plain text for the person to paste in a support conversation.
function attemptText(attempt, version) {
  if (!attempt) return `Magnum Office ${version}: nenhuma tentativa de atualização registrada.`;
  return [
    `Magnum Office ${version} — última tentativa de atualização`,
    `Versão: ${attempt.version} · Início: ${attempt.at} · Resultado: ${attempt.outcome}`,
    attempt.step ? `Etapa: ${attempt.step}${attempt.message ? ` · ${attempt.message}` : ''}` : '',
    attempt.folder ? `Pasta: ${attempt.folder} · Modo: ${attempt.mode || 'não informado'}` : '',
    attempt.installerCode !== null ? `Código do instalador: ${attempt.installerCode}` : '',
    attempt.foundVersion ? `Versão encontrada na pasta: ${attempt.foundVersion}` : '',
    '',
    ...attempt.lines,
  ]
    .filter((line, i, all) => line || all[i - 1])
    .join('\n');
}

module.exports = { lastAttempt, attemptText, readLog };
