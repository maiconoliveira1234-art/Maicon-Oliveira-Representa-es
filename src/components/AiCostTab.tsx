import React, { useEffect, useMemo, useState } from 'react';
import { Banknote, Bot, CalendarClock, MessageSquare } from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { supabase } from '../lib/supabase';
import { cn } from '../lib/utils';
import {
  AI_PERIOD_LABELS, type AiPeriod, type AiUsageRow, aiMonthProjection, aiPeriodRange, formatBrlSmall, formatTokens, formatUsd,
  summarizeAiUsage,
} from '../lib/aiUsage';

const COLUMNS = 'criado_em, tarefa, modelo, tokens_entrada, tokens_saida, tokens_cache_escrita, tokens_cache_leitura, custo_usd';
const PERIODS: AiPeriod[] = ['mes', 'mes_anterior', '30d', 'tudo'];
const SHORT_LABEL: Record<AiPeriod, string> = { mes: 'Este mês', mes_anterior: 'Mês anterior', '30d': '30 dias', tudo: 'Tudo' };

async function loadRows(period: AiPeriod): Promise<AiUsageRow[]> {
  const { start, end } = aiPeriodRange(period);
  const rows: AiUsageRow[] = [];
  for (let offset = 0; offset < 100000; offset += 1000) {
    let query = supabase.from('ia_uso').select(COLUMNS).eq('provedor', 'anthropic')
      .order('criado_em').order('id').range(offset, offset + 999);
    if (start) query = query.gte('criado_em', start.toISOString());
    if (end) query = query.lt('criado_em', end.toISOString());
    const { data, error } = await query;
    if (error) throw error;
    rows.push(...((data || []) as AiUsageRow[]));
    if (!data || data.length < 1000) break;
  }
  return rows;
}

async function loadFirstRecord(): Promise<Date | null> {
  const { data, error } = await supabase.from('ia_uso').select('criado_em').eq('provedor', 'anthropic')
    .order('criado_em').limit(1).maybeSingle();
  if (error) throw error;
  return data?.criado_em ? new Date(data.criado_em) : null;
}

// A Anthropic cobra em dólar; a tela converte para real pela cotação comercial do dia.
// A última cotação fica guardada no aparelho e é usada quando não dá para consultar.
const RATE_KEY = 'crm_cotacao_usd_brl';
const RATE_MAX_AGE = 6 * 3600 * 1000;
type DollarRate = { rate: number; at: number };

function savedRate(): DollarRate | null {
  try {
    const saved = JSON.parse(localStorage.getItem(RATE_KEY) || 'null');
    return saved && Number(saved.rate) > 0 && Number(saved.at) > 0 ? { rate: Number(saved.rate), at: Number(saved.at) } : null;
  } catch { return null; }
}

/** rate = null enquanto a primeira cotação não chega; done = a consulta terminou (com ou sem sucesso). */
function useDollarRate(): { rate: DollarRate | null; done: boolean } {
  const [rate, setRate] = useState<DollarRate | null>(savedRate);
  const [done, setDone] = useState(false);
  useEffect(() => {
    const current = savedRate();
    if (current && Date.now() - current.at < RATE_MAX_AGE) { setDone(true); return; }
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 8000);
    fetch('https://economia.awesomeapi.com.br/json/last/USD-BRL', { signal: controller.signal })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        const value = Number(data?.USDBRL?.bid);
        if (!(value > 0)) return;
        const fresh = { rate: value, at: Date.now() };
        setRate(fresh);
        try { localStorage.setItem(RATE_KEY, JSON.stringify(fresh)); } catch { /* sem cache */ }
      })
      .catch(() => { /* fica a última cotação guardada */ })
      .finally(() => { window.clearTimeout(timer); setDone(true); });
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, []);
  return { rate, done };
}

function StatCard({ label, value, detail, icon }: { label: string; value: string; detail?: string; icon: React.ReactNode }) {
  return (
    <div className="flex flex-col justify-between rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <span className="text-[11px] font-black uppercase tracking-wider text-neutral-400">{label}</span>
        <div className="rounded-lg bg-orange-50 p-2 text-orange-600">{icon}</div>
      </div>
      <div className="mt-2">
        <div className="text-2xl font-black text-neutral-900">{value}</div>
        {detail && <p className="mt-0.5 text-xs font-semibold text-neutral-500">{detail}</p>}
      </div>
    </div>
  );
}

const dayLabel = (dia: string) => `${dia.slice(8, 10)}/${dia.slice(5, 7)}`;

export function AiCostTab() {
  const [period, setPeriod] = useState<AiPeriod>('mes');
  const [rows, setRows] = useState<AiUsageRow[]>([]);
  const [firstRecord, setFirstRecord] = useState<Date | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const { rate, done: rateDone } = useDollarRate();

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    Promise.all([loadRows(period), loadFirstRecord()])
      .then(([data, first]) => { if (active) { setRows(data); setFirstRecord(first); } })
      .catch(() => { if (active) setError('Não foi possível carregar o custo de IA. Tente novamente.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [period]);

  const summary = useMemo(() => summarizeAiUsage(rows), [rows]);
  const projection = period === 'mes' ? aiMonthProjection(summary.custo, firstRecord) : null;
  // Em real pela cotação do dia; em dólar só se nunca foi possível obter a cotação.
  const money = (usd: number) => rate ? formatBrlSmall(usd * rate.rate) : formatUsd(usd);
  const waiting = loading || (!rate && !rateDone);
  const average = summary.respostas ? summary.custo / summary.respostas : 0;

  return (
    <section className="space-y-4" aria-label="Custo de IA">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex max-w-full overflow-x-auto rounded-lg border border-neutral-200 bg-neutral-100 p-1 shadow-sm scrollbar-none" role="group" aria-label="Período">
          {PERIODS.map(p => (
            <button
              key={p}
              type="button"
              aria-pressed={period === p}
              aria-label={AI_PERIOD_LABELS[p]}
              onClick={() => setPeriod(p)}
              className={cn(
                'shrink-0 whitespace-nowrap rounded-md px-3 py-2 text-xs font-black transition-all',
                period === p ? 'bg-white text-orange-600 shadow-sm' : 'text-neutral-600 hover:text-neutral-900'
              )}
            >
              {SHORT_LABEL[p]}
            </button>
          ))}
        </div>
        {(firstRecord || rate) && (
          <span className="text-xs font-semibold text-neutral-500">
            {[
              firstRecord ? `Registro desde ${firstRecord.toLocaleDateString('pt-BR')}` : '',
              rate ? `US$ 1 = ${rate.rate.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}` : '',
            ].filter(Boolean).join(' · ')}
          </span>
        )}
      </div>

      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {!rate && rateDone && (
        <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">Sem cotação do dólar no momento: valores em US$.</p>
      )}
      {waiting && <p role="status" className="py-6 text-center text-sm text-neutral-500">Carregando...</p>}

      {!waiting && !error && summary.respostas === 0 && (
        <p className="rounded-xl border border-neutral-200 bg-white p-4 text-sm text-neutral-600">
          Nenhuma resposta do Claude registrada neste período.
        </p>
      )}

      {!waiting && !error && summary.respostas > 0 && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard label="Gasto" value={money(summary.custo)} icon={<Banknote size={18} />} />
            <StatCard label="Respostas" value={summary.respostas.toLocaleString('pt-BR')} icon={<MessageSquare size={18} />} />
            <StatCard label="Por resposta" value={money(average)} icon={<Bot size={18} />} />
            {projection !== null && (
              <StatCard label="Projeção do mês" value={money(projection)} icon={<CalendarClock size={18} />} />
            )}
          </div>

          {summary.semPreco > 0 && (
            <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
              {summary.semPreco} {summary.semPreco === 1 ? 'resposta de modelo sem preço cadastrado não entra' : 'respostas de modelo sem preço cadastrado não entram'} no gasto.
            </p>
          )}

          <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
            <h2 className="text-sm font-extrabold text-neutral-900">Por tarefa</h2>
            <ul className="mt-3 divide-y divide-neutral-100">
              {summary.porTarefa.map(task => {
                const share = summary.custo > 0 ? task.custo / summary.custo : 0;
                return (
                  <li key={task.tarefa} className="py-3 first:pt-0 last:pb-0">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="min-w-0 truncate text-sm font-bold text-neutral-800">{task.label}</span>
                      <span className="shrink-0 text-sm font-black text-neutral-900">{money(task.custo)}</span>
                    </div>
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-neutral-100">
                      <div className="h-full rounded-full bg-orange-500" style={{ width: `${Math.round(share * 100)}%` }} />
                    </div>
                    <p className="mt-1.5 text-xs font-semibold text-neutral-500">
                      {task.respostas.toLocaleString('pt-BR')} {task.respostas === 1 ? 'resposta' : 'respostas'}
                      {' · '}{money(task.custo / task.respostas)} cada
                      {' · '}{formatTokens(task.tokensEntrada / task.respostas)} tokens enviados, {formatTokens(task.tokensSaida / task.respostas)} recebidos
                    </p>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
            <h2 className="text-sm font-extrabold text-neutral-900">Por dia</h2>
            <div className="mt-3 h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={summary.porDia} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                  <XAxis dataKey="dia" tickFormatter={dayLabel} axisLine={{ stroke: '#e5e5e5' }} tickLine={false}
                    tick={{ fontSize: 11, fontWeight: 700, fill: '#737373' }} minTickGap={12} />
                  <YAxis axisLine={false} tickLine={false} width={64}
                    tick={{ fontSize: 10, fontWeight: 700, fill: '#a3a3a3' }} tickFormatter={(v: number) => money(v)} />
                  <Tooltip
                    cursor={{ fill: '#fff7ed' }}
                    contentStyle={{ borderRadius: '12px', border: '1px solid #e5e5e5', fontSize: 12, fontWeight: 700 }}
                    labelFormatter={(label) => dayLabel(String(label))}
                    formatter={(value, _name, item) => [
                      `${money(Number(value))} · ${(item?.payload as { respostas?: number } | undefined)?.respostas ?? 0} respostas`,
                      'Gasto',
                    ]}
                  />
                  <Bar dataKey="custo" fill="#ea580c" radius={[4, 4, 0, 0]} maxBarSize={36} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
