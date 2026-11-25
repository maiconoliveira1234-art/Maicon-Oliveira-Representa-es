import type { Produto } from '../types';

export type PrecoRegistrado = { valor_unitario?: number; xdt?: number };

const arredondar = (n: number, casas: number) => {
  const fator = 10 ** casas;
  return Math.round((n + Number.EPSILON) * fator) / fator;
};

/**
 * Preço por unidade e desconto efetivo (%) sobre o preço de tabela, como
 * aparecem no pedido no momento em que ele é salvo. Ficam só no banco, para
 * lançar o pedido no ERP com o mesmo desconto; não são exibidos na tela nem
 * no PDF enviado ao cliente.
 */
export function registrarPreco(
  produto: Pick<Produto, 'custo_und'> | undefined,
  valorUnitario: unknown,
): PrecoRegistrado {
  const unitario = Number(valorUnitario);
  const tabela = Number(produto?.custo_und);
  if (!Number.isFinite(unitario) || unitario <= 0 || !Number.isFinite(tabela) || tabela <= 0) return {};
  const desconto = Math.min(100, Math.max(0, (1 - unitario / tabela) * 100));
  return { valor_unitario: arredondar(unitario, 4), xdt: arredondar(desconto, 2) };
}
