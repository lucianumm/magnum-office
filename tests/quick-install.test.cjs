const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const {spawnSync}=require('node:child_process');
test('README quick installation matches the script and blocks corrupt, unofficial or incomplete releases before execution',{skip:process.platform!=='win32'},()=>{
 const source=fs.readFileSync(path.resolve('installers/quick-install.ps1'),'utf8').replace(/\r\n/g,'\n').trim();const readme=fs.readFileSync(path.resolve('README.md'),'utf8');assert.equal(readme.match(/```powershell\r?\n([\s\S]*?)\r?\n```/)[1].replace(/\r\n/g,'\n').trim(),source);
 const base=path.resolve('work/quick-install-tests');fs.mkdirSync(base,{recursive:true});const root=fs.mkdtempSync(path.join(base,'run-'));assert.ok(root.startsWith(base+path.sep),'Unsafe cleanup');
 try{const script=String.raw`
$ErrorActionPreference='Stop'
Import-Module Microsoft.PowerShell.Utility -ErrorAction Stop
$script:source=[IO.File]::ReadAllText((Join-Path (Get-Location) 'installers/quick-install.ps1'))
$script:payload=[Text.Encoding]::UTF8.GetBytes('offline installer fixture')
$sha=[Security.Cryptography.SHA256]::Create();$script:hash=([BitConverter]::ToString($sha.ComputeHash($script:payload))).Replace('-','').ToLowerInvariant();$sha.Dispose()
function Invoke-RestMethod { param($Uri,$Headers) if($Uri -cne 'https://api.github.com/repos/lucianumm/magnum-office/releases/latest'){throw 'Wrong API'}; return $script:release }
function Invoke-WebRequest { param([switch]$UseBasicParsing,$Uri,$OutFile) $script:downloads++;[IO.File]::WriteAllBytes($OutFile,$script:payload) }
function Start-Process { param($FilePath,[switch]$Wait) $script:starts++;if(-not $Wait){throw 'Must wait'};if(-not (Test-Path -LiteralPath $FilePath)){throw 'Missing download'} }
$results=@()
foreach($case in @('valid','hash','url','prerelease','draft','missing-digest','missing-asset','tag')){
 $script:starts=0;$script:downloads=0
 $asset=[PSCustomObject]@{name='advocacia-gestao-setup-1.0.0-x64.exe';digest=('sha256:'+$script:hash);browser_download_url='https://github.com/lucianumm/magnum-office/releases/download/v1.0.0/advocacia-gestao-setup-1.0.0-x64.exe'}
 $script:release=[PSCustomObject]@{draft=$false;prerelease=$false;tag_name='v1.0.0';assets=@($asset)}
 switch($case){'hash'{$asset.digest='sha256:'+('0'*64)}'url'{$asset.browser_download_url='https://example.test/installer.exe'}'prerelease'{$script:release.prerelease=$true}'draft'{$script:release.draft=$true}'missing-digest'{$asset.digest=$null}'missing-asset'{$script:release.assets=@()}'tag'{$script:release.tag_name='v1.0.0-beta.1'}}
 $blocked=$false;try{& ([scriptblock]::Create($script:source))}catch{$blocked=$true;$caught=$_.Exception.Message}
 if($case -eq 'valid'){if($blocked -or $script:starts -ne 1 -or $script:downloads -ne 1){throw ('Valid installation failed: '+$caught+' starts='+$script:starts+' downloads='+$script:downloads)}}else{if(-not $blocked -or $script:starts -ne 0){throw ('Unsafe installation: '+$case)}}
 $results += $case
}
Write-Output ('VERIFIED:'+($results -join ','))
`;const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{cwd:process.cwd(),env:{...process.env,TEMP:root,TMP:root},encoding:'utf8',windowsHide:true,timeout:30000});assert.equal(result.status,0,result.stdout+'\n'+result.stderr);assert.match(result.stdout,/VERIFIED:valid,hash,url,prerelease,draft,missing-digest,missing-asset,tag/);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
