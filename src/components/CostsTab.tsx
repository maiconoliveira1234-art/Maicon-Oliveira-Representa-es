import React, { useEffect, useMemo, useState } from 'react';
import { CalendarClock, Wallet } from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { supabase } from '../lib/supabase';
import { cn } from '../lib/utils';
import {
  AI_PERIOD_LABELS, type AiPeriod, type AiUsageRow, aiMonthProjection, aiPeriodRange, formatBrlSmall, formatTokens,
  summarizeAiUsage,
} from '../lib/aiUsage';
import {
  EASYCOEXISTENCE, type WhatsAppCostRow, dayToDate, feeCharges, localDay, summarizeWhatsApp,
} from '../lib/crmCosts';

const AI_COLUMNS = 'criado_em, tarefa, modelo, tokens_entrada, tokens_saida, tokens_cache_escrita, tokens_cache_leitura, custo_usd';
const PERIODS: AiPeriod[] = ['mes', 'mes_anterior', '30d', 'tudo'];
const SHORT_LABEL: Record<AiPeriod, string> = { mes: 'Este mês', mes_anterior: 'Mês anterior', '30d': '30 dias', tudo: 'Tudo' };
const COLOR_CLAUDE = '#ea580c';
const COLOR_WHATSAPP = '#16a34a';

async function loadAiRows(period: AiPeriod): Promise<AiUsageRow[]> {
  const { start, end } = aiPeriodRange(period);
  const rows: AiUsageRow[] = [];
  for (let offset = 0; offset < 100000; offset += 1000) {
    let query = supabase.from('ia_uso').select(AI_COLUMNS).eq('provedor', 'anthropic')
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

async function loadAiFirst(): Promise<Date | null> {
  const { data, error } = await supabase.from('ia_uso').select('criado_em').eq('provedor', 'anthropic')
    .order('criado_em').limit(1).maybeSingle();
  if (error) throw error;
  return data?.criado_em ? new Date(data.criado_em) : null;
}

async function loadWhatsAppRows(period: AiPeriod): Promise<WhatsAppCostRow[]> {
  const { start, end } = aiPeriodRange(period);
  let query = supabase.from('whatsapp_custo_diario').select('dia, categoria, tipo, volume, custo, moeda').order('dia').limit(5000);
  if (start) query = query.gte('dia', localDay(start));
  if (end) query = query.lt('dia', localDay(end));
  const { data, error } = await query;
  if (error) throw error;
  return (data || []) as WhatsAppCostRow[];
}

async function loadWhatsAppFirst(): Promise<Date | null> {
  const { data, error } = await supabase.from('whatsapp_custo_diario').select('dia').order('dia').limit(1).maybeSingle();
  if (error) throw error;
  return data?.dia ? dayToDate(String(data.dia)) : null;
}

// A Anthropic e a Meta cobram em dólar; a tela converte pela cotação comercial do dia.
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
function useDollarRate(attempt: number): { rate: DollarRate | null; done: boolean } {
  const [rate, setRate] = useState<DollarRate | null>(savedRate);
  const [done, setDone] = useState(false);
  useEffect(() => {
    const current = savedRate();
    if (current && Date.now() - current.at < RATE_MAX_AGE) { setDone(true); return; }
    setDone(false);
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
  }, [attempt]);
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

function ShareRow({ label, value, share, detail, color }: { label: string; value: string; share: number; detail: string; color: string }) {
  return (
    <li className="py-3 first:pt-0 last:pb-0">
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate text-sm font-bold text-neutral-800">{label}</span>
        <span className="shrink-0 text-sm font-black text-neutral-900">{value}</span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-neutral-100">
        <div className="h-full rounded-full" style={{ width: `${Math.round(Math.max(0, Math.min(1, share)) * 100)}%`, backgroundColor: color }} />
      </div>
      <p className="mt-1.5 text-xs font-semibold text-neutral-500">{detail}</p>
    </li>
  );
}

const dayLabel = (dia: string) => `${dia.slice(8, 10)}/${dia.slice(5, 7)}`;
const plural = (n: number, one: string, many: string) => `${n.toLocaleString('pt-BR')} ${n === 1 ? one : many}`;

export function CostsTab() {
  const [period, setPeriod] = useState<AiPeriod>('mes');
  const [aiRows, setAiRows] = useState<AiUsageRow[]>([]);
  const [aiFirst, setAiFirst] = useState<Date | null>(null);
  const [waRows, setWaRows] = useState<WhatsAppCostRow[]>([]);
  const [waFirst, setWaFirst] = useState<Date | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [synced, setSynced] = useState(0);
  const [syncWarning, setSyncWarning] = useState(false);
  const [rateAttempt, setRateAttempt] = useState(0);
  const { rate, done: rateDone } = useDollarRate(rateAttempt);

  // Pede à Meta os números mais recentes do WhatsApp uma vez ao abrir; a tela já mostra o que está salvo.
  useEffect(() => {
    let active = true;
    supabase.functions.invoke('whatsapp-custos', { body: { sync: true } })
      .then(({ error: invokeError }) => { if (!active) return; setSyncWarning(Boolean(invokeError)); setSynced(n => n + 1); })
      .catch(() => { if (active) setSyncWarning(true); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    Promise.all([loadAiRows(period), loadAiFirst(), loadWhatsAppRows(period), loadWhatsAppFirst()])
      .then(([ai, first, wa, waStart]) => {
        if (!active) return;
        setAiRows(ai); setAiFirst(first); setWaRows(wa); setWaFirst(waStart);
      })
      .catch(() => { if (active) setError('Não foi possível carregar os custos. Tente novamente.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [period, synced]);

  const usdBrl = rate?.rate ?? 0;
  const ai = useMemo(() => summarizeAiUsage(aiRows), [aiRows]);
  const wa = useMemo(() => summarizeWhatsApp(waRows, usdBrl), [waRows, usdBrl]);
  const now = new Date();
  const { start, end } = aiPeriodRange(period, now);
  const fees = feeCharges(start, end ? new Date(end.getTime() - 1) : now);
  const feeTotal = fees * EASYCOEXISTENCE.mensalidade;
  const claudeBrl = ai.custo * usdBrl;
  const total = claudeBrl + wa.custo + feeTotal;

  let projection: number | null = null;
  if (period === 'mes') {
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthLast = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
    const claudeProj = aiMonthProjection(claudeBrl, aiFirst, now) ?? claudeBrl;
    const waProj = aiMonthProjection(wa.custo, waFirst, now) ?? wa.custo;
    projection = claudeProj + waProj + feeCharges(monthStart, monthLast) * EASYCOEXISTENCE.mensalidade;
  }

  const days = useMemo(() => {
    const map = new Map<string, { dia: string; claude: number; whatsapp: number; respostas: number }>();
    for (const d of ai.porDia) map.set(d.dia, { dia: d.dia, claude: d.custo * usdBrl, whatsapp: 0, respostas: d.respostas });
    for (const [dia, valor] of wa.porDia) {
      const item = map.get(dia) || { dia, claude: 0, whatsapp: 0, respostas: 0 };
      item.whatsapp += valor;
      map.set(dia, item);
    }
    return [...map.values()].sort((a, b) => a.dia.localeCompare(b.dia));
  }, [ai.porDia, wa.porDia, usdBrl]);

  const money = formatBrlSmall;
  const share = (v: number) => (total > 0 ? v / total : 0);
  const noRate = !rate && rateDone;
  const waiting = loading || (!rate && !rateDone);

  return (
    <section className="space-y-4" aria-label="Custos">
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
        {rate && (
          <span className="text-xs font-semibold text-neutral-500">
            US$ 1 = {rate.rate.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
          </span>
        )}
      </div>

      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {noRate && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
          <span>Sem cotação do dólar no momento.</span>
          <button type="button" onClick={() => setRateAttempt(n => n + 1)} className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-black">Tentar de novo</button>
        </div>
      )}
      {syncWarning && !waiting && (
        <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
          Não foi possível atualizar o WhatsApp com a Meta agora. Os valores são da última atualização.
        </p>
      )}
      {waiting && !noRate && <p role="status" className="py-6 text-center text-sm text-neutral-500">Carregando...</p>}

      {!waiting && !error && rate && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard label="Total" value={money(total)} icon={<Wallet size={18} />} />
            {projection !== null && <StatCard label="Projeção do mês" value={money(projection)} icon={<CalendarClock size={18} />} />}
          </div>

          {(ai.semPreco > 0 || wa.semPreco > 0) && (
            <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
              {[
                ai.semPreco ? plural(ai.semPreco, 'resposta de IA sem preço cadastrado', 'respostas de IA sem preço cadastrado') : '',
                wa.semPreco ? plural(wa.semPreco, 'mensagem do WhatsApp sem preço cadastrado', 'mensagens do WhatsApp sem preço cadastrado') : '',
              ].filter(Boolean).join(' e ')} fora do total.
            </p>
          )}

          <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
            <h2 className="text-sm font-extrabold text-neutral-900">Por serviço</h2>
            <ul className="mt-3 divide-y divide-neutral-100">
              <ShareRow
                label="Claude (IA)"
                value={money(claudeBrl)}
                share={share(claudeBrl)}
                color={COLOR_CLAUDE}
                detail={ai.respostas
                  ? `${plural(ai.respostas, 'resposta', 'respostas')} · ${money(claudeBrl / ai.respostas)} cada${aiFirst ? ` · desde ${aiFirst.toLocaleDateString('pt-BR')}` : ''}`
                  : 'Nenhuma resposta no período'}
              />
              <ShareRow
                label="WhatsApp (Meta)"
                value={`${wa.estimado ? '≈ ' : ''}${money(wa.custo)}`}
                share={share(wa.custo)}
                color={COLOR_WHATSAPP}
                detail={wa.cobradas + wa.gratis
                  ? `${plural(wa.cobradas, 'mensagem cobrada', 'mensagens cobradas')} · ${plural(wa.gratis, 'grátis', 'grátis')}`
                  : 'Nenhuma mensagem enviada pela API no período'}
              />
              <ShareRow
                label="easyCoexistence"
                value={money(feeTotal)}
                share={share(feeTotal)}
                color="#737373"
                detail={fees ? plural(fees, 'mensalidade', 'mensalidades') : 'Sem cobrança no período'}
              />
            </ul>
          </div>

          {days.length > 0 && (
            <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-extrabold text-neutral-900">Por dia</h2>
                <div className="flex items-center gap-3 text-xs font-bold text-neutral-500">
                  <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: COLOR_CLAUDE }} />Claude</span>
                  <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: COLOR_WHATSAPP }} />WhatsApp</span>
                </div>
              </div>
              <div className="mt-3 h-56 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={days} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                    <XAxis dataKey="dia" tickFormatter={dayLabel} axisLine={{ stroke: '#e5e5e5' }} tickLine={false}
                      tick={{ fontSize: 11, fontWeight: 700, fill: '#737373' }} minTickGap={12} />
                    <YAxis axisLine={false} tickLine={false} width={64}
                      tick={{ fontSize: 10, fontWeight: 700, fill: '#a3a3a3' }} tickFormatter={(v: number) => money(v)} />
                    <Tooltip
                      cursor={{ fill: '#fff7ed' }}
                      contentStyle={{ borderRadius: '12px', border: '1px solid #e5e5e5', fontSize: 12, fontWeight: 700 }}
                      labelFormatter={(label) => dayLabel(String(label))}
                      formatter={(value, name) => [money(Number(value)), name === 'claude' ? 'Claude' : 'WhatsApp']}
                    />
                    <Bar dataKey="claude" stackId="custo" fill={COLOR_CLAUDE} maxBarSize={36} />
                    <Bar dataKey="whatsapp" stackId="custo" fill={COLOR_WHATSAPP} radius={[4, 4, 0, 0]} maxBarSize={36} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {ai.porTarefa.length > 0 && (
            <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
              <h2 className="text-sm font-extrabold text-neutral-900">Claude por tarefa</h2>
              <ul className="mt-3 divide-y divide-neutral-100">
                {ai.porTarefa.map(task => (
                  <ShareRow
                    key={task.tarefa}
                    label={task.label}
                    value={money(task.custo * usdBrl)}
                    share={ai.custo > 0 ? task.custo / ai.custo : 0}
                    color={COLOR_CLAUDE}
                    detail={`${plural(task.respostas, 'resposta', 'respostas')} · ${money(task.custo * usdBrl / task.respostas)} cada · ${formatTokens(task.tokensEntrada / task.respostas)} tokens enviados, ${formatTokens(task.tokensSaida / task.respostas)} recebidos`}
                  />
                ))}
              </ul>
            </div>
          )}

          {wa.porCategoria.length > 0 && (
            <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
              <h2 className="text-sm font-extrabold text-neutral-900">WhatsApp por tipo</h2>
              <ul className="mt-3 divide-y divide-neutral-100">
                {wa.porCategoria.map(cat => (
                  <ShareRow
                    key={cat.categoria}
                    label={cat.label}
                    value={money(cat.custo)}
                    share={wa.custo > 0 ? cat.custo / wa.custo : 0}
                    color={COLOR_WHATSAPP}
                    detail={`${plural(cat.cobradas, 'cobrada', 'cobradas')} · ${plural(cat.gratis, 'grátis', 'grátis')}`}
                  />
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  );
}
