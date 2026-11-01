import { getCacheValue, setCacheValue, initDB } from './offline';

const memory = new Map<string, string | null>();
const writes = new Map<string, Promise<void>>();

function persistFallback(key: string, value: string | null) {
  const next = (writes.get(key) || Promise.resolve()).then(() => setCacheValue(key, value)).catch(error => {
    console.warn('Não foi possível persistir o rascunho offline:', error);
  });
  writes.set(key, next);
}

export function saveDraftLocally(key: string, value: string) {
  memory.set(key, value);
  // IndexedDB preserves drafts even when the browser's small localStorage quota is full.
  persistFallback(key, value);
  try {
    localStorage.setItem(key, value);
  } catch (error) {
    console.warn('Armazenamento local cheio; rascunho mantido no armazenamento offline.', error);
  }
}

export async function readDraftLocally(key: string): Promise<string | null> {
  if (memory.has(key)) return memory.get(key)!;
  let local: string | null = null;
  try { local = localStorage.getItem(key); } catch { /* IndexedDB fallback below. */ }
  let offline: string | null = null;
  try { offline = await getCacheValue<string | null>(key, null); } catch { /* Keep local copy. */ }
  const updated = (value: string | null) => {
    try { const data = JSON.parse(value || '{}'); return Date.parse(data.updatedAt || data.startedAt || '') || 0; }
    catch { return 0; }
  };
  return updated(offline) > updated(local) ? offline : local || offline;
}

export function clearLocalDraft(key: string) {
  memory.set(key, null);
  persistFallback(key, null);
  try { localStorage.removeItem(key); } catch { /* Cleared in the offline store. */ }
}

/**
 * Recupera rascunhos do armazenamento local e do IndexedDB.
 * Não elimina nenhum registro: uma ausência no Supabase não é prova de exclusão.
 */
export async function listLocalOrderDrafts(): Promise<Array<{ clienteId: string; draft: any }>> {
  const keys = new Set<string>();
  const orderKey = /^pedido_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && orderKey.test(key)) keys.add(key);
    }
  } catch { /* localStorage may be unavailable */ }
  try {
    const db = await initDB();
    const offlineRecords = await db.getAll('app_cache');
    for (const record of offlineRecords) {
      if (orderKey.test(record.key) && typeof record.value === 'string' && record.value) {
        keys.add(record.key);
      }
    }
  } catch (error) {
    console.warn('[Rascunhos] IndexedDB não disponível:', error);
  }

  const result: Array<{ clienteId: string; draft: any }> = [];
  for (const key of keys) {
    const raw = await readDraftLocally(key);
    if (!raw) continue;
    try {
      const data = JSON.parse(raw);
      const items = data?.items ?? data;
      if (!items || typeof items !== 'object' ||
          (Array.isArray(items) ? items.length === 0 : Object.keys(items).length === 0)) continue;
      const clienteId = key.slice('pedido_'.length);
      result.push({ clienteId, draft: data });
    } catch {
      // Não eliminar uma cópia antiga por erro de formato.
    }
  }
  return result;
}
