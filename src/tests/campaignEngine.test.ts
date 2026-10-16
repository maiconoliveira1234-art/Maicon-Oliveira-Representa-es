import assert from 'node:assert/strict';
import { avaliarCampanhas, campanhaAtiva, descricaoDesconto, descontoValido } from '../lib/campaignEngine';
import { calcularPrecoDeCampanha } from '../lib/campaignPricing';
import type { Campanha, RegraCampanha } from '../lib/campaignEngine';
import type { Produto } from '../types';

const produto = {
  id: 'item-a', produto: 'Produto A', familia: 'Magnus', ativo: true,
  quant_embalagem: 1, peso_embalagem: 15,
} as Produto;
const rule: RegraCampanha = {
  id: 'rule-1', tipo: 'bonificacao', produto_ids: [produto.id],
  familia: '', minimo: 10, repetivel: true,
  bonus_produto_id: '', bonus_quantidade: 1, desconto_percentual: 0,
};
const campanha: Campanha = {
  id: 'campaign-1', titulo: '10 + 1', descricao: '', status: 'ativa',
  inicio: '2026-01-01', fim: '2027-12-31', imagem_data: null, regras: [rule],
};
const now = new Date(2026, 9, 16);

assert.equal(campanhaAtiva(campanha, now), true);
assert.equal(campanhaAtiva({ ...campanha, fim: '2026-09-30' }, now), false);
assert.equal(avaliarCampanhas([campanha], [{ produto_id: 'item-a', quantidade: 9, tipo_operacao: 'VENDA' }], [produto], now)[0].falta, 1);
assert.equal(avaliarCampanhas([campanha], [{ produto_id: 'item-a', quantidade: 10, tipo_operacao: 'VENDA' }], [produto], now)[0].bonusQuantidade, 1);
assert.equal(avaliarCampanhas([campanha], [{ produto_id: 'item-a', quantidade: 25, tipo_operacao: 'VENDA' }], [produto], now)[0].bonusQuantidade, 2);
assert.equal(avaliarCampanhas([campanha], [
  { produto_id: 'item-a', quantidade: 9, tipo_operacao: 'VENDA' },
  { produto_id: 'item-a', quantidade: 999, tipo_operacao: 'BONIFICACAO_COMERCIAL' },
], [produto], now)[0].bonusQuantidade, 0);
assert.equal(avaliarCampanhas([{ ...campanha, regras: [{ ...rule, tipo: 'desconto', minimo: 20, desconto_percentual: 5 }] }], [
  { produto_id: 'item-a', quantidade: 20, tipo_operacao: 'VENDA' },
], [produto], now)[0].descontoPercentual, 5);
assert.equal(avaliarCampanhas([{ ...campanha, regras: [{ ...rule, repetivel: false }] }], [
  { produto_id: 'item-a', quantidade: 40, tipo_operacao: 'VENDA' },
], [produto], now)[0].bonusQuantidade, 1);
const caixas = { ...produto, quant_embalagem: 10 } as Produto;
const unidadesRule = { ...rule, tipo: 'desconto' as const, minimo: 20, unidade: 'unidades' as const, desconto_percentual: 7 };
assert.equal(avaliarCampanhas([{ ...campanha, regras: [unidadesRule] }], [
  { produto_id: 'item-a', quantidade: 2, tipo_operacao: 'VENDA' }
], [caixas], now)[0].descontoPercentual, 7);
assert.equal(avaliarCampanhas([{ ...campanha, regras: [{ ...unidadesRule, unidade: 'embalagens' }] }], [
  { produto_id: 'item-a', quantidade: 2, tipo_operacao: 'VENDA' }
], [caixas], now)[0].descontoPercentual, 0);
const produtoCaixa = { ...produto, quant_embalagem: 10, custo_und: 10 } as Produto;
const tabelaUnitaria = 8; // Tabela de R$ 80/caixa, cheia de R$ 100/caixa.
const ofertas = [
  { ...rule, tipo: 'desconto' as const, desconto_modalidade: 'adicional_percentual' as const, desconto_percentual: 10 },
  { ...rule, tipo: 'desconto' as const, desconto_modalidade: 'absoluto_percentual' as const, desconto_percentual: 30 },
  { ...rule, tipo: 'desconto' as const, desconto_modalidade: 'valor' as const, desconto_valor: 12 },
  { ...rule, tipo: 'desconto' as const, desconto_modalidade: 'preco_final' as const, preco_final: 65 },
].map((r,i) => ({
  campanha, regra: { ...r, id: 'desconto-' + i },
  quantidade: 10, falta: 0, elegivel: true, bonusProdutoId: null,
  bonusQuantidade: 0, descontoPercentual: 0,
}));
const preco = (selected: typeof ofertas) => calcularPrecoDeCampanha(produtoCaixa, tabelaUnitaria, selected).valorEmbalagem;
assert.equal(preco([ofertas[0]]), 72);
assert.equal(preco([ofertas[1]]), 70);
assert.equal(preco([ofertas[2]]), 68);
assert.equal(preco([ofertas[3]]), 65);
assert.equal(preco(ofertas), 65); // não acumular descontos
assert.equal(preco([]), 80);
assert.equal(preco([{ ...ofertas[1], regra: { ...ofertas[1].regra, desconto_percentual: 5 } }]), 80); // tabela melhor
assert.equal(preco([{ ...ofertas[2], regra: { ...ofertas[2].regra, desconto_valor: 999 } }]), 0); // teto de desconto
assert.equal(preco([{ ...ofertas[3], elegivel: false }]), 80);
assert.equal(calcularPrecoDeCampanha({ ...produtoCaixa, id: 'outro' }, tabelaUnitaria, ofertas).valorEmbalagem, 80);
assert.equal(descontoValido({ ...ofertas[2].regra, desconto_valor: -5 }), false);
assert.equal(descontoValido({ ...ofertas[3].regra, preco_final: 0 }), false);
assert.equal(descontoValido({ ...ofertas[1].regra, desconto_percentual: 105 }), false);
assert.equal(descontoValido({ ...rule, tipo: 'desconto', desconto_percentual: 10 }), true);
assert.equal(descricaoDesconto(ofertas[2].regra).includes('desconto por embalagem'), true);
assert.equal(avaliarCampanhas([{ ...campanha, regras: [{ ...ofertas[3].regra, preco_final: 0 }] }], [{ produto_id: 'item-a', quantidade: 20 }], [produto], now)[0].elegivel, false);
console.log('Testes de campanhas: OK');
