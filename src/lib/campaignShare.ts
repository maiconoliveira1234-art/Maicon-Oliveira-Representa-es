// Mensagem de WhatsApp que apresenta uma campanha ao cliente: como funciona, investimento e benefício.
// Preços sempre da unidade de venda, já com o desconto da tabela (mesma regra da IA do WhatsApp).
// A tabela de cada SKU é a maior entre a escolhida e a que o próprio pedido mínimo da campanha garante.
import type { Produto } from '../types';
import {
  campanhaAtiva, descontoValido, modalidadeDesconto,
  type Campanha, type OportunidadeCampanha, type RegraCampanha,
} from './campaignEngine';
import { calcularPrecoDeCampanha } from './campaignPricing';
import { faixaPorPeso, hojeSaoPaulo, precoNaFaixa, tabelaDoCliente, type Faixa } from '../../supabase/functions/whatsapp-suggest/priceTable.ts';

export { hojeSaoPaulo, tabelaDoCliente };
export type { Faixa };

export const FAIXAS: Faixa[] = ['livre', '200kg', '500kg', '1000kg', '2000kg', '4000kg'];
export const rotuloFaixa = (f: Faixa) => f === 'livre' ? 'tabela livre' : 'tabela ' + f.replace('kg', ' kg');
const maiorFaixa = (a: Faixa, b: Faixa): Faixa => FAIXAS.indexOf(a) >= FAIXAS.indexOf(b) ? a : b;

/** Quantos itens do grupo aparecem um a um na mensagem; acima disso, só a faixa de preço. */
const MAX_LISTA = 8;

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const num = (n: number, casas = 2) => n.toLocaleString('pt-BR', { maximumFractionDigits: casas });
const moeda = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }).replace(/ /g, ' ');
const pct = (v: number) => num(v, 1) + '%';
const data = (iso: string) => iso ? iso.slice(0, 10).split('-').reverse().join('/') : '';
const qtd = (p: Produto) => Number(p.quant_embalagem) > 1 ? Number(p.quant_embalagem) : 1;
const contar = (n: number, um: string, varios: string) => `${num(n)} ${n === 1 ? um : varios}`;
const iguais = (a: number, b: number) => Math.abs(a - b) < 0.005;
const intervalo = (valores: number[], fmt: (v: number) => string) => {
  const min = Math.min(...valores), max = Math.max(...valores);
  return iguais(min, max) ? fmt(min) : `${fmt(min)} a ${fmt(max)}`;
};

/** "10 caixas (40 unidades)" ou "10 unidades". */
export function embalagensTexto(n: number, unidadesPorEmbalagem: number): string {
  return unidadesPorEmbalagem > 1
    ? `${contar(n, 'caixa', 'caixas')} (${contar(n * unidadesPorEmbalagem, 'unidade', 'unidades')})`
    : contar(n, 'unidade', 'unidades');
}

/** Nome da embalagem do grupo: caixa, unidade ou embalagem quando há os dois tipos. */
function nomeEmbalagem(produtos: Produto[]): [string, string] {
  const tipos = new Set(produtos.map(p => qtd(p) > 1));
  if (tipos.size === 1 && tipos.has(true)) return ['caixa', 'caixas'];
  if (tipos.size === 1) return ['unidade', 'unidades'];
  return ['embalagem', 'embalagens'];
}

function minimoTexto(r: RegraCampanha, grupo: Produto[]): string {
  const n = Number(r.minimo) || 0;
  if (r.unidade === 'kg') return `${num(n)} kg`;
  if (r.unidade === 'unidades') return contar(n, 'unidade', 'unidades');
  const [um, varios] = nomeEmbalagem(grupo);
  return contar(n, um, varios);
}

/** Quantidade do pedido (caixas/sacos) de um SKU que atinge o mínimo da regra. */
function embalagensNecessarias(r: RegraCampanha, p: Produto): number | null {
  const minimo = Number(r.minimo) || 0;
  if (minimo <= 0) return null;
  if (r.unidade === 'kg') {
    const peso = Number(p.peso_embalagem) || 0;
    return peso > 0 ? Math.ceil(minimo / peso - 1e-9) : null;
  }
  if (r.unidade === 'unidades') return Math.ceil(minimo / qtd(p) - 1e-9);
  return minimo;
}

export function participantesDaRegra(r: RegraCampanha, produtos: Produto[]): Produto[] {
  const ids = new Set(r.produto_ids || []);
  const familia = (r.familia || '').toLocaleLowerCase('pt-BR');
  return produtos
    .filter(p => ids.has(p.id) || (!!familia && p.ativo !== false && (p.familia || '').toLocaleLowerCase('pt-BR') === familia))
    .sort((a, b) => a.produto.localeCompare(b.produto, 'pt-BR'));
}

function descontoParaCliente(r: RegraCampanha, grupo: Produto[]): string {
  const modo = modalidadeDesconto(r);
  const [um] = nomeEmbalagem(grupo);
  const quants = new Set(grupo.map(qtd));
  switch (modo) {
    case 'absoluto_percentual': return `${pct(Number(r.desconto_percentual))} de desconto sobre o preço cheio`;
    case 'valor': return `${moeda(Number(r.desconto_valor) || 0)} de desconto por ${um}`;
    case 'preco_final': {
      const final = Number(r.preco_final) || 0;
      return quants.size === 1
        ? `preço especial de ${moeda(r2(final / [...quants][0]))} a unidade`
        : `preço especial de ${moeda(final)} por ${um}`;
    }
    default: return `${pct(Number(r.desconto_percentual))} de desconto adicional sobre a sua tabela`;
  }
}

type LinhaSku = {
  produto: Produto;
  faixa: Faixa;
  embalagens: number;
  unidades: number;
  unidadeTabela: number;
  unidadeCampanha: number;
  investimento: number;
  economia: number;
  bonusValor: number;
  bonusUnidades: number;
};

export type OpcoesMensagem = {
  /** Tabela do cliente (ou escolhida). O pedido mínimo da campanha pode garantir uma maior. */
  faixa: Faixa;
  nomeCliente?: string;
  agora?: Date;
};
export type MensagemCampanha = { texto: string; avisos: string[] };

export function mensagemCampanha(campanha: Campanha, produtos: Produto[], opcoes: OpcoesMensagem): MensagemCampanha {
  const agora = opcoes.agora ?? new Date();
  const hoje = hojeSaoPaulo(agora);
  const byId = new Map(produtos.map(p => [p.id, p]));
  const avisos: string[] = [];
  if (!campanhaAtiva(campanha, agora)) avisos.push('Campanha fora da vigência ou não ativa.');
  const varias = (campanha.regras || []).length > 1;

  const blocos = (campanha.regras || []).map((r, i) => {
    const rotulo = varias ? `Condição ${i + 1} — ` : '';
    const grupo = participantesDaRegra(r, produtos);
    if (r.pendencias_importacao?.length) avisos.push(`${rotulo}Há SKUs do encarte ainda não conferidos.`);
    if (!grupo.length) {
      avisos.push(`${rotulo}Nenhum produto participante cadastrado.`);
      return '';
    }
    const desconto = r.tipo === 'desconto';
    if (desconto && !descontoValido(r)) avisos.push(`${rotulo}Desconto inválido.`);
    const bonus = r.tipo === 'bonificacao'
      ? (r.bonus_produto_id ? byId.get(r.bonus_produto_id) : grupo.length === 1 ? grupo[0] : undefined)
      : undefined;
    const bonusQtd = Math.max(0, Math.floor(Number(r.bonus_quantidade) || 0));
    if (r.tipo === 'bonificacao' && !bonus) avisos.push(`${rotulo}SKU bonificado não definido.`);

    const oferta: OportunidadeCampanha = {
      campanha, regra: r, quantidade: Number(r.minimo) || 0, falta: 0, elegivel: true,
      bonusProdutoId: bonus?.id ?? null, bonusQuantidade: bonusQtd, descontoPercentual: 0,
    };
    const semPreco: string[] = [];
    const linhas: LinhaSku[] = [];
    for (const p of grupo) {
      const embalagens = embalagensNecessarias(r, p);
      if (!embalagens) { semPreco.push(p.produto); continue; }
      const faixa = maiorFaixa(opcoes.faixa, faixaPorPeso(embalagens * (Number(p.peso_embalagem) || 0)));
      const unidadeTabela = precoNaFaixa(p, faixa).unidade;
      if (unidadeTabela <= 0) { semPreco.push(p.produto); continue; }
      const unidades = embalagens * qtd(p);
      const investimentoTabela = r2(unidadeTabela * unidades);
      const embalagemCampanha = desconto && descontoValido(r)
        ? calcularPrecoDeCampanha(p, unidadeTabela, [oferta]).valorEmbalagem
        : unidadeTabela * qtd(p);
      const investimento = r2(embalagemCampanha * embalagens);
      const bonusUnidade = bonus ? precoNaFaixa(bonus, faixa).unidade : 0;
      if (bonus && bonusUnidade <= 0 && !semPreco.includes(bonus.produto)) semPreco.push(bonus.produto);
      linhas.push({
        produto: p, faixa, embalagens, unidades, unidadeTabela,
        unidadeCampanha: r2(embalagemCampanha / qtd(p)),
        investimento,
        economia: desconto ? r2(investimentoTabela - investimento) : 0,
        bonusValor: bonus ? r2(bonusUnidade * qtd(bonus) * bonusQtd) : 0,
        bonusUnidades: bonus ? bonusQtd * qtd(bonus) : 0,
      });
    }
    if (semPreco.length) avisos.push(`${rotulo}Sem preço ou peso cadastrado: ${semPreco.join(', ')}.`);
    if (desconto && linhas.some(l => l.economia <= 0))
      avisos.push(`${rotulo}Na tabela escolhida, a campanha não reduz o preço de ${linhas.filter(l => l.economia <= 0).map(l => l.produto.produto).join(', ')}.`);

    const unico = grupo.length === 1 ? grupo[0] : null;
    const listar = !unico && grupo.length <= MAX_LISTA;
    const de = unico ? `de ${unico.produto}`
      : listar ? 'entre os produtos abaixo (pode combinar)'
      : r.familia ? `de produtos da linha ${r.familia} (pode combinar)`
      : `entre ${grupo.length} produtos participantes (pode combinar)`;
    const minimo = minimoTexto(r, grupo);
    const partes: string[] = varias ? [`*Condição ${i + 1}*`] : [];

    if (r.tipo === 'bonificacao') {
      const mesmo = !!unico && bonus?.id === unico.id;
      const ganho = bonus
        ? `${embalagensTexto(bonusQtd, qtd(bonus))} ${mesmo ? 'do mesmo produto' : 'de ' + bonus.produto}`
        : `${contar(bonusQtd, 'embalagem bonificada', 'embalagens bonificadas')}`;
      partes.push(`*Como funciona:* na compra de ${minimo} ${de}, você ganha ${ganho}. ` +
        (r.repetivel ? `A bonificação se repete a cada ${minimo}.` : 'Bonificação de uma vez por pedido.'));
    } else {
      partes.push(`*Como funciona:* comprando a partir de ${minimo} ${de}, você tem ${descontoParaCliente(r, grupo)}.`);
    }
    if (listar) {
      for (const p of grupo) {
        const l = linhas.find(x => x.produto.id === p.id);
        if (!l) continue;
        partes.push(desconto && l.economia > 0
          ? `• ${p.produto}: de ${moeda(l.unidadeTabela)} por ${moeda(l.unidadeCampanha)} a unidade`
          : `• ${p.produto}: ${moeda(l.unidadeCampanha)} a unidade`);
      }
    } else if (!unico && linhas.length) {
      partes.push(`Preço da unidade: ${intervalo(linhas.map(l => l.unidadeCampanha), moeda)}.`);
    }

    if (!linhas.length) return partes.join('\n');
    const faixas = new Set(linhas.map(l => l.faixa));
    const naTabela = faixas.size === 1 ? `, na ${rotuloFaixa(linhas[0].faixa)}` : '';
    if (unico) {
      const l = linhas[0];
      partes.push(`*Investimento:* ${moeda(l.investimento)} em ${embalagensTexto(l.embalagens, qtd(l.produto))}, a ${moeda(l.unidadeCampanha)} a unidade${naTabela}.`);
    } else {
      const invs = linhas.map(l => l.investimento);
      partes.push(`*Investimento:* ${iguais(Math.min(...invs), Math.max(...invs)) ? '' : 'a partir de '}${moeda(Math.min(...invs))} no pedido mínimo${naTabela}.`);
    }

    if (r.tipo === 'bonificacao' && bonus) {
      const comValor = linhas.filter(l => l.bonusValor > 0);
      if (comValor.length) {
        const equivale = comValor.map(l => 100 * l.bonusValor / (l.investimento + l.bonusValor));
        let texto = `*Benefício:* ${embalagensTexto(bonusQtd, qtd(bonus))} de bonificação, no valor de ${intervalo(comValor.map(l => l.bonusValor), moeda)}.`;
        const l = comValor[0];
        if (unico && bonus.id === unico.id && comValor.length === 1) {
          texto += ` Na prática, cada unidade sai a ${moeda(r2(l.investimento / (l.unidades + l.bonusUnidades)))}, o equivalente a ${pct(equivale[0])} de desconto.`;
        } else {
          texto += ` Equivale a ${intervalo(equivale, pct)} de desconto no pedido mínimo.`;
        }
        partes.push(texto);
      }
    } else if (desconto) {
      const comGanho = linhas.filter(l => l.economia > 0);
      if (comGanho.length) {
        if (unico) {
          const l = comGanho[0];
          partes.push(`*Benefício:* economia de ${moeda(l.economia)} no pedido mínimo; a unidade passa de ${moeda(l.unidadeTabela)} para ${moeda(l.unidadeCampanha)}.`);
        } else {
          partes.push(`*Benefício:* economia de ${intervalo(comGanho.map(l => l.economia), moeda)} no pedido mínimo.`);
        }
      }
    }
    return partes.join('\n');
  }).filter(Boolean);

  const hora = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', hour: 'numeric', hourCycle: 'h23' }).format(agora));
  const saudacao = hora < 12 ? 'Bom dia' : hora < 18 ? 'Boa tarde' : 'Boa noite';
  const nome = (opcoes.nomeCliente || '').trim();
  const validade = campanha.inicio && campanha.inicio > hoje
    ? `Válida de ${data(campanha.inicio)} a ${data(campanha.fim)}.`
    : campanha.fim ? `Válida até ${data(campanha.fim)}.` : '';
  const observacoes = (campanha.descricao || '').trim();

  const texto = [
    `${saudacao}${nome ? ', ' + nome : ''}! Tudo bem?`,
    'Tenho uma campanha que vale a pena para a sua loja:',
    '',
    `*${(campanha.titulo || '').trim()}*`,
    validade,
    '',
    blocos.join('\n\n'),
    observacoes ? `\n*Observações:* ${observacoes}` : '',
    '',
    'Quer que eu já monte o seu pedido?',
  ].join('\n').replace(/\n{3,}/g, '\n\n').trim();

  return { texto, avisos };
}
