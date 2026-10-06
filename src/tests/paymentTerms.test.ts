import assert from 'node:assert/strict';
import { getAvailableTerms } from '../lib/paymentTerms';

for (const value of [0, -1, 700, 899.99, NaN, Infinity]) {
  assert.deepEqual(getAvailableTerms(value), [], `Pedido inválido: ${value}`);
}
assert.deepEqual(getAvailableTerms(900), [
  'À Vista', '01 Boleto (07)', '01 Boleto (14)', '02 Boletos (07-14)',
]);
assert(!getAvailableTerms(1050).includes('03 Boletos (07-14-21)'));
assert(!getAvailableTerms(1349.99).includes('03 Boletos (07-14-21)'));
assert(getAvailableTerms(1350).includes('03 Boletos (07-14-21)'));
assert(!getAvailableTerms(2499.99).includes('01 Boleto (42)'));
assert(getAvailableTerms(2500).includes('04 Boletos (21-28-35-42)'));
assert(!getAvailableTerms(2499.99).includes('04 Boletos (21-28-35-42)'));

// Every option respects both the minimum installment and the ordinary final term.
// Campaign terms are supplied separately to the WhatsApp agent, not made permanent.
for (const [value, lastDay] of [[900, 14], [1050, 21], [1400, 28], [1800, 35],
  [2500, 42], [3800, 49], [5000, 56], [8000, 63], [13000, 70],
  [17000, 77], [20000, 84], [25000, 91], [55000, 91]]) {
  for (const term of getAvailableTerms(value).filter(term => term !== 'À Vista')) {
    const [, count, days] = term.match(/^(\d+) Boletos? \((.+)\)$/)!;
    const sequence = days.split('-').map(Number);
    assert.equal(sequence.length, Number(count));
    assert(Math.floor(Math.round(value * 100) / Number(count)) >= 45000);
    assert(sequence.at(-1)! <= lastDay);
    assert(sequence.every((day, i) => i === 0 || day - sequence[i - 1] === 7));
  }
}
console.log('Regras de pagamento: mínimos, limites por faixa e intervalos validados.');
