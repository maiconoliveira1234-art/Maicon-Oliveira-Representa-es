import type { Produto } from '../types';

export type TipoBeneficio = 'bonificacao' | 'desconto';
export type RegraCampanha = {
  id: string;
  tipo: TipoBeneficio;
  produto_ids: string[];
  familia: string;
  minimo: number;
  unidade?: 'embalagens' | 'unidades' | 'kg';
  repetivel: boolean;
  bonus_produto_id: string;
  bonus_quantidade: number;
  desconto_percentual: number;
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
      const elegivel = quantidade >= minimo && (regra.tipo !== 'bonificacao' || !!bonusProdutoId && byId.has(bonusProdutoId));
      const bonusQuantidade = regra.tipo === 'bonificacao' && elegivel
        ? (regra.repetivel ? Math.floor(quantidade / minimo) : 1) * Math.max(0, Math.floor(Number(regra.bonus_quantidade) || 0))
        : 0;
      avaliacoes.push({
        campanha, regra, quantidade,
        falta: Math.max(0, minimo - quantidade),
        elegivel: elegivel && (regra.tipo !== 'bonificacao' || bonusQuantidade > 0),
        bonusProdutoId,
        bonusQuantidade,
        descontoPercentual: regra.tipo === 'desconto' && elegivel
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
