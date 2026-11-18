import assert from 'node:assert/strict';
import {
  buscarProdutos, prepararCatalogo, fichaDoTexto, fichaDoProduto, inferirTermos, montarDicionario, descreverTermo,
} from '../lib/productMatch';

let passed = 0;
const it = (name: string, fn: () => void) => {
  try { fn(); passed++; } catch (error) { console.error(`FALHOU: ${name}`); throw error; }
};
const sorted = (s: Set<string>) => [...s].sort();

// Nomes reais do catálogo (peso_embalagem total, quant_embalagem).
const nomes: Array<[string, number, number]> = [
  ['FN LIFE AD PORT MINI/PEQ 15KG', 15, 1],
  ['FN LIFE AD PORT MINI/PEQ 10,1KG', 10.1, 1],
  ['FN LIFE AD PORT MINI/PEQ 3X2,5KG', 7.5, 3],
  ['FN LIFE AD PORT MED/GR 15KG', 15, 1],
  ['FN LIFE FILH PORT MINI/PEQ 15KG', 15, 1],
  ['FN PRO CAES AD MINI/PEQ 15KG', 15, 1],
  ['FN PRO SKIN CAO AD MP COR 10,1KG', 10.1, 1],
  ['FN FM SENSI AD MP CORD 10,1KG', 10.1, 1],
  ['FN FM AD MINI/PQ 10,1KG', 10.1, 1],
  ['FN FM SEN MINI/PQ 10,1KG', 10.1, 1],
  ['FN FM GATO CAST SALMAO 10,1KG', 10.1, 1],
  ['FN FM GATO HAIRBALL SAL 7KG', 7, 1],
  ['FN LIFE GATO CAST SALMAO 10,1KG', 10.1, 1],
  ['MAGNUS CAT AD CAST CARNE 10,1KG', 10.1, 1],
  ['MAGNUS CAT AD CAST SALMAO 10,1KG', 10.1, 1],
  ['MAGNUS CAT AD CAST CARNE 10X1KG', 10, 10],
  ['MAGNUS CAT AD CARNE 10,1KG', 10.1, 1],
  ['MAGNUS T D SABOR CARNE 15KG', 15, 1],
  ['MAGNUS T D PEQ PORTE CN/FG 15KG', 15, 1],
  ['MAGNUS T D FILH CARNE 20KG', 20, 1],
  ['MAGNUS CAT FILH CN/FG 20KG', 20, 1],
  ['MAGNUS BIFINHO CARNE 20X60G', 1.2, 20],
  ['MAGNUS BIFINHO FRANGO 20X60G', 1.2, 20],
  ['ORIGENS NAT CAO AD MP OVEL 4X3KG', 12, 4],
  ['ORIGENS NAT CAO AD MP FG 4X3KG', 12, 4],
  ['ORIGENS NAT CAO AD MG OVEL 12KG', 12, 1],
  ['ORIGENS AD SHIHTZU/LHASA 4X3KG', 12, 4],
  ['ORIGENS AD SHIHTZU/LHASA 5X1KG', 5, 5],
  ['ORIGENS FILH SHIHTZU/LHASA 5X1KG', 5, 5],
  ['ORIGENS CAO MIN/PEQ CN/CER 5X1KG', 5, 5],
  ['ORIGENS PN FEMUR 6X180G', 1.08, 6],
  ['ORIGENS PN FEMUR SUINO 6X100G', 0.6, 6],
  ['ORIGENS PN CASCO 6X60G', 0.36, 6],
  ['PETISCO ORIGENS CAT BOLA2X(10X40G)', 0.8, 20],
  ['SACHE ORIGENS GATO CAST ATU18X85', 1.53, 18],
  ['ORIGENS CREMINHO SALMAO 2X(6X60G)', 0.72, 48],
  ['FN REC CASE CAES AD CORD 6X270G', 1.62, 6],
  ['FN VET CAES HIPO MINI/PQ 2X2KG', 4, 2],
  ['AMOSTRA FN FM AD MINI/PQ 80G', 0, 20],
  ['CAMISETA PROMO MAGNUS MASC GG', 0, 1],
  ['GATAN MIX CARNE E FRANGO 10,1KG', 10.1, 1],
];
const catalogo = prepararCatalogo(nomes.map(([produto, peso_embalagem, quant_embalagem], i) =>
  ({ id: `p${i}`, produto, peso_embalagem, quant_embalagem })));
const idDe = (produto: string) => catalogo.find(p => p.produto === produto)!.id;
const primeiro = (consulta: string, opcoes = {}) => buscarProdutos(consulta, catalogo, opcoes).candidatos[0]?.produto;

// --- Ficha de atributos do produto ---
it('lê marca, família, porte, fase, sabor e peso da unidade', () => {
  const f = fichaDoProduto({ id: 'x', produto: 'ORIGENS NAT CAO AD MP OVEL 4X3KG', peso_embalagem: 12, quant_embalagem: 4 });
  assert.deepEqual(sorted(f.atributos.marca), ['ORIGENS']);
  assert.deepEqual(sorted(f.atributos.familia), ['NAT']);
  assert.deepEqual(sorted(f.atributos.porte), ['MINI', 'PEQ']);
  assert.deepEqual(sorted(f.atributos.fase), ['AD']);
  assert.deepEqual(sorted(f.atributos.sabor), ['OVELHA']);
  assert.equal(f.pesoUnidadeKg, 3);
  assert.equal(f.unidadesPorCaixa, 4);
});
it('MP, M/P, MINI/PEQ, MIN/PQ e PEQ PORTE viram o mesmo porte', () => {
  for (const t of ['FN X MP 1KG', 'FN X M/P 1KG', 'FN X MINI/PEQ 1KG', 'FN X MIN/PQ 1KG', 'MAGNUS T D PEQ PORTE 1KG'])
    assert.deepEqual(sorted(fichaDoTexto(t).atributos.porte), ['MINI', 'PEQ'], t);
});
it('entende pesos colados e caixas aninhadas', () => {
  assert.equal(fichaDoTexto('FN LIFE FILH PORT MINI/PEQ3X2,5KG').pesoUnidadeKg, 2.5);
  assert.equal(fichaDoTexto('PETISCO ORIGENS CAT BOLA2X(10X40G)').pesoUnidadeKg, 0.04);
  const sache = fichaDoTexto('SACHE ORIGENS GATO CAST ATU18X85');
  assert.equal(sache.pesoUnidadeKg, 0.085);
  assert.deepEqual(sorted(sache.atributos.sabor), ['ATUM']);
});
it('produto sem espécie escrita é para cães, exceto Gatan', () => {
  assert.deepEqual(sorted(fichaDoTexto('MAGNUS T D SABOR CARNE 15KG').atributos.especie), ['CAO']);
  assert.deepEqual(sorted(fichaDoTexto('GATAN MIX CARNE E FRANGO 10,1KG').atributos.especie), ['GATO']);
});

// --- Busca em funil ---
it('abreviações do cliente encontram o produto por extenso', () => {
  assert.equal(primeiro('fn laif ad mp 15kg'), 'FN LIFE AD PORT MINI/PEQ 15KG');
  assert.equal(primeiro('formula natural life adulto mini e pequeno 15 kg'), 'FN LIFE AD PORT MINI/PEQ 15KG');
  assert.equal(primeiro('Form Nat Life adulto mini/peq 15kg'), 'FN LIFE AD PORT MINI/PEQ 15KG');
});
it('cliente pede pelo peso da unidade: 3kg encontra a caixa 4x3kg', () => {
  assert.equal(primeiro('orig nat ad mp ovel 3kg'), 'ORIGENS NAT CAO AD MP OVEL 4X3KG');
});
it('Magnus Gato encontra Magnus Cat e marca a dúvida de sabor', () => {
  const r = buscarProdutos('magnus gato castrado 10kg', catalogo);
  assert.match(r.candidatos[0].produto, /^MAGNUS CAT AD CAST (CARNE|SALMAO) 10,1KG$/);
  assert.deepEqual(r.ambiguidade?.atributos.find(a => a.atributo === 'sabor')?.opcoes.sort(), ['Carne', 'Salmão']);
  assert.equal(r.vencedor_claro, false);
});
it('histórico de compras desempata quando o sabor não foi informado', () => {
  const historico = new Map([[idDe('MAGNUS CAT AD CAST SALMAO 10,1KG'), { orders: 4, last: '2026-10-01' }]]);
  assert.equal(primeiro('magnus gato castrado 10kg', { historico }), 'MAGNUS CAT AD CAST SALMAO 10,1KG');
});
it('nunca troca gato por cão', () => {
  const r = buscarProdutos('fn fm gato castrado salmao 10kg', catalogo);
  assert.ok(r.candidatos.every(c => /GATO|CAT/.test(c.produto)));
  assert.equal(r.candidatos[0].produto, 'FN FM GATO CAST SALMAO 10,1KG');
});
it('sem espécie informada, ração de cão vem antes da de gato', () => {
  assert.equal(primeiro('magnus filhote 20kg'), 'MAGNUS T D FILH CARNE 20KG');
});
it('Sens é Sensitive e Sen é Sênior', () => {
  assert.equal(primeiro('fn fm sens ad mp cord 10kg'), 'FN FM SENSI AD MP CORD 10,1KG');
  assert.equal(primeiro('fn fm sen mp 10kg'), 'FN FM SEN MINI/PQ 10,1KG');
});
it('produto comum fica à frente do especial quando o cuidado não foi pedido', () => {
  assert.equal(primeiro('fn fm adulto mini 10,1kg'), 'FN FM AD MINI/PQ 10,1KG');
  assert.equal(primeiro('magnus todo dia 15kg'), 'MAGNUS T D SABOR CARNE 15KG');
});
it('Petisco Origens Fêmur encontra a linha PN', () => {
  const r = buscarProdutos('petisco origens femur', catalogo);
  assert.match(r.candidatos[0].produto, /^ORIGENS PN FEMUR/);
  assert.notEqual(r.ambiguidade, null); // 180g ou suíno 100g
});
it('raça escrita do jeito do cliente', () => {
  assert.equal(primeiro('origens shitzu adulto 1kg'), 'ORIGENS AD SHIHTZU/LHASA 5X1KG');
});
it('vencedor claro quando marca, peso e atributos batem', () => {
  const r = buscarProdutos('FN Pro skin ad mp cordeiro 10,1kg', catalogo);
  assert.equal(r.candidatos[0].produto, 'FN PRO SKIN CAO AD MP COR 10,1KG');
  assert.equal(r.vencedor_claro, true);
});
it('amostras e brindes só aparecem quando pedidos', () => {
  assert.ok(!buscarProdutos('fn fm ad mini', catalogo).candidatos.some(c => c.produto.startsWith('AMOSTRA')));
  assert.ok(!buscarProdutos('magnus porte grande', catalogo).candidatos.slice(0, 3).some(c => c.produto.startsWith('CAMISETA')));
});
it('peso inexistente relaxa o filtro e avisa', () => {
  const r = buscarProdutos('magnus bifinho carne 99kg', catalogo);
  assert.ok(r.filtro_relaxado.includes('peso'));
  assert.equal(r.candidatos[0].produto, 'MAGNUS BIFINHO CARNE 20X60G');
});

// --- Aprendizado de termos ---
it('propõe o termo desconhecido para o atributo que faltou', () => {
  const produto = { id: 'x', produto: 'MAGNUS CAT AD CAST CARNE 10,1KG', peso_embalagem: 10.1, quant_embalagem: 1 };
  const s = inferirTermos('magnus felinu ad castrado carne 10kg', produto);
  assert.deepEqual(s, [{ termo: 'FELINU', atributo: 'especie', valor: 'GATO' }]);
  assert.equal(descreverTermo(s[0]), 'FELINU = Espécie: Gato');
});
it('não propõe nada quando tudo já foi reconhecido', () => {
  assert.deepEqual(inferirTermos('magnus gato ad castrado carne 10kg', { id: 'x', produto: 'MAGNUS CAT AD CAST CARNE 10,1KG' }), []);
});
it('termo aprovado passa a valer na busca', () => {
  const dic = montarDicionario([{ termo: 'felinu', atributo: 'especie', valor: 'GATO' }]);
  assert.equal(buscarProdutos('fn fm felinu castrado salmao 10kg', catalogo, { dicionarioCliente: dic }).candidatos[0].produto,
    'FN FM GATO CAST SALMAO 10,1KG');
});
it('sinônimo aprendido substitui a palavra', () => {
  const dic = montarDicionario([{ termo: 'femu', atributo: 'sinonimo', valor: 'FEMUR' }]);
  assert.equal(buscarProdutos('origens pn femu 180g', catalogo, { dicionarioCliente: dic }).candidatos[0].produto,
    'ORIGENS PN FEMUR 6X180G');
});

console.log(`Reconhecimento de produtos: ${passed} testes passaram.`);
