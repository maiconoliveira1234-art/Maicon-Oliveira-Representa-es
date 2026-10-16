import assert from 'node:assert/strict';
import type { Produto } from '../types';
import { filterCampaignSkus, normalizeSkuSearch } from '../lib/campaignSkuSearch';

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
console.log('Busca de SKUs para campanhas: OK');
