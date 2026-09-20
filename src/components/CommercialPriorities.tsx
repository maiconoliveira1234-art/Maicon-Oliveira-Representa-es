import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { format, startOfToday } from 'date-fns';
import { useDataManager } from '../lib/dataManager';
import { useAgendaPendencias } from '../hooks/useAgendaPendencias';
import { supabase } from '../lib/supabase';
import { hasPendingOpenOrderSync } from '../lib/openOrderSales';
import { isAgendaPendenciaAtiva } from '../lib/agendaPendencias';
import { buildCommercialPriorities, COMMERCIAL_RETURN_TITLE, COMMERCIAL_REVIEW_TITLE, isCommercialFollowUp } from '../lib/commercialPriorities';

// Small, read-only query. Never turn an unavailable order list into "no orders".
function useOpenOrderClients() {
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{ ids: Set<string> | null; loading: boolean }>({ ids: null, loading: true });
  useEffect(() => {
    let active = true;
    setState(previous => ({ ...previous, loading: true }));
    let request = 0;
    const refresh = async () => {
      const current = ++request;
      try {
        const { data, error } = await supabase.from('pedidos_em_aberto').select('cliente_id');
        if (error) throw error;
        if (active && current === request) setState({ ids: new Set((data || []).map(row => row.cliente_id)), loading: false });
      } catch {
        if (active && current === request) setState({ ids: null, loading: false });
      }
    };
    const onVisible = () => { if (document.visibilityState === 'visible') void refresh(); };
    void refresh();
    const channel = supabase.channel('commercial-open-orders').on('postgres_changes',
      { event: '*', schema: 'public', table: 'pedidos_em_aberto' }, refresh).subscribe();
    window.addEventListener('focus', refresh);
    window.addEventListener('online', refresh);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      active = false;
      void supabase.removeChannel(channel);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('online', refresh);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [revision]);
  return { ...state, refresh: () => setRevision(value => value + 1) };
}

type AgendaState = ReturnType<typeof useAgendaPendencias>;

export function ClientCommercialPriorities({ clienteId }: { clienteId: string }) {
  const agenda = useAgendaPendencias();
  return <CommercialPriorities agenda={agenda} clienteId={clienteId} />;
}

export function CommercialPriorities({ agenda, clienteId }: { agenda: AgendaState; clienteId?: string }) {
  const { clientes, hist_vendas, loadingGlobal, pendingQueueCount, syncAllData } = useDataManager();
  const orders = useOpenOrderClients();
  const [todayKey, setTodayKey] = useState(() => format(startOfToday(), 'yyyy-MM-dd'));
  const [editing, setEditing] = useState<string | null>(null);
  const [date, setDate] = useState('');
  const [note, setNote] = useState('');
  const [outcome, setOutcome] = useState('RETORNO');
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    const timer = window.setInterval(() => setTodayKey(format(startOfToday(), 'yyyy-MM-dd')), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const priorities = useMemo(() => {
    const ids = orders.ids ? new Set(orders.ids) : null;
    clientes.forEach(c => { if (hasPendingOpenOrderSync(c.id)) ids?.add(c.id); });
    return buildCommercialPriorities({ clientes, historico: hist_vendas, pendencias: agenda.pendencias,
      openClientIds: ids, today: new Date(todayKey + 'T00:00:00') });
  }, [clientes, hist_vendas, agenda.pendencias, orders.ids, todayKey, pendingQueueCount]);
  const visible = clienteId ? priorities.filter(p => p.cliente.id === clienteId) : priorities.slice(0, 5);
  const future = clienteId ? agenda.pendencias.filter(p => p.cliente_id === clienteId && isCommercialFollowUp(p)
    && isAgendaPendenciaAtiva(p) && p.data_prevista && p.data_prevista > todayKey)
    .sort((a, b) => a.data_prevista!.localeCompare(b.data_prevista!))[0] : undefined;
  const loading = agenda.loading || orders.loading || loadingGlobal;
  const startEdit = (id: string) => {
    const existing = agenda.pendencias.filter(p => p.cliente_id === id && isCommercialFollowUp(p) && isAgendaPendenciaAtiva(p))
      .sort((a, b) => (a.data_prevista || '').localeCompare(b.data_prevista || ''))[0];
    setEditing(id); setDate(existing?.data_prevista && existing.data_prevista >= todayKey ? existing.data_prevista : todayKey);
    setNote(existing?.descricao || ''); setOutcome(existing?.titulo === COMMERCIAL_REVIEW_TITLE ? 'SEM_NECESSIDADE' : 'RETORNO');
    setError(null); setMessage(null);
  };
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editing || busy || !date || date < todayKey) return;
    setBusy(true); setError(null);
    try {
      const existing = agenda.pendencias.filter(p => p.cliente_id === editing && isCommercialFollowUp(p) && isAgendaPendenciaAtiva(p))
        .sort((a, b) => (a.data_prevista || '').localeCompare(b.data_prevista || ''))[0];
      const input = { tipo: 'TAREFA' as const,
        titulo: outcome === 'SEM_NECESSIDADE' ? COMMERCIAL_REVIEW_TITLE : COMMERCIAL_RETURN_TITLE,
        descricao: note.trim() || null, cliente_id: editing, data_prevista: date,
        horario_inicio: null, horario_fim: null, dia_inteiro: true, prioridade: 'NORMAL' as const };
      if (existing) await agenda.update(existing.id, input);
      else await agenda.create(input);
      setEditing(null); setMessage('Retorno salvo. A prioridade será reavaliada na data combinada.');
    } catch {
      setError('Não foi possível salvar. Confira sua conexão e tente novamente; o retorno ainda não foi registrado.');
    } finally { setBusy(false); }
  };
  const complete = async (id: string) => {
    if (busy) return;
    setBusy(true); setError(null); setMessage(null);
    try {
      await agenda.updateStatus(id, 'CONCLUIDA');
      setMessage('Contato concluído. Sem nova data, a recompra poderá ser reavaliada amanhã.');
    } catch { setError('Não foi possível concluir o contato. Tente novamente.'); }
    finally { setBusy(false); }
  };
  const refreshPriorities = async () => {
    if (refreshing || busy) return;
    setRefreshing(true); setError(null); setMessage(null);
    try {
      const synced = await syncAllData(true);
      await agenda.refresh();
      orders.refresh();
      if (!synced) setError('Não foi possível atualizar todo o histórico. Os dados disponíveis podem estar desatualizados. Tente novamente.');
    } catch {
      setError('Não foi possível atualizar as prioridades. Tente novamente.');
    } finally { setRefreshing(false); }
  };
  const buttonClass = 'rounded-lg border border-neutral-200 bg-white px-3 py-2 text-xs font-bold text-neutral-700 disabled:opacity-50';
  const returnForm = <form onSubmit={save} className="mt-4 space-y-3 rounded-lg border border-orange-200 p-3">
        <p className="text-sm font-bold">Registrar contato · {clientes.find(c => c.id === editing)?.cliente}</p>
        <label className="block text-xs font-bold">Resultado
          <select disabled={busy} value={outcome} onChange={e => setOutcome(e.target.value)} className="mt-1 block w-full rounded-lg border border-neutral-300 p-2 text-base">
            <option value="RETORNO">Retorno combinado</option><option value="SEM_NECESSIDADE">Sem necessidade agora</option>
          </select>
        </label>
        <label className="block text-xs font-bold">{outcome === 'SEM_NECESSIDADE' ? 'Reavaliar em' : 'Data do retorno'}
          <input disabled={busy} type="date" required min={todayKey} value={date} onChange={e => setDate(e.target.value)} className="mt-1 block w-full min-w-0 rounded-lg border border-neutral-300 p-2 text-base" />
        </label>
        <label className="block text-xs font-bold">O que deve ser feito? (opcional)
          <textarea disabled={busy} maxLength={1000} value={note} onChange={e => setNote(e.target.value)} rows={2} className="mt-1 block w-full rounded-lg border border-neutral-300 p-2 text-base" />
        </label>
        <div className="flex flex-wrap gap-2"><button disabled={busy} type="submit" className={buttonClass}>{busy ? 'Salvando…' : 'Salvar retorno'}</button><button disabled={busy} type="button" className={buttonClass} onClick={() => setEditing(null)}>Cancelar</button></div>
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      </form>;
  return (
    <section className="min-w-0 rounded-lg border border-neutral-200 bg-white p-4 shadow-sm" aria-label={clienteId ? 'Próxima ação comercial' : 'Prioridades de hoje'}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-black text-neutral-950">{clienteId ? 'Próxima ação' : 'Prioridades de hoje'}</h2>
        </div>
        {!clienteId && <button type="button" onClick={refreshPriorities} disabled={refreshing || busy || loading} className={buttonClass}>{refreshing ? 'Atualizando…' : 'Atualizar'}</button>}
        {clienteId && <button type="button" disabled={busy || loading || !!agenda.error} onClick={() => startEdit(clienteId)} className={buttonClass}>{future ? 'Alterar retorno' : 'Registrar retorno'}</button>}
      </div>
      {(loading || refreshing) ? <p className="mt-3 text-sm text-neutral-500">Conferindo prioridades…</p> : agenda.error ? (
        <div role="alert" className="mt-3 text-sm text-amber-700">Não foi possível atualizar os retornos. <button type="button" onClick={() => agenda.refresh()} className="underline">Tentar novamente</button></div>
      ) : <>
        {!orders.ids && <p role="status" className="mt-3 text-xs text-amber-700">Pedidos em aberto indisponíveis. Exibindo apenas retornos combinados.</p>}
        {visible.map(item => (
          <article key={item.cliente.id} className="mt-3 min-w-0 rounded-lg border border-neutral-100 bg-neutral-50 p-3">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              {!clienteId && <h3 className="min-w-0 break-words text-sm font-black">{item.cliente.cliente}</h3>}
            </div>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-600">
              <span>Próx. ped.: <strong>{item.purchaseGap === null ? '—' : `${item.purchaseGap > 0 ? '+' : ''}${item.purchaseGap} dias`}</strong></span>
              <span>Ciclo: <strong>{item.cycleDays > 0 ? `${item.cycleDays} dias` : '—'}</strong></span>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {!clienteId && <Link className={buttonClass} to={'/cliente/' + item.cliente.id}>Abrir cliente</Link>}
              <button type="button" disabled={busy} aria-expanded={editing === item.cliente.id} onClick={() => startEdit(item.cliente.id)} className={buttonClass}>Registrar retorno</button>
              {item.followUp && <button type="button" disabled={busy} onClick={() => complete(item.followUp!.id)} className={buttonClass}>Contato concluído</button>}
            </div>
            {editing === item.cliente.id && returnForm}
          </article>
        ))}
        {future && <p className="mt-3 break-words text-sm text-neutral-600">{future.titulo}: {format(new Date(future.data_prevista + 'T00:00:00'), 'dd/MM/yyyy')}{future.descricao ? ` · ${future.descricao}` : ''}</p>}
        {visible.length === 0 && !future && <p className="mt-3 text-sm text-neutral-500">{orders.ids ? 'Nenhuma prioridade para hoje.' : 'Nenhum retorno vencido ou previsto para hoje.'}</p>}
      </>}
      {editing && !visible.some(item => item.cliente.id === editing) && returnForm}
      {error && !editing && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
      {message && <p role="status" className="mt-3 text-sm text-emerald-700">{message}</p>}
    </section>
  );
}
