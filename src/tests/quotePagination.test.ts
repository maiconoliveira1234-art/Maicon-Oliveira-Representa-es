import assert from 'node:assert/strict';
import { paginateQuoteItems } from '../lib/quotePagination';

const items = (count: number, bonuses = 0) => Array.from({ length: count }, (_, index) => ({
  id: index,
  tipo_operacao: index >= count - bonuses ? 'BONIFICACAO_COMERCIAL' : 'VENDA',
}));

const compact = paginateQuoteItems(items(16, 2), 'Entregar até sexta-feira');
assert.equal(compact.length, 1, 'a short order with bonuses and notes fits on one page');

const jucemara = items(30, 2);
const pages = paginateQuoteItems(jucemara, 'Entregar até sexta-feira');
assert.deepEqual(pages.map(page => page.length), [22, 8]);
assert.deepEqual(pages.flat(), jucemara, 'all items appear exactly once, in order');

const larger = paginateQuoteItems(items(70, 2));
assert.ok(larger.every(page => page.length > 0 && page.length <= 28));
assert.deepEqual(larger.flat(), items(70, 2));

console.log('Quote pagination: compact order, 30-item draft, and long order passed.');
