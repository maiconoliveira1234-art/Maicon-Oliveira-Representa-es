import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const manager = readFileSync('src/lib/dataManager.tsx','utf8');
const page = readFileSync('src/pages/OrderPage.tsx','utf8');
const sales = readFileSync('src/lib/openOrderSales.ts','utf8');
const ddl = readFileSync('security/order-deletion-tombstones-v1.20.186.sql','utf8');

assert.doesNotMatch(manager,/restoreLocalOpenOrders/);
assert.doesNotMatch(manager,/listLocalOrderDrafts\(\)/);
assert.match(manager,/\.rpc\('excluir_pedido_em_aberto', \{ p_cliente_id: clienteId \}\)/);
assert.match(manager,/item\.action === 'delete_open_order' &&\s*item\.payload\?\.explicit === true/);
assert.match(page,/pedidos_em_aberto_excluidos/);
assert.match(page,/deletedAt && started <= deletedAt/);
assert.match(page,/deletionPending/);
assert.match(sales,/hasPendingExplicitOrderDeletion/);
assert.match(sales,/deletedAtByClient/);
assert.match(sales,/\.rpc\('excluir_pedido_em_aberto'/);
assert.match(ddl,/CREATE TABLE IF NOT EXISTS public\.pedidos_em_aberto_excluidos/);
assert.match(ddl,/CREATE TRIGGER trg_bloquear_pedido_excluido/);
assert.match(ddl,/NEW\.started_at <= v_excluido_em/);
assert.match(ddl,/pg_advisory_xact_lock/);
assert.match(ddl,/DELETE FROM public\.pedidos_em_aberto WHERE cliente_id=p_cliente_id/);
console.log('Protecao contra reaparecimento de pedidos excluidos: verificacoes aprovadas.');
