import assert from 'node:assert/strict';
import { orderQuoteItems } from '../lib/quoteItemOrder';
const products = [{ id: 'a', produto: 'A' }, { id: 'z', produto: 'Z' }];
const items = [
  { produto_id: 'a', tipo_operacao: 'BONIFICACAO_COMERCIAL', quantidade: 5 },
  { produto_id: 'z', tipo_operacao: 'VENDA', quantidade: 10 },
  { produto_id: 'z', tipo_operacao: 'BONIFICACAO_COMERCIAL', quantidade: 1 },
  { produto_id: 'a', tipo_operacao: 'MERCHANDISING', quantidade: 2 },
  { produto_id: 'a', quantidade: 3 },
];
const original = JSON.stringify(items);
const ordered = orderQuoteItems(items, products);
assert.equal(JSON.stringify(items), original);
assert.deepEqual(ordered.map(x => x.quantidade), [2, 3, 10, 5, 1]);
assert.equal(ordered.reduce((sum, x) => sum + x.quantidade, 0), 21);
assert.deepEqual(orderQuoteItems([], products), []);
assert.equal(orderQuoteItems([items[0]], products)[0], items[0]);
// Page slicing retains the global ordering, including a bonus section continuing on later pages.
const many = [...Array.from({ length: 40 }, () => items[1]), ...Array.from({ length: 30 }, () => items[0])].reverse();
const sorted = orderQuoteItems(many, products);
const pages = Array.from({ length: Math.ceil(sorted.length / 13) }, (_, i) => sorted.slice(i * 13, (i + 1) * 13));
assert.equal(pages.flat().findIndex(x => x.tipo_operacao === 'BONIFICACAO_COMERCIAL'), 40);
assert.ok(pages.flat().slice(40).every(x => x.tipo_operacao === 'BONIFICACAO_COMERCIAL'));
console.log('Quote item order: bonuses last, quantities preserved, source unchanged, multipage ordering passed.');
