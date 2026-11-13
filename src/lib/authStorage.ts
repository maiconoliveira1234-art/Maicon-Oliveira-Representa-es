// Armazenamento da sessão do Supabase resistente a falta de espaço.
//
// No iPad o localStorage tem cota pequena (~5 MB) e o CRM espelha caches
// grandes nele. Quando a cota enche, a gravação do token falha e o login some
// ao reabrir o app. Aqui o token tem prioridade: se faltar espaço, removemos
// cópias de cache que também ficam no IndexedDB e tentamos de novo.

// Somente espelhos de dados que o dataManager também grava no IndexedDB.
// Nunca incluir filas pendentes, rascunhos ou preferências do usuário.
export const EVICTABLE_CACHE_KEYS = [
  'offline_db_hist_vendas',
  'offline_db_estoque_cliente',
  'offline_db_produtos',
  'offline_db_clientes',
  'offline_db_agenda_visitas',
  'offline_db_verba_flex_extrato',
  'offline_db_emprestimos',
  'offline_db_metas',
];

export function isQuotaError(error: unknown): boolean {
  const e = error as { name?: string; code?: number; message?: string } | null;
  return Boolean(e) && (
    e!.name === 'QuotaExceededError' ||
    e!.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    e!.code === 22 || e!.code === 1014 ||
    /quota/i.test(e!.message || '')
  );
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function createResilientAuthStorage(getStorage: () => StorageLike | undefined = () => {
  try { return globalThis.localStorage; } catch { return undefined; }
}) {
  // Mantém a sessão aberta durante o uso mesmo que a gravação falhe.
  const memory = new Map<string, string>();

  return {
    getItem(key: string): string | null {
      try {
        const value = getStorage()?.getItem(key);
        if (value != null) return value;
      } catch { /* usa a memória */ }
      return memory.get(key) ?? null;
    },
    setItem(key: string, value: string): void {
      memory.set(key, value);
      const storage = getStorage();
      if (!storage) return;
      try {
        storage.setItem(key, value);
        return;
      } catch (error) {
        if (!isQuotaError(error)) return;
      }
      for (const cacheKey of EVICTABLE_CACHE_KEYS) {
        try { storage.removeItem(cacheKey); } catch { /* segue */ }
        try {
          storage.setItem(key, value);
          console.warn(`[Auth] Espaço liberado (${cacheKey}) para manter a sessão salva.`);
          return;
        } catch (error) {
          if (!isQuotaError(error)) return;
        }
      }
      console.error('[Auth] Sem espaço para salvar a sessão; ela vale só enquanto o app estiver aberto.');
    },
    removeItem(key: string): void {
      memory.delete(key);
      try { getStorage()?.removeItem(key); } catch { /* segue */ }
    },
  };
}
