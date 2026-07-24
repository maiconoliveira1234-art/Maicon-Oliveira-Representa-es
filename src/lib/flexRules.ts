export const FLEX_RATE_CHANGE_DATE = '2026-07-01';
export const FLEX_RATE_BEFORE_JULY_2026 = 0.02;
export const FLEX_RATE_FROM_JULY_2026 = 0.015;

export function getFlexRateForDate(date: string | Date): number {
  const dateKey = typeof date === 'string'
    ? date.slice(0, 10)
    : [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, '0'),
        String(date.getDate()).padStart(2, '0')
      ].join('-');

  return dateKey >= FLEX_RATE_CHANGE_DATE
    ? FLEX_RATE_FROM_JULY_2026
    : FLEX_RATE_BEFORE_JULY_2026;
}

export function formatFlexRate(rate: number): string {
  return `${(rate * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
}
