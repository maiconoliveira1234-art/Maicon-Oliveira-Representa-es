import assert from 'node:assert/strict';
import { loadClientHistory } from '../lib/clientHistory';
import { HistVenda } from '../types';

const sale = (id: number, date = '2026-07-24') => ({ id, cliente_id: 'agronec', produto_id: `p${id}`, faturamento: date, qtd: 1, 'r$_total': 10 } as unknown as HistVenda);
const stale = [sale(1)];
const fresh = [sale(2, '2026-09-25'), ...stale];
assert.deepEqual((await loadClientHistory('agronec', stale, async () => ({ data: fresh, error: null }), true)).rows, fresh);
const pages: number[] = [];
const many = Array.from({ length: 622 }, (_, i) => sale(i));
const result = await loadClientHistory('agronec', stale, async (_, from, to) => {
  pages.push(from);
  return { data: many.slice(from, to + 1), error: null };
}, true);
assert.equal(result.rows.length, 622);
assert.deepEqual(pages, [0, 300, 600]);
const failed = await loadClientHistory('agronec', stale, async (_, from) => from === 0
  ? { data: many.slice(0, 300), error: null }
  : { data: null, error: new Error('network unavailable') }, true);
assert.deepEqual(failed, { rows: stale, fresh: false });
assert.deepEqual(await loadClientHistory('agronec', stale, async () => { throw new Error('must not fetch'); }, false), { rows: stale, fresh: false });
assert.deepEqual(await loadClientHistory('agronec', stale, async () => ({ data: [], error: null }), true), { rows: [], fresh: true });
console.log('Client history: stale cache, pagination, partial failure, offline and empty history passed.');
