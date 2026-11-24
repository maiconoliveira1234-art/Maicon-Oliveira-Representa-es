import { describe, it, expect } from 'vitest';
import { parsePricing, pricingFields, syncWindow } from '../../supabase/functions/whatsapp-custos/pricing';

describe('custo do WhatsApp (pricing_analytics da Meta)', () => {
  it('janela de 89 dias em meia-noite UTC até amanhã', () => {
    const w = syncWindow(new Date('2026-11-24T10:30:00Z'));
    expect(w.end).toBe(Date.UTC(2026, 10, 25) / 1000);
    expect(w.start).toBe(Date.UTC(2026, 10, 24) / 1000 - 89 * 86400);
    expect(w.firstDay).toBe('2026-08-27');
  });

  it('monta o campo da consulta com custo e volume por categoria e tipo', () => {
    expect(pricingFields(1, 2)).toBe('currency,pricing_analytics.start(1).end(2).granularity(DAILY).metric_types(["COST","VOLUME"]).dimensions(["PRICING_CATEGORY","PRICING_TYPE"])');
    expect(pricingFields(1, 2, false)).toBe('currency,pricing_analytics.start(1).end(2).granularity(DAILY).metric_types(["VOLUME"]).dimensions(["PRICING_CATEGORY","PRICING_TYPE"])');
  });

  it('converte os pontos em linhas por dia, somando repetidos', () => {
    const day = Date.UTC(2026, 10, 20) / 1000;
    const rows = parsePricing({
      currency: 'BRL',
      pricing_analytics: { data: [{ data_points: [
        { start: day, end: day + 86400, pricing_category: 'SERVICE', pricing_type: 'REGULAR', volume: 3, cost: 0.12 },
        { start: day, end: day + 86400, pricing_category: 'SERVICE', pricing_type: 'REGULAR', volume: 2, cost: 0.08 },
        { start: day, end: day + 86400, pricing_category: 'SERVICE', pricing_type: 'FREE_ENTRY_POINT', volume: 4, cost: 0 },
        { start: day + 86400, end: day + 2 * 86400, pricing_category: 'utility', pricing_type: 'regular', volume: 1 },
        { start: 'x', pricing_category: 'SERVICE', volume: 9, cost: 9 },
      ] }] },
    });
    expect(rows).toEqual([
      { dia: '2026-11-20', categoria: 'SERVICE', tipo: 'FREE_ENTRY_POINT', volume: 4, custo: 0, moeda: 'BRL' },
      { dia: '2026-11-20', categoria: 'SERVICE', tipo: 'REGULAR', volume: 5, custo: 0.2, moeda: 'BRL' },
      { dia: '2026-11-21', categoria: 'UTILITY', tipo: 'REGULAR', volume: 1, custo: null, moeda: 'BRL' },
    ]);
  });

  it('resposta sem custos não gera linhas', () => {
    expect(parsePricing({ currency: 'USD', id: '1' })).toEqual([]);
    expect(parsePricing(null)).toEqual([]);
  });
});
