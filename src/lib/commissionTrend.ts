import { addDays, endOfMonth, startOfMonth, subMonths } from 'date-fns';

export type CommissionTrendEntry = {
  date: string;
  commission: number;
};

function isBusinessDay(date: Date) {
  const day = date.getDay();
  return day !== 0 && day !== 6;
}

function countBusinessDays(start: Date, end: Date) {
  let count = 0;
  for (let date = start; date <= end; date = addDays(date, 1)) {
    if (isBusinessDay(date)) count += 1;
  }
  return count;
}

function endOfBusinessDayOrdinal(monthStart: Date, ordinal: number) {
  const monthEnd = endOfMonth(monthStart);
  let count = 0;
  let lastBusinessDay = monthStart;

  for (let date = monthStart; date <= monthEnd; date = addDays(date, 1)) {
    if (!isBusinessDay(date)) continue;
    count += 1;
    lastBusinessDay = date;
    if (count >= ordinal) return date;
  }

  return lastBusinessDay;
}

function localDate(value: string) {
  return new Date(`${value.slice(0, 10)}T12:00:00`);
}

export function calculateCommissionTrend(
  currentCommission: number,
  entries: CommissionTrendEntry[],
  selectedMonth: Date,
  deadline: Date,
  today = new Date()
) {
  const start = startOfMonth(selectedMonth);
  const end = deadline < endOfMonth(selectedMonth) ? deadline : endOfMonth(selectedMonth);

  if (today < start || today >= end) return currentCommission;

  const elapsedBusinessDays = Math.max(1, countBusinessDays(start, today));
  const totalBusinessDays = Math.max(1, countBusinessDays(start, end));
  const progress = Math.min(1, elapsedBusinessDays / totalBusinessDays);
  const currentPaceProjection = currentCommission * (totalBusinessDays / elapsedBusinessDays);

  const historicalShares = Array.from({ length: 8 }, (_, index) => {
    const monthsAgo = index + 1;
    const historicalStart = startOfMonth(subMonths(start, monthsAgo));
    const historicalEnd = endOfMonth(historicalStart);
    const cutoff = endOfBusinessDayOrdinal(historicalStart, elapsedBusinessDays);
    const monthEntries = entries.filter(entry => {
      const date = localDate(entry.date);
      return date >= historicalStart && date <= historicalEnd;
    });
    const total = monthEntries.reduce((sum, entry) => sum + entry.commission, 0);
    if (total <= 0) return null;

    const accumulated = monthEntries.reduce((sum, entry) => {
      return localDate(entry.date) <= cutoff ? sum + entry.commission : sum;
    }, 0);
    const share = accumulated / total;
    return share > 0 ? { share, monthsAgo } : null;
  }).filter((value): value is { share: number; monthsAgo: number } => value !== null);

  let balancedShares = historicalShares;
  if (historicalShares.length === 8) {
    const lowest = historicalShares.reduce((a, b) => a.share <= b.share ? a : b);
    const highest = historicalShares.reduce((a, b) => a.share >= b.share ? a : b);
    balancedShares = historicalShares.filter(item => item !== lowest && item !== highest);
  }

  if (balancedShares.length < 4) return currentPaceProjection;

  const weightedShare = balancedShares.reduce((sum, item) => {
    const weight = 9 - item.monthsAgo;
    return sum + item.share * weight;
  }, 0) / balancedShares.reduce((sum, item) => sum + (9 - item.monthsAgo), 0);

  const historicalProjection = weightedShare > 0
    ? currentCommission / weightedShare
    : currentPaceProjection;
  const historicalWeight = progress <= 1 / 3 ? 0.7 : progress <= 2 / 3 ? 0.5 : 0.3;

  return (historicalProjection * historicalWeight)
    + (currentPaceProjection * (1 - historicalWeight));
}
