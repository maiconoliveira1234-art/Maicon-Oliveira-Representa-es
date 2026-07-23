import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { agendaPendenciaService } from '../services/agendaPendenciaService';
import { AgendaPendencia, AgendaPendenciaInput, AgendaPendenciaStatus } from '../types/agendaPendencia';

const CACHE_KEY = 'agenda_pendencias_cache';

function readCache(): AgendaPendencia[] {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) || '[]');
  } catch {
    return [];
  }
}

export function useAgendaPendencias() {
  const [pendencias, setPendencias] = useState<AgendaPendencia[]>(readCache);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const persist = useCallback((items: AgendaPendencia[]) => {
    setPendencias(items);
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(items));
    } catch {
      // Cache is optional when browser storage is unavailable.
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const items = await agendaPendenciaService.list();
      persist(items);
      setError(null);
    } catch (err: any) {
      setError(err?.message || 'Nao foi possivel carregar as pendencias');
    } finally {
      setLoading(false);
    }
  }, [persist]);

  useEffect(() => {
    refresh();
    const channel = supabase
      .channel('agenda-pendencias-app')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'agenda_pendencias' }, refresh)
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [refresh]);

  const replace = useCallback((item: AgendaPendencia) => {
    persist([...pendencias.filter((current) => current.id !== item.id), item]);
    return item;
  }, [pendencias, persist]);

  const create = useCallback(async (input: AgendaPendenciaInput) => {
    return replace(await agendaPendenciaService.create(input));
  }, [replace]);

  const update = useCallback(async (id: string, input: Partial<AgendaPendenciaInput>) => {
    return replace(await agendaPendenciaService.update(id, input));
  }, [replace]);

  const updateStatus = useCallback(async (id: string, status: AgendaPendenciaStatus) => {
    return replace(await agendaPendenciaService.updateStatus(id, status));
  }, [replace]);

  return { pendencias, loading, error, refresh, create, update, updateStatus };
}
