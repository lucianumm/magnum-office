const frequencies = ['weekly', 'monthly', 'dates'];
function parts(date, timeZone) {
  return Object.fromEntries(new Intl.DateTimeFormat('en-CA', {timeZone, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit', hourCycle:'h23'}).formatToParts(new Date(date)).filter(p=>p.type!=='literal').map(p=>[p.type,Number(p.value)]));
}
function instant(p, timeZone) {
  const wall=Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute,p.second||0);let value=wall;
  for(let i=0;i<4;i++){const current=parts(value,timeZone);const offset=Date.UTC(current.year,current.month-1,current.day,current.hour,current.minute,current.second)-value;value=wall-offset;}
  const check=parts(value,timeZone);
  if(Object.keys(p).some(k=>check[k]!==p[k]))throw new Error('Uma ocorrência cai em um horário inexistente por mudança de fuso. Escolha outro horário.');
  return new Date(value).toISOString();
}
function iso(value){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString()!==value)throw new Error('Data da recorrência inválida.');return value;}
function expandSchedule(first, rule) {
  iso(first);if(!rule||!frequencies.includes(rule.frequency))throw new Error('Escolha uma recorrência válida.');
  const timeZone=rule.timeZone;if(typeof timeZone!=='string'||timeZone.length>80)throw new Error('Fuso horário inválido.');
  let start;try{start=parts(first,timeZone);}catch{throw new Error('Fuso horário inválido.');}
  if(rule.frequency==='dates'){
    if(!Array.isArray(rule.dates)||rule.dates.length<1||rule.dates.length>99)throw new Error('Adicione de 1 a 99 datas extras.');
    const dates=[first,...rule.dates.map(iso)];if(new Set(dates).size!==dates.length)throw new Error('Há datas e horários repetidos.');return dates.sort();
  }
  const {count,interval=1}=rule;const max=rule.frequency==='weekly'?260:60;
  if(!Number.isInteger(count)||count<2||count>max||!Number.isInteger(interval)||interval<1||interval>12)throw new Error(`Informe de 2 a ${max} ocorrências e um intervalo de 1 a 12.`);
  return Array.from({length:count},(_,i)=>{
    if(!i)return first;
    const d=rule.frequency==='weekly'?new Date(Date.UTC(start.year,start.month-1,start.day+7*i*interval)):new Date(Date.UTC(start.year,start.month-1+i*interval,1));
    const day=rule.frequency==='weekly'?d.getUTCDate():Math.min(start.day,new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate());
    return new Date(Date.parse(instant({year:d.getUTCFullYear(),month:d.getUTCMonth()+1,day,hour:start.hour,minute:start.minute,second:start.second},timeZone))+new Date(first).getUTCMilliseconds()).toISOString();
  });
}
module.exports={expandSchedule};
