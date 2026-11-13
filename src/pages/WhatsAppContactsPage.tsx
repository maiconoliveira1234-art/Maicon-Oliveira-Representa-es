import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EyeOff, Link2, Loader2, MessageCircle, Mic, RefreshCw, Search, Settings, ShieldCheck, XCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { ClientLinkSheet } from '../components/whatsapp/ClientLinkSheet';
import {
  fetchClientes,
  linkContact,
  setContactStatus,
  type ClienteLite,
  type WhatsAppMap,
} from '../lib/whatsappContacts';
import { refreshWhatsAppSummary } from '../hooks/useWhatsAppSummary';
import { matchesQuery, readSession, relativeTime, writeSession } from '../lib/whatsappUi';

type Filter = 'novas' | 'recentes' | 'todos' | 'identificar' | 'ignorados';

type PreviewMessage = {
  id: string;
  contato_map_id: string | null;
  mensagem: string;
  recebida_em: string;
  tipo_mensagem: string | null;
  transcricao_audio: string | null;
};

type Summary = { last: PreviewMessage | null; unseen: number };

const MESSAGE_FIELDS = 'id, contato_map_id, mensagem, recebida_em, tipo_mensagem, transcricao_audio';
const FILTER_KEY = 'whatsapp.filter';
const QUERY_KEY = 'whatsapp.query';
const POLL_MS = 20000;

// Kept at module level so coming back from a conversation shows the list instantly while it refreshes.
let cache: { maps: WhatsAppMap[]; summaries: Record<string, Summary> } | null = null;

function previewText(message: PreviewMessage | null): { text: string; audio: boolean } {
  if (!message) return { text: 'Sem mensagens recentes', audio: false };
  if (message.tipo_mensagem === 'audio') {
    return { text: message.transcricao_audio ? message.transcricao_audio : 'Áudio sem texto', audio: true };
  }
  return { text: message.mensagem, audio: false };
}

const FILTER_LABELS: Record<Filter, string> = {
  novas: 'Novas',
  recentes: 'Recentes',
  todos: 'Todos',
  identificar: 'Identificar',
  ignorados: 'Ignorados',
};

export function WhatsAppContactsPage() {
  const navigate = useNavigate();
  const [maps, setMaps] = useState<WhatsAppMap[]>(cache?.maps || []);
  const [summaries, setSummaries] = useState<Record<string, Summary>>(cache?.summaries || {});
  const [clientes, setClientes] = useState<ClienteLite[]>([]);
  const [clientesLoading, setClientesLoading] = useState(false);
  const [loading, setLoading] = useState(!cache);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [sheetMap, setSheetMap] = useState<WhatsAppMap | null>(null);
  const [filter, setFilter] = useState<Filter | null>(() => readSession<Filter | null>(FILTER_KEY, null));
  const [query, setQuery] = useState(() => readSession<string>(QUERY_KEY, ''));
  const [menuOpen, setMenuOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clientesLoaded = useRef(false);

  const load = useCallback(async (silent: boolean) => {
    if (!silent && !cache) setLoading(true);
    try {
      const { data: mapData, error: mapError } = await supabase
        .from('whatsapp_contatos_map')
        .select('id, whatsapp_nome, whatsapp_perfil_nome, cliente_id, status, total_mensagens, ultima_vez_em, oculto')
        .eq('oculto', false)
        .order('ultima_vez_em', { ascending: false });
      if (mapError) throw mapError;
      const nextMaps = (mapData || []) as WhatsAppMap[];

      // Previews are fetched for the visible, non-ignored contacts only, so hidden/ignored chatter
      // can no longer push a real conversation out of the list.
      const activeIds = nextMaps.filter(item => item.status !== 'ignorado').map(item => item.id);
      const next: Record<string, Summary> = {};
      for (const item of nextMaps) next[item.id] = { last: null, unseen: 0 };

      if (activeIds.length > 0) {
        const [lastResult, unseenResult] = await Promise.all([
          supabase
            .from('whatsapp_mensagens')
            .select(MESSAGE_FIELDS)
            .in('contato_map_id', activeIds)
            .order('recebida_em', { ascending: false })
            .limit(1500),
          supabase
            .from('whatsapp_mensagens')
            .select('contato_map_id')
            .in('contato_map_id', activeIds)
            .is('visualizada_em', null)
            .limit(2000),
        ]);
        if (lastResult.error) throw lastResult.error;
        if (unseenResult.error) throw unseenResult.error;

        for (const message of (lastResult.data || []) as PreviewMessage[]) {
          const entry = message.contato_map_id ? next[message.contato_map_id] : null;
          if (entry && !entry.last) entry.last = message;
        }
        for (const row of (unseenResult.data || []) as Array<{ contato_map_id: string | null }>) {
          const entry = row.contato_map_id ? next[row.contato_map_id] : null;
          if (entry) entry.unseen += 1;
        }
      }

      cache = { maps: nextMaps, summaries: next };
      setMaps(nextMaps);
      setSummaries(next);
      setError(null);
    } catch (err: any) {
      console.error('Erro ao carregar o WhatsApp:', err);
      setError(err?.message || 'Não foi possível carregar as conversas.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(false);
    const tick = () => {
      if (!document.hidden) void load(true);
    };
    const id = window.setInterval(tick, POLL_MS);
    window.addEventListener('focus', tick);
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('focus', tick);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [load]);

  useEffect(() => writeSession(QUERY_KEY, query), [query]);

  const nameOf = (item: WhatsAppMap) => item.whatsapp_perfil_nome || item.whatsapp_nome;

  const counts = useMemo(() => {
    const linked = maps.filter(item => item.status === 'vinculado');
    return {
      novas: linked.filter(item => (summaries[item.id]?.unseen || 0) > 0).length,
      recentes: linked.length,
      todos: linked.length,
      identificar: maps.filter(item => item.status === 'pendente').length,
      ignorados: maps.filter(item => item.status === 'ignorado').length,
    };
  }, [maps, summaries]);

  // Until the user picks a filter, open on "Novas" when there is something new, otherwise "Recentes".
  const activeFilter: Filter = filter ?? (counts.novas > 0 ? 'novas' : 'recentes');

  const chooseFilter = (next: Filter) => {
    setFilter(next);
    writeSession(FILTER_KEY, next);
  };

  const lastTime = (item: WhatsAppMap) => summaries[item.id]?.last?.recebida_em || item.ultima_vez_em;

  const rows = useMemo(() => {
    const byStatus = maps.filter(item => {
      if (activeFilter === 'identificar') return item.status === 'pendente';
      if (activeFilter === 'ignorados') return item.status === 'ignorado';
      if (item.status !== 'vinculado') return false;
      if (activeFilter === 'novas') return (summaries[item.id]?.unseen || 0) > 0;
      return true;
    });
    const searched = query.trim()
      ? byStatus.filter(item => {
          const last = summaries[item.id]?.last;
          return matchesQuery(query, item.whatsapp_perfil_nome, item.whatsapp_nome, last?.mensagem, last?.transcricao_audio);
        })
      : byStatus;
    return [...searched].sort((a, b) => new Date(lastTime(b)).getTime() - new Date(lastTime(a)).getTime());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maps, summaries, activeFilter, query]);

  const ensureClientes = async () => {
    if (clientesLoaded.current) return;
    clientesLoaded.current = true;
    setClientesLoading(true);
    try {
      setClientes(await fetchClientes());
    } catch (err: any) {
      clientesLoaded.current = false;
      setError(err?.message || 'Não foi possível carregar os clientes do CRM.');
    } finally {
      setClientesLoading(false);
    }
  };

  const openSheet = (item: WhatsAppMap) => {
    setSheetMap(item);
    void ensureClientes();
  };

  const afterChange = async () => {
    await load(true);
    void refreshWhatsAppSummary();
  };

  const pickClient = async (clienteId: string) => {
    if (!sheetMap) return;
    setBusyId(sheetMap.id);
    setError(null);
    try {
      await linkContact(sheetMap.id, clienteId);
      setSheetMap(null);
      await afterChange();
    } catch (err: any) {
      setError(err?.message || 'Não foi possível vincular o contato.');
    } finally {
      setBusyId(null);
    }
  };

  const changeStatus = async (item: WhatsAppMap, status: 'pendente' | 'ignorado') => {
    setBusyId(item.id);
    setError(null);
    try {
      await setContactStatus(item.id, status);
      await afterChange();
    } catch (err: any) {
      setError(err?.message || 'Não foi possível atualizar o contato.');
    } finally {
      setBusyId(null);
    }
  };

  const filtersToShow: Filter[] = ['novas', 'recentes', 'todos', 'identificar', 'ignorados'];
  const emptyText: Record<Filter, string> = {
    novas: 'Nenhuma conversa com mensagem nova.',
    recentes: 'Nenhuma conversa vinculada ainda.',
    todos: 'Nenhuma conversa vinculada ainda.',
    identificar: 'Nenhum contato esperando identificação.',
    ignorados: 'Nenhum contato ignorado.',
  };

  return (
    <div className="mx-auto max-w-3xl pb-4">
      <div className="mb-3 flex items-center gap-2">
        <h1 className="flex flex-1 items-center gap-2 text-xl font-black text-neutral-900">
          <MessageCircle size={22} className="text-green-600" /> WhatsApp
        </h1>
        <button
          type="button"
          onClick={() => void load(true)}
          aria-label="Atualizar"
          className="flex h-11 w-11 items-center justify-center rounded-xl text-neutral-500 hover:bg-neutral-100"
        >
          <RefreshCw size={18} />
        </button>
        <div className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen(open => !open)}
            aria-label="Mais opções"
            aria-expanded={menuOpen}
            className="flex h-11 w-11 items-center justify-center rounded-xl text-neutral-500 hover:bg-neutral-100"
          >
            <Settings size={18} />
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 top-12 z-40 w-52 overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-xl">
                <button
                  type="button"
                  onClick={() => navigate('/whatsapp/ocultos')}
                  className="flex min-h-[48px] w-full items-center gap-3 px-4 text-left text-sm font-bold text-neutral-700 hover:bg-neutral-50"
                >
                  <EyeOff size={16} /> Contatos ocultos
                </button>
                <button
                  type="button"
                  onClick={() => navigate('/whatsapp/regras')}
                  className="flex min-h-[48px] w-full items-center gap-3 border-t border-neutral-100 px-4 text-left text-sm font-bold text-violet-700 hover:bg-neutral-50"
                >
                  <ShieldCheck size={16} /> Regras da IA
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="relative mb-3">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" size={17} />
        <input
          value={query}
          onChange={event => setQuery(event.target.value)}
          placeholder="Buscar cliente ou mensagem"
          className="h-11 w-full rounded-xl border border-neutral-200 bg-white pl-10 pr-3 text-base outline-none focus:border-orange-400"
        />
      </div>

      <div className="-mx-4 mb-3 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]" role="tablist">
        {filtersToShow.map(item => {
          const selected = activeFilter === item;
          const count = counts[item];
          const hot = (item === 'novas' || item === 'identificar') && count > 0;
          return (
            <button
              key={item}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => chooseFilter(item)}
              className={`flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-xl border px-4 text-sm font-black transition ${
                selected ? 'border-orange-300 bg-orange-50 text-orange-700' : 'border-neutral-200 bg-white text-neutral-600'
              }`}
            >
              {FILTER_LABELS[item]}
              <span className={`rounded-full px-1.5 text-xs ${hot ? 'bg-orange-500 text-white' : 'text-neutral-400'}`}>{count}</span>
            </button>
          );
        })}
      </div>

      {error && (
        <div className="mb-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</div>
      )}

      {loading ? (
        <div className="flex min-h-48 items-center justify-center text-neutral-500">
          <Loader2 className="mr-2 animate-spin" size={20} /> Carregando...
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-neutral-200 bg-white p-8 text-center text-sm text-neutral-500">
          {query.trim() ? 'Nada encontrado para essa busca.' : emptyText[activeFilter]}
          {activeFilter === 'novas' && !query.trim() && counts.recentes > 0 && (
            <button type="button" onClick={() => chooseFilter('recentes')} className="mt-3 block w-full text-sm font-black text-orange-600">
              Ver conversas recentes
            </button>
          )}
        </div>
      ) : (
        <ul className="divide-y divide-neutral-100 overflow-hidden rounded-2xl border border-neutral-200 bg-white">
          {rows.map(item => {
            const summary = summaries[item.id];
            const preview = previewText(summary?.last || null);
            const unseen = summary?.unseen || 0;
            const busy = busyId === item.id;
            const linked = item.status === 'vinculado';
            const open = () => linked && navigate(`/whatsapp/conversa/${item.id}`);
            return (
              <li key={item.id} className="p-3">
                <div
                  role={linked ? 'button' : undefined}
                  tabIndex={linked ? 0 : undefined}
                  onClick={open}
                  onKeyDown={event => {
                    if (linked && (event.key === 'Enter' || event.key === ' ')) {
                      event.preventDefault();
                      open();
                    }
                  }}
                  className={`flex min-h-[56px] items-start gap-3 ${linked ? 'cursor-pointer' : ''}`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <h2 className={`truncate text-[15px] text-neutral-900 ${unseen > 0 ? 'font-black' : 'font-bold'}`}>{nameOf(item)}</h2>
                      <span className="ml-auto shrink-0 text-xs font-semibold text-neutral-400">{relativeTime(lastTime(item))}</span>
                    </div>
                    <div className="mt-0.5 flex items-center gap-1.5">
                      {preview.audio && <Mic size={13} className="shrink-0 text-neutral-400" />}
                      <p className={`line-clamp-2 text-sm ${unseen > 0 ? 'font-semibold text-neutral-800' : 'text-neutral-500'}`}>{preview.text}</p>
                    </div>
                  </div>
                  {unseen > 0 && (
                    <span className="mt-1 flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full bg-green-600 px-1.5 text-xs font-black text-white">
                      {unseen}
                    </span>
                  )}
                </div>

                {item.status === 'pendente' && (
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => openSheet(item)}
                      disabled={busy}
                      className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-neutral-900 px-3 text-sm font-black text-white disabled:opacity-50"
                    >
                      <Link2 size={16} /> Vincular cliente
                    </button>
                    <button
                      type="button"
                      onClick={() => void changeStatus(item, 'ignorado')}
                      disabled={busy}
                      className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-neutral-200 bg-white px-3 text-sm font-black text-neutral-600 disabled:opacity-50"
                    >
                      {busy ? <Loader2 size={16} className="animate-spin" /> : <XCircle size={16} />} Não é cliente
                    </button>
                  </div>
                )}
                {item.status === 'ignorado' && (
                  <div className="mt-2 flex justify-end">
                    <button
                      type="button"
                      onClick={() => void changeStatus(item, 'pendente')}
                      disabled={busy}
                      className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-neutral-200 bg-white px-4 text-sm font-black text-neutral-700 disabled:opacity-50"
                    >
                      {busy ? <Loader2 size={16} className="animate-spin" /> : <Link2 size={16} />} Reavaliar
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {sheetMap && (
        <ClientLinkSheet
          title={nameOf(sheetMap)}
          hintName={nameOf(sheetMap)}
          clientes={clientes}
          loading={clientesLoading}
          busy={busyId === sheetMap.id}
          onPick={id => void pickClient(id)}
          onClose={() => setSheetMap(null)}
        />
      )}
    </div>
  );
}
