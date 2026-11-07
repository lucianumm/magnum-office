import fs from 'node:fs/promises';
import {Resvg} from '@resvg/resvg-js';
const source=await fs.readFile('desktop/assets/brand-source.jpg');
const svg=`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="512" height="512" viewBox="0 0 512 512"><rect width="512" height="512" fill="#25282d"/><image x="0" y="0" width="512" height="512" preserveAspectRatio="xMidYMid meet" xlink:href="data:image/jpeg;base64,${source.toString('base64')}"/></svg>`;
await fs.mkdir('desktop/assets',{recursive:true});await fs.mkdir('frontend/public',{recursive:true});
const sizes=[16,32,48,64,128,256];const icons=sizes.map(size=>new Resvg(svg,{fitTo:{mode:'width',value:size}}).render().asPng());
await fs.writeFile('desktop/assets/icon.png',icons.at(-1));await fs.writeFile('frontend/public/app-icon.png',new Resvg(svg).render().asPng());
const header=Buffer.alloc(6+16*sizes.length);header.writeUInt16LE(1,2);header.writeUInt16LE(sizes.length,4);let offset=header.length;
for(let i=0;i<sizes.length;i++){const pos=6+16*i;header[pos]=sizes[i]===256?0:sizes[i];header[pos+1]=header[pos];header.writeUInt16LE(1,pos+4);header.writeUInt16LE(32,pos+6);header.writeUInt32LE(icons[i].length,pos+8);header.writeUInt32LE(offset,pos+12);offset+=icons[i].length;}
await fs.writeFile('desktop/assets/icon.ico',Buffer.concat([header,...icons]));
process.stdout.write('Ícone original preparado em PNG e ICO com seis resoluções.\n');
