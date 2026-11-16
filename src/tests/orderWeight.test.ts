import { describe, it, expect } from 'vitest';
import { pesoTotalItensVenda, pesoTotalMapaVenda } from '../lib/orderWeight';

const produtos = {
  a: { peso_embalagem: 15 },
  b: { peso_embalagem: 10.1 },
  c: { peso_embalagem: 20 },
};

describe('peso total do pedido', () => {
  it('mapa e lista dão o mesmo total, inclusive com produto fora da lista filtrada', () => {
    const mapa = { a: 100, b: 3, c: 0 };
    const lista = [
      { produto_id: 'a', quantidade: 100, tipo_operacao: 'VENDA' },
      { produto_id: 'b', quantidade: 3 },
    ];
    expect(pesoTotalMapaVenda(mapa, produtos)).toBe(1530.3);
    expect(pesoTotalItensVenda(lista, produtos)).toBe(1530.3);
  });
  it('ignora bonificação, brinde, quantidade zero e produto desconhecido', () => {
    const lista = [
      { produto_id: 'a', quantidade: 2, tipo_operacao: 'VENDA' },
      { produto_id: 'c', quantidade: 5, tipo_operacao: 'BONIFICACAO_COMERCIAL' },
      { produto_id: 'c', quantidade: 5, tipo_operacao: 'MERCHANDISING' },
      { produto_id: 'b', quantidade: 0 },
      { produto_id: 'x', quantidade: 9 },
    ];
    expect(pesoTotalItensVenda(lista, new Map(Object.entries(produtos)))).toBe(30);
  });
});
