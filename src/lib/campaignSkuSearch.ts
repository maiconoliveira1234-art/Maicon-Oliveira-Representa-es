import type { Produto } from '../types';

/** Busca por palavras em qualquer ordem, ignorando acentos e diferenças de caixa. */
export function normalizeSkuSearch(value: string): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function filterCampaignSkus(
  products: Produto[],
  query: string,
  maxResults = 20,
): { results: Produto[]; total: number } {
  const input = normalizeSkuSearch(query);
  const terms = input.split(' ').filter(Boolean);
  const matched = products.filter(product => {
    if (!product.ativo) return false;
    const haystack = normalizeSkuSearch((product.produto || '') + ' ' + (product.familia || ''));
    return terms.every(term => haystack.includes(term));
  });

  matched.sort((a, b) => {
    const aName = normalizeSkuSearch(a.produto);
    const bName = normalizeSkuSearch(b.produto);
    const rank = (name: string) => !input ? 0
      : name === input ? 0
      : name.startsWith(input) ? 1
      : name.includes(input) ? 2 : 3;
    return rank(aName) - rank(bName) ||
      a.produto.localeCompare(b.produto, 'pt-BR', { sensitivity: 'base' });
  });

  return { results: matched.slice(0, Math.max(1, maxResults)), total: matched.length };
}
