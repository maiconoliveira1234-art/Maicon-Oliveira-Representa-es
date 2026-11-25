import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registrarPreco } from '../lib/orderDraftPricing';
import { withDraftCampaigns, readDraftCampaigns } from '../lib/orderDraftCampaigns';

// Faixa de 1000 kg: 18% em FN Life e 24% em Origens.
const fnLife = { custo_und: 192.32 };
assert.deepEqual(registrarPreco(fnLife, 192.32 * (1 - 0.18)), { valor_unitario: 157.7024, xdt: 18 });
assert.deepEqual(registrarPreco({ custo_und: 98.6 }, 98.6 * (1 - 0.24)), { valor_unitario: 74.936, xdt: 24 });

// Campanha de 30% sobre o preço cheio.
assert.equal(registrarPreco({ custo_und: 100 }, 70).xdt, 30);

// Sem desconto, acréscimo ou dados faltando.
assert.equal(registrarPreco(fnLife, 192.32).xdt, 0);
assert.equal(registrarPreco(fnLife, 200).xdt, 0);
assert.deepEqual(registrarPreco(undefined, 150), {});
assert.deepEqual(registrarPreco(fnLife, 0), {});
assert.deepEqual(registrarPreco({ custo_und: 0 }, 10), {});

// Os campos convivem com as campanhas aprovadas do rascunho.
const itens = withDraftCampaigns([
  { produto_id: 'a', quantidade: 3, tipo_operacao: 'VENDA', ...registrarPreco(fnLife, 157.7024) },
  { produto_id: 'b', quantidade: 1, tipo_operacao: 'BONIFICACAO_COMERCIAL' },
], ['regra']);
const salvo = JSON.parse(JSON.stringify(itens));
assert.equal(salvo[0].xdt, 18);
assert.equal(salvo[0].valor_unitario, 157.7024);
assert.deepEqual(readDraftCampaigns(salvo), ['regra']);
assert.equal('xdt' in salvo[1], false);

// O desconto não pode aparecer no PDF/tela do pedido: só no salvamento.
const pagina = readFileSync(new URL('../pages/OrderPage.tsx', import.meta.url), 'utf8');
assert.equal((pagina.match(/\bxdt\b/gi) || []).length, 0);
assert.equal((pagina.match(/registrarPreco\(/g) || []).length, 1);

console.log('orderDraftPricing: ok');
