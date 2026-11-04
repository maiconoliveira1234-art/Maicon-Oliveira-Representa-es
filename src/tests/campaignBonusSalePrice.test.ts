import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { calcularPrecoDeCampanha } from '../lib/campaignPricing';
import type { Produto } from '../types';
import type { OportunidadeCampanha } from '../lib/campaignEngine';

const sku = { id:'sache', produto:'SACHE ORIGENS CAO PP FRAN 18X85G', familia:'59 - SACHES ORIGENS',
  custo_und:2.57, quant_embalagem:18, peso_embalagem:1.53 } as Produto;
const bonus = { elegivel:true, regra: { id:'10mais1', tipo:'bonificacao', produto_ids:[], familia: sku.familia,
  minimo:10, bonus_produto_id:sku.id, bonus_quantidade:1, desconto_percentual:0 } } as OportunidadeCampanha;
const precoDeVenda = calcularPrecoDeCampanha(sku, 2.57 * .81, [bonus]);
assert.ok(precoDeVenda.valorUnitario > 0, 'Participar da bonificacao nao zera preco de venda');
assert.equal(precoDeVenda.regraId, null, 'Regra de bonificacao nao altera preco da venda');
assert.equal(Math.round(precoDeVenda.valorEmbalagem * 100) / 100, 37.47);
const order = readFileSync('src/pages/OrderPage.tsx','utf8');
assert.match(order, /vendasSemPreco/);
assert.match(order, /Somente bonificacoes podem ter preco zero/);
assert.match(order, /tipo_operacao: 'BONIFICACAO_COMERCIAL' as const/);
assert.match(order, /valor_unitario: 0, valor_total: 0/);
const sql = readFileSync('security/fix-sache-origens-price-v1.20.187.sql','utf8');
assert.match(sql,/custo_und = 2\.57/);
assert.match(sql,/custo_total = 46\.26/);
console.log('SKU bonificado tambem pode ser vendido com preco normal. Teste OK.');
