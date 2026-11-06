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

/** Semana de segunda a domingo: sábado da semana seguinte + prazo em dias. */
export function calcularVencimentosW(dataFaturamento: string, prazos: number[]) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dataFaturamento)) return [];
  const base = new Date(dataFaturamento + 'T12:00:00Z');
  if (Number.isNaN(base.getTime()) || base.toISOString().slice(0, 10) !== dataFaturamento ||
      prazos.some(p => !Number.isInteger(p) || p < 1 || p > 365)) return [];
  const segundaZero = (base.getUTCDay() + 6) % 7;
  base.setUTCDate(base.getUTCDate() + 12 - segundaZero);
  return prazos.map(prazo => {
    const vencimento = new Date(base);
    vencimento.setUTCDate(vencimento.getUTCDate() + prazo);
    return { prazo, vencimento: vencimento.toISOString().slice(0, 10) };
  });
}

