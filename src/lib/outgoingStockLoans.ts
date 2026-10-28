import type { Emprestimo } from '../types';

export function outgoingStockLoans(loans: Emprestimo[], clientId?: string) {
  const byProduct = new Map<string, { quantidade: number; emprestimos: Emprestimo[] }>();
  if (!clientId) return byProduct;
  for (const loan of loans) {
    const quantity = Number(loan.quantidade);
    if (loan.cliente_origem_id !== clientId || loan.status !== 'pendente' ||
        !loan.produto_id || !Number.isFinite(quantity) || quantity <= 0) continue;
    const entry = byProduct.get(loan.produto_id) || { quantidade: 0, emprestimos: [] };
    entry.quantidade += quantity;
    entry.emprestimos.push(loan);
    byProduct.set(loan.produto_id, entry);
  }
  return byProduct;
}
