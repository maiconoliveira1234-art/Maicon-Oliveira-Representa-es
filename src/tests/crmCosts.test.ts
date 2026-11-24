import { describe, it, expect } from 'vitest';
import { feeCharges, summarizeWhatsApp, whatsappRowCostBrl, type WhatsAppCostRow } from '../lib/crmCosts';

const row = (dia: string, categoria: string, tipo: string, volume: number, custo: number | null = null, moeda = 'BRL'): WhatsAppCostRow =>
  ({ dia, categoria, tipo, volume, custo, moeda });

describe('custos do WhatsApp', () => {
  it('mensagens grátis custam zero; cobradas usam o custo da Meta ou a estimativa', () => {
    expect(whatsappRowCostBrl(row('2026-11-16', 'SERVICE', 'FREE_CUSTOMER_SERVICE', 10), 5)).toEqual({ valor: 0, estimado: false });
    expect(whatsappRowCostBrl(row('2026-11-16', 'SERVICE', 'REGULAR', 10, 0.4), 5)).toEqual({ valor: 0.4, estimado: false });
    expect(whatsappRowCostBrl(row('2026-11-16', 'SERVICE', 'REGULAR', 10, 0.1, 'USD'), 5)).toEqual({ valor: 0.5, estimado: false });
    const est = whatsappRowCostBrl(row('2026-11-16', 'SERVICE', 'REGULAR', 10), 5);
    expect(est.estimado).toBe(true);
    expect(est.valor).toBeCloseTo(10 * 0.0068 * 5, 10);
    expect(whatsappRowCostBrl(row('2026-11-16', 'MARKETING', 'REGULAR', 3), 5)).toEqual({ valor: null, estimado: true });
  });

  it('resume por categoria e por dia', () => {
    const s = summarizeWhatsApp([
      row('2026-11-16', 'SERVICE', 'FREE_CUSTOMER_SERVICE', 10),
      row('2026-11-17', 'SERVICE', 'REGULAR', 5),
      row('2026-11-17', 'MARKETING', 'REGULAR', 2),
      row('2026-11-18', 'UTILITY', 'FREE_CUSTOMER_SERVICE', 1),
    ], 5);
    expect(s.cobradas).toBe(7);
    expect(s.gratis).toBe(11);
    expect(s.semPreco).toBe(2);
    expect(s.estimado).toBe(true);
    expect(s.custo).toBeCloseTo(5 * 0.0068 * 5, 10);
    expect(s.porCategoria.map(c => [c.label, c.cobradas, c.gratis])).toEqual([
      ['Atendimento', 5, 10], ['Marketing', 2, 0], ['Utilidade', 0, 1],
    ]);
    expect([...s.porDia.entries()].map(([d, v]) => [d, Math.round(v * 1000) / 1000])).toEqual([
      ['2026-11-16', 0], ['2026-11-17', 0.17], ['2026-11-18', 0],
    ]);
  });

  it('só grátis: custo zero e não estimado', () => {
    const s = summarizeWhatsApp([row('2026-11-16', 'SERVICE', 'FREE_CUSTOMER_SERVICE', 22)], 5);
    expect(s).toMatchObject({ custo: 0, cobradas: 0, gratis: 22, estimado: false, semPreco: 0 });
  });
});

describe('mensalidade do easyCoexistence', () => {
  const first = new Date(2026, 10, 13);
  it('conta as cobranças do período', () => {
    expect(feeCharges(new Date(2026, 10, 1), new Date(2026, 10, 24), first)).toBe(1);
    expect(feeCharges(new Date(2026, 9, 1), new Date(2026, 9, 31, 23, 59), first)).toBe(0);
    expect(feeCharges(null, new Date(2027, 1, 20), first)).toBe(4);
    expect(feeCharges(new Date(2026, 11, 1), new Date(2026, 11, 12), first)).toBe(0);
    expect(feeCharges(new Date(2026, 11, 1), new Date(2026, 11, 31, 23, 59), first)).toBe(1);
  });
  it('dia 31 cai no último dia dos meses curtos', () => {
    const d31 = new Date(2027, 0, 31);
    expect(feeCharges(new Date(2027, 1, 1), new Date(2027, 1, 28), d31)).toBe(1);
  });
});
