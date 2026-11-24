import { describe, it, expect } from 'vitest';
import { aiMonthProjection, aiPeriodRange, formatTokens, formatUsd, summarizeAiUsage, type AiUsageRow } from '../lib/aiUsage';

const row = (criado_em: string, tarefa: string, custo: number | null, entrada = 1000, saida = 100): AiUsageRow => ({
  criado_em, tarefa, modelo: 'claude-haiku-5-5',
  tokens_entrada: entrada, tokens_saida: saida, tokens_cache_escrita: 0, tokens_cache_leitura: 0, custo_usd: custo,
});

describe('custo de IA', () => {
  it('soma gasto, respostas e tokens por tarefa e por dia', () => {
    const s = summarizeAiUsage([
      row('2026-11-24T12:00:00-03:00', 'imagem', 0.004, 30000, 200),
      row('2026-11-24T15:00:00-03:00', 'sugestao', 0.0015),
      row('2026-11-25T09:00:00-03:00', 'imagem', '0.006' as unknown as number, 30000, 200),
      row('2026-11-25T10:00:00-03:00', 'desconhecida', 0.0005),
    ]);
    expect(s.respostas).toBe(4);
    expect(s.custo).toBeCloseTo(0.012, 10);
    expect(s.tokensEntrada).toBe(62000);
    expect(s.porTarefa.map(t => t.tarefa)).toEqual(['imagem', 'sugestao', 'outra']);
    expect(s.porTarefa[0]).toMatchObject({ label: 'Leitura de imagens', respostas: 2, tokensEntrada: 60000 });
    expect(s.porTarefa[0].custo).toBeCloseTo(0.01, 10);
    expect(s.porDia.map(d => [d.dia, d.respostas])).toEqual([['2026-11-24', 2], ['2026-11-25', 2]]);
    expect(s.semPreco).toBe(0);
  });

  it('resposta sem preço conta como resposta mas não soma no gasto', () => {
    const s = summarizeAiUsage([row('2026-11-24T12:00:00-03:00', 'pdf', null), row('2026-11-24T12:00:00-03:00', 'pdf', 0.002)]);
    expect(s.respostas).toBe(2);
    expect(s.semPreco).toBe(1);
    expect(s.custo).toBeCloseTo(0.002, 10);
  });

  it('períodos: mês atual, mês anterior (inclusive virada de ano) e 30 dias', () => {
    const now = new Date(2026, 0, 15, 10);
    expect(aiPeriodRange('mes', now)).toEqual({ start: new Date(2026, 0, 1), end: null });
    expect(aiPeriodRange('mes_anterior', now)).toEqual({ start: new Date(2025, 11, 1), end: new Date(2026, 0, 1) });
    expect(aiPeriodRange('30d', now).start?.getTime()).toBe(now.getTime() - 30 * 86400000);
    expect(aiPeriodRange('tudo', now)).toEqual({ start: null, end: null });
  });

  it('projeção usa o ritmo desde o primeiro registro quando ele é deste mês', () => {
    const now = new Date(2026, 10, 25, 0, 0); // 25/11, faltam 6 dias para 01/12
    const first = new Date(2026, 10, 23, 0, 0); // 2 dias de registro
    expect(aiMonthProjection(0.2, first, now)).toBeCloseTo(0.2 + 0.1 * 6, 10);
    // Registro mais antigo que o mês: ritmo desde o dia 1º
    const older = new Date(2026, 9, 1);
    expect(aiMonthProjection(2.4, older, now)).toBeCloseTo(2.4 + (2.4 / 24) * 6, 10);
    // Menos de um dia de registro ou sem registro: sem projeção
    expect(aiMonthProjection(0.05, new Date(2026, 10, 24, 12), now)).toBeNull();
    expect(aiMonthProjection(0, null, now)).toBeNull();
  });

  it('formata valores pequenos sem virar zero', () => {
    expect(formatUsd(0.00135).replace(/\s/g, ' ')).toBe('US$ 0,0014');
    expect(formatUsd(0.25).replace(/\s/g, ' ')).toBe('US$ 0,250');
    expect(formatUsd(12.5).replace(/\s/g, ' ')).toBe('US$ 12,50');
    expect(formatTokens(950)).toBe('950');
    expect(formatTokens(31234)).toBe('31,2 mil');
    expect(formatTokens(1_250_000)).toBe('1,3 mi');
  });
});
