const fs=require('node:fs/promises');

const path=require('node:path');

const {randomUUID}=require('node:crypto');

const {entity}=require('./validation.cjs');

const {extractEmails}=require('./email-addresses.cjs');

const {documentKey}=require('../app/br-documents.mjs');

const normalize=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');

const aliases={birthDate:['datanascimento','datadenascimento','nascimento','aniversario','birthday','birthdate'],name:['nome','nomecompleto','cliente','name','fullname'],email:['email','emailaddress','correioeletronico'],phone:['telefone','celular','whatsapp','phone','mobile'],document:['documento','cpf','cnpj','cpfcnpj'],address:['endereco','address'],notes:['observacoes','notas','descricao','description','notes'],title:['titulo','assunto','compromisso','subject','summary','title'],due:['dataehora','inicio','datainicio','start','startdate','due','vencimento'],date:['data','date','dia'],time:['hora','horario','time','starttime'],type:['tipo','type'],priority:['prioridade','priority'],status:['situacao','status'],
 nationality:['nacionalidade'],maritalStatus:['estadocivil'],profession:['profissao','ocupacao'],rg:['rg','identidade','cedulaidentidade'],zip:['cep'],street:['logradouro','rua'],addressNumber:['numero','numeroendereco'],district:['bairro'],city:['cidade','municipio'],state:['uf','estado']};

const fields={clients:['name','birthDate','email','phone','document','nationality','maritalStatus','profession','rg','zip','street','addressNumber','district','city','state','address','notes'],tasks:['title','due','date','time','type','priority','notes']};

function cell(value){if(value instanceof Date)return value.toISOString().slice(value.getUTCFullYear()<1901?11:0,16);if(value&&typeof value==='object'){if(value.formula)throw new Error('Fórmulas não são importadas. Use valores fixos.');if(value.text!==undefined)return String(value.text);if(value.richText)return value.richText.map(t=>t.text).join('');return '';}return String(value??'').trim();}

function localDate(value,time=''){value=String(value||'').trim();if(/^\d{2}\/\d{2}\/\d{4}/.test(value))value=value.replace(/^(\d{2})\/(\d{2})\/(\d{4})/,'$3-$2-$1');value=value.replace(' ','T');if(/^\d{4}-\d{2}-\d{2}$/.test(value))value+='T'+(time||'09:00');if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:00(\.000Z)?)?$/.test(value))throw new Error('Use uma data com horário HH:mm, sem fuso ou segundos.');return value.slice(0,16);}

class Imports{

 constructor(store){this.store=store;this.previews=new Map();}

 async read(file){const stat=await fs.stat(file);if(!stat.isFile()||stat.size>5*1024**2)throw new Error('Use arquivos de até 5 MB.');const ext=path.extname(file).toLowerCase();let sheets=[];

  if(ext==='.xlsx'){await require('./zip-limits.cjs').checkArchive(file);const Excel=require('exceljs');const book=new Excel.Workbook();await book.xlsx.readFile(file);sheets=book.worksheets.map(sheet=>{if(sheet.rowCount>5001||sheet.columnCount>80)throw new Error('Limite de 5.000 linhas e 80 colunas por planilha.');const rows=[];sheet.eachRow({includeEmpty:true},row=>rows.push(row.values.slice(1).map(cell)));return {name:sheet.name,rows};});}

  else if(['.csv','.tsv','.txt'].includes(ext)){let content=await fs.readFile(file,'utf8');if(content.includes('\uFFFD'))content=new TextDecoder('windows-1252').decode(await fs.readFile(file));const first=content.split(/\r?\n/)[0];const delimiter=ext==='.tsv'?'\t':[';',',','\t'].sort((a,b)=>first.split(b).length-first.split(a).length)[0];const rows=require('csv-parse/sync').parse(content,{bom:true,delimiter,skip_empty_lines:true,relax_column_count:true,max_record_size:100000});if(rows.length>5001||rows.some(r=>r.length>80))throw new Error('Limite de 5.000 linhas e 80 colunas.');sheets=[{name:path.basename(file),rows}];}else throw new Error('Use CSV, TSV ou Excel XLSX. Para XLS antigo, salve como XLSX.');

  if(!sheets.length||sheets.length>30)throw new Error('Use um arquivo com 1 a 30 planilhas.');const id=randomUUID();this.previews.clear();this.previews.set(id,{sheets,created:Date.now()});return {id,sheets:sheets.map(s=>({name:s.name,headers:s.rows[0]||[],sample:s.rows.slice(1,5),count:Math.max(0,s.rows.length-1)}))};

 }

 mapping(kind,headers){if(!fields[kind])throw new Error('Tipo de importação inválido.');return Object.fromEntries(fields[kind].map(f=>[f,headers.findIndex(h=>aliases[f].includes(normalize(h)))]));}

 preview({id,kind,sheet=0,mapping}){const source=this.previews.get(id);if(!source||Date.now()-source.created>1800000)throw new Error('Selecione o arquivo novamente.');if(!fields[kind]||!Number.isInteger(sheet)||!source.sheets[sheet])throw new Error('Planilha inválida.');const rows=source.sheets[sheet].rows;mapping=mapping||this.mapping(kind,rows[0]||[]);for(const [f,index]of Object.entries(mapping))if(!fields[kind].includes(f)||!Number.isInteger(index)||index< -1||index>=80)throw new Error('Coluna inválida.');const existing=this.store.list(kind);const keys=new Set(existing.flatMap(r=>this.keys(kind,r)));const result=[];

  for(let n=1;n<rows.length;n++){if(!rows[n].some(v=>String(v).trim()))continue;try{const raw={};for(const f of fields[kind])raw[f]=mapping[f]>=0?cell(rows[n][mapping[f]]):'';if(kind==='clients'&&raw.email){const parsed=extractEmails(raw.email);if(parsed.emails.length!==1||parsed.unrecognized)throw new Error('Informe apenas um e-mail válido por contato.');raw.email=parsed.emails[0];}if(kind==='clients'&&raw.birthDate){raw.birthDate=raw.birthDate.replace(/^(\d{2})\/(\d{2})\/(\d{4})$/,'$3-$2-$1').slice(0,10);}if(kind==='tasks')raw.due=localDate(raw.due||raw.date.split('T')[0],raw.time);const value=entity(kind,raw);const rowKeys=this.keys(kind,value);const duplicate=rowKeys.some(k=>keys.has(k));if(!duplicate)rowKeys.forEach(k=>keys.add(k));result.push({row:n+1,value,duplicate,error:''});}catch(e){result.push({row:n+1,error:e.message,duplicate:false});}}

  source.validated={kind,result};return {rows:result,valid:result.filter(r=>!r.error&&!r.duplicate).length,duplicates:result.filter(r=>r.duplicate).length,errors:result.filter(r=>r.error).length};

 }

 keys(kind,r){return kind==='clients'?[r.email&&'email:'+r.email.toLowerCase(),r.document&&'doc:'+documentKey(r.document),!r.email&&!r.document&&'name:'+normalize(r.name)+':'+r.phone.replace(/\D/g,'')].filter(Boolean):['task:'+normalize(r.title)+':'+r.due];}

 commit({id,rows}){const p=this.previews.get(id);if(!p?.validated||Date.now()-p.created>1800000||!Array.isArray(rows)||rows.length>5000)throw new Error('Revise a importação novamente.');const {kind,result}=p.validated;const chosen=[...new Set(rows)].map(n=>result.find(r=>r.row===n));if(!chosen.length||chosen.some(r=>!r||r.error||r.duplicate))throw new Error('Selecione linhas válidas e sem duplicação.');const seen=new Set(this.store.list(kind).flatMap(r=>this.keys(kind,r)));for(const r of chosen){if(this.keys(kind,r.value).some(k=>seen.has(k)))throw new Error('Os dados mudaram. Revise novamente as duplicações.');this.keys(kind,r.value).forEach(k=>seen.add(k));}this.store.db.exec('BEGIN');try{for(const r of chosen)this.store.save(kind,r.value);this.store.db.exec('COMMIT');}catch(e){this.store.db.exec('ROLLBACK');throw e;}this.previews.delete(id);return {count:chosen.length};}

}

module.exports={Imports,fields,localDate};
