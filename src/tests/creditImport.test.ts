import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { distribuirFaturamentoEmParcelas } from '../lib/creditImport';

const split = distribuirFaturamentoEmParcelas(100.01, ['2026-11-30','2026-12-07','2026-12-14']);
assert.deepEqual(split.map(p => p.valor), [33.33, 33.33, 33.35]);
assert.equal(Math.round(split.reduce((total,p)=>total + p.valor,0)*100),10001);
assert.deepEqual(distribuirFaturamentoEmParcelas(0,['2026-11-30']),[]);

const page = readFileSync('src/pages/ImportPage.tsx','utf8');
const sql = readFileSync('security/import_financial_store_v1_20_184.sql','utf8');
assert.match(page,/Loja do faturamento \/ CNPJ/);
assert.match(page,/entidade_financeira_id: lojaFinanceiraId \|\| null/);
assert.match(page,/lojaFinanceiraId\)/);
assert.match(page,/parcelas_credito: parcelasFinanceiras/);
assert.match(sql,/FOREIGN KEY \(entidade_financeira_id\)/);
assert.match(sql,/v_lojas_distintas > 1/);
assert.match(sql,/v_faturamentos/);
assert.match(sql,/origem, referencia_externa/);
console.log('Importação por loja: vínculos, parcelas, centavos e projeção verificados.');
