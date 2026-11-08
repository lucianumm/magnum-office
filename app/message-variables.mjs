export const messageVariables=[['{1}','Nome completo do cliente'],['{2}','Primeiro nome'],['{3}','Nome do escritório']];
// Extra variables available in the reminder sent to the client before a hearing or meeting.
export const reminderVariables=[['{4}','Data do compromisso'],['{5}','Horário'],['{6}','Título do compromisso']];
export function personalizeReminder(value,client,settings,task){
 const [date,time]=String(task.due||'').split('T');const values={'4':date?date.split('-').reverse().join('/'):'','5':time||'','6':task.title||''};
 return personalizeMessage(String(value||'').replace(/\{([456])\}/g,(_,key)=>values[key]),client,settings);
}
export function personalizeMessage(value,client={},settings={},html=false){
 const name=client.name||'cliente',first=name.trim().split(/\s+/)[0],office=settings.officeName||'nosso escritório';const values={'1':name,'2':first,'3':office,cliente:name,primeiro_nome:first,escritorio:office};
 return String(value||'').replace(/\{(1|2|3|cliente|primeiro_nome|escritorio)\}/g,(_,key)=>html?values[key].replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])):values[key]);
}
