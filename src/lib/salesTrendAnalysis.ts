import { HistVenda, Produto, Cliente } from '../types';
import { classifySaleRecord } from './salesClassifier';
import { shouldExcludeSale } from '../constants';
import { parseISO } from 'date-fns';

export type TrendMode = 'quarterly' | 'annual';

export type TrendCategory = 
  | 'strong_growth' 
  | 'growth' 
  | 'stable' 
  | 'decline' 
  | 'strong_decline' 
  | 'insufficient_data';

export interface TrendCategoryInfo {
  key: TrendCategory;
  label: string;
  shortLabel: string;
  emoji: string;
  bgClass: string;
  textClass: string;
  borderClass: string;
  badgeClass: string;
}

export const TREND_CATEGORIES: Record<TrendCategory, TrendCategoryInfo> = {
  strong_growth: {
    key: 'strong_growth',
    label: 'Crescimento forte',
    shortLabel: 'Cresc. Forte',
    emoji: '🚀',
    bgClass: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    textClass: 'text-emerald-700',
    borderClass: 'border-emerald-300',
    badgeClass: 'bg-emerald-100 text-emerald-800 border border-emerald-300',
  },
  growth: {
    key: 'growth',
    label: 'Crescimento',
    shortLabel: 'Crescimento',
    emoji: '📈',
    bgClass: 'bg-green-50 text-green-700 border-green-200',
    textClass: 'text-green-700',
    borderClass: 'border-green-300',
    badgeClass: 'bg-green-100 text-green-800 border border-green-300',
  },
  stable: {
    key: 'stable',
    label: 'Estável',
    shortLabel: 'Estável',
    emoji: '➡️',
    bgClass: 'bg-neutral-100 text-neutral-700 border-neutral-200',
    textClass: 'text-neutral-700',
    borderClass: 'border-neutral-300',
    badgeClass: 'bg-neutral-100 text-neutral-700 border border-neutral-300',
  },
  decline: {
    key: 'decline',
    label: 'Queda',
    shortLabel: 'Queda',
    emoji: '📉',
    bgClass: 'bg-amber-50 text-amber-700 border-amber-200',
    textClass: 'text-amber-700',
    borderClass: 'border-amber-300',
    badgeClass: 'bg-amber-100 text-amber-800 border border-amber-300',
  },
  strong_decline: {
    key: 'strong_decline',
    label: 'Queda forte',
    shortLabel: 'Queda Forte',
    emoji: '🔴',
    bgClass: 'bg-rose-50 text-rose-700 border-rose-200',
    textClass: 'text-rose-700',
    borderClass: 'border-rose-300',
    badgeClass: 'bg-rose-100 text-rose-800 border border-rose-300',
  },
  insufficient_data: {
    key: 'insufficient_data',
    label: 'Dados insuficientes',
    shortLabel: 'Insuficiente',
    emoji: '⚪',
    bgClass: 'bg-neutral-50 text-neutral-500 border-neutral-200',
    textClass: 'text-neutral-500',
    borderClass: 'border-neutral-200',
    badgeClass: 'bg-neutral-100 text-neutral-500 border border-neutral-200',
  },
};

export interface PeriodDataPoint {
  periodKey: string;     // e.g. "2024-Q1" or "2024"
  label: string;         // e.g. "Q1/2024" or "2024"
  year: number;
  quarter?: number;      // 1 to 4 if quarterly
  totalKg: number;       // Sum of kg in this period
  chartKg: number;       // Quarterly: totalKg; Annual: monthly average kg
  orderCount: number;
  activeMonths: number;  // Number of valid months in this period (12 for full year, or elapsed months)
}

export interface TrendAnalysis {
  category: TrendCategory;
  categoryInfo: TrendCategoryInfo;
  slope: number;                 // Slope m of linear regression
  normalizedSlope: number;       // Slope / mean y (% per period)
  totalTrendChangePct: number;   // Estimated % change over entire series: (slope * (N - 1) / mean_y) * 100
  rSquared: number;              // Coefficient of determination (0 to 1)
  dataPointsCount: number;
  latestPeriodValue: number;
  latestPeriodKey: string;
  firstPeriodValue: number;
  firstPeriodKey: string;
}

export interface ClientSalesEvolution {
  clienteId: string;
  clienteNome: string;
  cidade: string;
  series: PeriodDataPoint[];
  trend: TrendAnalysis;
  currentKg: number;
  latestPeriodLabel: string;
}

/**
 * Calculates the Linear Regression slope, R-squared and overall trend classification
 * across all available periods in the series.
 * 
 * Mathematical Formulation:
 * 1. For data points (x_i, y_i) where x_i = 0, 1, ..., N-1:
 *    mean_x = (N - 1) / 2
 *    mean_y = sum(y_i) / N
 *    slope m = sum((x_i - mean_x) * (y_i - mean_y)) / sum((x_i - mean_x)^2)
 * 
 * 2. Total estimated percentage trend change across the series:
 *    deltaTrendPct = (m * (N - 1) / mean_y) * 100 (when mean_y > 0)
 * 
 * 3. Coefficient of determination R^2 (consistency of the trend line):
 *    R^2 = [sum((x_i - mean_x)*(y_i - mean_y))]^2 / [sum((x_i - mean_x)^2) * sum((y_i - mean_y)^2)]
 * 
 * 4. Objective Classification criteria:
 *    - Strong Growth (🚀): deltaTrendPct >= +25% and (R^2 >= 0.35 or deltaTrendPct >= +40%)
 *    - Growth (📈): deltaTrendPct >= +7% (without meeting strong growth)
 *    - Stable (➡️): -7% <= deltaTrendPct < +7%
 *    - Decline (📉): deltaTrendPct <= -7% (without meeting strong decline)
 *    - Strong Decline (🔴): deltaTrendPct <= -25% and (R^2 >= 0.35 or deltaTrendPct <= -40%)
 *    - Insufficient Data (⚪): N < 2 or all y_i == 0
 */
export function calculateSeriesTrend(dataPoints: PeriodDataPoint[]): TrendAnalysis {
  const n = dataPoints.length;

  if (n < 2) {
    const singleVal = n === 1 ? dataPoints[0].chartKg : 0;
    const singleKey = n === 1 ? dataPoints[0].periodKey : '';
    return {
      category: 'insufficient_data',
      categoryInfo: TREND_CATEGORIES.insufficient_data,
      slope: 0,
      normalizedSlope: 0,
      totalTrendChangePct: 0,
      rSquared: 0,
      dataPointsCount: n,
      latestPeriodValue: singleVal,
      latestPeriodKey: singleKey,
      firstPeriodValue: singleVal,
      firstPeriodKey: singleKey,
    };
  }

  const values = dataPoints.map(p => p.chartKg);
  const sumY = values.reduce((acc, v) => acc + v, 0);
  const meanY = sumY / n;

  const firstPeriodValue = values[0];
  const firstPeriodKey = dataPoints[0].periodKey;
  const latestPeriodValue = values[n - 1];
  const latestPeriodKey = dataPoints[n - 1].periodKey;

  // If entire series is zero
  if (meanY <= 0.0001) {
    return {
      category: 'stable',
      categoryInfo: TREND_CATEGORIES.stable,
      slope: 0,
      normalizedSlope: 0,
      totalTrendChangePct: 0,
      rSquared: 0,
      dataPointsCount: n,
      latestPeriodValue,
      latestPeriodKey,
      firstPeriodValue,
      firstPeriodKey,
    };
  }

  const meanX = (n - 1) / 2;
  let numerator = 0;
  let denominatorX = 0;
  let sumSquaredDiffY = 0;

  for (let i = 0; i < n; i++) {
    const diffX = i - meanX;
    const diffY = values[i] - meanY;
    numerator += diffX * diffY;
    denominatorX += diffX * diffX;
    sumSquaredDiffY += diffY * diffY;
  }

  const slope = denominatorX !== 0 ? numerator / denominatorX : 0;
  const normalizedSlope = meanY > 0 ? (slope / meanY) * 100 : 0; // % per step
  const totalTrendChangePct = meanY > 0 ? ((slope * (n - 1)) / meanY) * 100 : 0;

  let rSquared = 0;
  if (denominatorX > 0 && sumSquaredDiffY > 0) {
    rSquared = Math.min(1, Math.max(0, (numerator * numerator) / (denominatorX * sumSquaredDiffY)));
  }

  // Objective categorization based on total trend change & consistency (R^2)
  let category: TrendCategory = 'stable';

  // For 2 data points, simple threshold
  if (n === 2) {
    if (totalTrendChangePct >= 30) category = 'strong_growth';
    else if (totalTrendChangePct >= 7) category = 'growth';
    else if (totalTrendChangePct <= -30) category = 'strong_decline';
    else if (totalTrendChangePct <= -7) category = 'decline';
    else category = 'stable';
  } else {
    // 3 or more data points: use trend change + consistency
    if (totalTrendChangePct >= 25 && (rSquared >= 0.35 || totalTrendChangePct >= 45)) {
      category = 'strong_growth';
    } else if (totalTrendChangePct >= 7) {
      category = 'growth';
    } else if (totalTrendChangePct <= -25 && (rSquared >= 0.35 || totalTrendChangePct <= -45)) {
      category = 'strong_decline';
    } else if (totalTrendChangePct <= -7) {
      category = 'decline';
    } else {
      category = 'stable';
    }
  }

  return {
    category,
    categoryInfo: TREND_CATEGORIES[category],
    slope,
    normalizedSlope,
    totalTrendChangePct,
    rSquared,
    dataPointsCount: n,
    latestPeriodValue,
    latestPeriodKey,
    firstPeriodValue,
    firstPeriodKey,
  };
}

/**
 * Builds the full historical timeline of all available periods in the dataset.
 */
export function buildHistoricalPeriodKeys(
  allSales: HistVenda[],
  mode: TrendMode
): { periodKey: string; label: string; year: number; quarter?: number }[] {
  if (allSales.length === 0) return [];

  let minDate = new Date();
  let maxDate = new Date();
  let hasValidDate = false;

  allSales.forEach(h => {
    if (!h.faturamento) return;
    const d = parseISO(h.faturamento);
    if (isNaN(d.getTime())) return;
    
    if (!hasValidDate) {
      minDate = d;
      maxDate = d;
      hasValidDate = true;
    } else {
      if (d < minDate) minDate = d;
      if (d > maxDate) maxDate = d;
    }
  });

  if (!hasValidDate) return [];

  const startYear = minDate.getFullYear();
  const endYear = maxDate.getFullYear();

  const periods: { periodKey: string; label: string; year: number; quarter?: number }[] = [];

  if (mode === 'quarterly') {
    const startQ = Math.floor(minDate.getMonth() / 3) + 1;
    const endQ = Math.floor(maxDate.getMonth() / 3) + 1;

    for (let y = startYear; y <= endYear; y++) {
      const firstQ = y === startYear ? startQ : 1;
      const lastQ = y === endYear ? endQ : 4;

      for (let q = firstQ; q <= lastQ; q++) {
        periods.push({
          periodKey: `${y}-Q${q}`,
          label: `Q${q}/${y}`,
          year: y,
          quarter: q,
        });
      }
    }
  } else {
    // Annual mode
    for (let y = startYear; y <= endYear; y++) {
      periods.push({
        periodKey: `${y}`,
        label: `${y}`,
        year: y,
      });
    }
  }

  return periods;
}

/**
 * Computes how many valid active months exist in a given year.
 * For past years, it is 12 months.
 * For the latest/current year with data, it calculates the number of elapsed months with valid sales activity.
 */
function getActiveMonthsForYear(year: number, allSalesOfYear: HistVenda[]): number {
  const currentRealYear = new Date().getFullYear();
  const currentRealMonth = new Date().getMonth() + 1; // 1 to 12

  if (year < currentRealYear) {
    return 12;
  }

  // If current year, check max month observed or current real month
  const observedMonths = new Set<number>();
  allSalesOfYear.forEach(h => {
    if (!h.faturamento) return;
    const d = parseISO(h.faturamento);
    if (!isNaN(d.getTime()) && d.getFullYear() === year) {
      observedMonths.add(d.getMonth() + 1);
    }
  });

  const maxObservedMonth = observedMonths.size > 0 ? Math.max(...Array.from(observedMonths)) : 1;
  const elapsedMonths = Math.max(1, Math.min(12, Math.max(maxObservedMonth, currentRealMonth)));
  return elapsedMonths;
}

/**
 * Aggregates sales by period (Quarterly or Annual) for a given set of sales records.
 * 
 * Rules:
 * - Quarterly: sum of kg in the quarter.
 * - Annual: monthly average kg in that year = total kg in year / active months in year.
 */
export function aggregateSalesByPeriods(
  sales: HistVenda[],
  periods: { periodKey: string; label: string; year: number; quarter?: number }[],
  mode: TrendMode,
  produtosMap: Record<string, Produto>
): PeriodDataPoint[] {
  // Group sales by periodKey
  const periodMap: Record<string, { totalKg: number; orderCount: number; salesList: HistVenda[] }> = {};
  
  periods.forEach(p => {
    periodMap[p.periodKey] = { totalKg: 0, orderCount: 0, salesList: [] };
  });

  const orderKeysByPeriod: Record<string, Set<string>> = {};
  periods.forEach(p => {
    orderKeysByPeriod[p.periodKey] = new Set();
  });

  sales.forEach(h => {
    if (!classifySaleRecord(h).entraFaturamento) return;
    if (shouldExcludeSale(h.cliente, h.faturamento)) return;
    if (!h.faturamento) return;

    const d = parseISO(h.faturamento);
    if (isNaN(d.getTime())) return;

    const year = d.getFullYear();
    const q = Math.floor(d.getMonth() / 3) + 1;
    const periodKey = mode === 'quarterly' ? `${year}-Q${q}` : `${year}`;

    if (!periodMap[periodKey]) return;

    const prod = produtosMap[h.produto_id] || (h.produtos ? produtosMap[h.produtos.toLowerCase()] : null);
    const weightUnit = prod?.peso_embalagem || 0;
    const kg = (h.qtd || 0) * weightUnit;

    periodMap[periodKey].totalKg += kg;
    periodMap[periodKey].salesList.push(h);

    const orderId = h.pedido_id || h.numero_pedido_erp || `${h.cliente}_${h.faturamento}`;
    orderKeysByPeriod[periodKey].add(orderId);
  });

  return periods.map(p => {
    const data = periodMap[p.periodKey] || { totalKg: 0, orderCount: 0, salesList: [] };
    const orderCount = orderKeysByPeriod[p.periodKey]?.size || 0;

    let activeMonths = 1;
    let chartKg = data.totalKg;

    if (mode === 'annual') {
      activeMonths = getActiveMonthsForYear(p.year, data.salesList);
      // Monthly average for the year
      chartKg = activeMonths > 0 ? data.totalKg / activeMonths : data.totalKg;
    }

    return {
      periodKey: p.periodKey,
      label: p.label,
      year: p.year,
      quarter: p.quarter,
      totalKg: data.totalKg,
      chartKg,
      orderCount,
      activeMonths,
    };
  });
}

/**
 * Computes portfolio-wide summary and client-by-client evolution breakdown.
 */
export function computePortfolioAndClientsEvolution(
  allSales: HistVenda[],
  clientes: Cliente[],
  produtosMap: Record<string, Produto>,
  mode: TrendMode,
  periodRange?: { startKey?: string; endKey?: string }
): {
  portfolioSeries: PeriodDataPoint[];
  portfolioTrend: TrendAnalysis;
  clientsEvolution: ClientSalesEvolution[];
  periodOptions: { periodKey: string; label: string }[];
  trendCounts: Record<TrendCategory, number>;
} {
  // Filter strictly for ACTIVE clients
  const activeClientes = clientes.filter(c => c.ativo !== false);
  const activeClientIds = new Set(activeClientes.map(c => c.id));
  const activeSales = allSales.filter(h => h.cliente_id && activeClientIds.has(h.cliente_id));

  // 1. Build all available periods across history of active sales
  const allPeriods = buildHistoricalPeriodKeys(activeSales, mode);

  // 2. Filter periods by range if specified
  let activePeriods = allPeriods;
  if (periodRange?.startKey || periodRange?.endKey) {
    const startIdx = periodRange.startKey 
      ? allPeriods.findIndex(p => p.periodKey === periodRange.startKey)
      : 0;
    const endIdx = periodRange.endKey 
      ? allPeriods.findIndex(p => p.periodKey === periodRange.endKey)
      : allPeriods.length - 1;

    const validStart = startIdx >= 0 ? startIdx : 0;
    const validEnd = endIdx >= 0 ? endIdx : allPeriods.length - 1;

    if (validStart <= validEnd) {
      activePeriods = allPeriods.slice(validStart, validEnd + 1);
    }
  }

  // 3. Aggregate Portfolio-wide (for active sales only)
  const portfolioSeries = aggregateSalesByPeriods(activeSales, activePeriods, mode, produtosMap);
  const portfolioTrend = calculateSeriesTrend(portfolioSeries);

  // 4. Group sales by client
  const salesByClient: Record<string, HistVenda[]> = {};
  activeSales.forEach(h => {
    if (!h.cliente_id) return;
    if (!salesByClient[h.cliente_id]) {
      salesByClient[h.cliente_id] = [];
    }
    salesByClient[h.cliente_id].push(h);
  });

  const trendCounts: Record<TrendCategory, number> = {
    strong_growth: 0,
    growth: 0,
    stable: 0,
    decline: 0,
    strong_decline: 0,
    insufficient_data: 0,
  };

  // 5. Aggregate for each active client
  const clientsEvolution: ClientSalesEvolution[] = activeClientes.map(cliente => {
    const clientSales = salesByClient[cliente.id] || [];
    const series = aggregateSalesByPeriods(clientSales, activePeriods, mode, produtosMap);
    const trend = calculateSeriesTrend(series);

    const latestPoint = series.length > 0 ? series[series.length - 1] : null;
    const currentKg = latestPoint ? latestPoint.chartKg : 0;
    const latestPeriodLabel = latestPoint ? latestPoint.label : '-';

    trendCounts[trend.category] += 1;

    return {
      clienteId: cliente.id,
      clienteNome: cliente.cliente || 'Sem nome',
      cidade: cliente.cidade || '-',
      series,
      trend,
      currentKg,
      latestPeriodLabel,
    };
  });

  // Sort by current period sales (highest to lowest) by default
  clientsEvolution.sort((a, b) => b.currentKg - a.currentKg);

  return {
    portfolioSeries,
    portfolioTrend,
    clientsEvolution,
    periodOptions: allPeriods.map(p => ({ periodKey: p.periodKey, label: p.label })),
    trendCounts,
  };
}
