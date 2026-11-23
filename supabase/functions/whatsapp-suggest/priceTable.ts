// Tabela e preço que a IA informa ao cliente no WhatsApp.
// A faixa segue a mesma regra da tela de pedido: peso comprado nos últimos 28 dias corridos
// (0 a 28 dias, linhas do histórico com produto conhecido, qtd x peso da embalagem).
//   ativa  -> o peso dos últimos 28 dias garante uma faixa hoje
//   ultima -> sem faixa hoje: a faixa mais recente que o cliente teve em alguma compra anterior
//   livre  -> cliente nunca atingiu faixa (ou sem histórico)
// O preço informado é sempre o da unidade de venda ao consumidor, já com o desconto da faixa.

export type Faixa = 'livre' | '200kg' | '500kg' | '1000kg' | '2000kg' | '4000kg';
export type TabelaTipo = 'ativa' | 'ultima' | 'livre';

export type PriceProduct = {
  id: string;
  produto: string;
  peso_embalagem: number | null;
  quant_embalagem?: number | null;
  custo_und?: number | null;
  custo_total?: number | null;
  sugestao?: number | null;
  livre?: number | null;
  '200kg'?: number | null;
  '500kg'?: number | null;
  '1000kg'?: number | null;
  '2000kg'?: number | null;
  '4000kg'?: number | null;
};
export type PriceSale = {
  faturamento: string | null;
  produto_id: string | null;
  produtos: string | null;
  qtd: number | null;
};
export type TabelaCliente = {
  tipo: TabelaTipo;
  faixa: Faixa;
  /** Peso comprado nos 28 dias até hoje. */
  pesoAtivo: number;
  /** Data da compra que garantiu a última tabela (só quando tipo = ultima). */
  dataUltima: string | null;
  /** Peso dos 28 dias que levou à última tabela (só quando tipo = ultima). */
  pesoUltima: number;
};

const num = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const DAY = 86400000;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}/;

export function faixaPorPeso(peso: number): Faixa {
  if (peso >= 4000) return '4000kg';
  if (peso >= 2000) return '2000kg';
  if (peso >= 1000) return '1000kg';
  if (peso >= 500) return '500kg';
  if (peso >= 200) return '200kg';
  return 'livre';
}

/** Dia corrente em São Paulo (YYYY-MM-DD), independente do relógio UTC do servidor. */
export function hojeSaoPaulo(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** Dias corridos entre duas datas YYYY-MM-DD (ate - de). */
export function diasCorridos(de: string, ate: string): number {
  return Math.round((Date.parse(ate.slice(0, 10) + 'T00:00:00Z') - Date.parse(de.slice(0, 10) + 'T00:00:00Z')) / DAY);
}

/** Desconto da tabela em fração (0.16). Aceita também 16 = 16%, como a tela de pedido. */
export function normalizarDesconto(value: unknown): number {
  const parsed = typeof value === 'string' ? Number(value.trim().replace(',', '.')) : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.min(1, parsed > 1 ? parsed / 100 : parsed);
}

function productLookup(products: PriceProduct[]) {
  const byId = new Map(products.map(p => [p.id, p]));
  const byName = new Map(products.map(p => [String(p.produto || '').toLowerCase(), p]));
  return (s: PriceSale) => (s.produto_id ? byId.get(s.produto_id) : undefined)
    || (s.produtos ? byName.get(String(s.produtos).toLowerCase()) : undefined);
}

/** Peso comprado nos 28 dias corridos que terminam em `ate` (inclusive). */
export function pesoJanela28(sales: PriceSale[], products: PriceProduct[], ate: string): number {
  const find = productLookup(products);
  let total = 0;
  for (const s of sales) {
    if (!s.faturamento || !ISO_DAY.test(s.faturamento)) continue;
    const dias = diasCorridos(s.faturamento, ate);
    if (dias < 0 || dias > 28) continue;
    const p = find(s);
    if (p) total += num(s.qtd) * num(p.peso_embalagem);
  }
  return Math.round(total * 1000) / 1000;
}

export function tabelaDoCliente(sales: PriceSale[], products: PriceProduct[], hoje: string): TabelaCliente {
  const pesoAtivo = pesoJanela28(sales, products, hoje);
  const faixaAtiva = faixaPorPeso(pesoAtivo);
  if (faixaAtiva !== 'livre') return { tipo: 'ativa', faixa: faixaAtiva, pesoAtivo, dataUltima: null, pesoUltima: 0 };

  // Cada compra abre uma janela de 28 dias; a mais recente que atingiu faixa é a última tabela do cliente.
  const datas = [...new Set(sales
    .map(s => String(s.faturamento || '').slice(0, 10))
    .filter(d => ISO_DAY.test(d) && d <= hoje))].sort().reverse();
  for (const data of datas) {
    const peso = pesoJanela28(sales, products, data);
    const faixa = faixaPorPeso(peso);
    if (faixa !== 'livre') return { tipo: 'ultima', faixa, pesoAtivo, dataUltima: data, pesoUltima: peso };
  }
  return { tipo: 'livre', faixa: 'livre', pesoAtivo, dataUltima: null, pesoUltima: 0 };
}

/** Preço da unidade de venda e da caixa na faixa, e a sugestão de venda por unidade (0 = sem sugestão). */
export function precoNaFaixa(p: PriceProduct, faixa: Faixa) {
  const desconto = normalizarDesconto((p as Record<string, unknown>)[faixa]);
  const unidade = Math.round(num(p.custo_und) * (1 - desconto) * 100) / 100;
  const caixa = Math.round(num(p.custo_total) * (1 - desconto) * 100) / 100;
  const sugestao = num(p.sugestao) > 0 ? Math.round(num(p.sugestao) * 100) / 100 : 0;
  return { desconto, unidade, caixa, sugestao };
}

/** Texto que o CRM passa à IA sobre a tabela do cliente. */
export function descreverTabela(t: TabelaCliente): string {
  if (t.tipo === 'ativa') return `ativa (faixa ${t.faixa}; ${t.pesoAtivo.toFixed(1)} kg comprados nos últimos 28 dias)`;
  if (t.tipo === 'ultima') return `ultima (faixa ${t.faixa}, conquistada até a compra de ${t.dataUltima}; não está ativa hoje)`;
  return 'livre (cliente sem tabela ativa e sem tabela anterior)';
}
