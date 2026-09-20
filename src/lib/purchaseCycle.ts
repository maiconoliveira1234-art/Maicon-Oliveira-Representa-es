import { differenceInCalendarDays, format, isValid, parseISO, subMonths } from 'date-fns';
import { HistVenda } from '../types';
import { calcularCicloPonderado } from './calculations';
import { classifySaleRecord } from './salesClassifier';

/** Shared Próx. ped. calculation for Metas, Agenda and Home.
 * Positive gap = overdue; negative = days remaining; null = insufficient history.
 * Commercial bonuses replenish stock and count as consumption, as in Metas.
 */
export function getPurchaseCycle(sales: HistVenda[], today: Date) {
  const todayKey = format(today, 'yyyy-MM-dd');
  const cutoff = format(subMonths(today, 12), 'yyyy-MM-dd');
  const dates = new Set<string>();
  for (const sale of sales) {
    if (String(sale.id ?? '').startsWith('open_order_')) continue;
    if (!classifySaleRecord(sale).influenciaConsumo) continue;
    const key = typeof sale.faturamento === 'string' ? sale.faturamento.slice(0, 10) : '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || !isValid(parseISO(key)) || key < cutoff || key > todayKey) continue;
    dates.add(key);
  }
  const sortedDates = [...dates].sort();
  const lastDate = sortedDates.at(-1) || null;
  const elapsedDays = lastDate ? differenceInCalendarDays(today, parseISO(lastDate)) : 0;
  const cycleDays = calcularCicloPonderado(sortedDates);
  return {
    cycleDays,
    elapsedDays,
    gap: cycleDays > 0 ? elapsedDays - cycleDays : null,
    purchaseDays: sortedDates.length,
    lastDate
  };
}
