import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// A rota "Produtos" (/consulta-preco) abre a PriceReportsPage.
const app = readFileSync('src/App.tsx', 'utf8');
assert.match(app, /path="\/consulta-preco" element=\{<PriceReportsPage \/>\}/);

const page = readFileSync('src/pages/PriceReportsPage.tsx', 'utf8');

// Menu de tres pontos no cabecalho com Exibir/Ocultar inativos.
assert.match(page, /<MoreHorizontal size=\{18\} \/>/);
assert.match(page, /role="menu"/);
assert.match(page, /\{showInactive \? 'Ocultar inativos' : 'Exibir inativos'\}/);
assert.match(page, /document\.addEventListener\('pointerdown', closeOnOutside\)/);

// Modo inativos lista so os inativos, com os mesmos filtros de busca/familia/peso.
assert.match(page, /const listedProducts = showInactive \? inactiveProducts : activeProducts;/);
assert.match(page, /const filteredProducts = useMemo\(\(\) => listedProducts/);

// Linhas dos inativos abrem o cadastro, sem selecao para PDF.
assert.match(page, /\{showInactive \? \(\s*<ComparisonReport\s+readOnly/);
assert.match(page, /\{!readOnly && <td\s+data-label="Selecionar"/);
assert.match(page, /onOpenProduct=\{product => openProduct\(product\)\}/);
assert.match(page, /\{!showInactive && <button\s+onClick=\{mode === 'history' \? generateHistoryPdf : generateComparisonPdf\}/);

// Reativacao direto no cadastro.
assert.match(page, /supabase\.from\('produtos'\)\.update\(\{ ativo: true \}\)\.eq\('id', product\.id\)/);
assert.match(page, /onReactivate=\{\(\) => reactivateProduct\(viewedProduct\)\}/);
assert.match(page, /const isInactive = product\.ativo === false;/);
assert.match(page, /<RotateCcw size=\{17\}\/>\}? Reativar/);

console.log('Produtos inativos na tela de Produtos: verificacoes aprovadas.');
