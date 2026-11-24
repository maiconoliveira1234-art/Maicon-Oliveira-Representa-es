// Custos do CRM em reais: Claude (public.ia_uso), WhatsApp pela Meta (public.whatsapp_custo_diario)
// e a mensalidade do easyCoexistence.

/** Mensalidade do easyCoexistence: 1 número conectado, faixa de 1 a 5 conexões. */
export const EASYCOEXISTENCE = {
  mensalidade: 29.9,
  /** Conectado em 10/11/2026; 3 dias grátis, primeira cobrança em 13/11. */
  primeiraCobranca: new Date(2026, 10, 13),
};

/**
 * Preço por mensagem cobrada no Brasil, em US$, usado quando a Meta não informa o custo
 * (o token do easyCoexistence não tem permissão para ler o custo, só a quantidade).
 * Tabela da Meta de julho/2026: utilidade e autenticação US$ 0,0068; atendimento segue o mesmo preço.
 * Categoria sem preço aqui conta como "sem preço" na tela.
 */
export const META_PRECO_USD: Record<string, number> = {
  SERVICE: 0.0068,
  UTILITY: 0.0068,
  AUTHENTICATION: 0.0068,
};

const CATEGORY_LABELS: Record<string, string> = {
  SERVICE: 'Atendimento',
  UTILITY: 'Utilidade',
  MARKETING: 'Marketing',
  MARKETING_LITE: 'Marketing',
  AUTHENTICATION: 'Autenticação',
  AUTHENTICATION_INTERNATIONAL: 'Autenticação internacional',
};
export const metaCategoryLabel = (c: string) => CATEGORY_LABELS[c] || 'Outras';

export type WhatsAppCostRow = {
  dia: string;
  categoria: string;
  tipo: string;
  volume: number | null;
  custo: number | string | null;
  moeda: string | null;
};

const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const pad = (n: number) => String(n).padStart(2, '0');
/** yyyy-MM-dd no fuso do aparelho. */
export const localDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
/** Data local (meia-noite) de um yyyy-MM-dd. */
export const dayToDate = (dia: string) => new Date(Number(dia.slice(0, 4)), Number(dia.slice(5, 7)) - 1, Number(dia.slice(8, 10)));

/** Mensagem grátis segundo a Meta (janela de atendimento, anúncio...). */
export const isFreeType = (tipo: string) => tipo.toUpperCase().startsWith('FREE');

/**
 * Custo de uma linha em reais. Custo informado pela Meta vem primeiro (na moeda da conta);
 * sem ele, grátis vale zero e cobrada é estimada pelo preço da categoria. null = sem preço.
 */
export function whatsappRowCostBrl(row: WhatsAppCostRow, usdBrl: number): { valor: number | null; estimado: boolean } {
  if (row.custo !== null && row.custo !== undefined && row.custo !== '') {
    const custo = num(row.custo);
    const moeda = String(row.moeda || '').toUpperCase();
    if (moeda === 'BRL') return { valor: custo, estimado: false };
    if (moeda === 'USD') return { valor: custo * usdBrl, estimado: false };
    return { valor: null, estimado: false };
  }
  if (isFreeType(row.tipo) || num(row.volume) === 0) return { valor: 0, estimado: false };
  const price = META_PRECO_USD[row.categoria];
  if (price === undefined) return { valor: null, estimado: true };
  return { valor: num(row.volume) * price * usdBrl, estimado: true };
}

export type WhatsAppCategorySummary = { categoria: string; label: string; cobradas: number; gratis: number; custo: number };
export type WhatsAppSummary = {
  custo: number;
  cobradas: number;
  gratis: number;
  /** Algum valor veio da estimativa pela tabela de preços. */
  estimado: boolean;
  /** Mensagens cobradas sem preço conhecido (não entram no custo). */
  semPreco: number;
  porCategoria: WhatsAppCategorySummary[];
  /** Custo por dia (yyyy-MM-dd). */
  porDia: Map<string, number>;
};

export function summarizeWhatsApp(rows: WhatsAppCostRow[], usdBrl: number): WhatsAppSummary {
  const cats = new Map<string, WhatsAppCategorySummary>();
  const porDia = new Map<string, number>();
  let custo = 0, cobradas = 0, gratis = 0, semPreco = 0, estimado = false;
  for (const row of rows) {
    const volume = num(row.volume);
    const free = isFreeType(row.tipo);
    const { valor, estimado: est } = whatsappRowCostBrl(row, usdBrl);
    const key = CATEGORY_LABELS[row.categoria] ? row.categoria : 'OUTRA';
    const cat = cats.get(key) || { categoria: key, label: metaCategoryLabel(key), cobradas: 0, gratis: 0, custo: 0 };
    if (free) { gratis += volume; cat.gratis += volume; } else { cobradas += volume; cat.cobradas += volume; }
    if (valor === null) semPreco += volume;
    else {
      custo += valor;
      cat.custo += valor;
      porDia.set(row.dia, (porDia.get(row.dia) || 0) + valor);
      if (est && valor > 0) estimado = true;
    }
    cats.set(key, cat);
  }
  return {
    custo, cobradas, gratis, estimado, semPreco, porDia,
    porCategoria: [...cats.values()].sort((a, b) => b.custo - a.custo || (b.cobradas + b.gratis) - (a.cobradas + a.gratis)),
  };
}

const addMonths = (d: Date, k: number) => {
  const target = new Date(d.getFullYear(), d.getMonth() + k, 1);
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  return new Date(target.getFullYear(), target.getMonth(), Math.min(d.getDate(), last));
};

/** Quantas mensalidades vencem entre start (inclusive) e end (inclusive). start null = desde a primeira. */
export function feeCharges(start: Date | null, end: Date, first = EASYCOEXISTENCE.primeiraCobranca): number {
  let count = 0;
  for (let k = 0; k < 600; k++) {
    const due = addMonths(first, k);
    if (due > end) break;
    if (!start || due >= start) count++;
  }
  return count;
}
