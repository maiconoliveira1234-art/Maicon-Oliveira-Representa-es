import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createResilientAuthStorage, EVICTABLE_CACHE_KEYS } from '../lib/authStorage';

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

// Cota cheia de caches: o token é salvo liberando um espelho do IndexedDB.
const full = quotaStorage(1000);
full.data.set('offline_db_hist_vendas', 'x'.repeat(900));
full.data.set('pedido_rascunho', 'y'.repeat(50));
const storage = createResilientAuthStorage(() => full);
storage.setItem('sb-token', 'z'.repeat(200));
assert.equal(full.data.get('sb-token'), 'z'.repeat(200));
assert.equal(full.data.has('offline_db_hist_vendas'), false);
assert.equal(full.data.get('pedido_rascunho'), 'y'.repeat(50), 'rascunhos nunca são removidos');
// Uma nova instância (app reaberto) encontra a sessão.
assert.equal(createResilientAuthStorage(() => full).getItem('sb-token'), 'z'.repeat(200));

// Sem como liberar espaço, a sessão continua válida enquanto o app está aberto.
const tiny = quotaStorage(10);
const mem = createResilientAuthStorage(() => tiny);
mem.setItem('sb-token', 'z'.repeat(200));
assert.equal(mem.getItem('sb-token'), 'z'.repeat(200));
mem.removeItem('sb-token');
assert.equal(mem.getItem('sb-token'), null);

assert.ok(!EVICTABLE_CACHE_KEYS.includes('offline_db_pending_queue'), 'fila pendente nunca é descartável');

// O teste de disponibilidade do index.html não pode depender de gravar
// (setItem falha com cota cheia e trocaria o storage real por memória).
const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
assert.ok(!html.includes("setItem('__test_storage__'"));
assert.ok(html.includes("window.localStorage.getItem('__test_storage__')"));

// A renovação do token não refaz a checagem de acesso nem bloqueia a tela.
const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
assert.ok(!app.includes('session?.access_token]'));

console.log('authStorage tests passed');
