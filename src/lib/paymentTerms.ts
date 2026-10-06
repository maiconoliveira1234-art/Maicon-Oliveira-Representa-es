export interface PaymentRule {
  prazoInicial: number;
  prazoFinal: number;
  valorMinimo: number;
}

export const MINIMUM_ORDER_VALUE = 900;
export const MINIMUM_INSTALLMENT_VALUE = 450;

export const PAYMENT_RULES: PaymentRule[] = [
  { prazoInicial: 7, prazoFinal: 14, valorMinimo: MINIMUM_ORDER_VALUE },
  { prazoInicial: 7, prazoFinal: 21, valorMinimo: 1050 },
  { prazoInicial: 7, prazoFinal: 28, valorMinimo: 1400 },
  { prazoInicial: 7, prazoFinal: 35, valorMinimo: 1800 },
  { prazoInicial: 14, prazoFinal: 42, valorMinimo: 2500 },
  { prazoInicial: 14, prazoFinal: 49, valorMinimo: 3800 },
  { prazoInicial: 21, prazoFinal: 56, valorMinimo: 5000 },
  { prazoInicial: 21, prazoFinal: 63, valorMinimo: 8000 },
  { prazoInicial: 21, prazoFinal: 70, valorMinimo: 13000 },
  { prazoInicial: 21, prazoFinal: 77, valorMinimo: 17000 },
  { prazoInicial: 21, prazoFinal: 84, valorMinimo: 20000 },
  { prazoInicial: 21, prazoFinal: 91, valorMinimo: 25000 },
];

export function getAvailableTerms(totalValue: number): string[] {
  if (!Number.isFinite(totalValue) || totalValue < MINIMUM_ORDER_VALUE) return [];
  const available: string[] = ['À Vista'];
  const maxDay = PAYMENT_RULES.reduce(
    (max, rule) => totalValue >= rule.valorMinimo ? Math.max(max, rule.prazoFinal) : max,
    0,
  );
  // Work in cents so a rounded-up installment never hides one below the minimum.
  const totalCents = Math.round(totalValue * 100);
  const maxInstallments = Math.min(13, Math.floor(totalCents / (MINIMUM_INSTALLMENT_VALUE * 100)));

  // Generate sequences following the pattern: XX Boletos (YY-ZZ-...)
  // Starting days can be 07, 14, or 21
  for (let n = 1; n <= maxInstallments; n++) {
    for (const start of [7, 14, 21]) {
      const end = start + (n - 1) * 7;
      if (end <= maxDay) {
        const sequence: string[] = [];
        for (let i = 0; i < n; i++) {
          const day = start + i * 7;
          sequence.push(day.toString().padStart(2, '0'));
        }
        const label = n === 1 ? '01 Boleto' : `${n.toString().padStart(2, '0')} Boletos`;
        available.push(`${label} (${sequence.join('-')})`);
      }
    }
  }

  // Use a Set to avoid duplicates and return
  return Array.from(new Set(available));
}
