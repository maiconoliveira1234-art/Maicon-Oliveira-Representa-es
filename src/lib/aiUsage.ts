// Custo de IA: soma as linhas de public.ia_uso (gravadas pelas edge functions a cada resposta cobrada).

export type AiUsageRow = {
  criado_em: string;
  tarefa: string;
  modelo: string;
  tokens_entrada: number | null;
  tokens_saida: number | null;
  tokens_cache_escrita: number | null;
  tokens_cache_leitura: number | null;
  custo_usd: number | string | null;
};

export type AiPeriod = 'mes' | 'mes_anterior' | '30d' | 'tudo';

export const AI_PERIOD_LABELS: Record<AiPeriod, string> = {
  mes: 'Este mês',
  mes_anterior: 'Mês anterior',
  '30d': 'Últimos 30 dias',
  tudo: 'Tudo',
};

const TASK_LABELS: Record<string, string> = {
  sugestao: 'Sugestões de resposta',
  imagem: 'Leitura de imagens',
  pdf: 'Leitura de PDFs',
  pedido: 'Análise de pedidos',
  estilo: 'Perfil de estilo',
  teste: 'Teste de conexão',
};

export const aiTaskLabel = (task: string) => TASK_LABELS[task] || 'Outras';

const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const DAY = 86400000;
const pad = (n: number) => String(n).padStart(2, '0');
/** yyyy-MM-dd no fuso do aparelho. */
const localDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Início (inclusive) e fim (exclusivo) do período, no fuso do aparelho. null = sem limite. */
export function aiPeriodRange(period: AiPeriod, now = new Date()): { start: Date | null; end: Date | null } {
  if (period === 'mes') return { start: new Date(now.getFullYear(), now.getMonth(), 1), end: null };
  if (period === 'mes_anterior') {
    return { start: new Date(now.getFullYear(), now.getMonth() - 1, 1), end: new Date(now.getFullYear(), now.getMonth(), 1) };
  }
  if (period === '30d') return { start: new Date(now.getTime() - 30 * DAY), end: null };
  return { start: null, end: null };
}

export type AiTaskSummary = {
  tarefa: string;
  label: string;
  respostas: number;
  custo: number;
  tokensEntrada: number;
  tokensSaida: number;
};

export type AiUsageSummary = {
  custo: number;
  respostas: number;
  tokensEntrada: number;
  tokensSaida: number;
  /** Respostas de modelos sem preço cadastrado (não entram no custo). */
  semPreco: number;
  porTarefa: AiTaskSummary[];
  /** Um item por dia com uso, em ordem cronológica. dia = yyyy-MM-dd. */
  porDia: { dia: string; custo: number; respostas: number }[];
};

export function summarizeAiUsage(rows: AiUsageRow[]): AiUsageSummary {
  const tasks = new Map<string, AiTaskSummary>();
  const days = new Map<string, { dia: string; custo: number; respostas: number }>();
  let custo = 0, tokensEntrada = 0, tokensSaida = 0, semPreco = 0;
  for (const row of rows) {
    const cost = row.custo_usd === null || row.custo_usd === undefined ? null : num(row.custo_usd);
    const entrada = num(row.tokens_entrada) + num(row.tokens_cache_escrita) + num(row.tokens_cache_leitura);
    const saida = num(row.tokens_saida);
    if (cost === null) semPreco++;
    custo += cost ?? 0;
    tokensEntrada += entrada;
    tokensSaida += saida;

    const key = TASK_LABELS[row.tarefa] ? row.tarefa : 'outra';
    const task = tasks.get(key) || { tarefa: key, label: aiTaskLabel(key), respostas: 0, custo: 0, tokensEntrada: 0, tokensSaida: 0 };
    task.respostas++;
    task.custo += cost ?? 0;
    task.tokensEntrada += entrada;
    task.tokensSaida += saida;
    tasks.set(key, task);

    const created = new Date(row.criado_em);
    if (Number.isNaN(created.getTime())) continue;
    const dia = localDay(created);
    const day = days.get(dia) || { dia, custo: 0, respostas: 0 };
    day.custo += cost ?? 0;
    day.respostas++;
    days.set(dia, day);
  }
  return {
    custo, respostas: rows.length, tokensEntrada, tokensSaida, semPreco,
    porTarefa: [...tasks.values()].sort((a, b) => b.custo - a.custo || b.respostas - a.respostas),
    porDia: [...days.values()].sort((a, b) => a.dia.localeCompare(b.dia)),
  };
}

/**
 * Projeção do gasto do mês corrente no ritmo atual. O ritmo conta a partir do início do mês
 * ou do primeiro registro, o que vier depois. null com menos de um dia de registro.
 */
export function aiMonthProjection(spentThisMonth: number, firstRecord: Date | null, now = new Date()): number | null {
  if (!firstRecord) return null;
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const base = firstRecord > monthStart ? firstRecord : monthStart;
  const elapsed = now.getTime() - base.getTime();
  if (elapsed < DAY) return null;
  const remaining = Math.max(0, monthEnd.getTime() - now.getTime());
  return spentThisMonth + (spentThisMonth / elapsed) * remaining;
}

/** Dólar com casas suficientes para valores pequenos: US$ 12,34 · US$ 0,123 · US$ 0,0013. */
export function formatUsd(value: number): string {
  const abs = Math.abs(value);
  const digits = abs >= 10 || abs === 0 ? 2 : abs >= 0.1 ? 3 : 4;
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'USD', minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
}

/** Real com centavos; valores menores que R$ 0,10 ganham casas para não virar zero: R$ 0,58 · R$ 0,058 · R$ 0,0069. */
export function formatBrlSmall(value: number): string {
  const abs = Math.abs(value);
  const digits = abs >= 0.1 || abs === 0 ? 2 : abs >= 0.01 ? 3 : 4;
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
}

/** 1.234 · 12,3 mil · 1,2 mi */
export function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`;
  if (value >= 10_000) return `${(value / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil`;
  return Math.round(value).toLocaleString('pt-BR');
}
