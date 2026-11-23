import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const page = readFileSync('src/pages/PriceInquiryPage.tsx','utf8');

// Lista carrega ativos e inativos; o filtro decide o que aparece.
assert.match(page,/\[showInactive, setShowInactive\] = useState\(false\)/);
assert.match(page,/const localProducts = cachedProdutos;/);
assert.match(page,/\.from\('produtos'\)[\s\S]*?\.select\('\*'\)\s*\.order\('familia'\)/);
assert.doesNotMatch(page,/\.from\('produtos'\)[\s\S]*?\.select\('\*'\)\s*\.eq\('ativo', true\)/);
assert.match(page,/showInactive \? p\.ativo !== false : p\.ativo === false/);

// Botao de inativos fica no menu de tres pontos do cabecalho.
assert.match(page,/<MoreHorizontal size=\{16\} \/>/);
assert.match(page,/role="menu"/);
assert.match(page,/\{showInactive \? 'Ocultar Inativos' : 'Exibir Inativos'\}/);
assert.doesNotMatch(page,/'Mostrar Ativos'/);
assert.match(page,/document\.addEventListener\('pointerdown', closeOnOutside\)/);

// Linha do produto inativo e clicavel e abre o cadastro.
assert.match(page,/if \(isInactive\) openProductRecord\(produto\); else toggleSelect\(produto\.id\);/);
assert.match(page,/setEditingInactive\(produto\.ativo === false\)/);

// Reativacao direto no cadastro, salvando com ativo = true.
assert.match(page,/handleSaveProduct\(\{ ativo: true \}\)/);
assert.match(page,/const data: Produto = \{ \.\.\.editForm, \.\.\.overrides \};/);
assert.match(page,/ativo: data\.ativo/);
assert.match(page,/ativo: !editForm\.ativo/);
assert.match(page,/onClick=\{\(\) => handleSaveProduct\(\)\}/);
assert.doesNotMatch(page,/onClick=\{handleSaveProduct\}/);
assert.match(page,/refreshProdutos\(\)\.catch/);

// Exportacao continua so com produtos ativos.
assert.match(page,/filteredProdutos\.filter\(p => p\.ativo !== false\)\.map\(p => p\.id\)/);
console.log('Reativacao de produtos pelo CRM: verificacoes aprovadas.');
