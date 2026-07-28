import { EstoqueCliente } from '../types';

export type StockCountPayload = Pick<
  EstoqueCliente,
  'cliente_id' | 'produto_id' | 'quantidade_atual' | 'ultima_contagem'
>;

export function getLocalDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function buildStockCountPayload(
  clienteId: string,
  items: Array<Partial<EstoqueCliente> & { produto_id: string }>
): StockCountPayload[] {
  const today = getLocalDateKey();
  return items.map(item => ({
    cliente_id: clienteId,
    produto_id: item.produto_id,
    quantidade_atual: Number(item.quantidade_atual) || 0,
    ultima_contagem: item.ultima_contagem || today
  }));
}

export function mergeStockCountRecords(
  current: EstoqueCliente[],
  clienteId: string,
  confirmed: EstoqueCliente[]
) {
  const updatedProducts = new Set(confirmed.map(item => item.produto_id));
  return [
    ...current.filter(item =>
      item.cliente_id !== clienteId || !updatedProducts.has(item.produto_id)
    ),
    ...confirmed
  ];
}

export function isStockCountFullyConfirmed(
  sent: StockCountPayload[],
  confirmed: EstoqueCliente[]
) {
  const confirmedByProduct = new Map(confirmed.map(item => [item.produto_id, item]));
  return sent.every(item => {
    const saved = confirmedByProduct.get(item.produto_id);
    return saved
      && Number(saved.quantidade_atual) === Number(item.quantidade_atual)
      && saved.ultima_contagem === item.ultima_contagem;
  });
}
