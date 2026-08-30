import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(value: number | undefined | null) {
  const val = value ?? 0;
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(val);
}

export function formatWeight(value: number | undefined | null) {
  const val = value ?? 0;
  return new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(val) + ' kg';
}

export function deduplicateSales<T>(data: T[]): T[] {
  if (!data || !Array.isArray(data)) return [];
  const uniqueMap = new Map();
  data.forEach((h: any) => {
    // Create a robust key based on available fields
    const date = h.faturamento || '';
    const client = h.cliente_id || '';
    const prod = (h.produto_id || h.produtos || '').toString().trim().toLowerCase();
    const qty = h.qtd || 0;
    const total = h["r$_total"] || 0;
    
    const key = `${date}|${client}|${prod}|${qty}|${total}`;
    if (!uniqueMap.has(key)) {
      uniqueMap.set(key, h);
    }
  });
  return Array.from(uniqueMap.values()) as T[];
}

/**
 * Robust date parser supporting ISO, Brazilian (DD/MM/YYYY, DD/MM/YY),
 * and Month/Year (MM/YYYY, MM/YY) string formats.
 */
export function parseSaleDate(dateStr?: string | null): Date | null {
  if (!dateStr || typeof dateStr !== 'string') return null;
  const str = dateStr.trim();
  if (!str) return null;

  // 1. ISO format: YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss
  if (/^\d{4}-\d{2}/.test(str)) {
    const parts = str.split('T')[0].split('-');
    const year = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1;
    const day = parts[2] ? parseInt(parts[2], 10) : 1;
    const d = new Date(year, month, day);
    if (!isNaN(d.getTime())) return d;
  }

  // 2. Slash format: DD/MM/YYYY or DD/MM/YY (or MM/YYYY, MM/YY)
  if (str.includes('/')) {
    const parts = str.split('/');
    if (parts.length === 3) {
      const day = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10) - 1;
      let year = parseInt(parts[2], 10);
      if (year < 100) year += 2000;
      const d = new Date(year, month, day);
      if (!isNaN(d.getTime())) return d;
    } else if (parts.length === 2) {
      // e.g. "01/25" or "01/2025"
      const month = parseInt(parts[0], 10) - 1;
      let year = parseInt(parts[1], 10);
      if (year < 100) year += 2000;
      const d = new Date(year, month, 1);
      if (!isNaN(d.getTime())) return d;
    }
  }

  // 3. Hyphen format with Brazilian order: DD-MM-YYYY or MM-YYYY
  if (str.includes('-')) {
    const parts = str.split('-');
    if (parts.length === 3 && parts[0].length <= 2) {
      const day = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10) - 1;
      let year = parseInt(parts[2], 10);
      if (year < 100) year += 2000;
      const d = new Date(year, month, day);
      if (!isNaN(d.getTime())) return d;
    } else if (parts.length === 2) {
      const month = parseInt(parts[0], 10) - 1;
      let year = parseInt(parts[1], 10);
      if (year < 100) year += 2000;
      const d = new Date(year, month, 1);
      if (!isNaN(d.getTime())) return d;
    }
  }

  const d = new Date(str);
  if (!isNaN(d.getTime())) return d;

  return null;
}
