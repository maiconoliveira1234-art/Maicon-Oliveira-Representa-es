import { Produto, PrecoFaixa } from '../types';
import { differenceInDays } from 'date-fns';

export function getFaixaPreco(pesoTotal: number): PrecoFaixa {
  if (pesoTotal >= 4000) return '4000kg';
  if (pesoTotal >= 2000) return '2000kg';
  if (pesoTotal >= 1000) return '1000kg';
  if (pesoTotal >= 500) return '500kg';
  if (pesoTotal >= 200) return '200kg';
  return 'livre';
}

export function getValorUnitario(produto: Produto, faixa: PrecoFaixa): number {
  switch (faixa) {
    case '4000kg': return produto["4000kg"];
    case '2000kg': return produto["2000kg"];
    case '1000kg': return produto["1000kg"];
    case '500kg': return produto["500kg"];
    case '200kg': return produto["200kg"];
    case 'livre': return produto.livre;
    default: return produto.livre;
  }
}

export function calcularSugestao(
  consumoMedioDiario: number,
  estoqueAtual: number,
  diasDesdeUltimaCompra: number,
  pesoEmbalagem: number
): number {
  // Necessidade para os próximos 30 dias + reposição do que já consumiu
  const diasParaPrever = 30;
  const consumoEstimado = consumoMedioDiario * (diasDesdeUltimaCompra + diasParaPrever);
  const necessidade = Math.max(0, consumoEstimado - estoqueAtual);
  
  // Arredondar para cima baseado no peso da embalagem (unidades inteiras)
  return Math.ceil(necessidade / pesoEmbalagem);
}

export function deveManterFaixaAnterior(dataUltimaCompra?: string): boolean {
  if (!dataUltimaCompra) return false;
  const dias = differenceInDays(new Date(), new Date(dataUltimaCompra));
  return dias <= 28;
}
