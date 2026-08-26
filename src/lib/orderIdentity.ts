import { HistVenda } from '../types';

export function getSalesOrderIdentity(sale: HistVenda): string {
  const canonicalPedidoId = sale.pedido_id?.trim();
  if (canonicalPedidoId) {
    return canonicalPedidoId;
  }
  const orderNumber = sale.numero_pedido_erp?.trim();
  if (orderNumber) {
    return `${sale.cliente_id}-erp-${orderNumber}`;
  }
  return `${sale.cliente_id}-data-${(sale.faturamento || '').slice(0, 10)}`;
}

