import assert from 'node:assert/strict';
import { avaliarCampanhas, campanhaAtiva } from '../lib/campaignEngine';
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
console.log('Testes de campanhas: OK');
