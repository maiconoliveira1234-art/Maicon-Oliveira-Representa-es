/** Distribui valor total em boletos de centavos inteiros; última parcela absorve o resíduo. */
export function distribuirFaturamentoEmParcelas(
  totalVendas: number,
  vencimentos: string[]
): Array<{ vencimento: string; valor: number }> {
  if (!Number.isFinite(totalVendas) || totalVendas <= 0 || vencimentos.length === 0) return [];
  const centavos = Math.round(totalVendas * 100);
  const base = Math.floor(centavos / vencimentos.length);
  return vencimentos.map((vencimento, index) => ({
    vencimento,
    valor: (index === vencimentos.length - 1
      ? centavos - base * (vencimentos.length - 1)
      : base) / 100
  }));
}
