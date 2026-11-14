// Tira do localStorage os caches grandes (clientes, produtos, histórico...).
//
// Esses dados já ficam completos no IndexedDB. A cópia no localStorage enchia a
// cota de ~5 MB do iPad e impedia gravações pequenas e importantes, como o
// rascunho da contagem, os rascunhos de pedido e a sessão de login.

import { EVICTABLE_CACHE_KEYS } from './authStorage';
import { getCacheValue, setCacheValue } from './offline';

type StorageLike = Pick<Storage, 'getItem' | 'removeItem'>;
type CacheLike = {
  has: (key: string) => Promise<boolean>;
  set: (key: string, value: unknown) => Promise<void>;
};

const MISSING = '__promax_cache_missing__';

const defaultStorage = (): StorageLike | undefined => {
  try { return globalThis.localStorage; } catch { return undefined; }
};

const defaultCache: CacheLike = {
  has: async key => (await getCacheValue<unknown>(key, MISSING)) !== MISSING,
  set: (key, value) => setCacheValue(key, value),
};

export const INDEXEDDB_ONLY_CACHE_KEYS: ReadonlySet<string> = new Set(EVICTABLE_CACHE_KEYS);

/**
 * Move cada cache grande para o IndexedDB (se ainda não estiver lá) e só então
 * apaga a cópia do localStorage. Se o IndexedDB falhar, a cópia é mantida.
 * Devolve as chaves liberadas.
 */
export async function moveLargeCachesToIndexedDB(
  storage = defaultStorage(),
  cache: CacheLike = defaultCache
): Promise<string[]> {
  const released: string[] = [];
  if (!storage) return released;
  for (const key of INDEXEDDB_ONLY_CACHE_KEYS) {
    let raw: string | null = null;
    try { raw = storage.getItem(key); } catch { continue; }
    if (raw == null) continue;
    try {
      if (!(await cache.has(key))) {
        await cache.set(key, JSON.parse(raw));
      }
      storage.removeItem(key);
      released.push(key);
    } catch (error) {
      console.warn(`[OfflineManager] Cache ${key} mantido no localStorage.`, error);
    }
  }
  return released;
}
