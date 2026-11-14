// Rascunho da contagem de estoque guardado com segurança no aparelho.
//
// O localStorage do iPad tem cota pequena (~5 MB) e pode estar cheio. Por isso
// a cópia principal fica no IndexedDB (sem esse limite) e o localStorage é só
// uma cópia extra. O envio à nuvem usa o rascunho em memória e não depende de
// nenhuma das duas gravações locais.

import { getCacheValue, setCacheValue } from './offline';

export type StockDraft = {
  valores: Record<string, number>;
  tocados: string[];
  revisao: number;
};

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
type CacheLike = {
  get: (key: string) => Promise<unknown>;
  set: (key: string, value: unknown) => Promise<void>;
};

export const stockDraftKey = (clienteId: string) => `estoque_rascunho_v2_${clienteId}`;
// Formato antigo: só os valores, sem revisão. Ainda é lido e limpo.
export const legacyStockDraftKey = (clienteId: string) => `estoque_${clienteId}`;

const defaultStorage = (): StorageLike | undefined => {
  try { return globalThis.localStorage; } catch { return undefined; }
};

const defaultCache: CacheLike = {
  get: key => getCacheValue<unknown>(key, null),
  set: (key, value) => setCacheValue(key, value),
};

export function isValidStockDraft(value: unknown): value is StockDraft {
  const d = value as StockDraft | null;
  return Boolean(d) && typeof d === 'object' &&
    Number(d!.revisao) > 0 &&
    Boolean(d!.valores) && typeof d!.valores === 'object' && !Array.isArray(d!.valores) &&
    Array.isArray(d!.tocados);
}

/** Devolve o rascunho mais recente (maior revisão) entre os válidos. */
export function newerStockDraft(...drafts: Array<StockDraft | null | undefined>): StockDraft | null {
  let best: StockDraft | null = null;
  for (const d of drafts) {
    if (isValidStockDraft(d) && (!best || Number(d.revisao) > Number(best.revisao))) best = d;
  }
  return best;
}

export function readStockDraftFromStorage(clienteId: string, storage = defaultStorage()): StockDraft | null {
  try {
    const raw = storage?.getItem(stockDraftKey(clienteId));
    const parsed = raw ? JSON.parse(raw) : null;
    return isValidStockDraft(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Lê as duas cópias locais e devolve a mais recente. */
export async function readStockDraft(
  clienteId: string,
  storage = defaultStorage(),
  cache: CacheLike = defaultCache
): Promise<StockDraft | null> {
  const fromStorage = readStockDraftFromStorage(clienteId, storage);
  let fromCache: StockDraft | null = null;
  try {
    const value = await cache.get(stockDraftKey(clienteId));
    fromCache = isValidStockDraft(value) ? value : null;
  } catch { /* usa a cópia do localStorage */ }
  return newerStockDraft(fromStorage, fromCache);
}

// Gravações em ordem: uma revisão antiga nunca sobrescreve uma mais nova.
const writeQueues = new Map<string, Promise<boolean>>();

/**
 * Grava o rascunho no IndexedDB e, se couber, no localStorage.
 * Resolve `true` se pelo menos uma das cópias foi gravada.
 */
export function saveStockDraft(
  clienteId: string,
  draft: StockDraft,
  storage = defaultStorage(),
  cache: CacheLike = defaultCache
): Promise<boolean> {
  const key = stockDraftKey(clienteId);
  let savedInStorage = false;
  try {
    storage?.setItem(key, JSON.stringify(draft));
    savedInStorage = true;
  } catch {
    // Cota cheia: a cópia do IndexedDB abaixo continua valendo.
    try { storage?.removeItem(key); } catch { /* segue */ }
  }
  // A cópia antiga sem revisão não é mais necessária.
  try { storage?.removeItem(legacyStockDraftKey(clienteId)); } catch { /* segue */ }

  const previous = writeQueues.get(key) || Promise.resolve(true);
  const next = previous.catch(() => false).then(async () => {
    try {
      await cache.set(key, draft);
      return true;
    } catch (error) {
      console.warn('[CONTAGEM] IndexedDB indisponível para o rascunho.', error);
      return savedInStorage;
    }
  });
  writeQueues.set(key, next);
  return next;
}

export async function clearStockDraft(
  clienteId: string,
  storage = defaultStorage(),
  cache: CacheLike = defaultCache
): Promise<void> {
  const key = stockDraftKey(clienteId);
  try { storage?.removeItem(key); } catch { /* segue */ }
  try { storage?.removeItem(legacyStockDraftKey(clienteId)); } catch { /* segue */ }
  const previous = writeQueues.get(key) || Promise.resolve(true);
  const next = previous.catch(() => false).then(async () => {
    try { await cache.set(key, null); } catch { /* nada a limpar */ }
    return true;
  });
  writeQueues.set(key, next);
  await next;
}
