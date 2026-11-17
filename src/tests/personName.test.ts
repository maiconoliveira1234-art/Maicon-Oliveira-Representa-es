import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatPersonName } from '../lib/personName';

test('formata nomes com so a inicial maiuscula', () => {
  assert.equal(formatPersonName('CARLA'), 'Carla');
  assert.equal(formatPersonName('  RACAO   FACIL '), 'Racao Facil');
  assert.equal(formatPersonName('MARIA DA SILVA'), 'Maria da Silva');
  assert.equal(formatPersonName('ana-clara'), 'Ana-Clara');
  assert.equal(formatPersonName('ÉRICA'), 'Érica');
  assert.equal(formatPersonName(null), '');
  assert.equal(formatPersonName('undefined'), '');
});
