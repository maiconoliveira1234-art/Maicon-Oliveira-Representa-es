export const TIME_ZONE = 'America/Sao_Paulo';
export function localDay(now = new Date()) {
 return new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year:'numeric', month:'2-digit', day:'2-digit' }).format(now);
}
export function cycle(day: string) {
 const date = new Date(day+'T12:00:00Z');
 const days = Math.floor((date.getTime()-Date.UTC(date.getUTCFullYear(),0,1,12))/86400000);
 return {week: Math.floor(days/7)%2+1, weekday: ['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'][date.getUTCDay()]};
}
export function nextDay(day: string) { return new Date(Date.parse(day+'T12:00:00Z')+86400000).toISOString().slice(0,10); }
export function eventBody(day: string, name: string, start?: string|null, end?: string|null, allDay = false, details: ClientDetails = {}) {
 const valid = (s?: string|null) => !!s && /^\d{2}:\d{2}(:\d{2})?$/.test(s) && Number(s.slice(0,2))<24 && Number(s.slice(3,5))<60;
 const timed = !allDay && valid(start) && valid(end) && end! > start!;
 return {summary:name.trim(), ...contactFields(details), start:timed?{dateTime:day+'T'+start!.slice(0,5)+':00',timeZone:TIME_ZONE}:{date:day},end:timed?{dateTime:day+'T'+end!.slice(0,5)+':00',timeZone:TIME_ZONE}:{date:nextDay(day)},reminders:{useDefault:false},extendedProperties:{private:{source:'promax',day}}};
}
export async function eventId(day: string, key: string) {
 const hash = await crypto.subtle.digest('SHA-256',new TextEncoder().encode('promax:'+day+':'+key));
 return 'pm'+Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('');
}

// Today plus fifteen future dates: the complete fifteenth day is included.
export function syncDays(today: string) {
 const days=[today]; for(let i=0;i<15;i++) days.push(nextDay(days[days.length-1])); return days;
}
export function staleEvents(events: Array<{id:string;extendedProperties?:{private?:{source?:string;day?:string}}}>, desired: Set<string>, first:string, last:string) {
 return events.filter(e=>e.extendedProperties?.private?.source==='promax' && !!e.extendedProperties.private.day && e.extendedProperties.private.day>=first && e.extendedProperties.private.day<=last && !desired.has(e.id));
}

export type ClientDetails = {contato?:string|null;telefone?:string|number|null;endereco?:string|null;bairro?:string|null;cidade?:string|null};
export function contactFields(client:ClientDetails) {
 const clean=(v:unknown)=>v==null?'':String(v).trim();
 const escape=(v:string)=>v.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
 const contact=clean(client.contato),phone=clean(client.telefone);
 return {
  location:[client.endereco,client.bairro,client.cidade].map(clean).filter(Boolean).join(', '),
  description:[contact?'Contato: '+escape(contact):'',phone?'Telefone: '+escape(phone):''].filter(Boolean).join('\n'),
 };
}

export type CalendarPending = {id:string;tipo:string;titulo:string;data_prevista:string|null;status:string;clientes?: (ClientDetails & {cliente:string;ativo:boolean})|null};
export function pendingEvent(item:CalendarPending) {
 if(!item.data_prevista || !['PENDENTE','EM_ANDAMENTO'].includes(item.status) || item.clientes?.ativo===false) return null;
 const followUp=item.tipo==='TAREFA' && ['Retorno comercial','Reavaliar recompra'].includes(item.titulo);
 const title=(item.tipo==='VISITA_EXTRA'||followUp)?item.clientes?.cliente||item.titulo:item.titulo;
 const body=eventBody(item.data_prevista,title||'Tarefa',null,null,true,item.clientes||{});
 const kind=item.tipo==='VISITA_EXTRA'?'Visita extra':followUp?item.titulo:'Tarefa';
 const clientLine=item.tipo==='TAREFA'&&!followUp&&item.clientes?.cliente?'Cliente: '+item.clientes.cliente:'';
 const escape=(v:string)=>v.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
 body.description=[escape(kind),escape(clientLine),body.description].filter(Boolean).join('\n');
 return {...body,colorId:'6'};
}
