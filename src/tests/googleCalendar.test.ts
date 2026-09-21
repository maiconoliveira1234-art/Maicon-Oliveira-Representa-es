import assert from 'node:assert/strict';
import { differenceInWeeks, startOfYear } from 'date-fns';
import { cycle, eventBody, eventId, localDay, nextDay } from '../../supabase/functions/google-calendar/model';

assert.equal(localDay(new Date('2026-09-21T02:59:59Z')), '2026-09-20');
assert.equal(localDay(new Date('2026-09-21T03:00:00Z')), '2026-09-21');
assert.equal(nextDay('2024-02-28'), '2024-02-29');
assert.equal(nextDay('2026-12-31'), '2027-01-01');
for (const year of [2024, 2026, 2027]) {
  for (let day = new Date(year, 0, 1, 12); day.getFullYear() === year; day.setDate(day.getDate() + 1)) {
    const iso = `${year}-${String(day.getMonth()+1).padStart(2,'0')}-${String(day.getDate()).padStart(2,'0')}`;
    assert.equal(cycle(iso).week, differenceInWeeks(day, startOfYear(day)) % 2 + 1);
  }
}
const event = eventBody('2026-09-21', ' Cliente Exemplo ', '08:00:00', '09:00:00');
assert.equal(event.summary, 'Cliente Exemplo');
assert.deepEqual(event.start, { dateTime: '2026-09-21T08:00:00', timeZone: 'America/Sao_Paulo' });
assert.equal(event.description, '');
assert.equal(event.location, '');
assert.deepEqual(eventBody('2026-09-21', 'Cliente', '09:00', '08:00').end, {date:'2026-09-22'});
assert.deepEqual(eventBody('2026-09-21', 'Cliente', '24:00', '25:00').start, {date:'2026-09-21'});
assert.deepEqual(eventBody('2026-09-21', 'Cliente', '08:00', '09:00', true).start, {date:'2026-09-21'});
assert.deepEqual(eventBody('2026-09-21', 'Cliente').end, {date:'2026-09-22'});
const id = await eventId('2026-09-21', 'client-1');
assert.match(id, /^[0-9a-v]{5,1024}$/);
assert.equal(id, await eventId('2026-09-21', 'client-1'));
assert.notEqual(id, await eventId('2026-09-22', 'client-1'));
assert.notEqual(id, await eventId('2026-09-21', 'client-2'));
console.log('Google Calendar: dates, agenda cycle, event payloads and idempotency passed.');

const { syncDays, staleEvents } = await import('../../supabase/functions/google-calendar/model');
const windowDays = syncDays('2026-12-25');
assert.equal(windowDays.length, 16);
assert.equal(windowDays[15], '2027-01-09');
assert.equal(new Set(windowDays).size, 16);
const owned = (id:string, day:string) => ({id,extendedProperties:{private:{source:'promax',day}}});
assert.deepEqual(staleEvents([
 owned('keep','2026-12-25'), owned('cancelled','2027-01-09'),
 owned('past','2026-12-24'), owned('future','2027-01-10'), {id:'personal'}
], new Set(['keep']), windowDays[0], windowDays[15]).map(e=>e.id), ['cancelled']);
console.log('15-day horizon and cancellation cleanup boundaries passed.');

const detailed=eventBody('2026-09-21','Loja',null,null,false,{contato:' Ana ',telefone:47999998888,endereco:'Rua Exemplo, 123',bairro:'Centro',cidade:'Joinville'});
assert.equal(detailed.summary,'Loja');
assert.equal(detailed.location,'Rua Exemplo, 123, Centro, Joinville');
assert.equal(detailed.description,'Contato: Ana\nTelefone: 47999998888');
assert.equal('attendees' in detailed,false);
assert.equal(eventBody('2026-09-21','Loja',null,null,false,{cidade:'Joinville'}).location,'Joinville');
assert.equal(eventBody('2026-09-21','Loja',null,null,false,{contato:'<Ana>'}).description,'Contato: &lt;Ana&gt;');
console.log('Contact fields, absent data and description escaping passed.');

const { pendingEvent } = await import('../../supabase/functions/google-calendar/model');
const task={id:'task-1',tipo:'TAREFA',titulo:'Conferir material',data_prevista:'2026-09-22',status:'PENDENTE'};
assert.equal(pendingEvent(task)!.summary,'Conferir material');
assert.deepEqual(pendingEvent(task)!.start,{date:'2026-09-22'});
assert.deepEqual(pendingEvent(task)!.end,{date:'2026-09-23'});
const customer={cliente:'Pet Shop',ativo:true,contato:'Ana',endereco:'Rua A'};
for(const title of ['Retorno comercial','Reavaliar recompra']) {
 const body=pendingEvent({...task,titulo:title,clientes:customer})!;
 assert.equal(body.summary,'Pet Shop'); assert.ok(body.description.startsWith(title));
}
assert.equal(pendingEvent({...task,tipo:'VISITA_EXTRA',clientes:customer})!.summary,'Pet Shop');
assert.equal(pendingEvent({...task,status:'CONCLUIDA'}),null);
assert.equal(pendingEvent({...task,status:'CANCELADA'}),null);
assert.equal(pendingEvent({...task,data_prevista:null}),null);
assert.equal(pendingEvent({...task,clientes:{...customer,ativo:false}}),null);
assert.notEqual(await eventId(task.data_prevista,'pendencia:task-1'),await eventId(task.data_prevista,'pendencia:task-2'));
console.log('All-day extras, follow-ups and tasks, including clientless tasks, passed.');
