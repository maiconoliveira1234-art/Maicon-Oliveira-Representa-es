export function orderQuoteItems<T extends { produto_id?: string; tipo_operacao?: string }>(
  items: T[], products: { id: string; produto: string }[]
): T[] {
  const names = new Map(products.map(p => [p.id, p.produto]));
  return [...items].sort((a, b) => {
    const bonusOrder = Number(a.tipo_operacao === 'BONIFICACAO_COMERCIAL') -
      Number(b.tipo_operacao === 'BONIFICACAO_COMERCIAL');
    return bonusOrder || (names.get(a.produto_id || '') || '').localeCompare(names.get(b.produto_id || '') || '', 'pt-BR');
  });
}
