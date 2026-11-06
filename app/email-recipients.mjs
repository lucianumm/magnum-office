export function addEmailRecipients(emails,current,clients,limit=100){
 const seen=new Set(current.map(r=>r.email.toLowerCase()));const added=[];let duplicate=0,blocked=0,overflow=0;
 for(const email of emails){const address=email.toLowerCase();if(seen.has(address)){duplicate++;continue;}if(clients.some(c=>c.email?.toLowerCase()===address&&(c.emailPreference==='Não receber'||c.status==='Inativo'))){blocked++;continue;}if(current.length+added.length>=limit){overflow++;continue;}const client=clients.find(c=>c.email?.toLowerCase()===address);seen.add(address);added.push({email,...client?{clientId:client.id}:{}});}
 return {recipients:[...current,...added],added:added.length,duplicate,blocked,overflow};
}
