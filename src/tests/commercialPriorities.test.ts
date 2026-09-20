import { getPurchaseCycle } from '../lib/purchaseCycle';
import assert from 'node:assert/strict';
import { buildCommercialPriorities, COMMERCIAL_RETURN_TITLE } from '../lib/commercialPriorities';
import { Cliente, HistVenda } from '../types';
import { AgendaPendencia } from '../types/agendaPendencia';

const client: Cliente = { id: 'a', cliente: 'Cliente A', ativo: true, cidade: '' };
const today = new Date('2026-09-20T00:00:00');
const sale = (date: string, overrides = {}): HistVenda => ({ id: date, cliente_id: 'a', faturamento: date,
  vendas: 'VENDAS', qtd: 1, 'r$_total': 100, ...overrides } as HistVenda);
const history = ['2026-07-20', '2026-08-10', '2026-08-31'].map(d => sale(d));
const task = (overrides = {}): AgendaPendencia => ({ id: 'p', cliente_id: 'a', tipo: 'TAREFA', titulo: COMMERCIAL_RETURN_TITLE,
  descricao: 'Conferir estoque', data_prevista: '2026-09-19', status: 'PENDENTE', ...overrides } as AgendaPendencia);
const run = (overrides = {}) => buildCommercialPriorities({ clientes: [client], historico: history,
  pendencias: [], openClientIds: new Set<string>(), today, ...overrides });
let count = 0;
function test(name: string, fn: () => void) { fn(); count++; console.log('OK', name); }

test('not overdue before the normal buying interval', () => assert.equal(run().length, 0));
const overdueHistory = ['2026-07-01', '2026-07-22', '2026-08-12'].map(d => sale(d));
test('21-day interval stays constant while elapsed time grows', () => {
  const [p] = run({ historico: overdueHistory });
  assert.equal(p.overdueDays, 18); assert.match(p.reason, /21 dias; há 39 dias/);
});
test('multiple product rows and same-day orders are one purchase day', () => {
  assert.equal(run({ historico: [...overdueHistory, ...overdueHistory] })[0].overdueDays, 18);
});
test('one purchase day, invalid and future dates do not create a cycle', () => {
  assert.equal(run({ historico: [overdueHistory[0], sale('invalid'), sale('2027-01-01')] }).length, 0);
  assert.equal(getPurchaseCycle([overdueHistory[0]], today).gap, null);
});
test('recent actual sale resets elapsed days', () => assert.equal(run({ historico: [...overdueHistory, sale('2026-09-19')] }).length, 0));
test('open order blocks repurchase but preserves promised contact', () => {
  assert.equal(run({ historico: overdueHistory, openClientIds: new Set(['a']) }).length, 0);
  assert.equal(run({ pendencias: [task()], openClientIds: new Set(['a']) })[0].kind, 'RETORNO');
});
test('unknown open orders cannot establish missing orders', () => assert.equal(run({ historico: overdueHistory, openClientIds: null }).length, 0));
test('future follow-up postpones automatic repurchase', () => assert.equal(run({ historico: overdueHistory, pendencias: [task({ data_prevista: '2026-09-25' })] }).length, 0));
test('follow-up becomes eligible on exact day, one entry per client', () => {
  const result = run({ historico: overdueHistory, pendencias: [task({ data_prevista: '2026-09-20' }), task({ id: 'p2' })] });
  assert.equal(result.length, 1); assert.equal(result[0].followUp!.id, 'p2');
});
test('unrelated tasks do not suppress repurchase or become commercial returns', () => {
  assert.equal(run({ historico: overdueHistory, pendencias: [task({ titulo: 'Entregar catálogo', data_prevista: '2026-09-25' })] })[0].kind, 'RECOMPRA');
});
test('completion suppresses for local day only; cancellation does not suppress', () => {
  assert.equal(run({ historico: overdueHistory, pendencias: [task({ status: 'CONCLUIDA', concluida_em: '2026-09-20T12:00:00' })] }).length, 0);
  assert.equal(run({ historico: overdueHistory, pendencias: [task({ status: 'CONCLUIDA', concluida_em: '2026-09-19T12:00:00' })] }).length, 1);
  assert.equal(run({ historico: overdueHistory, pendencias: [task({ status: 'CANCELADA', data_prevista: '2026-09-25' })] }).length, 1);
});
test('inactive clients excluded and returns rank ahead of repurchase', () => {
  const clients = [client, { ...client, id: 'b' }, { ...client, id: 'inactive', ativo: false }];
  const result = run({ clientes: clients, historico: overdueHistory, pendencias: [task({ cliente_id: 'b' }), task({ cliente_id: 'inactive' })] });
  assert.deepEqual(result.map(p => p.cliente.id), ['b', 'a']);
});
test('old history, merchandising and drafts are excluded consistently', () => {
  for (const overrides of [{ vendas: 'BONIFICACAO', tabela: 'BRINDES' }, { id: 'open_order_a' }]) {
    assert.equal(run({ historico: overdueHistory.map(s => ({ ...s, ...overrides })) }).length, 0);
  }
  assert.equal(run({ historico: ['2024-01-01', '2024-02-01', '2024-03-01'].map(d => sale(d)) }).length, 0);
});
test('numeric database sale IDs do not crash the Home calculation', () => {
  const numericHistory = overdueHistory.map((s, i) => ({ ...s, id: i + 1 })) as unknown as HistVenda[];
  const result = run({ historico: numericHistory });
  assert.equal(result.length, 1);
  assert.equal(result[0].kind, 'RECOMPRA');
  assert.equal(result[0].overdueDays, 18);
});
test('two purchase days suffice, matching Metas', () => {
  assert.equal(run({ historico: overdueHistory.slice(0, 2) })[0].overdueDays, 39);
});
test('Home uses weighted Metas cycle and alerts on first overdue day', () => {
  const rows = ['2026-01-01', '2026-02-20', '2026-03-12', '2026-04-01', '2026-04-21'].map(d => sale(d));
  const date = new Date('2026-05-14T00:00:00');
  const cycle = getPurchaseCycle(rows, date);
  assert.equal(cycle.cycleDays, 22);
  assert.equal(cycle.gap, 1);
  const [priority] = run({ historico: rows, today: date });
  assert.equal(priority.overdueDays, cycle.gap);
  assert.match(priority.reason, /Próx. ped.: \+1 dias/);
  assert.equal(run({ historico: rows, today: new Date('2026-05-13T00:00:00') }).length, 0);
});
test('commercial bonuses count as stock replenishment, gifts do not reset last date', () => {
  const rows = [sale('2026-08-01'), sale('2026-08-21', { vendas: 'BONIFICACAO', 'r$_total': 0 }), sale('2026-09-19', { vendas: 'BONIFICACAO', tabela: 'BRINDES' })];
  const cycle = getPurchaseCycle(rows, today);
  assert.equal(cycle.cycleDays, 20);
  assert.equal(cycle.lastDate, '2026-08-21');
  assert.equal(cycle.gap, 10);
  assert.equal(run({ historico: rows })[0].overdueDays, 10);
});
console.log(`${count} commercial priority tests passed.`);
