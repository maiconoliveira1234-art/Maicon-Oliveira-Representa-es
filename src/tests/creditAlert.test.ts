import assert from 'node:assert/strict';
import { avaliarLimiteCredito } from '../lib/creditAlert';

const saldo = {
  limite: 8000,
  disponivel_oficial: 2500,
  disponivel_estimado: 3500,
  reservas_total: 300,
};

const insuficiente = avaliarLimiteCredito(4000, saldo, '02 Boletos (14-21)');
assert.equal(insuficiente.situacao, 'insuficiente');
assert.equal(insuficiente.excesso, 500);
assert.equal(insuficiente.disponivelConservador, 2200);

const porLiberacao = avaliarLimiteCredito(3000, saldo, '01 Boleto (14)');
assert.equal(porLiberacao.situacao, 'atencao');
assert.equal(porLiberacao.excesso, 0);

const suficiente = avaliarLimiteCredito(2000, saldo, '01 Boleto (14)');
assert.equal(suficiente.situacao, 'suficiente');

assert.equal(avaliarLimiteCredito(9000, saldo, 'À Vista').situacao, 'avista');
assert.equal(avaliarLimiteCredito(0, saldo, '01 Boleto (14)').situacao, 'sem_valor');
assert.equal(avaliarLimiteCredito(3500.01, saldo, '01 Boleto (14)').excesso, 0.01);
assert.equal(avaliarLimiteCredito(3500, saldo, '01 Boleto (14)').excesso, 0);

const creditoZero = avaliarLimiteCredito(900, { limite: 2000, disponivel_oficial: 0, disponivel_estimado: 0, reservas_total: 0 }, '01 Boleto (14)');
assert.equal(creditoZero.situacao, 'insuficiente');
assert.equal(creditoZero.excesso, 900);

console.log('Alertas de crédito: limite suficiente, projeção, insuficiência, centavos e à vista validados.');
