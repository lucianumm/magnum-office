export const messageVariables=[['{1}','Nome completo do cliente'],['{2}','Primeiro nome'],['{3}','Nome do escritório']];
export function personalizeMessage(value,client={},settings={},html=false){
 const name=client.name||'cliente',first=name.trim().split(/\s+/)[0],office=settings.officeName||'nosso escritório';const values={'1':name,'2':first,'3':office,cliente:name,primeiro_nome:first,escritorio:office};
 return String(value||'').replace(/\{(1|2|3|cliente|primeiro_nome|escritorio)\}/g,(_,key)=>html?values[key].replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])):values[key]);
}
