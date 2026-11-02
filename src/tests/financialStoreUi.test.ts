import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const importPage = readFileSync('src/pages/ImportPage.tsx', 'utf8');
const editor = readFileSync('src/components/NewClientModal.tsx', 'utf8');
const addStore = readFileSync('src/components/AddFinancialStoreModal.tsx', 'utf8');

assert.match(importPage, /setLojaFinanceiraId\(lojas.length === 1 \? lojas\[0\].id : ''\)/);
assert.match(importPage, /lojasStatus === 'ready' && lojasFinanceiras.length > 1 && \(\s*<>\s*<label htmlFor="import-loja-financeira"/);
assert.match(importPage, /if \(lojasFinanceiras.length > 0 && !lojaSelecionada\)/);

assert.match(editor, /editingCliente && \(\s*<section/);
assert.match(editor, /Acrescentar loja/);
assert.match(editor, /<AddFinancialStoreModal/);
assert.match(editor, /setLojas\(current => \[\.\.\.current, loja\]/);

assert.match(addStore, /cliente_comercial_id: clienteId/);
assert.match(addStore, /razao_social: name/);
assert.match(addStore, /limite_total: Math.round\(total \* 100\)/);
assert.match(addStore, /disponivel_oficial_snapshot:/);
assert.match(addStore, /data_snapshot: format\(new Date\(\), 'yyyy-MM-dd'\)/);
assert.match(addStore, /titulos_conferidos: false/);
assert.match(addStore, /\.select\('id, razao_social, limite_total'\)\.single\(\)/);
assert.match(addStore, /replace\(\/\\s\/g, ''\)/);
assert.match(addStore, /replace\(\/\\.\/g, ''\)/);
console.log('Cadastro de lojas: seleção condicional, vínculo e validação financeira conferidos.');
