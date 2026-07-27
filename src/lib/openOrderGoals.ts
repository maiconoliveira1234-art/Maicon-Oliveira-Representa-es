import { Produto } from '../types';

export type OpenOrderGoalRecord = {
  cliente_id: string;
  items: Array<{
    produto_id?: string;
    quantidade?: number;
    tipo_operacao?: string;
  }> | null;
};

export function calculateOpenOrderGoalWeights(
  openOrders: OpenOrderGoalRecord[],
  productsMap: Record<string, Produto>
) {
  const byClient: Record<string, number> = {};
  let total = 0;

  openOrders.forEach(order => {
    if (!Array.isArray(order.items)) return;

    order.items.forEach(item => {
      if (!item.produto_id || (item.tipo_operacao || 'VENDA') !== 'VENDA') return;
      const quantity = Number(item.quantidade) || 0;
      const packageWeight = Number(productsMap[item.produto_id]?.peso_embalagem) || 0;
      if (quantity <= 0 || packageWeight <= 0) return;

      const weight = quantity * packageWeight;
      byClient[order.cliente_id] = (byClient[order.cliente_id] || 0) + weight;
      total += weight;
    });
  });

  return { byClient, total };
}
