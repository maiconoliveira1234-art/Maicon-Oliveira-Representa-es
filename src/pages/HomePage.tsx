import React, { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Calendar,
  CheckCircle2,
  Clock,
  Loader2,
  Map as MapIcon,
  PackageCheck,
  Route,
  Target,
  ClipboardCheck,
  MapPin,
  Users,
  WalletCards
} from 'lucide-react';
import {
  differenceInDays,
  differenceInWeeks,
  endOfMonth,
  format,
  isWithinInterval,
  parseISO,
  startOfMonth,
  startOfToday,
  startOfYear,
  subMonths
} from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { agendaService } from '../services/agendaService';
import { supabase } from '../lib/supabase';
import { HistVenda, Produto } from '../types';
import { DiaSemana, Visita, VisitaStatus } from '../types/agenda';
import { cn, formatWeight } from '../lib/utils';
import { getAgendaNoteAlert } from '../lib/agendaNoteAlert';
import { useAgendaPendencias } from '../hooks/useAgendaPendencias';
import { isAgendaPendenciaAtiva, sortAgendaPendencias } from '../lib/agendaPendencias';

import { useDataManager } from '../lib/dataManager';

type MetaRow = {
  cliente_id: string;
  meta: number;
};

type HomeData = {
  visitas: Visita[];
  historico: HistVenda[];
  produtos: Produto[];
  metas: Record<string, number>;
  unscheduledClients: number;
};

type TaskFilter = 'TODAS' | 'ATRASADAS' | 'HOJE' | 'FUTURAS' | 'SEM_DATA';

const DIAS_MAP: Record<number, DiaSemana> = {
  1: 'Segunda',
  2: 'Terça',
  3: 'Quarta',
  4: 'Quinta',
  5: 'Sexta'
};

function getCycleWeek(date: Date): 1 | 2 {
  const anchor = startOfYear(date);
  const weeksSinceAnchor = differenceInWeeks(date, anchor);
  return weeksSinceAnchor % 2 === 0 ? 1 : 2;
}

function getDayName(date: Date): DiaSemana | null {
  const dayIdx = date.getDay();
  return DIAS_MAP[dayIdx as keyof typeof DIAS_MAP] || null;
}

function statusLabel(status: VisitaStatus) {
  const labels: Record<VisitaStatus, string> = {
    pendente: 'Pendente',
    concluida: 'Concluida',
    reagendada: 'Reagendada',
    cancelada: 'Cancelada'
  };
  return labels[status];
}

export function HomePage() {
  const location = useLocation();
  const selectedDate = (location.state as any)?.selectedDate;
  const today = useMemo(() => startOfToday(), []);
  
  const { 
    clientes, 
    produtos, 
    metas, 
    agenda_visitas, 
    hist_vendas, 
    loadingGlobal 
  } = useDataManager();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [taskFilter, setTaskFilter] = useState<TaskFilter>('TODAS');
  const [data, setData] = useState<HomeData>({
    visitas: [],
    historico: [],
    produtos: [],
    metas: {},
    unscheduledClients: 0
  });
  const { pendencias, updateStatus: updatePendenciaStatus } = useAgendaPendencias();

  useEffect(() => {
    if (loadingGlobal) {
      setLoading(true);
      return;
    }

    try {
      const activeClientIds = new Set(clientes.filter(c => c.ativo !== false).map(c => c.id));
      const filteredVisitas = agenda_visitas.filter(v => activeClientIds.has(v.cliente_id));
      
      const scheduledIds = new Set(agenda_visitas.map(v => v.cliente_id).filter(Boolean));
      const unscheduledClientsCount = clientes.filter(c => c.ativo !== false && !scheduledIds.has(c.id)).length;

      setData({
        visitas: filteredVisitas,
        historico: hist_vendas,
        produtos: produtos,
        metas: metas,
        unscheduledClients: unscheduledClientsCount
      });
      setError(null);
    } catch (err: any) {
      setError(err?.message || 'Erro ao carregar rotina diária');
    } finally {
      setLoading(false);
    }
  }, [loadingGlobal, clientes, produtos, metas, agenda_visitas, hist_vendas]);

  const summary = useMemo(() => {
    const currentWeek = getCycleWeek(today);
    const currentDay = getDayName(today);
    const monthStart = startOfMonth(today);
    const monthEnd = endOfMonth(today);

    const todayVisits = data.visitas
      .filter((visita) => visita.semana === currentWeek && visita.dia_semana === currentDay)
      .sort((a, b) => (a.horario_inicio || '').localeCompare(b.horario_inicio || '') || a.ordem_visita - b.ordem_visita);

    const todayClientIds = todayVisits.map((visita) => visita.cliente_id).filter(Boolean) as string[];
    const produtosMap = new Map(data.produtos.map((produto) => [produto.id, produto]));

    const monthSalesForTodayClients = data.historico.filter((sale) => {
      if (!todayClientIds.includes(sale.cliente_id)) return false;
      try {
        const date = parseISO(sale.faturamento);
        return isWithinInterval(date, { start: monthStart, end: monthEnd });
      } catch {
        return false;
      }
    });

    const realizedWeight = monthSalesForTodayClients.reduce((total, sale) => {
      const produto = produtosMap.get(sale.produto_id);
      return total + (Number(sale.qtd) || 0) * (produto?.peso_embalagem || 0);
    }, 0);

    const targetWeight = todayClientIds.reduce((total, id) => total + (data.metas[id] || 0), 0);
    const completedVisits = todayVisits.filter((visita) => visita.status === 'concluida').length;
    const pendingVisits = todayVisits.filter((visita) => visita.status === 'pendente').length;
    const nextVisit = todayVisits.find((visita) => visita.status !== 'concluida' && visita.status !== 'cancelada') || todayVisits[0] || null;

    const histByClient = new Map<string, HistVenda[]>();
    data.historico.forEach((sale) => {
      if (!sale.cliente_id) return;
      const list = histByClient.get(sale.cliente_id) || [];
      list.push(sale);
      histByClient.set(sale.cliente_id, list);
    });

    const overdueVisits = todayVisits
      .map((visita) => {
        const history = (visita.cliente_id ? histByClient.get(visita.cliente_id) : []) || [];
        const sorted = history
          .filter((sale) => sale.faturamento)
          .sort((a, b) => parseISO(b.faturamento).getTime() - parseISO(a.faturamento).getTime());

        if (sorted.length === 0) return { visita, gap: 0 };

        const uniqueDays = new Set(sorted.map((sale) => format(parseISO(sale.faturamento), 'yyyy-MM-dd')));
        const oldest = parseISO(sorted[sorted.length - 1].faturamento);
        const averageCycle = uniqueDays.size > 0 ? Math.round(differenceInDays(today, oldest) / uniqueDays.size) : 0;
        const daysSinceLastOrder = differenceInDays(today, parseISO(sorted[0].faturamento));

        return {
          visita,
          gap: daysSinceLastOrder - averageCycle
        };
      })
      .filter((item) => item.gap > 0)
      .sort((a, b) => b.gap - a.gap)
      .slice(0, 3);

    const noteRiskPriority = {
      pending: 0,
      attention: 1,
      note: 2
    };

    const allNoteRisks = todayVisits
      .map((visita) => {
        const noteAlert = getAgendaNoteAlert(visita.observacoes);
        return noteAlert ? { visita, noteAlert } : null;
      })
      .filter(Boolean)
      .sort((a, b) => noteRiskPriority[a!.noteAlert.level] - noteRiskPriority[b!.noteAlert.level]) as Array<{
        visita: Visita;
        noteAlert: NonNullable<ReturnType<typeof getAgendaNoteAlert>>;
      }>;

    const noteRiskCounts = allNoteRisks.reduce(
      (acc, item) => {
        acc[item.noteAlert.level] += 1;
        return acc;
      },
      { pending: 0, attention: 0, note: 0 }
    );
    const noteRisks = allNoteRisks.slice(0, 4);

    const fixedVisits = todayVisits.filter((visita) => visita.agenda_fixa).length;
    const loadLevel = targetWeight >= 5000 || todayVisits.length >= 10 ? 'Dia pesado' : targetWeight >= 2500 || todayVisits.length >= 7 ? 'Dia normal' : 'Dia leve';

    return {
      todayVisits,
      completedVisits,
      pendingVisits,
      nextVisit,
      targetWeight,
      realizedWeight,
      overdueVisits,
      noteRisks,
      noteRiskCounts,
      fixedVisits,
      loadLevel,
      currentWeek,
      currentDay
    };
  }, [data, today]);

  const pendingAgendaItems = useMemo(() => {
    const todayKey = format(today, 'yyyy-MM-dd');
    return sortAgendaPendencias(pendencias.filter((item) =>
      isAgendaPendenciaAtiva(item)
      && (!item.data_prevista || item.data_prevista <= todayKey)
    )).slice(0, 5);
  }, [pendencias, today]);

  const taskSummary = useMemo(() => {
    const todayKey = format(today, 'yyyy-MM-dd');
    const all = sortAgendaPendencias(pendencias.filter((item) =>
      item.tipo === 'TAREFA' && isAgendaPendenciaAtiva(item)
    ));
    const matches = (date: string | null) => {
      if (taskFilter === 'ATRASADAS') return Boolean(date && date < todayKey);
      if (taskFilter === 'HOJE') return date === todayKey;
      if (taskFilter === 'FUTURAS') return Boolean(date && date > todayKey);
      if (taskFilter === 'SEM_DATA') return !date;
      return true;
    };
    return {
      all,
      visible: all.filter((item) => matches(item.data_prevista)),
      overdue: all.filter((item) => item.data_prevista && item.data_prevista < todayKey).length,
      today: all.filter((item) => item.data_prevista === todayKey).length,
      future: all.filter((item) => item.data_prevista && item.data_prevista > todayKey).length,
      undated: all.filter((item) => !item.data_prevista).length
    };
  }, [pendencias, taskFilter, today]);

  if (selectedDate) {
    return <Navigate to="/agenda" state={{ selectedDate }} replace />;
  }

  if (loading) {
    return (
      <div className="min-h-[70vh] flex flex-col items-center justify-center text-neutral-400">
        <Loader2 className="animate-spin text-orange-600" size={34} />
        <p className="mt-4 text-xs font-black uppercase tracking-[0.2em]">Carregando rotina</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-xl mx-auto mt-12 bg-white border border-rose-100 rounded-lg p-6 text-center shadow-sm">
        <div className="w-14 h-14 rounded-lg bg-rose-50 text-rose-600 flex items-center justify-center mx-auto mb-4">
          <AlertCircle size={28} />
        </div>
        <h1 className="text-xl font-black text-neutral-900">Nao consegui abrir o resumo</h1>
        <p className="mt-2 text-sm font-medium text-neutral-500">{error}</p>
      </div>
    );
  }

  const progress = summary.targetWeight > 0 ? Math.min(100, Math.round((summary.realizedWeight / summary.targetWeight) * 100)) : 0;

  return (
    <div className="mx-auto w-full max-w-6xl min-w-0 space-y-5 overflow-x-hidden">
      <section className="min-w-0 overflow-hidden rounded-lg border border-neutral-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[10px] font-black text-orange-600 uppercase tracking-[0.24em]">Hoje</p>
            <h1 className="mt-1 break-words text-2xl font-black capitalize tracking-tight text-neutral-950 md:text-3xl">
              {format(today, "EEEE, d 'de' MMMM", { locale: ptBR })}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Badge>Semana {summary.currentWeek}</Badge>
              <Badge>{summary.currentDay || 'Sem roteiro'}</Badge>
              <Badge>{summary.loadLevel}</Badge>
            </div>
          </div>
          <div className="grid w-full min-w-0 grid-cols-2 gap-2 sm:flex sm:w-auto sm:shrink-0">
            <Link to="/agenda" className="inline-flex min-w-0 items-center justify-center gap-2 rounded-lg bg-orange-600 px-3 py-3 text-sm font-black text-white shadow-lg shadow-orange-600/20 transition-transform active:scale-95 sm:px-4">
              Abrir Agenda
              <ArrowRight className="shrink-0" size={18} />
            </Link>
            <Link to="/emprestimos" className="inline-flex min-w-0 items-center justify-center gap-2 rounded-lg border border-neutral-200 bg-white px-3 py-3 text-sm font-black text-neutral-800 transition-transform active:scale-95 sm:px-4">
              Trocas
            </Link>
          </div>
        </div>
      </section>

      <section className="grid min-w-0 grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
        <MetricCard icon={Calendar} label="Visitas" value={summary.todayVisits.length.toString()} detail={summary.completedVisits + ' feitas - ' + summary.pendingVisits + ' pendentes'} tone="orange" />
        <MetricCard icon={Target} label="Meta do Dia" value={formatWeight(summary.targetWeight)} detail={progress + '% realizado no mes'} tone="green" />
        <MetricCard icon={PackageCheck} label="Realizado" value={formatWeight(summary.realizedWeight)} detail="Clientes do roteiro" tone="blue" />
        <MetricCard icon={Users} label="Novos fora da agenda" value={data.unscheduledClients.toString()} detail="Clientes ativos sem visita" tone="rose" />
      </section>

      <section className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
        <div className="min-w-0 overflow-hidden rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div className="min-w-0">
              <p className="text-[10px] font-black text-neutral-400 uppercase tracking-[0.22em]">Proxima acao</p>
              <h2 className="text-lg font-black text-neutral-950">Primeira visita pendente</h2>
            </div>
            <Route className="shrink-0 text-orange-600" size={24} />
          </div>

          {summary.nextVisit ? (
            <div className="min-w-0 overflow-hidden rounded-lg border border-neutral-100 bg-neutral-50 p-4">
              <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-xl font-black text-neutral-950 truncate">{summary.nextVisit.cliente_nome}</h3>
                  <p className="mt-1 text-sm font-bold text-neutral-500 truncate">{[summary.nextVisit.endereco, summary.nextVisit.bairro, summary.nextVisit.cidade].filter(Boolean).join(' - ')}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Badge>{statusLabel(summary.nextVisit.status)}</Badge>
                    {summary.nextVisit.horario_inicio && <Badge>{summary.nextVisit.horario_inicio}</Badge>}
                    {summary.nextVisit.agenda_fixa && <Badge>Manual</Badge>}
                  </div>
                </div>
                {summary.nextVisit.cliente_id && (
                  <Link to={'/cliente/' + summary.nextVisit.cliente_id} className="inline-flex min-w-0 items-center justify-center gap-2 rounded-lg bg-neutral-900 px-4 py-3 text-sm font-black text-white transition-transform active:scale-95 md:shrink-0">
                    Cliente
                    <ArrowRight className="shrink-0" size={16} />
                  </Link>
                )}
              </div>
            </div>
          ) : (
            <EmptyState icon={CheckCircle2} title="Sem visita para hoje" text="A agenda nao tem roteiro ativo para este dia." />
          )}
        </div>

        <div className="min-w-0 overflow-hidden rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div className="min-w-0">
              <p className="text-[10px] font-black text-neutral-400 uppercase tracking-[0.22em]">Atencao</p>
              <h2 className="text-lg font-black text-neutral-950">Riscos e pendencias</h2>
            </div>
            <AlertCircle className="shrink-0 text-amber-500" size={24} />
          </div>
          <div className="space-y-2">
            {pendingAgendaItems.map((item) => {
              const cliente = clientes.find((current) => current.id === item.cliente_id);
              const overdue = item.data_prevista && item.data_prevista < format(today, 'yyyy-MM-dd');
              return (
                <div key={'pending-' + item.id} className={cn(
                  'flex min-w-0 items-center gap-2 rounded-lg border px-2.5 py-2',
                  overdue ? 'border-rose-100 bg-rose-50' : 'border-neutral-200 bg-neutral-50'
                )}>
                  {item.tipo === 'VISITA_EXTRA' ? <MapPin size={17} className="shrink-0 text-orange-600" /> : <ClipboardCheck size={17} className="shrink-0 text-sky-600" />}
                  <Link to="/agenda" state={{ selectedDate: item.data_prevista || format(today, 'yyyy-MM-dd') }} className="min-w-0 flex-1">
                    <p className="truncate text-sm font-black text-neutral-900">{item.titulo}</p>
                    <p className={cn('truncate text-[10px] font-bold', overdue ? 'text-rose-600' : 'text-neutral-500')}>
                      {overdue ? 'Atrasada' : item.data_prevista ? 'Para hoje' : 'Sem data'}{cliente ? ` · ${cliente.cliente}` : ''}
                    </p>
                  </Link>
                  <button type="button" onClick={() => updatePendenciaStatus(item.id, 'CONCLUIDA')} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-emerald-200 bg-white text-emerald-600" title="Concluir">
                    <CheckCircle2 size={16} />
                  </button>
                </div>
              );
            })}
            {(summary.noteRiskCounts.pending > 0 || summary.noteRiskCounts.attention > 0 || summary.noteRiskCounts.note > 0) && (
              <div className="grid grid-cols-3 gap-1.5">
                <RiskCount label="Pend." value={summary.noteRiskCounts.pending} tone="rose" />
                <RiskCount label="Atenção" value={summary.noteRiskCounts.attention} tone="orange" />
                <RiskCount label="Notas" value={summary.noteRiskCounts.note} tone="sky" />
              </div>
            )}
            {summary.noteRisks.map(({ visita, noteAlert }) => (
              <div key={'note-' + visita.id} className={cn(
                "flex min-w-0 items-center justify-between gap-3 rounded-lg border px-3 py-3",
                noteAlert.level === 'pending' && "border-rose-100 bg-rose-50",
                noteAlert.level === 'attention' && "border-orange-100 bg-orange-50",
                noteAlert.level === 'note' && "border-sky-100 bg-sky-50"
              )}>
                <div className="min-w-0">
                  <p className={cn(
                    "text-sm font-black truncate",
                    noteAlert.level === 'pending' && "text-rose-900",
                    noteAlert.level === 'attention' && "text-orange-900",
                    noteAlert.level === 'note' && "text-sky-900"
                  )}>{visita.cliente_nome}</p>
                  <p className={cn(
                    "text-xs font-bold truncate",
                    noteAlert.level === 'pending' && "text-rose-700",
                    noteAlert.level === 'attention' && "text-orange-700",
                    noteAlert.level === 'note' && "text-sky-700"
                  )}>{noteAlert.label}: {noteAlert.text || 'Observação ativa'}</p>
                </div>
                <AlertTriangle className={cn(
                  "shrink-0",
                  noteAlert.level === 'pending' && "text-rose-600",
                  noteAlert.level === 'attention' && "text-orange-600",
                  noteAlert.level === 'note' && "text-sky-600"
                )} size={18} />
              </div>
            ))}
            {summary.overdueVisits.map(({ visita, gap }) => (
              <div key={visita.id} className="flex min-w-0 items-center justify-between gap-3 rounded-lg border border-amber-100 bg-amber-50 px-3 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-black text-neutral-900 truncate">{visita.cliente_nome}</p>
                  <p className="text-xs font-bold text-amber-700">{gap}d acima do ciclo</p>
                </div>
                <Clock className="text-amber-600 shrink-0" size={18} />
              </div>
            ))}
            {summary.fixedVisits > 0 && (
              <InfoLine icon={WalletCards} text={summary.fixedVisits + ' visita(s) com dia fixado manualmente'} />
            )}
            {data.unscheduledClients > 0 && (
              <InfoLine icon={Users} text={data.unscheduledClients + ' cliente(s) ativos fora da agenda'} />
            )}
            {pendingAgendaItems.length === 0 && summary.noteRisks.length === 0 && summary.overdueVisits.length === 0 && summary.fixedVisits === 0 && data.unscheduledClients === 0 && (
              <EmptyState icon={CheckCircle2} title="Tudo limpo" text="Nao encontrei alertas relevantes para hoje." compact />
            )}
          </div>
        </div>
      </section>

      <section className="min-w-0 overflow-hidden rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex min-w-0 items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-neutral-400">Acompanhamento</p>
            <h2 className="truncate text-lg font-black text-neutral-950">Tarefas pendentes</h2>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="rounded-lg bg-sky-50 px-2 py-1 text-xs font-black text-sky-700">{taskSummary.all.length}</span>
            <Link to="/agenda" className="text-xs font-black text-orange-600">Abrir agenda</Link>
          </div>
        </div>

        <div className="mb-3 grid grid-cols-3 gap-1.5 sm:grid-cols-5">
          {([
            ['TODAS', 'Todas', taskSummary.all.length],
            ['ATRASADAS', 'Atrasadas', taskSummary.overdue],
            ['HOJE', 'Hoje', taskSummary.today],
            ['FUTURAS', 'Futuras', taskSummary.future],
            ['SEM_DATA', 'Sem data', taskSummary.undated]
          ] as Array<[TaskFilter, string, number]>).map(([value, label, count]) => (
            <button
              key={value}
              type="button"
              onClick={() => setTaskFilter(value)}
              className={cn(
                'flex h-9 min-w-0 items-center justify-center gap-1 rounded-lg border px-1 text-[10px] font-black transition-colors',
                taskFilter === value ? 'border-neutral-900 bg-neutral-900 text-white' : 'border-neutral-200 bg-white text-neutral-500 hover:bg-neutral-50',
                value === 'SEM_DATA' && 'col-span-2 sm:col-span-1'
              )}
            >
              <span className="truncate">{label}</span>
              <span className={cn('shrink-0', taskFilter === value ? 'text-neutral-300' : 'text-neutral-400')}>{count}</span>
            </button>
          ))}
        </div>

        <div className="max-h-[360px] space-y-1.5 overflow-y-auto pr-0.5">
          {taskSummary.visible.map((item) => {
            const cliente = clientes.find((current) => current.id === item.cliente_id);
            const isOverdue = Boolean(item.data_prevista && item.data_prevista < format(today, 'yyyy-MM-dd'));
            const dateLabel = !item.data_prevista
              ? 'Sem data'
              : item.data_prevista === format(today, 'yyyy-MM-dd')
                ? 'Hoje'
                : format(parseISO(item.data_prevista), 'dd/MM/yyyy');
            return (
              <div key={'task-list-' + item.id} className={cn(
                'flex min-w-0 items-center gap-2 rounded-lg border px-2.5 py-2',
                isOverdue ? 'border-rose-100 bg-rose-50' : 'border-neutral-100 bg-neutral-50'
              )}>
                <ClipboardCheck size={17} className={cn('shrink-0', isOverdue ? 'text-rose-600' : 'text-sky-600')} />
                <Link to="/agenda" state={{ selectedDate: item.data_prevista || format(today, 'yyyy-MM-dd') }} className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <p className="truncate text-sm font-black text-neutral-900">{item.titulo}</p>
                    {item.prioridade !== 'NORMAL' && <span className={cn('shrink-0 text-[8px] font-black', item.prioridade === 'URGENTE' ? 'text-rose-600' : 'text-amber-600')}>{item.prioridade}</span>}
                  </div>
                  <p className={cn('truncate text-[10px] font-bold', isOverdue ? 'text-rose-600' : 'text-neutral-500')}>
                    {dateLabel}{item.horario_inicio ? ` · ${item.horario_inicio.slice(0, 5)}` : ''}{cliente ? ` · ${cliente.cliente}` : ''}
                  </p>
                </Link>
                <button
                  type="button"
                  onClick={() => updatePendenciaStatus(item.id, 'CONCLUIDA')}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-emerald-200 bg-white text-emerald-600 hover:bg-emerald-50"
                  title="Concluir tarefa"
                >
                  <CheckCircle2 size={16} />
                </button>
              </div>
            );
          })}
          {taskSummary.visible.length === 0 && (
            <EmptyState icon={CheckCircle2} title="Nenhuma tarefa" text="Nao existem tarefas pendentes neste filtro." compact />
          )}
        </div>
      </section>

      <section className="min-w-0 overflow-hidden rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <div className="min-w-0">
            <p className="text-[10px] font-black text-neutral-400 uppercase tracking-[0.22em]">Resumo</p>
            <h2 className="text-lg font-black text-neutral-950">Visitas de hoje</h2>
          </div>
          <Link to="/agenda" className="shrink-0 text-sm font-black text-orange-600">Ver agenda</Link>
        </div>
        <div className="space-y-2">
          {summary.todayVisits.slice(0, 6).map((visita, index) => (
            <div key={visita.id} className="flex min-w-0 items-center gap-3 rounded-lg border border-neutral-100 bg-neutral-50 px-3 py-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-neutral-200 bg-white text-xs font-black text-neutral-500">{index + 1}</div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-black text-neutral-950 truncate">{visita.cliente_nome}</p>
                <p className="text-xs font-bold text-neutral-400 truncate">{[visita.bairro, visita.cidade].filter(Boolean).join(' - ')}</p>
              </div>
              <span className={cn('shrink-0 rounded-full px-2 py-1 text-[10px] font-black uppercase', visita.status === 'concluida' ? 'bg-green-50 text-green-700' : 'bg-neutral-100 text-neutral-500')}>
                {statusLabel(visita.status)}
              </span>
            </div>
          ))}
          {summary.todayVisits.length === 0 && <EmptyState icon={MapIcon} title="Sem roteiro" text="Nao ha clientes programados para hoje." compact />}
        </div>
      </section>
    </div>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return <span className="rounded-full bg-neutral-100 px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-neutral-500">{children}</span>;
}

function MetricCard({ icon: Icon, label, value, detail, tone }: { icon: React.ElementType; label: string; value: string; detail: string; tone: 'orange' | 'green' | 'blue' | 'rose' }) {
  const toneClasses = {
    orange: 'bg-orange-50 text-orange-600',
    green: 'bg-emerald-50 text-emerald-600',
    blue: 'bg-blue-50 text-blue-600',
    rose: 'bg-rose-50 text-rose-600'
  };

  return (
    <div className="min-w-0 overflow-hidden rounded-lg border border-neutral-200 bg-white p-2.5 shadow-sm sm:p-4">
      <div className="flex min-w-0 items-center gap-2 sm:block">
        <div className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg sm:mb-3 sm:h-10 sm:w-10', toneClasses[tone])}>
          <Icon className="h-4 w-4 sm:h-[21px] sm:w-[21px]" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-[9px] font-black uppercase text-neutral-400 sm:text-[10px] sm:tracking-wider">{label}</p>
          <p className="truncate text-base font-black leading-tight text-neutral-950 sm:mt-1 sm:text-xl">{value}</p>
        </div>
      </div>
      <p className="mt-1.5 truncate text-[9px] font-bold leading-tight text-neutral-500 sm:mt-1 sm:text-xs">{detail}</p>
    </div>
  );
}

function InfoLine({ icon: Icon, text }: { icon: React.ElementType; text: string }) {
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-lg border border-neutral-100 bg-neutral-50 px-3 py-3">
      <Icon className="text-neutral-400 shrink-0" size={18} />
      <p className="min-w-0 break-words text-sm font-bold text-neutral-700">{text}</p>
    </div>
  );
}

function RiskCount({ label, value, tone }: { label: string; value: number; tone: 'rose' | 'orange' | 'sky' }) {
  const toneClasses = {
    rose: 'border-rose-100 bg-rose-50 text-rose-700',
    orange: 'border-orange-100 bg-orange-50 text-orange-700',
    sky: 'border-sky-100 bg-sky-50 text-sky-700'
  };

  return (
    <div className={cn('min-w-0 rounded-lg border px-2 py-1.5 text-center', toneClasses[tone])}>
      <p className="text-[9px] font-black uppercase leading-none truncate">{label}</p>
      <p className="mt-0.5 text-sm font-black leading-tight">{value}</p>
    </div>
  );
}

function EmptyState({ icon: Icon, title, text, compact = false }: { icon: React.ElementType; title: string; text: string; compact?: boolean }) {
  return (
    <div className={cn('text-center rounded-lg border border-dashed border-neutral-200 bg-neutral-50', compact ? 'p-4' : 'p-8')}>
      <Icon className="mx-auto text-neutral-300" size={compact ? 24 : 34} />
      <p className="mt-2 text-sm font-black text-neutral-800">{title}</p>
      <p className="mt-1 text-xs font-bold text-neutral-400">{text}</p>
    </div>
  );
}
