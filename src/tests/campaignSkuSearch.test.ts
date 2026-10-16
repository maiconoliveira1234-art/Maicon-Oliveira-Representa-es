import assert from 'node:assert/strict';
import type { Produto } from '../types';
import { filterCampaignSkus, normalizeSkuSearch } from '../lib/campaignSkuSearch';
import { addCampaignSkuIds, toggleCampaignSkuId } from '../lib/campaignSkuSelection';

const produtos = [
  { id: '1', produto: 'Fórmula Natural Fresh Meat Adulto Mini', familia: 'Fórmula Natural', ativo: true },
  { id: '2', produto: 'Magnus Todo Dia Adulto', familia: 'Magnus', ativo: true },
  { id: '3', produto: 'Magnus Premium Filhotes', familia: 'Magnus', ativo: true },
  { id: '4', produto: 'Magnus Todo Dia (inativo)', familia: 'Magnus', ativo: false },
] as Produto[];

assert.equal(normalizeSkuSearch('  FórMULA  NATURAL  '), 'formula natural');
assert.deepEqual(filterCampaignSkus(produtos, 'MAGNUS').results.map(p => p.id), ['3', '2']);
assert.deepEqual(filterCampaignSkus(produtos, 'todo adulto').results.map(p => p.id), ['2']);
assert.deepEqual(filterCampaignSkus(produtos, 'fresh mini').results.map(p => p.id), ['1']);
assert.equal(filterCampaignSkus(produtos, 'xyz').total, 0);
assert.equal(filterCampaignSkus(produtos, '').total, 3);
assert.equal(filterCampaignSkus(produtos, 'magnus', 1).results.length, 1);
const life = [
  { id: 'l1', produto: 'Fórmula Natural Life Cães Adultos 15kg', familia: 'Fórmula Natural', ativo: true },
  { id: 'l2', produto: 'Fórmula Natural Life Cães Filhotes 15 KG', familia: 'Fórmula Natural', ativo: true },
  { id: 'l3', produto: 'Fórmula Natural Life Gatos Filhotes 15kg', familia: 'Fórmula Natural', ativo: true },
  { id: 'l4', produto: 'Fórmula Natural Life Cães Adultos 3kg', familia: 'Fórmula Natural', ativo: true },
] as Produto[];
assert.deepEqual(filterCampaignSkus(life, 'life 15kg').results.map(p=>p.id), ['l1','l2','l3']);
assert.deepEqual(filterCampaignSkus(life, 'caes filhote').results.map(p=>p.id), ['l2']);
assert.deepEqual(filterCampaignSkus(life, 'gato filhotes').results.map(p=>p.id), ['l3']);
let selected = addCampaignSkuIds([], filterCampaignSkus(life, 'life 15kg', life.length).results.map(p=>p.id));
assert.deepEqual(selected, ['l1','l2','l3']);
selected = addCampaignSkuIds(selected, ['l2','l3']);
assert.deepEqual(selected, ['l1','l2','l3']);
selected = toggleCampaignSkuId(selected, 'l2');
assert.deepEqual(selected, ['l1','l3']);
selected = toggleCampaignSkuId(selected, 'l2');
assert.deepEqual(selected, ['l1','l3','l2']);
assert.deepEqual(
  addCampaignSkuIds(filterCampaignSkus(life,'gato filhote').results.map(p=>p.id),
    filterCampaignSkus(life,'cao filhote').results.map(p=>p.id)), ['l3','l2'],
);
console.log('Busca de SKUs para campanhas: OK');
