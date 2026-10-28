import assert from 'node:assert/strict';
import { outgoingStockLoans } from '../lib/outgoingStockLoans';
import type { Emprestimo } from '../types';
const loan = { id: '1', cliente_origem_id: 'A', cliente_destino_id: 'B', produto_id: 'food', quantidade: 1, status: 'pendente', data_emprestimo: '2026-10-28' } as Emprestimo;
const loans: Emprestimo[] = [loan,
  { ...loan, id: '2', cliente_destino_id: 'C', quantidade: 2 },
  { ...loan, id: '3', status: 'pago', quantidade: 9 },
  { ...loan, id: '4', cliente_origem_id: 'B', cliente_destino_id: 'A', quantidade: 7 },
  { ...loan, id: '5', produto_id: 'other', quantidade: 4 },
  { ...loan, id: '6', quantidade: -1 },
];
const result = outgoingStockLoans(loans, 'A');
assert.equal(result.get('food')?.quantidade, 3);
assert.deepEqual(result.get('food')?.emprestimos.map(l => l.cliente_destino_id), ['B', 'C']);
assert.equal(result.get('other')?.quantidade, 4);
assert.equal(outgoingStockLoans(loans).size, 0);
assert.equal(outgoingStockLoans(loans, 'C').size, 0);
assert.equal(outgoingStockLoans([{ ...loan, status: 'pago' }], 'A').size, 0);
assert.equal(outgoingStockLoans(loans, 'B').get('food')?.quantidade, 7);
console.log('Outgoing stock loans: aggregation, direction, paid loans and client isolation passed.');
