import React, { useEffect, useRef, useState } from 'react';
import { Users } from 'lucide-react';
import { FilterDropdown } from './FilterDropdown';
import { format } from 'date-fns';
import { supabase } from '../lib/supabase';
import { Cliente } from '../types';
import { formatCurrency } from '../lib/utils';
import { adjustedCredit, canSettleEarly, CreditTitle, PAGO_ANTECIPADO, sumTitles, titleStatus } from '../lib/financialReview';

type Store = {
  id: string; razao_social: string; limite_total: number;
  disponivel_oficial_snapshot: number; data_snapshot: string;
};
const fields = 'id, razao_social, limite_total, disponivel_oficial_snapshot, data_snapshot';
const dateLabel = (value: string | null) => value ? value.slice(0, 10).split('-').reverse().join('/') : 'Não informado';
const inputClass = 'w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900';

async function loadTitles(id: string): Promise<CreditTitle[]> {
  const titles: CreditTitle[] = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await supabase.from('titulos_credito')
      .select('id, vencimento, valor, baixado_em').eq('entidade_financeira_id', id)
      .order('vencimento').order('id').range(offset, offset + 499);
    if (error) throw error;
    titles.push(...(data || []).map(t => ({ ...t, valor: Number(t.valor) })));
    if (!data || data.length < 500) return titles;
  }
}

function StoreReview({ store, onSaved }: { store: Store; onSaved: (store: Store) => void }) {
  const [available, setAvailable] = useState<number | null>(null);
  const [balanceError, setBalanceError] = useState('');
  const [titles, setTitles] = useState<CreditTitle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [raw, setRaw] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [filter, setFilter] = useState('A vencer');
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [settling, setSettling] = useState(false);
  const [balanceTick, setBalanceTick] = useState(0);
  const lock = useRef(false);
  const [today, setToday] = useState(() => format(new Date(), 'yyyy-MM-dd'));
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    loadTitles(store.id).then(rows => { if (active) setTitles(rows); })
      .catch(() => { if (active) setError('Não foi possível consultar os boletos. Atualize a consulta para tentar novamente.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [store.id]);
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      if (active) setToday(format(new Date(), 'yyyy-MM-dd'));
      try {
        const { data, error: readError } = await supabase.rpc('saldo_credito_projetado', {
          p_entidade: store.id, p_data: format(new Date(), 'yyyy-MM-dd')
        });
        if (readError) throw readError;
        const row = Array.isArray(data) ? data[0] : data;
        if (!row || !Number.isFinite(Number(row.disponivel_estimado))) throw new Error('Saldo indisponível');
        if (active) { setAvailable(Number(row.disponivel_estimado)); setBalanceError(''); }
      } catch {
        if (active) { setAvailable(null); setBalanceError('Não foi possível atualizar o disponível. Atualize a consulta.'); }
      }
    };
    void refresh();
    const timer = window.setInterval(refresh, 60000);
    window.addEventListener('focus', refresh);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, [store.id, store.limite_total, store.disponivel_oficial_snapshot, balanceTick]);
  let preview: ReturnType<typeof adjustedCredit> | null = null;
  let validation = '';
  if (editing && raw.trim()) {
    try { preview = adjustedCredit(raw, store.limite_total, store.disponivel_oficial_snapshot); }
    catch (err) { validation = (err as Error).message; }
  }
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (lock.current || !preview) return;
    lock.current = true;
    setSaving(true);
    setMessage('');
    try {
      if (navigator.onLine === false) throw new Error('Conecte-se à internet para salvar o limite.');
      // Preserve snapshot debt and date. Match the previously read balances so a
      // concurrent import or edit cannot be overwritten with stale values.
      let query = supabase.from('entidades_financeiras')
        .update({ limite_total: preview.limit, disponivel_oficial_snapshot: preview.available })
        .eq('id', store.id).eq('limite_total', store.limite_total)
        .eq('disponivel_oficial_snapshot', store.disponivel_oficial_snapshot);
      query = store.data_snapshot ? query.eq('data_snapshot', store.data_snapshot) : query.is('data_snapshot', null);
      const { data, error: writeError } = await query.select(fields).single();
      if (writeError || !data) throw new Error('Não foi possível confirmar a alteração. Os dados podem ter mudado ou seu acesso não permite editar. Atualize a consulta e tente novamente.');
      onSaved({ ...data, limite_total: Number(data.limite_total), disponivel_oficial_snapshot: Number(data.disponivel_oficial_snapshot) });
      setEditing(false);
      setMessage('Limite salvo no CRM.');
    } catch (err) {
      setMessage((err as Error).message);
    } finally {
      lock.current = false;
      setSaving(false);
    }
  };
  // Baixa manual de boleto pago antes do vencimento: grava baixado_em = hoje e
  // o saldo projetado passa a liberar o valor no limite a partir de hoje.
  const settle = async () => {
    if (lock.current) return;
    const chosen = titles.filter(t => selected.has(t.id) && canSettleEarly(t, today));
    if (!chosen.length) return;
    lock.current = true;
    setSettling(true);
    setMessage('');
    try {
      if (navigator.onLine === false) throw new Error('Conecte-se à internet para dar baixa.');
      const day = format(new Date(), 'yyyy-MM-dd');
      const { data, error: writeError } = await supabase.from('titulos_credito')
        .update({ baixado_em: day })
        .in('id', chosen.map(t => t.id)).eq('entidade_financeira_id', store.id)
        .is('baixado_em', null).gt('vencimento', day)
        .select('id, baixado_em');
      if (writeError) throw new Error('Não foi possível dar baixa. Atualize a consulta e tente novamente.');
      const done = new Map<string, string>((data || []).map((r: { id: string; baixado_em: string }) => [r.id, r.baixado_em] as [string, string]));
      setTitles(rows => rows.map(t => done.has(t.id) ? { ...t, baixado_em: done.get(t.id) ?? null } : t));
      setSelected(new Set());
      setBalanceTick(n => n + 1);
      const total = formatCurrency(sumTitles(chosen.filter(t => done.has(t.id))));
      setMessage(done.size === chosen.length
        ? `Baixa de ${done.size} boleto(s) • ${total}.`
        : `Baixa confirmada em ${done.size} de ${chosen.length} boleto(s) (${total}). Atualize a consulta.`);
    } catch (err) {
      setMessage((err as Error).message);
    } finally {
      lock.current = false;
      setSettling(false);
    }
  };
  const undoSettle = async (title: CreditTitle) => {
    if (lock.current || !title.baixado_em) return;
    lock.current = true;
    setSettling(true);
    setMessage('');
    try {
      if (navigator.onLine === false) throw new Error('Conecte-se à internet para desfazer a baixa.');
      const { data, error: writeError } = await supabase.from('titulos_credito')
        .update({ baixado_em: null })
        .eq('id', title.id).eq('entidade_financeira_id', store.id).eq('baixado_em', title.baixado_em)
        .select('id');
      if (writeError || !data?.length) throw new Error('Não foi possível desfazer a baixa. Atualize a consulta e tente novamente.');
      setTitles(rows => rows.map(t => t.id === title.id ? { ...t, baixado_em: null } : t));
      setBalanceTick(n => n + 1);
      setMessage(`Baixa desfeita • ${formatCurrency(title.valor)}.`);
    } catch (err) {
      setMessage((err as Error).message);
    } finally {
      lock.current = false;
      setSettling(false);
    }
  };
  const toggle = (id: string) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const visible = titles.filter(t => filter === 'Todos' || titleStatus(t, today) === filter);
  const chosen = titles.filter(t => selected.has(t.id) && canSettleEarly(t, today));
  return <article className="space-y-4 rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
    <h3 className="font-extrabold text-neutral-900">{store.razao_social}</h3>
    <div className="grid gap-3 sm:grid-cols-2">
      <div><p className="text-xs text-neutral-500">Limite total</p><p className="text-xl font-black">{formatCurrency(store.limite_total)}</p></div>
      <div><p className="text-xs text-neutral-500">Disponível atualizado (pagamento presumido)</p><p className="text-xl font-black">{available === null ? 'Indisponível / consultando...' : formatCurrency(available)}</p></div>
    </div>
    {balanceError && <p role="alert" className="text-sm text-red-700">{balanceError}</p>}
    {!editing ? <button type="button" className="rounded-lg bg-orange-600 px-4 py-2 text-sm font-bold text-white"
      onClick={() => { setRaw(store.limite_total.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })); setMessage(''); setEditing(true); }}>Alterar limite</button> :
      <form onSubmit={save} className="space-y-3 rounded-lg bg-orange-50 p-3">
        <label className="block text-sm font-bold">Novo limite aprovado no ERP (R$)
          <input autoFocus required inputMode="decimal" disabled={saving} className={inputClass} value={raw} onChange={e => setRaw(e.target.value)} />
        </label>
        {preview && <p className="text-sm">Limite: {formatCurrency(store.limite_total)} → {formatCurrency(preview.limit)}. Disponível no levantamento após o ajuste: {formatCurrency(preview.available)}.</p>}
        {validation && <p role="alert" className="text-sm text-red-700">{validation}</p>}
        <div className="flex gap-2">
          <button type="submit" disabled={saving || !preview || preview.limit === store.limite_total} className="rounded-lg bg-orange-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{saving ? 'Salvando...' : 'Salvar limite'}</button>
          <button type="button" disabled={saving} className="rounded-lg border px-4 py-2 text-sm" onClick={() => { setEditing(false); setMessage(''); }}>Cancelar</button>
        </div>
      </form>}
    {message && <p role="status" className="rounded-lg bg-neutral-100 p-3 text-sm">{message}</p>}
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h4 className="font-bold">Boletos</h4>
      <label className="text-xs">Situação
        <select className={inputClass} value={filter} onChange={e => { setFilter(e.target.value); setSelected(new Set()); }}>
          {['Todos', 'Pagamento presumido', 'A vencer', PAGO_ANTECIPADO].map(s => <option key={s}>{s}</option>)}
        </select>
      </label>
    </div>
    {loading ? <p role="status" className="text-sm">Consultando boletos...</p> : error ? <p role="alert" className="text-sm text-red-700">{error}</p> :
      <><p className="text-xs text-neutral-600">{visible.length} boleto(s) • {formatCurrency(sumTitles(visible))}</p>
        {chosen.length > 0 && <div className="flex flex-wrap gap-2">
          <button type="button" disabled={settling} onClick={settle} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
            {settling ? 'Dando baixa...' : `Dar baixa (${chosen.length}) • ${formatCurrency(sumTitles(chosen))}`}
          </button>
          <button type="button" disabled={settling} onClick={() => setSelected(new Set())} className="rounded-lg border px-4 py-2 text-sm">Limpar</button>
        </div>}
        {visible.length === 0 ? <p className="text-sm text-neutral-500">Nenhum boleto encontrado nesta consulta.</p> :
          <div className="max-h-96 overflow-auto"><table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-neutral-100"><tr><th className="w-10 p-2"><span className="sr-only">Selecionar</span></th><th className="p-2">Vencimento</th><th className="p-2">Valor</th><th className="p-2">Situação</th></tr></thead>
            <tbody>{visible.map(t => {
              const status = titleStatus(t, today);
              const eligible = canSettleEarly(t, today);
              return <tr key={t.id} className={`border-b border-neutral-100 ${selected.has(t.id) && eligible ? 'bg-emerald-50' : ''}`}>
                <td className="p-0">{eligible && <label className="flex h-11 w-10 cursor-pointer items-center justify-center">
                  <input type="checkbox" className="h-5 w-5 accent-emerald-600" disabled={settling} checked={selected.has(t.id)} onChange={() => toggle(t.id)}
                    aria-label={`Selecionar boleto de ${dateLabel(t.vencimento)} • ${formatCurrency(t.valor)}`} />
                </label>}</td>
                <td className="whitespace-nowrap p-2">{dateLabel(t.vencimento)}</td><td className="whitespace-nowrap p-2">{formatCurrency(t.valor)}</td>
                <td className="p-2">{status === PAGO_ANTECIPADO
                  ? <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-emerald-700">{status} {dateLabel(t.baixado_em ?? null).slice(0, 5)}</span>
                      <button type="button" disabled={settling} onClick={() => undoSettle(t)} className="rounded-md border px-2 py-1 text-xs font-bold disabled:opacity-50">Desfazer</button>
                    </div>
                  : status}</td>
              </tr>;
            })}</tbody>
          </table></div>}
      </>}
  </article>;
}

export function FinancialTab({ clientes }: { clientes: Cliente[] }) {
  const [clientId, setClientId] = useState('');
  const activeClients = clientes.filter(c => c.ativo !== false);
  useEffect(() => {
    if (clientId && !clientes.some(c => c.id === clientId && c.ativo !== false)) setClientId('');
  }, [clientes, clientId]);
  const [stores, setStores] = useState<Store[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setStores([]);
    setError('');
    if (!clientId) { setLoading(false); return; }
    setLoading(true);
    const load = async () => {
      const rows: Store[] = [];
      for (let offset = 0; ; offset += 500) {
        const { data, error: readError } = await supabase.from('entidades_financeiras')
          .select(fields).eq('cliente_comercial_id', clientId).order('razao_social').order('id').range(offset, offset + 499);
        if (readError) throw readError;
        rows.push(...(data || []).map(s => ({ ...s, limite_total: Number(s.limite_total), disponivel_oficial_snapshot: Number(s.disponivel_oficial_snapshot) })));
        if (!data || data.length < 500) break;
      }
      if (active) setStores(rows);
    };
    load().catch(() => { if (active) setError('Não foi possível consultar o financeiro. Confira a conexão e as permissões.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [clientId, revision]);
  return <section className="space-y-4" aria-label="Financeiro dos clientes">
    <div className="rounded-xl border border-neutral-200 bg-white p-4">
      <h2 className="text-lg font-extrabold">Financeiro por cliente</h2>
      <FilterDropdown
        label="Selecione um cliente"
        options={[...activeClients].sort((x, y) => x.cliente.localeCompare(y.cliente, 'pt-BR')).map(c => ({ id: c.id, label: c.cliente }))}
        selected={clientId}
        onChange={setClientId}
        placeholder="Digite o nome do cliente"
        icon={<Users size={20} />}
      />
      <button type="button" disabled={!clientId || loading} onClick={() => setRevision(n => n + 1)} className="mt-3 rounded-lg border px-4 py-2 text-sm font-bold disabled:opacity-50">Atualizar consulta</button>
    </div>
    {loading && <p role="status">Consultando financeiro...</p>}
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {clientId && !loading && !error && stores.length === 0 && <p className="rounded-lg bg-amber-50 p-3 text-sm">Nenhum cadastro financeiro disponível para este cliente. Isso não significa limite zero ou ausência de dívida.</p>}
    {stores.map(store => <StoreReview key={store.id + ':' + revision} store={store} onSaved={updated => setStores(rows => rows.map(s => s.id === updated.id ? updated : s))} />)}
  </section>;
}

