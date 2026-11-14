import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  clearStockDraft,
  legacyStockDraftKey,
  newerStockDraft,
  readStockDraft,
  saveStockDraft,
  stockDraftKey,
  type StockDraft,
} from '../lib/stockCountDraftStore';
import { moveLargeCachesToIndexedDB } from '../lib/localCacheMigration';

// localStorage com cota: grava enquanto couber, depois lança QuotaExceededError.
function quotaStorage(limit: number) {
  const data = new Map<string, string>();
  const size = () => [...data].reduce((n, [k, v]) => n + k.length + v.length, 0);
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    removeItem: (k: string) => { data.delete(k); },
    setItem: (k: string, v: string) => {
      const prev = data.get(k);
      data.set(k, v);
      if (size() > limit) {
        if (prev === undefined) data.delete(k); else data.set(k, prev);
        const e = new Error('The quota has been exceeded.'); e.name = 'QuotaExceededError'; throw e;
      }
    },
  };
}

function memoryCache(fail = false) {
  const data = new Map<string, unknown>();
  return {
    data,
    get: async (k: string) => { if (fail) throw new Error('idb off'); return data.has(k) ? data.get(k) : null; },
    set: async (k: string, v: unknown) => { if (fail) throw new Error('idb off'); data.set(k, v); },
    has: async (k: string) => { if (fail) throw new Error('idb off'); return data.has(k); },
  };
}

const draft = (revisao: number, qtd = 3): StockDraft => ({ valores: { p1: qtd }, tocados: ['p1'], revisao });

// 1. localStorage cheio (cenário do iPad): o rascunho vai para o IndexedDB.
{
  const full = quotaStorage(200);
  full.data.set('offline_db_hist_vendas', 'x'.repeat(190));
  const cache = memoryCache();
  const ok = await saveStockDraft('c1', draft(10), full, cache);
  assert.equal(ok, true, 'salvar com localStorage cheio deve usar o IndexedDB');
  assert.equal(full.data.has(stockDraftKey('c1')), false);
  assert.deepEqual(await readStockDraft('c1', full, cache), draft(10));
}

// 2. Sem nenhum armazenamento local: informa a falha para a tela avisar.
{
  const full = quotaStorage(10);
  const ok = await saveStockDraft('c2', draft(10), full, memoryCache(true));
  assert.equal(ok, false);
}

// 3. IndexedDB fora do ar, mas localStorage com espaço: ainda salva.
{
  const roomy = quotaStorage(10_000);
  const ok = await saveStockDraft('c3', draft(5), roomy, memoryCache(true));
  assert.equal(ok, true);
  assert.deepEqual(await readStockDraft('c3', roomy, memoryCache(true)), draft(5));
}

// 4. A leitura escolhe a cópia mais recente entre as duas.
{
  const roomy = quotaStorage(10_000);
  const cache = memoryCache();
  roomy.setItem(stockDraftKey('c4'), JSON.stringify(draft(1, 1)));
  cache.data.set(stockDraftKey('c4'), draft(2, 9));
  assert.equal((await readStockDraft('c4', roomy, cache))?.valores.p1, 9);
  assert.equal(newerStockDraft(draft(3), null, draft(7), { lixo: true } as never)?.revisao, 7);
}

// 5. Gravações seguidas terminam na última revisão; limpar apaga as duas cópias e a antiga.
{
  const roomy = quotaStorage(10_000);
  const cache = memoryCache();
  roomy.setItem(legacyStockDraftKey('c5'), '{"p1":1}');
  void saveStockDraft('c5', draft(1), roomy, cache);
  await saveStockDraft('c5', draft(2), roomy, cache);
  assert.equal((cache.data.get(stockDraftKey('c5')) as StockDraft).revisao, 2);
  assert.equal(roomy.data.has(legacyStockDraftKey('c5')), false);
  await clearStockDraft('c5', roomy, cache);
  assert.equal(await readStockDraft('c5', roomy, cache), null);
}

// 6. Migração: caches grandes saem do localStorage sem perder dados.
{
  const storage = quotaStorage(100_000);
  const cache = memoryCache();
  storage.setItem('offline_db_clientes', JSON.stringify([{ id: 'a' }]));
  storage.setItem('offline_db_produtos', JSON.stringify([{ id: 'antigo' }]));
  cache.data.set('offline_db_produtos', [{ id: 'completo' }]);
  storage.setItem('offline_db_pending_queue', '[]');
  storage.setItem(stockDraftKey('c6'), JSON.stringify(draft(1)));
  const released = await moveLargeCachesToIndexedDB(storage, cache);
  assert.deepEqual(released.sort(), ['offline_db_clientes', 'offline_db_produtos']);
  assert.deepEqual(cache.data.get('offline_db_clientes'), [{ id: 'a' }]);
  assert.deepEqual(cache.data.get('offline_db_produtos'), [{ id: 'completo' }], 'não sobrescreve o cache completo');
  assert.equal(storage.data.has('offline_db_pending_queue'), true, 'fila pendente nunca é movida');
  assert.equal(storage.data.has(stockDraftKey('c6')), true, 'rascunhos nunca são movidos');
}

// 7. Migração com IndexedDB fora do ar mantém a cópia local.
{
  const storage = quotaStorage(100_000);
  storage.setItem('offline_db_clientes', '[]');
  assert.deepEqual(await moveLargeCachesToIndexedDB(storage, memoryCache(true)), []);
  assert.equal(storage.data.has('offline_db_clientes'), true);
}

// 8. A tela não depende mais do localStorage para enviar à nuvem nem trava a contagem com alertas.
{
  const page = readFileSync(new URL('../pages/StockCountPage.tsx', import.meta.url), 'utf8');
  const sync = page.slice(page.indexOf('const syncDraft'), page.indexOf('const scheduleDraftSync'));
  assert.match(sync, /pendingDraft\.current/);
  assert.doesNotMatch(sync, /localStorage/);
  assert.doesNotMatch(page, /esta contagem não pôde ser gravada no dispositivo/);
  const manager = readFileSync(new URL('../lib/dataManager.tsx', import.meta.url), 'utf8');
  assert.match(manager, /moveLargeCachesToIndexedDB\(\)/);
}

console.log('stockCountDraft: ok');
