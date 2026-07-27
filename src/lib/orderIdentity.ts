import { HistVenda } from '../types';

type SaleWithOrderNumber = HistVenda & {
  numero_pedido_erp?: string;
};

export function getSalesOrderIdentity(sale: HistVenda) {
  const orderNumber = (sale as SaleWithOrderNumber).numero_pedido_erp?.trim();
  if (orderNumber) return `${sale.cliente_id}-erp-${orderNumber}`;
  return `${sale.cliente_id}-data-${sale.faturamento.slice(0, 10)}`;
}
