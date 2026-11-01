export type SaldoCredito = {
  limite: number;
  disponivel_oficial: number;
  disponivel_estimado: number;
  reservas_total: number;
};

export type ResultadoLimiteCredito = {
  situacao: 'sem_valor' | 'avista' | 'insuficiente' | 'atencao' | 'suficiente';
  disponivelConservador: number;
  disponivelProjetado: number;
  excesso: number;
};

export function avaliarLimiteCredito(
  valorPedido: number,
  saldo: SaldoCredito,
  prazo: string
): ResultadoLimiteCredito {
  const limite = Math.max(0, Number(saldo.limite) || 0);
  const reservas = Math.max(0, Number(saldo.reservas_total) || 0);
  const conservador = Math.max(0, Math.min(limite, Number(saldo.disponivel_oficial) - reservas || 0));
  const projetado = Math.max(0, Math.min(limite, Number(saldo.disponivel_estimado) || 0));
  const valorCentavos = Math.round((Number(valorPedido) || 0) * 100);
  const excessoCentavos = Math.max(0, valorCentavos - Math.round(projetado * 100));
  const situacao = valorCentavos <= 0
    ? 'sem_valor'
    : prazo === 'À Vista'
      ? 'avista'
      : excessoCentavos > 0
        ? 'insuficiente'
        : valorCentavos > Math.round(conservador * 100)
          ? 'atencao'
          : 'suficiente';

  return {
    situacao,
    disponivelConservador: conservador,
    disponivelProjetado: projetado,
    excesso: excessoCentavos / 100
  };
}
