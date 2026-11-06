import assert from 'node:assert/strict';
import { calcularVencimentosW, distribuirFaturamentoEmParcelas } from '../lib/creditImport';

// Every day in the same Monday–Sunday billing week shares the following Saturday.
for (const day of ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08']) {
  assert.deepEqual(calcularVencimentosW(day, [14, 21, 28]).map(p => p.vencimento),
    ['2026-11-28', '2026-12-05', '2026-12-12']);
}
assert.deepEqual(calcularVencimentosW('2026-12-31', [7, 14]).map(p => p.vencimento), ['2027-01-16', '2027-01-23']);
assert.deepEqual(calcularVencimentosW('2026-02-30', [14]), []);
assert.deepEqual(calcularVencimentosW('2026-11-06', [-1]), []);
const parcelas = distribuirFaturamentoEmParcelas(100.01, calcularVencimentosW('2026-11-06', [14, 21, 28]).map(p => p.vencimento));
assert.deepEqual(parcelas, [
  { vencimento: '2026-11-28', valor: 33.33 },
  { vencimento: '2026-12-05', valor: 33.33 },
  { vencimento: '2026-12-12', valor: 33.35 }
]);
console.log('Saturday billing schedule tests passed.');
