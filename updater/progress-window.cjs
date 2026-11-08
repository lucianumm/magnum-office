// Small window shown by the preserved program while the installer runs. Without it the
// application simply disappears for a few minutes and people try to reopen it.
const fs = require('node:fs');
const path = require('node:path');
const { BrowserWindow, app } = require('electron');
const texts = {
  installing: ['Atualizando o sistema', 'Instalando a nova versão. Não desligue o computador.'],
  starting: ['Quase pronto', 'Abrindo a nova versão e conferindo seus dados.'],
  restoring: ['A atualização não pôde ser concluída', 'Voltando à versão anterior. Seus dados estão preservados.']
};
const page = `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Atualização</title><style>
html,body{margin:0;height:100%;font:14px 'Segoe UI',sans-serif;color:#1f2933;background:#fff}
body{display:flex;flex-direction:column;justify-content:center;gap:8px;padding:0 28px;box-sizing:border-box;-webkit-app-region:drag}
h1{font-size:16px;font-weight:600;margin:0}p{margin:0;color:#52606d}
i{display:block;height:4px;border-radius:2px;margin-top:10px;overflow:hidden;background:#e4e7eb;position:relative}
i:after{content:'';position:absolute;inset:0 60% 0 0;background:#0d7168;border-radius:2px;animation:a 1.4s ease-in-out infinite alternate}
@keyframes a{to{inset:0 0 0 60%}}@media(prefers-reduced-motion:reduce){i:after{animation:none}}
</style><h1 id="t"></h1><p id="s"></p><i></i></html>`;
async function runProgressWindow(root) {
  await app.whenReady();
  const file = path.join(root, 'update-progress.json');
  const win = new BrowserWindow({ width: 440, height: 150, frame: false, resizable: false, minimizable: false, maximizable: false, alwaysOnTop: true, skipTaskbar: false, title: 'Atualização', show: false, webPreferences: { sandbox: true, contextIsolation: true } });
  win.once('ready-to-show', () => { win.show(); if (!win.isVisible()) win.show(); });
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(page));
  const deadline = Date.now() + 15 * 60000;
  let shown = '';
  const timer = setInterval(() => {
    let step = '';
    try { step = JSON.parse(fs.readFileSync(file, 'utf8')).step; } catch { /* The guardian is still writing. */ }
    if (step === 'done' || Date.now() > deadline) { clearInterval(timer); fs.rmSync(file, { force: true }); app.quit(); return; }
    if (step !== shown && texts[step] && !win.isDestroyed()) {
      shown = step;
      const [title, detail] = texts[step];
      void win.webContents.executeJavaScript(`document.getElementById('t').textContent=${JSON.stringify(title)};document.getElementById('s').textContent=${JSON.stringify(detail)};`);
    }
  }, 500);
}
module.exports = { runProgressWindow };
