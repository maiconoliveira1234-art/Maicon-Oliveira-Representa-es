import { getCacheValue, setCacheValue } from './offline';

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
