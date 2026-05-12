import { differenceInWeeks, parseISO, startOfYear } from 'date-fns';

/**
 * Calculates current cycle week (1 or 2) based on an anchor point.
 * We use the start of the year as anchor for a consistent 2-week rotation.
 */
export function getCurrentCycleWeek(): 1 | 2 {
  const now = new Date();
  const anchor = startOfYear(now);
  const weeksSinceAnchor = differenceInWeeks(now, anchor);
  return (weeksSinceAnchor % 2 === 0) ? 1 : 2;
}

export const DIAS_SEMANA = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta'];

export function getStatusColor(status: string) {
  switch (status) {
    case 'concluida': return 'bg-green-100 text-green-700 border-green-200';
    case 'pendente': return 'bg-orange-100 text-orange-700 border-orange-200';
    case 'reagendada': return 'bg-purple-100 text-purple-700 border-purple-200';
    case 'cancelada': return 'bg-red-100 text-red-700 border-red-200';
    default: return 'bg-neutral-100 text-neutral-700 border-neutral-200';
  }
}

export function formatPhoneNumber(phone: string) {
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.length === 11) {
    return `(${cleaned.substring(0, 2)}) ${cleaned.substring(2, 7)}-${cleaned.substring(7)}`;
  }
  return phone;
}
