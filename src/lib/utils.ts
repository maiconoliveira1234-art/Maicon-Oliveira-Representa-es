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
