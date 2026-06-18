import { Produto } from '../types';

export interface CostAuditResult {
  produtoId: string;
  produtoNome: string;
  custoTotalAtual: number;
  custoUndAtual: number;
  quantEmbalagem: number;
  
  // Audited import metrics
  qtdImportada: number;
  valorTotalImportado: number;
  descontoAplicado: number; // xdt
  valorRealUnitImportado: number; // r$_total / qtd
  
  // Computed expected metrics
  custoCaculadoTotal: number;
  custoCalculadoUnd: number;
  
  // Discrepancy metrics
  diferencaMonetaria: number;
  diferencaPercentual: number;
  
  status: 'COERENTE' | 'DIVERGENTE' | 'ALERTA_BONIF' | 'IGNORADO';
  mensagem: string;
}

/**
 * Audit a single row's pricing against standard product profile.
 * 
 * Rules:
 * - Se tabela ou vendas represent merchandising/brindes, skip.
 * - Se vendas = 'VENDAS', validate normally.
 * - Se vendas = 'BONIFICACAO', validate or generate warning alert.
 */
export function auditRowCost(
  row: { 
    produto: string; 
    qtd: number; 
    valor_total: number; 
    desconto: number; 
    tipo: string; 
    tabela: string;
  },
  produto: Produto,
  tolerancePercent: number = 1.0 // ±1%
): CostAuditResult | null {
  if (!produto) return null;

  const { qtd, valor_total, desconto, tipo = '', tabela = '' } = row;
  const tUpper = tabela.toUpperCase();
  const vUpper = tipo.toUpperCase();

  // Rule 3: Merchandising/brindes => Do not validate
  const isMerchandising = tUpper.includes('BRINDES') || vUpper.includes('BRINDE');
  if (isMerchandising) {
    return {
      produtoId: produto.id,
      produtoNome: produto.produto,
      custoTotalAtual: produto.custo_total,
      custoUndAtual: produto.custo_und,
      quantEmbalagem: produto.quant_embalagem || 1,
      qtdImportada: qtd,
      valorTotalImportado: valor_total,
      descontoAplicado: desconto,
      valorRealUnitImportado: qtd > 0 ? valor_total / qtd : 0,
      custoCaculadoTotal: produto.custo_total,
      custoCalculadoUnd: produto.custo_und,
      diferencaMonetaria: 0,
      diferencaPercentual: 0,
      status: 'IGNORADO',
      mensagem: 'Material promocional / merchandising. Auditoria de custo ignorada.'
    };
  }

  // Prevent division by zero
  if (qtd <= 0) return null;

  // Rule 1: Calculate Real Value Imported
  const valorReal = valor_total / qtd;

  // Rule 2: Reconstruct fill value (before xdt discount)
  // If discount is 100% or more, prevent division by zero or negative
  const divisor = 1 - (desconto / 100);
  const custoTotalCalculado = divisor > 0.001 ? valorReal / divisor : valorReal;

  const currentCustoTotal = produto.custo_total || 0;
  const quantEmbalagem = produto.quant_embalagem || 1;
  const custoCalculadoUnd = custoTotalCalculado / quantEmbalagem;

  // Calculate discrepancy if we have a setup cost
  let diferencaMonetaria = 0;
  let diferencaPercentual = 0;
  let isDivergent = false;

  if (currentCustoTotal > 0) {
    diferencaMonetaria = custoTotalCalculado - currentCustoTotal;
    diferencaPercentual = (diferencaMonetaria / currentCustoTotal) * 100;
    isDivergent = Math.abs(diferencaPercentual) > tolerancePercent;
  } else {
    // If current cost is 0, we can also consider it divergent/missing
    diferencaMonetaria = custoTotalCalculado;
    diferencaPercentual = 100;
    isDivergent = true;
  }

  const isBonif = vUpper.includes('BONIFICACAO');

  let status: CostAuditResult['status'] = 'COERENTE';
  let mensagem = 'Cadastro de preços coerente.';

  if (isBonif) {
    status = isDivergent ? 'ALERTA_BONIF' : 'COERENTE';
    mensagem = isDivergent 
      ? 'Divergência detectada em item de bonificação comercial. Sugere-se avaliar.' 
      : 'Bonificação comercial coerente com custo atual do cadastro.';
  } else if (isDivergent) {
    status = 'DIVERGENTE';
    mensagem = `Custo calculado (R$ ${custoTotalCalculado.toFixed(2)}) diverge do cadastrado (R$ ${currentCustoTotal.toFixed(2)}).`;
  }

  return {
    produtoId: produto.id,
    produtoNome: produto.produto,
    custoTotalAtual: currentCustoTotal,
    custoUndAtual: produto.custo_und || 0,
    quantEmbalagem,
    qtdImportada: qtd,
    valorTotalImportado: valor_total,
    descontoAplicado: desconto,
    valorRealUnitImportado: valorReal,
    custoCaculadoTotal: parseFloat(custoTotalCalculado.toFixed(4)),
    custoCalculadoUnd: parseFloat(custoCalculadoUnd.toFixed(4)),
    diferencaMonetaria: parseFloat(diferencaMonetaria.toFixed(2)),
    diferencaPercentual: parseFloat(diferencaPercentual.toFixed(2)),
    status,
    mensagem
  };
}
