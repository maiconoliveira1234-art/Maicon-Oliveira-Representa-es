import { differenceInCalendarDays, format, isValid, parseISO, subMonths } from 'date-fns';
import { Cliente, HistVenda } from '../types';
import { AgendaPendencia } from '../types/agendaPendencia';
import { isAgendaPendenciaAtiva } from './agendaPendencias';

// Use the existing task schema; these explicit titles distinguish commercial
// follow-ups from unrelated client tasks. No inference from free-form notes.
export const COMMERCIAL_RETURN_TITLE = 'Retorno comercial';
export const COMMERCIAL_REVIEW_TITLE = 'Reavaliar recompra';
export const isCommercialFollowUp = (item: AgendaPendencia) =>
  item.tipo === 'TAREFA' && [COMMERCIAL_RETURN_TITLE, COMMERCIAL_REVIEW_TITLE].includes(item.titulo);

export type CommercialPriority = {
  cliente: Cliente;
  kind: 'RETORNO' | 'RECOMPRA';
  reason: string;
  action: string;
  overdueDays: number;
  relativeDelay: number;
  followUp?: AgendaPendencia;
};

export function buildCommercialPriorities({ clientes, historico, pendencias, openClientIds, today }: {
  clientes: Cliente[];
  historico: HistVenda[];
  pendencias: AgendaPendencia[];
  // null means we could not verify open orders: do not invent repurchase alerts.
  openClientIds: Set<string> | null;
  today: Date;
}): CommercialPriority[] {
  const todayKey = format(today, 'yyyy-MM-dd');
  const cutoff = format(subMonths(today, 12), 'yyyy-MM-dd');
  const daysByClient = new Map<string, Set<string>>();
  for (const sale of historico) {
    // Strict sale type: unknown operations, gifts, returns and draft orders
    // cannot establish an actual buying cycle.
    if (sale.vendas?.trim().toUpperCase() !== 'VENDAS' || !(Number(sale.qtd) > 0)
      || !(Number(sale['r$_total']) > 0) || String(sale.id ?? '').startsWith('open_order_')) continue;
    const key = sale.faturamento?.slice(0, 10);
    if (!key || !isValid(parseISO(key)) || key < cutoff || key > todayKey) continue;
    if (!daysByClient.has(sale.cliente_id)) daysByClient.set(sale.cliente_id, new Set());
    daysByClient.get(sale.cliente_id)!.add(key);
  }
  const followUpsByClient = new Map<string, AgendaPendencia[]>();
  for (const item of pendencias) {
    if (!item.cliente_id || !isCommercialFollowUp(item)) continue;
    if (!followUpsByClient.has(item.cliente_id)) followUpsByClient.set(item.cliente_id, []);
    followUpsByClient.get(item.cliente_id)!.push(item);
  }
  const result: CommercialPriority[] = [];
  for (const cliente of clientes) {
    if (cliente.ativo === false) continue;
    const followUps = followUpsByClient.get(cliente.id) || [];
    const active = followUps.filter(isAgendaPendenciaAtiva);
    const due = active.filter(p => p.data_prevista && p.data_prevista <= todayKey)
      .sort((a, b) => a.data_prevista!.localeCompare(b.data_prevista!) || a.id.localeCompare(b.id))[0];
    if (due) {
      result.push({ cliente, kind: 'RETORNO', followUp: due,
        reason: `${due.titulo} previsto para ${format(parseISO(due.data_prevista!), 'dd/MM/yyyy')}.`,
        action: due.descricao || 'Retomar o contato combinado e registrar o resultado.',
        overdueDays: differenceInCalendarDays(today, parseISO(due.data_prevista!)), relativeDelay: 0 });
      continue;
    }
    // Respect a future agreement, and do not repeat an action completed today.
    if (active.some(p => p.data_prevista && p.data_prevista > todayKey)
      || followUps.some(p => p.status === 'CONCLUIDA' && p.concluida_em
        && format(parseISO(p.concluida_em), 'yyyy-MM-dd') === todayKey)) continue;
    if (!openClientIds || openClientIds.has(cliente.id)) continue;
    const dates = [...(daysByClient.get(cliente.id) || [])].sort().slice(-7);
    if (dates.length < 3) continue;
    const cycle = Math.max(1, Math.round(differenceInCalendarDays(parseISO(dates.at(-1)!), parseISO(dates[0])) / (dates.length - 1)));
    const elapsed = differenceInCalendarDays(today, parseISO(dates.at(-1)!));
    const overdueDays = elapsed - cycle;
    // A small tolerance avoids noisy alerts for normal day-to-day variation.
    if (overdueDays < Math.max(3, Math.ceil(cycle * 0.2))) continue;
    result.push({ cliente, kind: 'RECOMPRA', overdueDays, relativeDelay: overdueDays / cycle,
      reason: `Intervalo médio de ${cycle} dias; há ${elapsed} dias sem compra. Base: ${dates.length} dias de compra nos últimos 12 meses.`,
      action: 'Conferir estoque dos itens habituais e avaliar reposição.' });
  }
  return result.sort((a, b) => Number(b.kind === 'RETORNO') - Number(a.kind === 'RETORNO')
    || (a.kind === 'RETORNO' ? b.overdueDays - a.overdueDays : b.relativeDelay - a.relativeDelay)
    || b.overdueDays - a.overdueDays || a.cliente.cliente.localeCompare(b.cliente.cliente)
    || a.cliente.id.localeCompare(b.cliente.id));
}
