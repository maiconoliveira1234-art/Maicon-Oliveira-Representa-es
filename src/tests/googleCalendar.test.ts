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
assert.equal('description' in event, false);
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
