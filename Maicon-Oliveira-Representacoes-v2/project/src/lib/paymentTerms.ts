export interface PaymentRule {
  prazoInicial: number;
  prazoFinal: number;
  valorMinimo: number;
}

export const PAYMENT_RULES: PaymentRule[] = [
  { prazoInicial: 7, prazoFinal: 14, valorMinimo: 700 },
  { prazoInicial: 7, prazoFinal: 21, valorMinimo: 1050 },
  { prazoInicial: 7, prazoFinal: 28, valorMinimo: 1400 },
  { prazoInicial: 7, prazoFinal: 35, valorMinimo: 1800 },
  { prazoInicial: 14, prazoFinal: 42, valorMinimo: 2600 },
  { prazoInicial: 14, prazoFinal: 49, valorMinimo: 3800 },
  { prazoInicial: 21, prazoFinal: 56, valorMinimo: 5000 },
  { prazoInicial: 21, prazoFinal: 63, valorMinimo: 8000 },
  { prazoInicial: 21, prazoFinal: 70, valorMinimo: 13000 },
  { prazoInicial: 21, prazoFinal: 77, valorMinimo: 17000 },
  { prazoInicial: 21, prazoFinal: 84, valorMinimo: 20000 },
  { prazoInicial: 21, prazoFinal: 91, valorMinimo: 25000 },
];

export function getAvailableTerms(totalValue: number): string[] {
  const available: string[] = ['À Vista'];
  
  // Find max day based on the rules
  let maxDay = 0;
  if (totalValue >= 700) maxDay = 14;
  if (totalValue >= 1050) maxDay = 21;
  if (totalValue >= 1400) maxDay = 28;
  if (totalValue >= 1800) maxDay = 35;
  if (totalValue >= 2600) maxDay = 42;
  if (totalValue >= 3800) maxDay = 49;
  if (totalValue >= 5000) maxDay = 56;
  if (totalValue >= 8000) maxDay = 63;
  if (totalValue >= 13000) maxDay = 70;
  if (totalValue >= 17000) maxDay = 77;
  if (totalValue >= 20000) maxDay = 84;
  if (totalValue >= 25000) maxDay = 91;

  if (totalValue > 0 && maxDay === 0) maxDay = 7;

  // Generate sequences following the pattern: XX Boletos (YY-ZZ-...)
  // Starting days can be 07, 14, or 21
  for (let n = 1; n <= 13; n++) {
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
