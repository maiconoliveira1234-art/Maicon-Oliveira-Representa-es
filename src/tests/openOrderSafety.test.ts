import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const order = readFileSync('src/pages/OrderPage.tsx', 'utf8');
const manager = readFileSync('src/lib/dataManager.tsx', 'utf8');
const storage = readFileSync('src/lib/draftStorage.ts', 'utf8');
const sales = readFileSync('src/lib/openOrderSales.ts', 'utf8');

// Abrir uma tela vazia ou relogar jamais pode apagar pedidos.
assert.match(order, /if \(itens\.length === 0\) \{[\s\S]*?draftSaver\.cancel\(\);[\s\S]*?return;/);
assert.doesNotMatch(order, /if \(itens\.length === 0\) \{\s*draftSaver\.cancel\(\);\s*deleteOpenOrder/);
assert.match(order, /else if \(!dbData && localData\) \{[\s\S]*?savedData = localData;/);
assert.doesNotMatch(manager, /const reconcileOpenOrders = async/);

// Rascunhos sobrevivem à consulta remota vazia e podem voltar à nuvem.
assert.match(manager, /listLocalOrderDrafts\(\)/);
assert.match(manager, /\.from\('pedidos_em_aberto'\)[\s\S]*?\.insert\(\{/);
assert.match(storage, /db\.getAll\('app_cache'\)/);

// Exclusões antigas sem confirmação explícita não podem ser reaplicadas.
assert.match(manager, /item\.payload\?\.explicit !== true/);
assert.match(manager, /const deletion = \{ cliente_id: clienteId, explicit: true \}/);
assert.match(sales, /export function purgeOrphanLocalOpenOrder/);
assert.doesNotMatch(sales, /if \(serverLoaded && !openOrdersMap\.has/);
assert.match(sales, /if \(error\) \{[\s\S]*?return false;[\s\S]*?clearLocalDraft/);

console.log('Segurança de pedidos: início de sessão, armazenamento local e exclusões explícitas verificados.');
