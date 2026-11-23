import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  descreverTabela, diasCorridos, faixaPorPeso, hojeSaoPaulo, normalizarDesconto,
  pesoJanela28, precoNaFaixa, tabelaDoCliente,
} from '../../supabase/functions/whatsapp-suggest/priceTable.ts';

// FN Pro 3x2,5kg: caixa com 3 unidades, preços como no cadastro.
const fnPro = {
  id: 'fn', produto: 'FN PRO CAES FILH MINI/PEQ 3X2,5KG', peso_embalagem: 7.5, quant_embalagem: 3,
  custo_total: 155.85, custo_und: 51.95, sugestao: 83.9,
  livre: 0, '200kg': 0.1, '500kg': 0.16, '1000kg': 0.18, '2000kg': 0.2, '4000kg': 0.22,
};
const saco15 = { id: 'mg', produto: 'MAGNUS TODO DIA 15KG', peso_embalagem: 15, quant_embalagem: 1, custo_total: 120, custo_und: 120, sugestao: 0, livre: 0, '500kg': 0.14 };
const produtos = [fnPro, saco15];
const venda = (faturamento: string, qtd: number, produto_id: string | null = 'mg', produtos: string | null = null) =>
  ({ faturamento, qtd, produto_id, produtos });

test('faixa por peso acumulado', () => {
  assert.equal(faixaPorPeso(199.9), 'livre');
  assert.equal(faixaPorPeso(200), '200kg');
  assert.equal(faixaPorPeso(500), '500kg');
  assert.equal(faixaPorPeso(4000), '4000kg');
});

test('janela de 28 dias corridos, como na tela de pedido', () => {
  assert.equal(diasCorridos('2026-10-26', '2026-11-23'), 28);
  const vendas = [venda('2026-10-26', 20), venda('2026-10-25', 100), venda('2026-11-24', 100)];
  // 28 dias entra; 29 dias e data futura não entram.
  assert.equal(pesoJanela28(vendas, produtos, '2026-11-23'), 300);
  // Produto encontrado pelo nome quando a linha não tem produto_id.
  assert.equal(pesoJanela28([venda('2026-11-20', 2, null, 'magnus todo dia 15kg')], produtos, '2026-11-23'), 30);
});

test('tabela ativa quando comprou o volume nos últimos 28 dias', () => {
  const t = tabelaDoCliente([venda('2026-11-10', 20), venda('2026-11-01', 14)], produtos, '2026-11-23');
  assert.equal(t.tipo, 'ativa');
  assert.equal(t.faixa, '500kg');
  assert.equal(t.pesoAtivo, 510);
  assert.match(descreverTabela(t), /^ativa \(faixa 500kg/);
});

test('sem tabela ativa usa a última tabela que o cliente teve', () => {
  const vendas = [venda('2026-09-20', 40), venda('2026-09-05', 30)];
  const t = tabelaDoCliente(vendas, produtos, '2026-11-23');
  assert.equal(t.tipo, 'ultima');
  assert.equal(t.faixa, '1000kg');
  assert.equal(t.dataUltima, '2026-09-20');
  assert.match(descreverTabela(t), /^ultima \(faixa 1000kg/);
});

test('compra pequena recente não apaga a última tabela conquistada', () => {
  // 600 kg há 40 dias, 45 kg há 5 dias: hoje está livre, a última tabela é a de 500 kg.
  const t = tabelaDoCliente([venda('2026-11-18', 3), venda('2026-10-14', 40)], produtos, '2026-11-23');
  assert.equal(t.tipo, 'ultima');
  assert.equal(t.faixa, '500kg');
  assert.equal(t.dataUltima, '2026-10-14');
});

test('cliente que nunca atingiu faixa fica na tabela livre', () => {
  assert.equal(tabelaDoCliente([venda('2026-11-01', 3)], produtos, '2026-11-23').tipo, 'livre');
  const vazio = tabelaDoCliente([], produtos, '2026-11-23');
  assert.equal(vazio.tipo, 'livre');
  assert.equal(vazio.faixa, 'livre');
});

test('preço informado é o da unidade, com desconto da faixa, e traz a sugestão de venda', () => {
  const p = precoNaFaixa(fnPro, '500kg');
  assert.equal(p.unidade, 43.64); // 51,95 x (1 - 16%)
  assert.equal(p.caixa, 130.91);
  assert.equal(p.sugestao, 83.9);
  assert.equal(precoNaFaixa(fnPro, 'livre').unidade, 51.95);
  assert.equal(precoNaFaixa(saco15, '500kg').sugestao, 0);
});

test('desconto aceita fração ou percentual', () => {
  assert.equal(normalizarDesconto(0.16), 0.16);
  assert.equal(normalizarDesconto(19), 0.19);
  assert.equal(normalizarDesconto(null), 0);
});

test('dia corrente em São Paulo', () => {
  assert.equal(hojeSaoPaulo(new Date('2026-11-24T02:59:00Z')), '2026-11-23');
  assert.equal(hojeSaoPaulo(new Date('2026-11-24T03:00:00Z')), '2026-11-24');
});
