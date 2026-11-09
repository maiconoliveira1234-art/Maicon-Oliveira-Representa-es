import { scheduleVisits } from '../lib/visitSchedule';
import React, { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Loader2,
  Map as MapIcon,
  ClipboardCheck,
} from 'lucide-react';
import {
  differenceInWeeks,
  endOfMonth,
  format,
  isWithinInterval,
  parseISO,
  startOfMonth,
  startOfToday,
  startOfYear,
} from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { HistVenda, Produto } from '../types';
import { DiaSemana, Visita, VisitaStatus } from '../types/agenda';
import { cn, formatWeight } from '../lib/utils';
import { useAgendaPendencias } from '../hooks/useAgendaPendencias';
import { isAgendaPendenciaAtiva, sortAgendaPendencias } from '../lib/agendaPendencias';

import { useDataManager } from '../lib/dataManager';
import { CommercialPriorities } from '../components/CommercialPriorities';

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

export function HomePage({ afterHeader }: { afterHeader?: React.ReactNode } = {}) {
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
  const [showAllTasks, setShowAllTasks] = useState(false);
  const [data, setData] = useState<HomeData>({
    visitas: [],
    historico: [],
    produtos: [],
    metas: {},
    unscheduledClients: 0
  });
  const agendaPendencias = useAgendaPendencias();
  const { pendencias, updateStatus: updatePendenciaStatus } = agendaPendencias;

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

    const todayVisits = scheduleVisits(data.visitas.map(v => {
      const c = clientes.find(c => c.id === v.cliente_id);
      return {...v, latitude:c?.latitude ?? v.latitude, longitude:c?.longitude ?? v.longitude, cidade:c?.cidade || v.cidade};
    }), data.historico, today)
      .filter((visita) => visita.semana === currentWeek && visita.dia_semana === currentDay)
      .sort((a, b) => a.ordem_visita - b.ordem_visita);

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
    const loadLevel = targetWeight >= 5000 || todayVisits.length >= 10 ? 'Dia pesado' : targetWeight >= 2500 || todayVisits.length >= 7 ? 'Dia normal' : 'Dia leve';

    return {
      todayVisits,
      completedVisits,
      pendingVisits,
      targetWeight,
      realizedWeight,
      loadLevel,
      currentWeek,
      currentDay
    };
  }, [data, today, clientes]);

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
      urgent: all.filter((item) => Boolean(item.data_prevista && item.data_prevista <= todayKey)),
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


  const todayKey = format(today, 'yyyy-MM-dd');
  const formatMeta = (value: number) => formatWeight(Math.round(value)).replace(/,00 kg$/, ' kg');
  const visitCount = summary.todayVisits.length;
  const visibleTasks = showAllTasks ? taskSummary.visible : taskSummary.urgent.slice(0, 3);
  const tasksCounter = showAllTasks ? taskSummary.all.length : taskSummary.urgent.length;

  const renderTask = (item: (typeof taskSummary.all)[number]) => {
    const cliente = clientes.find((current) => current.id === item.cliente_id);
    const isOverdue = Boolean(item.data_prevista && item.data_prevista < todayKey);
    const dateLabel = !item.data_prevista
      ? 'Sem data'
      : item.data_prevista === todayKey
        ? 'Hoje'
        : format(parseISO(item.data_prevista), 'dd/MM/yyyy');
    return (
      <div key={'task-list-' + item.id} className={cn(
        'flex min-w-0 items-center gap-2 rounded-lg border px-2.5 py-2',
        isOverdue ? 'border-rose-100 bg-rose-50' : 'border-neutral-100 bg-neutral-50'
      )}>
        <ClipboardCheck size={17} className={cn('shrink-0', isOverdue ? 'text-rose-600' : 'text-sky-600')} />
        <Link to="/agenda" state={{ selectedDate: item.data_prevista || todayKey }} className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <p className="truncate text-sm font-black text-neutral-900">{item.titulo}</p>
            {item.prioridade !== 'NORMAL' && <span className={cn('shrink-0 text-[8px] font-black', item.prioridade === 'URGENTE' ? 'text-rose-600' : 'text-amber-600')}>{item.prioridade}</span>}
          </div>
          <p className={cn('truncate text-xs font-bold', isOverdue ? 'text-rose-600' : 'text-neutral-500')}>
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
  };

  return (
    <div className="mx-auto w-full max-w-6xl min-w-0 space-y-4 overflow-x-hidden">
      <section className="min-w-0 overflow-hidden rounded-lg border border-neutral-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <h1 className="break-words text-2xl font-black capitalize tracking-tight text-neutral-950 md:text-3xl">
              {format(today, "EEEE, d 'de' MMMM", { locale: ptBR })}
            </h1>
            <p className="mt-1 text-sm font-semibold text-neutral-500">
              {['Semana ' + summary.currentWeek, summary.currentDay || 'Sem roteiro', summary.loadLevel].filter(Boolean).join(' · ')}
            </p>
          </div>
          <Link to="/agenda" className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-orange-600 px-4 py-3 text-sm font-black text-white shadow-lg shadow-orange-600/20 transition-transform active:scale-95">
            Abrir Agenda
            <ArrowRight className="shrink-0" size={18} />
          </Link>
        </div>
      </section>

      {afterHeader}

      <CommercialPriorities agenda={agendaPendencias} />

      <section className="min-w-0 overflow-hidden rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
        <div className="mb-3 min-w-0">
          <h2 className="text-lg font-black text-neutral-950">Visitas de hoje</h2>
          <p className="mt-1 text-sm font-semibold text-neutral-500">
            {visitCount} {visitCount === 1 ? 'visita' : 'visitas'}
            {' · meta '}{formatMeta(summary.targetWeight)}
            {' · realizado '}{formatMeta(summary.realizedWeight)}
            {data.unscheduledClients > 0 ? ` · ${data.unscheduledClients} fora da agenda` : ''}
          </p>
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

      <section className="min-w-0 overflow-hidden rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex min-w-0 items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="truncate text-lg font-black text-neutral-950">{showAllTasks ? 'Tarefas pendentes' : 'Tarefas de hoje e atrasadas'}</h2>
            <span className="shrink-0 rounded-lg bg-sky-50 px-2 py-1 text-xs font-black text-sky-700">{tasksCounter}</span>
          </div>
          <button
            type="button"
            onClick={() => setShowAllTasks((current) => !current)}
            className="shrink-0 text-sm font-black text-orange-600"
          >
            {showAllTasks ? 'Mostrar menos' : `Ver todas (${taskSummary.all.length})`}
          </button>
        </div>

        {showAllTasks && (
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
                  'flex h-9 min-w-0 items-center justify-center gap-1 rounded-lg border px-1 text-xs font-black transition-colors',
                  taskFilter === value ? 'border-neutral-900 bg-neutral-900 text-white' : 'border-neutral-200 bg-white text-neutral-500 hover:bg-neutral-50',
                  value === 'SEM_DATA' && 'col-span-2 sm:col-span-1'
                )}
              >
                <span className="truncate">{label}</span>
                <span className={cn('shrink-0', taskFilter === value ? 'text-neutral-300' : 'text-neutral-400')}>{count}</span>
              </button>
            ))}
          </div>
        )}

        <div className={cn('space-y-1.5', showAllTasks && 'max-h-[360px] overflow-y-auto pr-0.5')}>
          {visibleTasks.map(renderTask)}
          {visibleTasks.length === 0 && (
            <EmptyState
              icon={CheckCircle2}
              title="Nenhuma tarefa"
              text={showAllTasks ? 'Nao existem tarefas pendentes neste filtro.' : 'Nenhuma tarefa atrasada ou para hoje.'}
              compact
            />
          )}
        </div>
      </section>
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
