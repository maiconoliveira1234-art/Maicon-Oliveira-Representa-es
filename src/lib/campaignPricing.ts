import type { Produto } from '../types';
import { descontoValido, modalidadeDesconto, produtoNaRegra, type ModalidadeDesconto, type OportunidadeCampanha } from './campaignEngine';

export type PrecoCampanha = {
  valorUnitario: number;
  valorEmbalagem: number;
  regraId: string | null;
  modalidade: ModalidadeDesconto | null;
};
const arredondarCentavos = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Retorna o menor preço válido sem somar descontos de campanhas distintas. */
export function calcularPrecoDeCampanha(
  produto: Produto,
  valorUnitarioTabela: number,
  oportunidadesAprovadas: OportunidadeCampanha[],
): PrecoCampanha {
  const unidadePorEmbalagem = Number(produto.quant_embalagem) > 0 ? Number(produto.quant_embalagem) : 1;
  const precoTabela = Math.max(0, Number(valorUnitarioTabela) || 0) * unidadePorEmbalagem;
  const precoCheio = Math.max(0, Number(produto.custo_und) || 0) * unidadePorEmbalagem;
  let preco = precoTabela;
  let regraId: string | null = null;
  let modalidade: ModalidadeDesconto | null = null;
  for (const oferta of oportunidadesAprovadas) {
    const r = oferta.regra;
    if (!oferta.elegivel || !descontoValido(r) || !produtoNaRegra(produto, r)) continue;
    const modo = modalidadeDesconto(r);
    let valor: number;
    switch (modo) {
      case 'adicional_percentual': valor = precoTabela * (1 - Number(r.desconto_percentual) / 100); break;
      case 'absoluto_percentual': valor = precoCheio * (1 - Number(r.desconto_percentual) / 100); break;
      case 'valor': valor = precoTabela - Number(r.desconto_valor); break;
      case 'preco_final': valor = Number(r.preco_final); break;
    }
    if (!Number.isFinite(valor)) continue;
    const candidato = arredondarCentavos(Math.max(0, valor));
    // Uma promoção nunca deve piorar a condição normal do cliente.
    if (candidato < preco - 0.00001) {
      preco = candidato;
      regraId = r.id;
      modalidade = modo;
    }
  }
  return { valorUnitario: preco / unidadePorEmbalagem, valorEmbalagem: preco, regraId, modalidade };
}
