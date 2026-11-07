const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { backupPath } = require('../backend/backups.cjs');
async function startGuardian(root, pending, installer, options = {}) {
  const runtime = path.join(backupPath(root, pending.backupId), 'runtime');
  const recoveryExe = path.join(runtime, path.basename(process.execPath));
  await fs.access(recoveryExe);
  const guardianId=require('node:crypto').randomUUID();
  const readyFile=path.join(root,'guardian-ready-'+guardianId+'.json');
  const cancelFile=path.join(root,'guardian-cancel-'+guardianId+'.json');
  const request = { ...pending, root, installer, parentPid: process.pid, recoveryExe,guardianId,readyFile,cancelFile };
  const requestFile = path.join(root, 'update-request.json');
  await fs.writeFile(requestFile, JSON.stringify(request), { mode: 0o600 });
  const script = path.join(runtime, 'resources', 'guardian.cjs');
  await fs.access(script);
  const child = (options.launcher||spawn)(recoveryExe, [script, requestFile], { env: {...process.env, ELECTRON_RUN_AS_NODE: '1'}, detached: true, stdio: 'ignore', windowsHide: true });
  await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
  try{let ready=false;for(let i=0;i<80;i++){try{const value=JSON.parse((await fs.readFile(readyFile,'utf8')).replace(/^\uFEFF/,''));if(value.id===guardianId){ready=true;break;}}catch{/* Wait for the helper to acknowledge startup. */}if(child.exitCode!==null)break;await new Promise(resolve=>setTimeout(resolve,150));}if(!ready){await fs.writeFile(cancelFile,'cancelled');throw new Error('O assistente de atualização não iniciou. O aplicativo continuará aberto. Baixe o instalador oficial e conclua a instalação manualmente.');}}
  finally{child.unref();await fs.rm(readyFile,{force:true}).catch(()=>{});}
}
module.exports = { startGuardian };
