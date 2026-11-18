import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rankOptions } from '../lib/rankOptions';

const opts = ['Racao Facil', 'Pet Racao Centro', 'Agro Ração Joinville', 'Casa do Pet', 'Mercado Facil'].map(label => ({ label }));
const labels = (q: string) => rankOptions(opts, q).map(o => o.label);

test('ignora acento e maiusculas e ordena por proximidade', () => {
  assert.deepEqual(labels('RAÇÃO').slice(0, 1), ['Racao Facil']);
  assert.equal(labels('racao').length, 3);
});
test('palavras em qualquer ordem', () => {
  assert.deepEqual(labels('facil racao'), ['Racao Facil']);
});
test('comeca com o texto vem primeiro', () => {
  assert.equal(labels('pet')[0], 'Pet Racao Centro');
});
test('sem resultado tenta letras na sequencia', () => {
  assert.deepEqual(labels('rcfcl'), ['Racao Facil', 'Mercado Facil']);
});
test('vazio devolve tudo', () => {
  assert.equal(labels('').length, 5);
});
