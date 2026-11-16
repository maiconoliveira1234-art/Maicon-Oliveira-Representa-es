// Regra unica do peso total de um pedido. Todas as telas (contagem, pedido,
// ficha do cliente) devem usar estas funcoes para mostrar o mesmo numero.
// Conta apenas itens de VENDA com quantidade > 0: bonificacao e brindes nao
// entram no peso que define a faixa de preco.
type WithWeight = { peso_embalagem?: number | null };
type Lookup = Record<string, WithWeight | undefined> | Map<string, WithWeight>;

const find = (lookup: Lookup, id: string): WithWeight | undefined =>
  lookup instanceof Map ? lookup.get(id) : lookup[id];

const round3 = (n: number) => Math.round(n * 1000) / 1000;

export function pesoLinha(quantidade: unknown, produto?: WithWeight | null): number {
  const qty = Number(quantidade) || 0;
  if (qty <= 0 || !produto) return 0;
  return qty * (Number(produto.peso_embalagem) || 0);
}

/** Pedido na forma de lista de itens (rascunho salvo, tela do pedido). */
export function pesoTotalItensVenda(
  items: Array<{ produto_id?: string; quantidade?: unknown; tipo_operacao?: string }>,
  produtos: Lookup,
): number {
  return round3(items.reduce((acc, item) => {
    if (item.tipo_operacao && item.tipo_operacao !== 'VENDA') return acc;
    return acc + pesoLinha(item.quantidade, find(produtos, item.produto_id || ''));
  }, 0));
}

/** Pedido na forma produto_id -> quantidade (tela de contagem). */
export function pesoTotalMapaVenda(pedidoMap: Record<string, number>, produtos: Lookup): number {
  return round3(Object.entries(pedidoMap).reduce(
    (acc, [id, qty]) => acc + pesoLinha(qty, find(produtos, id)), 0));
}
