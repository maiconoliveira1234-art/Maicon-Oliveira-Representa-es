import assert from 'node:assert/strict';
import { readDraftCampaigns, withDraftCampaigns, localDraftIsNewer } from '../lib/orderDraftCampaigns';
import { createDebouncedDraftSave } from '../lib/debouncedDraftSave';
import { avaliarCampanhas, type Campanha } from '../lib/campaignEngine';
import type { Produto } from '../types';

const products = [
  { id: 'food', quant_embalagem: 1, peso_embalagem: 15 },
  { id: 'bucket', quant_embalagem: 1, peso_embalagem: 0 },
] as Produto[];
const campaign: Campanha = {
  id: 'buckets', titulo: 'Baldes', descricao: '', status: 'ativa',
  inicio: '2026-10-01', fim: '2026-10-31', imagem_data: null,
  regras: [{ id: 'rule', tipo: 'bonificacao', minimo: 10, unidade: 'unidades',
    produto_ids: ['food'], familia: '', repetivel: true,
    bonus_produto_id: 'bucket', bonus_quantidade: 5, desconto_percentual: 0 }],
};
const date = new Date(2026, 9, 28);
const sales = [{ produto_id: 'food', quantidade: 10, tipo_operacao: 'VENDA' }];
const roundTrip = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const restoredBenefits = (items: typeof sales) => avaliarCampanhas([campaign], items, products, date)
  .filter(o => o.elegivel && readDraftCampaigns(items).includes(o.regra.id));

// Order -> storage -> stock screen rebuild -> cloud JSON -> reopened order.
const applied = roundTrip(withDraftCampaigns(sales, ['rule']));
const stockItems = applied.map(({ produto_id, quantidade, tipo_operacao }) => ({ produto_id, quantidade, tipo_operacao }));
const resaved = roundTrip(withDraftCampaigns(stockItems, readDraftCampaigns(applied)));
assert.equal(restoredBenefits(resaved).length, 1);
assert.equal(restoredBenefits(resaved)[0].bonusQuantidade, 5);
assert.equal(restoredBenefits(resaved)[0].bonusProdutoId, 'bucket');
// Repeated navigation cannot duplicate campaign benefits.
assert.deepEqual(withDraftCampaigns(resaved, readDraftCampaigns(resaved)), resaved);
// Explicit removal stays removed; decreasing eligible sales still enforces the campaign rule.
assert.equal(restoredBenefits(withDraftCampaigns(resaved, [])).length, 0);
assert.equal(restoredBenefits(withDraftCampaigns([{ ...sales[0], quantidade: 9 }], ['rule'])).length, 0);
// Read legacy drafts and tolerate metadata moved off the first item or malformed values.
assert.deepEqual(readDraftCampaigns(sales), []);
assert.deepEqual(readDraftCampaigns([{}, { campanhas_aplicadas: ['rule', 'rule', null, 4] }]), ['rule']);
assert.deepEqual(withDraftCampaigns([], ['rule']), []);
const now = '2026-10-28T12:00:01.000Z';
assert.equal(localDraftIsNewer({ updatedAt: now }, '2026-10-28T12:00:00.000Z'), true);
assert.equal(localDraftIsNewer({ updatedAt: now }, now), true);
assert.equal(localDraftIsNewer({ updatedAt: now }, '2026-10-28T12:00:02.000Z'), false);
assert.equal(localDraftIsNewer(null, now), false);

// Navigating before the debounce fires persists the latest approval exactly once.
const written: typeof resaved[] = [];
const saver = createDebouncedDraftSave<typeof resaved>(items => written.push(roundTrip(items)), 10);
saver.schedule(withDraftCampaigns(sales, []));
saver.schedule(resaved);
saver.flush();
assert.equal(written.length, 1);
assert.equal(restoredBenefits(written[0])[0].bonusQuantidade, 5);
await new Promise(resolve => setTimeout(resolve, 25));
assert.equal(written.length, 1);
// Clearing/finalizing must not recreate the deleted order on navigation.
saver.schedule(resaved);
saver.cancel();
saver.flush();
await new Promise(resolve => setTimeout(resolve, 25));
assert.equal(written.length, 1);
saver.schedule(withDraftCampaigns(sales, []));
await new Promise(resolve => setTimeout(resolve, 25));
assert.equal(written.length, 2);
assert.equal(restoredBenefits(written[1]).length, 0);
console.log('Campaign draft regression tests passed: navigation, stock rebuild, removal, eligibility and debounce.');
