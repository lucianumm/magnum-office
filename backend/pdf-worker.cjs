const {parentPort,workerData}=require('node:worker_threads');const fs=require('node:fs/promises');const path=require('node:path');
const {PDFDocument}=require('pdf-lib');const {archiveDocument,addBitmap,rasterPages,PDFiumLibrary}=require('./pdfa.cjs');
const progress=(value,message)=>parentPort.postMessage({progress:value,message});
async function read(file){const stat=await fs.stat(file);if(!stat.isFile()||stat.size>100*1024**2)throw new Error('Use arquivos de até 100 MB.');return fs.readFile(file);}
async function save(pdf){return Buffer.from(await pdf.save({useObjectStreams:false}));}
async function write(file,bytes){await fs.writeFile(file+'.partial',bytes,{flag:'wx'});await fs.rename(file+'.partial',file);}
async function run(){const {mode,files,output,limitMB,pagesPerPart}=workerData;let total=0;for(const file of files){total+=(await fs.stat(file)).size;if(total>200*1024**2)throw new Error('Selecione até 200 MB no total.');}
 const warnings=[],results=[];let library;let processed=0;const maxOutput=400*1024**2;
 try{library=await PDFiumLibrary.init();let pdf=await archiveDocument(),part=1,firstPage=1;
  async function record(bytes,end){const name=mode==='split'?`parte-${String(part++).padStart(3,'0')}-paginas-${firstPage}-${end}.pdf`:path.basename(output);const target=mode==='split'?path.join(output,name):output;await write(target,bytes);results.push({name,pages:end-firstPage+1,size:bytes.length,format:'PDF/A-2b'});firstPage=end+1;}
  for(let fileIndex=0;fileIndex<files.length;fileIndex++){
   let bytes=await read(files[fileIndex]);
   if(mode==='images'){const source=await PDFDocument.create();const image=/\.png$/i.test(files[fileIndex])?await source.embedPng(bytes):await source.embedJpg(bytes);if(image.width*image.height>25000000)throw new Error('Use imagens de até 25 milhões de pixels.');const [w,h]=image.width>image.height?[841.89,595.28]:[595.28,841.89];const scale=Math.min((w-48)/image.width,(h-48)/image.height);source.addPage([w,h]).drawImage(image,{x:(w-image.width*scale)/2,y:(h-image.height*scale)/2,width:image.width*scale,height:image.height*scale});bytes=await source.save();}
   await rasterPages(library,bytes,async(bitmap,w,h,index,count)=>{
    if(++processed>2000)throw new Error('Limite de 2.000 páginas por operação.');
    let previous;if(mode==='split'&&!pagesPerPart&&pdf.getPageCount())previous=await save(pdf);
    addBitmap(pdf,bitmap,w,h);
    if(mode==='split'){
     let current=await save(pdf);
     if(!pagesPerPart&&current.length>limitMB*1024**2&&pdf.getPageCount()>1){await record(previous,processed-1);pdf=await archiveDocument();addBitmap(pdf,bitmap,w,h);current=await save(pdf);}
     if(!pagesPerPart&&current.length>limitMB*1024**2)warnings.push(`A página ${processed} sozinha excede ${limitMB} MB e foi mantida inteira.`);
     if(pagesPerPart?pdf.getPageCount()>=pagesPerPart:current.length>limitMB*1024**2){await record(current,processed);pdf=await archiveDocument();}
    }else if(processed%10===0&&(await save(pdf)).length>maxOutput)throw new Error('O resultado excede 400 MB. Divida o documento em partes menores.');
    progress(Math.min(95,Math.round((fileIndex+(index+1)/count)/files.length*95)),`Convertendo página ${processed} para PDF/A-2b no computador...`);
   });
  }
  if(pdf.getPageCount()){const bytes=await save(pdf);if(bytes.length>maxOutput)throw new Error('O resultado excede 400 MB. Divida em partes menores.');await record(bytes,processed);}
  warnings.push('PDF/A-2b gerado como imagens: texto pesquisável, links, formulários e assinaturas digitais não são preservados. Guarde os originais.');progress(100,'PDF/A-2b concluído');return {files:results,warnings,format:'PDF/A-2b'};
 }finally{library?.destroy();}
}
run().then(result=>parentPort.postMessage({result})).catch(error=>parentPort.postMessage({error:/encrypted|password/i.test(error.message)?'PDF protegido por senha. Exporte uma cópia desbloqueada no seu leitor de PDF e tente novamente.':error.message}));
