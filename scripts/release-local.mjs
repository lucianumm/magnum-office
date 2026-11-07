import fs from 'node:fs/promises';import path from 'node:path';import {spawn} from 'node:child_process';import {fileURLToPath} from 'node:url';
const keyDir=process.env.MAGNUM_PUBLISHER_KEYS||path.join(process.env.LOCALAPPDATA||'', 'MagnumOfficePublisher');
if(!path.isAbsolute(keyDir))throw new Error('Configure uma pasta absoluta para as chaves de publicação.');
const backupKey=await fs.readFile(path.join(keyDir,'update-backup-public.pem'),'utf8').catch(()=>'');const mode=process.argv[2];const pkg=JSON.parse(await fs.readFile('package.json','utf8'));
const env={...process.env,GITHUB_REPOSITORY:'lucianumm/magnum-office',GITHUB_REF_NAME:`v${pkg.version}`,UPDATE_PUBLIC_KEY:await fs.readFile(path.join(keyDir,'update-public.pem'),'utf8')};
if(backupKey)env.UPDATE_BACKUP_PUBLIC_KEY=backupKey;if(mode==='manifest')env.UPDATE_PRIVATE_KEY=await fs.readFile(path.join(keyDir,'update-private.pem'),'utf8');
if(!['configure','manifest'].includes(mode))throw new Error('Use configure ou manifest.');
const script=mode==='configure'?'configure-release.mjs':'release-manifest.mjs';
const child=spawn(process.execPath,[fileURLToPath(new URL('./'+script,import.meta.url)),...mode==='manifest'?[process.argv[3]||`installers/artifacts/v${pkg.version}`]:[]],{env,stdio:'inherit',windowsHide:true});child.on('exit',code=>process.exitCode=code||0);
