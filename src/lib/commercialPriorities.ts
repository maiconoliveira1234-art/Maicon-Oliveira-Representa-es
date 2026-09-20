import { differenceInCalendarDays, format, parseISO } from 'date-fns';
import { getPurchaseCycle } from './purchaseCycle';
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
  const historyByClient = new Map<string, HistVenda[]>();
  for (const sale of historico) {
    if (!historyByClient.has(sale.cliente_id)) historyByClient.set(sale.cliente_id, []);
    historyByClient.get(sale.cliente_id)!.push(sale);
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
    const cycle = getPurchaseCycle(historyByClient.get(cliente.id) || [], today);
    // Same positive Próx. ped. shown in Metas. No extra grace period.
    if (cycle.gap === null || cycle.gap <= 0) continue;
    result.push({ cliente, kind: 'RECOMPRA', overdueDays: cycle.gap, relativeDelay: cycle.gap / cycle.cycleDays,
      reason: `Próx. ped.: +${cycle.gap} dias. Ciclo ponderado de ${cycle.cycleDays} dias; há ${cycle.elapsedDays} dias sem reposição. Base: ${cycle.purchaseDays} dias de reposição nos últimos 12 meses.`,
      action: 'Conferir estoque dos itens habituais e avaliar reposição.' });
  }
  return result.sort((a, b) => Number(b.kind === 'RETORNO') - Number(a.kind === 'RETORNO')
    || (a.kind === 'RETORNO' ? b.overdueDays - a.overdueDays : b.relativeDelay - a.relativeDelay)
    || b.overdueDays - a.overdueDays || a.cliente.cliente.localeCompare(b.cliente.cliente)
    || a.cliente.id.localeCompare(b.cliente.id));
}
