// Leitura do pricing_analytics da Meta (custo das mensagens do WhatsApp por dia).
// Sem dependências: roda igual no Deno (edge function) e nos testes.

export const LOOKBACK_DAYS = 89;
const DAY = 86400;

export type CostRow = { dia: string; categoria: string; tipo: string; volume: number; custo: number | null; moeda: string | null };

/** Janela pedida à Meta: da meia-noite UTC de LOOKBACK_DAYS dias atrás até a meia-noite UTC de amanhã. */
export function syncWindow(now = new Date()): { start: number; end: number; firstDay: string } {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) / 1000;
  const start = today - LOOKBACK_DAYS * DAY;
  return { start, end: today + DAY, firstDay: new Date(start * 1000).toISOString().slice(0, 10) };
}

/**
 * Campo `fields` da consulta ao WABA: moeda da conta + volume diário por categoria e tipo, e o custo
 * quando `withCost`. O token do easyCoexistence não tem permissão para o custo (erro 10): nesse caso
 * a consulta é refeita só com o volume e a tela estima o custo pela tabela de preços da Meta.
 */
export function pricingFields(start: number, end: number, withCost = true): string {
  return `currency,pricing_analytics.start(${start}).end(${end}).granularity(DAILY)`
    + `.metric_types(${withCost ? '["COST","VOLUME"]' : '["VOLUME"]'}).dimensions(["PRICING_CATEGORY","PRICING_TYPE"])`;
}

const code = (value: unknown, fallback: string) => {
  const text = String(value ?? '').trim().toUpperCase().replace(/[^A-Z0-9_]/g, '').slice(0, 60);
  return text || fallback;
};

/** Converte a resposta da Meta em linhas por dia, somando pontos repetidos (ex.: mais de um país). */
export function parsePricing(body: any): CostRow[] {
  const currency = /^[A-Z]{3}$/.test(String(body?.currency || '').toUpperCase()) ? String(body.currency).toUpperCase() : null;
  const points: any[] = (body?.pricing_analytics?.data || []).flatMap((d: any) => Array.isArray(d?.data_points) ? d.data_points : []);
  const rows = new Map<string, CostRow>();
  for (const p of points) {
    const startSec = Number(p?.start);
    if (!Number.isFinite(startSec) || startSec <= 0) continue;
    const dia = new Date(startSec * 1000).toISOString().slice(0, 10);
    const categoria = code(p?.pricing_category, 'OUTRA');
    const tipo = code(p?.pricing_type, 'REGULAR');
    const key = `${dia}|${categoria}|${tipo}`;
    const row = rows.get(key) || { dia, categoria, tipo, volume: 0, custo: null, moeda: currency };
    const volume = Number(p?.volume);
    if (Number.isFinite(volume) && volume > 0) row.volume += Math.round(volume);
    const cost = Number(p?.cost);
    if (p?.cost !== undefined && p?.cost !== null && Number.isFinite(cost) && cost >= 0) {
      row.custo = Math.round(((row.custo ?? 0) + cost) * 1e6) / 1e6;
    }
    rows.set(key, row);
  }
  return [...rows.values()].sort((a, b) => a.dia.localeCompare(b.dia) || a.categoria.localeCompare(b.categoria) || a.tipo.localeCompare(b.tipo));
}
