import { supabase } from './supabase';
import { HistVenda } from '../types';
import { deduplicateSales } from './utils';

type Page = { data: HistVenda[] | null; error: unknown };
type FetchPage = (clientId: string, from: number, to: number) => PromiseLike<Page>;

const fetchPage: FetchPage = (clientId, from, to) => supabase
  .from('hist_vendas').select('*').eq('cliente_id', clientId)
  .order('faturamento', { ascending: false }).order('id', { ascending: false })
  .range(from, to);

export async function loadClientHistory(
  clientId: string,
  fallback: HistVenda[],
  readPage: FetchPage = fetchPage,
  online = typeof navigator === 'undefined' || navigator.onLine !== false
): Promise<{ rows: HistVenda[]; fresh: boolean }> {
  if (!online) return { rows: fallback, fresh: false };
  const rows: HistVenda[] = [];
  const pageSize = 300;
  try {
    for (let from = 0; ; from += pageSize) {
      const page = await readPage(clientId, from, from + pageSize - 1);
      if (page.error || !page.data) throw page.error || new Error('Missing history response');
      rows.push(...page.data);
      if (page.data.length < pageSize) return { rows: deduplicateSales(rows), fresh: true };
    }
  } catch (error) {
    console.warn('[ClientHistory] Histórico local mantido; atualização indisponível.', error);
    return { rows: fallback, fresh: false };
  }
}
