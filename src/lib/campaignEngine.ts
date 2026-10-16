import type { Produto } from '../types';

export type TipoBeneficio = 'bonificacao' | 'desconto';
/** Descontos monetários e preço final são valores por embalagem comercial. */
export type ModalidadeDesconto = 'adicional_percentual' | 'absoluto_percentual' | 'valor' | 'preco_final';
export type RegraCampanha = {
  id: string;
  tipo: TipoBeneficio;
  produto_ids: string[];
  /** Pendências de associação de nomes importados pela IA; revisão antes de ativar. */
  pendencias_importacao?: string[];
  familia: string;
  minimo: number;
  unidade?: 'embalagens' | 'unidades' | 'kg';
  repetivel: boolean;
  bonus_produto_id: string;
  bonus_quantidade: number;
  desconto_percentual: number;
  desconto_modalidade?: ModalidadeDesconto; // sem campo: regra antiga de desconto adicional
  desconto_valor?: number;
  preco_final?: number;
};
export type Campanha = {
  id: string;
  titulo: string;
  descricao: string;
  status: 'rascunho' | 'ativa' | 'pausada' | 'encerrada';
  inicio: string;
  fim: string;
  imagem_data: string | null;
  regras: RegraCampanha[];
  created_at?: string;
};
export type ItemVendaCampanha = { produto_id?: string; quantidade?: number; tipo_operacao?: string };
export type OportunidadeCampanha = {
  campanha: Campanha;
  regra: RegraCampanha;
  quantidade: number;
  falta: number;
  elegivel: boolean;
  bonusProdutoId: string | null;
  bonusQuantidade: number;
  descontoPercentual: number;
};

export function modalidadeDesconto(r: RegraCampanha): ModalidadeDesconto {
  return ['adicional_percentual', 'absoluto_percentual', 'valor', 'preco_final'].includes(r.desconto_modalidade || '')
    ? r.desconto_modalidade! : 'adicional_percentual';
}
export function descontoValido(r: RegraCampanha): boolean {
  if (r.tipo !== 'desconto') return false;
  const modo = modalidadeDesconto(r);
  const valor = Number(modo === 'valor' ? r.desconto_valor : modo === 'preco_final' ? r.preco_final : r.desconto_percentual);
  return Number.isFinite(valor) && valor > 0 &&
    (modo === 'valor' || modo === 'preco_final' ? valor <= 10_000_000 : valor <= 100);
}
export function descricaoDesconto(r: RegraCampanha): string {
  const modo = modalidadeDesconto(r);
  const percentual = Number(r.desconto_percentual).toLocaleString('pt-BR', { maximumFractionDigits: 2 });
  const moeda = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  switch (modo) {
    case 'absoluto_percentual': return percentual + '% de desconto absoluto sobre preço cheio';
    case 'valor': return moeda(Number(r.desconto_valor) || 0) + ' de desconto por embalagem';
    case 'preco_final': return 'Preço final de ' + moeda(Number(r.preco_final) || 0) + ' por embalagem';
    default: return percentual + '% de desconto adicional sobre a tabela';
  }
}

export function campanhaAtiva(c: Campanha, hoje = new Date()): boolean {
  const dia = [hoje.getFullYear(), String(hoje.getMonth() + 1).padStart(2, '0'), String(hoje.getDate()).padStart(2, '0')].join('-');
  return c.status === 'ativa' && !!c.inicio && !!c.fim && c.inicio <= dia && c.fim >= dia;
}

export function produtoNaRegra(p: Produto, r: RegraCampanha): boolean {
  return (r.produto_ids || []).includes(p.id) ||
    (!!r.familia && p.familia?.toLocaleLowerCase('pt-BR') === r.familia.toLocaleLowerCase('pt-BR'));
}

export function avaliarCampanhas(
  campanhas: Campanha[],
  itens: ItemVendaCampanha[],
  produtos: Produto[],
  hoje = new Date(),
): OportunidadeCampanha[] {
  const byId = new Map(produtos.map(p => [p.id, p]));
  const vendas = itens.filter(i => !i.tipo_operacao || i.tipo_operacao === 'VENDA');
  const avaliacoes: OportunidadeCampanha[] = [];
  for (const campanha of campanhas) {
    if (!campanhaAtiva(campanha, hoje)) continue;
    for (const regra of campanha.regras || []) {
      const minimo = Number(regra.minimo);
      if (!Number.isFinite(minimo) || minimo <= 0) continue;
      const elegiveis = vendas.filter(i => {
        const p = byId.get(i.produto_id || '');
        return !!p && produtoNaRegra(p, regra);
      });
      const quantidade = elegiveis.reduce((sum, i) => {
        const p = byId.get(i.produto_id || '')!;
        const qtd = Math.max(0, Number(i.quantidade) || 0);
        return sum + qtd * (regra.unidade === 'unidades' ? (p.quant_embalagem || 1) : regra.unidade === 'kg' ? (p.peso_embalagem || 0) : 1);
      }, 0);
      // Quando a regra contempla vários SKUs, nunca escolher o bonificado por aproximação.
      const unico = [...new Set(elegiveis.map(i => i.produto_id || ''))];
      const bonusProdutoId = regra.bonus_produto_id || (unico.length === 1 ? unico[0] : null);
      const elegivel = quantidade >= minimo &&
        (regra.tipo === 'bonificacao'
          ? !!bonusProdutoId && byId.has(bonusProdutoId)
          : descontoValido(regra));
      const bonusQuantidade = regra.tipo === 'bonificacao' && elegivel
        ? (regra.repetivel ? Math.floor(quantidade / minimo) : 1) * Math.max(0, Math.floor(Number(regra.bonus_quantidade) || 0))
        : 0;
      avaliacoes.push({
        campanha, regra, quantidade,
        falta: Math.max(0, minimo - quantidade),
        elegivel: elegivel && (regra.tipo !== 'bonificacao' || bonusQuantidade > 0),
        bonusProdutoId,
        bonusQuantidade,
        descontoPercentual: regra.tipo === 'desconto' && elegivel &&
          ['adicional_percentual', 'absoluto_percentual'].includes(modalidadeDesconto(regra))
          ? Math.min(100, Math.max(0, Number(regra.desconto_percentual) || 0)) : 0,
      });
    }
  }
  return avaliacoes;
}

export function campanhasParaHistorico(
  campanhas: Campanha[],
  historico: { produto_id?: string }[],
  produtos: Produto[],
): Campanha[] {
  const comprados = new Set(historico.map(h => h.produto_id).filter(Boolean));
  return campanhas.filter(c => campanhaAtiva(c) && c.regras?.some(r => produtos.some(p => comprados.has(p.id) && produtoNaRegra(p, r))));
}
