import assert from 'node:assert/strict';
import { adjustedCredit, titleStatus } from '../lib/financialReview';

assert.deepEqual(adjustedCredit('15.000,00', 10000, 2000), { limit: 15000, available: 7000 });
assert.deepEqual(adjustedCredit('9.000,00', 10000, 2000), { limit: 9000, available: 1000 });
assert.deepEqual(adjustedCredit('8.000,00', 10000, 2000), { limit: 8000, available: 0 });
assert.deepEqual(adjustedCredit('0', 10000, 10000), { limit: 0, available: 0 });
assert.deepEqual(adjustedCredit('R$ 15.000,25', 10000, 2000), { limit: 15000.25, available: 7000.25 });
for (const value of ['', '-1', '1,001', 'abc', '1e5', '7.999,99', '1.2.3', '999999999999999999999']) {
  assert.throws(() => adjustedCredit(value, 10000, 2000));
}
assert.equal(titleStatus({ vencimento: '2026-11-05', baixado_em: null }, '2026-11-06'), 'Pagamento presumido');
assert.equal(titleStatus({ vencimento: '2026-11-06', baixado_em: null }, '2026-11-06'), 'Pagamento presumido');
assert.equal(titleStatus({ vencimento: '2026-11-07', baixado_em: null }, '2026-11-06'), 'A vencer');
assert.equal(titleStatus({ vencimento: '2026-11-05', baixado_em: '2026-11-06' }, '2026-11-06'), 'Baixado');
assert.equal(titleStatus({ vencimento: '2026-11-05', baixado_em: '2026-11-07' }, '2026-11-06'), 'Pagamento presumido');
console.log('Financial review tests passed.');
