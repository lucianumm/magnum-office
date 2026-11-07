const fs=require('node:fs/promises');const path=require('node:path');const crypto=require('node:crypto');
const {PDFDocument,PDFName,PDFHexString,PDFString,pushGraphicsState,popGraphicsState,concatTransformationMatrix,drawObject}=require('pdf-lib');
const {PDFiumLibrary}=require('@hyzyla/pdfium');const N=PDFName.of;
async function archiveDocument(){
  const pdf=await PDFDocument.create({updateMetadata:false});const c=pdf.context;
  const profile=c.register(c.flateStream(await fs.readFile(path.join(__dirname,'assets','sRGB2014.icc')),{N:3}));
  pdf.catalog.set(N('OutputIntents'),c.obj([{Type:'OutputIntent',S:'GTS_PDFA1',OutputConditionIdentifier:PDFString.of('sRGB IEC61966-2.1'),Info:PDFString.of('sRGB2014'),DestOutputProfile:profile}]));
  const xmp='<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/" pdfaid:part="2" pdfaid:conformance="B"/></rdf:RDF></x:xmpmeta><?xpacket end="w"?>';
  pdf.catalog.set(N('Metadata'),c.register(c.stream(Buffer.from(xmp,'utf8'),{Type:'Metadata',Subtype:'XML'})));
  const id=PDFHexString.of(crypto.randomBytes(16).toString('hex'));c.trailerInfo.ID=c.obj([id,id]);delete c.trailerInfo.Info;return pdf;
}
function addBitmap(pdf,bitmap,width,height){
  const {data}=bitmap;const pixels=bitmap.width*bitmap.height;if(pixels>25000000||data.length!==pixels*4)throw new Error('Página excessiva para conversão local.');
  const rgb=Buffer.allocUnsafe(pixels*3);for(let i=0,j=0;i<data.length;i+=4){const a=data[i+3]/255;rgb[j++]=Math.round(data[i]*a+255*(1-a));rgb[j++]=Math.round(data[i+1]*a+255*(1-a));rgb[j++]=Math.round(data[i+2]*a+255*(1-a));}
  const image=pdf.context.register(pdf.context.flateStream(rgb,{Type:'XObject',Subtype:'Image',Width:bitmap.width,Height:bitmap.height,ColorSpace:'DeviceRGB',BitsPerComponent:8}));
  const page=pdf.addPage([width,height]);const name=page.node.newXObject('ArchiveImage',image);page.pushOperators(pushGraphicsState(),concatTransformationMatrix(width,0,0,height,0,0),drawObject(name),popGraphicsState());
}
async function rasterPages(library,bytes,onPage){
  const doc=await library.loadDocument(bytes);try{
    const count=doc.getPageCount();if(count<1||count>2000)throw new Error('Use PDFs com 1 a 2.000 páginas.');
    for(let i=0;i<count;i++){const page=doc.getPage(i);try{const {originalWidth:w,originalHeight:h}=page.getOriginalSize();if(!Number.isFinite(w)||!Number.isFinite(h)||w<1||h<1||w>14400||h>14400)throw new Error('Dimensões da página não suportadas.');const scale=Math.min(2.5,4000/Math.max(w,h));const image=await page.render({scale,render:'bitmap',transparent:false,renderFormFields:true});await onPage(image,w,h,i,count);}finally{page.close();}}
  }finally{doc.destroy();}
}
module.exports={archiveDocument,addBitmap,rasterPages,PDFiumLibrary};
