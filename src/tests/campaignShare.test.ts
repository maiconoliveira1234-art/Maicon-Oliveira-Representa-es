import assert from 'node:assert/strict';
import { mensagemCampanha } from '../lib/campaignShare';
import type { Campanha, RegraCampanha } from '../lib/campaignEngine';
import type { Produto } from '../types';

// Mesmos cadastros do teste de tabela da IA do WhatsApp.
const fnPro = {
  id: 'fn', produto: 'FN PRO CAES FILH MINI/PEQ 3X2,5KG', familia: 'Formula Natural Pro', ativo: true,
  peso_embalagem: 7.5, quant_embalagem: 3, custo_total: 155.85, custo_und: 51.95, sugestao: 83.9,
  livre: 0, '200kg': 0.1, '500kg': 0.16, '1000kg': 0.18, '2000kg': 0.2, '4000kg': 0.22,
} as unknown as Produto;
const magnus = {
  id: 'mg', produto: 'MAGNUS TODO DIA 15KG', familia: 'Magnus', ativo: true,
  peso_embalagem: 15, quant_embalagem: 1, custo_total: 120, custo_und: 120, sugestao: 0,
  livre: 0, '200kg': 0.08, '500kg': 0.14, '1000kg': 0.16, '2000kg': 0.18, '4000kg': 0.2,
} as unknown as Produto;
const magnusGato = { ...magnus, id: 'mgg', produto: 'MAGNUS GATOS 10,1KG', peso_embalagem: 10.1, custo_und: 110, custo_total: 110 } as Produto;
const produtos = [fnPro, magnus, magnusGato];

const regra = (r: Partial<RegraCampanha>): RegraCampanha => ({
  id: 'r1', tipo: 'bonificacao', produto_ids: [], familia: '', minimo: 10, unidade: 'embalagens',
  repetivel: true, bonus_produto_id: '', bonus_quantidade: 1, desconto_percentual: 0, ...r,
});
const campanha = (regras: RegraCampanha[], extra: Partial<Campanha> = {}): Campanha => ({
  id: 'c1', titulo: 'Leve 10 ganhe 1', descricao: '', status: 'ativa',
  inicio: '2026-11-01', fim: '2026-12-31', imagem_data: null, regras, ...extra,
});
const manha = new Date('2026-11-24T11:00:00Z'); // 08:00 em São Paulo

// Bonificação do mesmo SKU: investimento, valor bonificado, preço efetivo e desconto equivalente.
const bonif = mensagemCampanha(campanha([regra({ produto_ids: ['fn'] })]), produtos,
  { faixa: 'livre', nomeCliente: 'Ana', agora: manha });
assert.match(bonif.texto, /^Bom dia, Ana! Tudo bem\?/);
assert.match(bonif.texto, /\*Leve 10 ganhe 1\*\nVálida até 31\/12\/2026\./);
assert.match(bonif.texto, /na compra de 10 caixas de FN PRO CAES FILH MINI\/PEQ 3X2,5KG, você ganha 1 caixa \(3 unidades\) do mesmo produto\. A bonificação se repete a cada 10 caixas\./);
assert.match(bonif.texto, /\*Investimento:\* R\$ 1\.558,50 em 10 caixas \(30 unidades\), a R\$ 51,95 a unidade, na tabela livre\./);
assert.match(bonif.texto, /\*Benefício:\* 1 caixa \(3 unidades\) de bonificação, no valor de R\$ 155,85\. Na prática, cada unidade sai a R\$ 47,23, o equivalente a 9,1% de desconto\./);
assert.match(bonif.texto, /Quer que eu já monte o seu pedido\?$/);
assert.deepEqual(bonif.avisos, []);

// A tabela do cliente vale quando é maior que a do pedido mínimo.
const tabela200 = mensagemCampanha(campanha([regra({ produto_ids: ['fn'] })]), produtos, { faixa: '200kg', agora: manha });
assert.match(tabela200.texto, /^Bom dia! Tudo bem\?/);
assert.match(tabela200.texto, /R\$ 46,76 a unidade, na tabela 200 kg/);

// Desconto: o próprio pedido mínimo (40 x 15 kg = 600 kg) garante a tabela 500 kg.
const desc = mensagemCampanha(campanha([regra({ tipo: 'desconto', produto_ids: ['mg'], minimo: 40, desconto_percentual: 5 })]),
  produtos, { faixa: 'livre', agora: manha });
assert.match(desc.texto, /comprando a partir de 40 unidades de MAGNUS TODO DIA 15KG, você tem 5% de desconto adicional sobre a sua tabela\./);
assert.match(desc.texto, /\*Investimento:\* R\$ 3\.921,60 em 40 unidades, a R\$ 98,04 a unidade, na tabela 500 kg\./);
assert.match(desc.texto, /\*Benefício:\* economia de R\$ 206,40 no pedido mínimo; a unidade passa de R\$ 103,20 para R\$ 98,04\./);

// Preço final por caixa vira preço da unidade; campanha pior que a tabela gera aviso e não mostra benefício.
const final = mensagemCampanha(campanha([regra({ tipo: 'desconto', desconto_modalidade: 'preco_final', preco_final: 150, produto_ids: ['fn'] })]),
  produtos, { faixa: '500kg', agora: manha });
assert.match(final.texto, /preço especial de R\$ 50,00 a unidade/);
assert.doesNotMatch(final.texto, /Benefício/);
assert.equal(final.avisos.some(a => a.includes('não reduz o preço')), true);

// Grupo com vários SKUs: lista os preços, investimento "a partir de" e intervalo do desconto equivalente.
const grupo = mensagemCampanha(campanha([
  regra({ produto_ids: ['mg', 'mgg'], minimo: 12, bonus_produto_id: 'mgg', repetivel: false }),
  regra({ id: 'r2', tipo: 'desconto', familia: 'Formula Natural Pro', minimo: 30, unidade: 'unidades', desconto_modalidade: 'valor', desconto_valor: 15 }),
], { descricao: 'Não acumula com outras ações.', inicio: '2026-12-01' }), produtos, { faixa: 'livre', agora: manha });
assert.match(grupo.texto, /Válida de 01\/12\/2026 a 31\/12\/2026\./);
assert.match(grupo.texto, /\*Condição 1\*\n\*Como funciona:\* na compra de 12 unidades entre os produtos abaixo \(pode combinar\), você ganha 1 unidade de MAGNUS GATOS 10,1KG\. Bonificação de uma vez por pedido\./);
assert.match(grupo.texto, /• MAGNUS GATOS 10,1KG: R\$ 110,00 a unidade\n• MAGNUS TODO DIA 15KG: R\$ 120,00 a unidade/);
assert.match(grupo.texto, /\*Investimento:\* a partir de R\$ 1\.320,00 no pedido mínimo/);
assert.match(grupo.texto, /Equivale a 7,1% a 7,7% de desconto no pedido mínimo\./);
assert.match(grupo.texto, /\*Condição 2\*\n\*Como funciona:\* comprando a partir de 30 unidades de FN PRO CAES FILH MINI\/PEQ 3X2,5KG, você tem R\$ 15,00 de desconto por caixa\./);
assert.match(grupo.texto, /\*Observações:\* Não acumula com outras ações\./);
assert.deepEqual(grupo.avisos, ['Campanha fora da vigência ou não ativa.']);

// Pendências e bonificado ausente aparecem como aviso para o representante, não na mensagem.
const pendente = mensagemCampanha(campanha([regra({ produto_ids: ['mg', 'mgg'], pendencias_importacao: ['X'] })]), produtos, { faixa: 'livre', agora: manha });
assert.equal(pendente.avisos.includes('SKU bonificado não definido.'), true);
assert.equal(pendente.avisos.includes('Há SKUs do encarte ainda não conferidos.'), true);

if (process.env.SHOW) console.log(bonif.texto + '\n\n-----\n\n' + grupo.texto);
console.log('Testes de compartilhamento de campanhas: OK');
