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

/** Uniformiza algumas grafias usuais para ampliar a busca no catálogo. */
function matchText(value: string): string {
  return normalizeSkuSearch(value)
    .replace(/\b(\d+)\s+kg\b/g, '$1kg')
    .replace(/\b(caes|cao|cachorros?|caninos?)\b/g, 'cao')
    .replace(/\b(gatos?|felinos?)\b/g, 'gato')
    .replace(/\b(filhotes?|filh)\b/g, 'filhote');
}

export function filterCampaignSkus(
  products: Produto[],
  query: string,
  maxResults = 20,
): { results: Produto[]; total: number } {
  const input = matchText(query);
  const terms = input.split(' ').filter(Boolean);
  const matched = products.filter(product => {
    if (!product.ativo) return false;
    const haystack = matchText((product.produto || '') + ' ' + (product.familia || ''));
    return terms.every(term => haystack.includes(term));
  });

  matched.sort((a, b) => {
    const aName = matchText(a.produto);
    const bName = matchText(b.produto);
    const rank = (name: string) => !input ? 0
      : name === input ? 0
      : name.startsWith(input) ? 1
      : name.includes(input) ? 2 : 3;
    return rank(aName) - rank(bName) ||
      a.produto.localeCompare(b.produto, 'pt-BR', { sensitivity: 'base' });
  });

  return { results: matched.slice(0, Math.max(1, maxResults)), total: matched.length };
}
