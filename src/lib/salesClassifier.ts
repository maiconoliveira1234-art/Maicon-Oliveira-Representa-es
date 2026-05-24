/**
 * Sales Classifier Utility for Commercial CRM
 * 
 * Provides dynamic classification for imported sales lines (from hist_vendas)
 * using the combination of ERP Column 5 (vendas/tipo) and ERP Column 1 (tabela).
 * 
 * This module helps differentiate "Normal Sale" from "Commercial Bonus" 
 * and "Branded Merchandising / Gifts" without altering database tables or breaking
 * historical compatibility.
 */

export type TipoOperacao = 'VENDA' | 'BONIFICACAO_COMERCIAL' | 'MERCHANDISING';

export interface SaleClassification {
  tipoOperacao: TipoOperacao;
  label: string;
  badgeStyle: string; // Tailwind bg + text classes for light theme
  textStyle: string;  // Tailwind text classes
  bgStyle: string;    // Tailwind background classes
  
  // Business logic flags
  entraFaturamento: boolean;
  entraComissao: boolean;
  entraMetas: boolean;
  influenciaEstoque: boolean;
  influenciaSugestao: boolean;
  influenciaConsumo: boolean;
}

/**
 * Classifies a sale record based on 'vendas' type and 'tabela' fields.
 * 
 * REGRA 1 — Venda normal: vendas = 'VENDAS'
 * REGRA 2 — Bonificação comercial: vendas contains 'BONIFICACAO' AND tabela does NOT contain 'BRINDES'
 * REGRA 3 — Brinde / merchandising: vendas contains 'BONIFICACAO' AND tabela contains 'BRINDES'
 * 
 * Also handles fallback for DOACAO/BRINDE keyword categories dynamically.
 */
export function classifySale(vendas: string = '', tabela: string = ''): SaleClassification {
  const vUpper = vendas.toUpperCase().trim();
  const tUpper = tabela.toUpperCase().trim();

  // If literally of type VENDAS, it's a Normal Sale
  if (vUpper === 'VENDAS') {
    return {
      tipoOperacao: 'VENDA',
      label: 'Venda Normal',
      badgeStyle: 'bg-blue-100 text-blue-800 border-blue-200',
      textStyle: 'text-blue-700',
      bgStyle: 'bg-blue-50',
      entraFaturamento: true,
      entraComissao: true,
      entraMetas: true,
      influenciaEstoque: true,
      influenciaSugestao: true,
      influenciaConsumo: true,
    };
  }

  // If contains BONIFICACAO, DOACAO or BRINDE (or similar ERP promo types)
  const isPromo = vUpper.includes('BONIFICACAO') || vUpper.includes('DOACAO') || vUpper.includes('BRINDE');
  
  if (isPromo) {
    // If the table name contains 'BRINDES' or the operation type is specifically 'BRINDE'
    const isMerchandising = tUpper.includes('BRINDES') || vUpper.includes('BRINDE');
    
    if (isMerchandising) {
      return {
        tipoOperacao: 'MERCHANDISING',
        label: 'Merchandising / Brinde',
        badgeStyle: 'bg-purple-100 text-purple-800 border-purple-200',
        textStyle: 'text-purple-700',
        bgStyle: 'bg-purple-50',
        entraFaturamento: false,
        entraComissao: false,
        entraMetas: false,
        influenciaEstoque: false,
        influenciaSugestao: false,
        influenciaConsumo: false,
      };
    } else {
      // Commercial Bonificação
      return {
        tipoOperacao: 'BONIFICACAO_COMERCIAL',
        label: 'Bonificação Comercial',
        badgeStyle: 'bg-orange-100 text-orange-800 border-orange-200',
        textStyle: 'text-orange-700',
        bgStyle: 'bg-orange-50',
        entraFaturamento: false,
        entraComissao: false,
        entraMetas: false,
        influenciaEstoque: true,
        influenciaSugestao: true,
        influenciaConsumo: true,
      };
    }
  }

  // Safe fallback to Normal Sale for general operations to prevent missing faturamento data
  return {
    tipoOperacao: 'VENDA',
    label: 'Venda Normal',
    badgeStyle: 'bg-blue-100 text-blue-800 border-blue-200',
    textStyle: 'text-blue-700',
    bgStyle: 'bg-blue-50',
    entraFaturamento: true,
    entraComissao: true,
    entraMetas: true,
    influenciaEstoque: true,
    influenciaSugestao: true,
    influenciaConsumo: true,
  };
}

/**
 * Classifies a database HistVenda record.
 */
export function classifySaleRecord(record: { vendas?: string, tabela?: string }): SaleClassification {
  return classifySale(record.vendas || '', record.tabela || '');
}
