import { supabase } from './supabase';
import { HistVenda, Cliente, Produto } from '../types';
import { getFaixaPreco, getValorUnitario, calcularPrecoComDesconto } from './calculations';

/**
 * Checks if the client has a pending offline open order creation/update waiting in queue
 */
export function hasPendingOpenOrderSync(clienteId: string): boolean {
  if (!clienteId) return false;
  try {
    const raw = localStorage.getItem('offline_db_pending_queue');
    if (!raw) return false;
    const queue = JSON.parse(raw);
    if (!Array.isArray(queue)) return false;
    return queue.some(
      item => item.action === 'save_open_order' &&
      (item.payload?.cliente_id === clienteId || item.payload?.clienteId === clienteId)
    );
  } catch {
    return false;
  }
}

/**
 * Purges an orphan local draft if it does not exist on the server and is not queued for sync
 */
export function purgeOrphanLocalOpenOrder(clienteId: string): void {
  if (!clienteId) return;
  if (!hasPendingOpenOrderSync(clienteId)) {
    try {
      localStorage.removeItem(`pedido_${clienteId}`);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('openOrderPurged', { detail: { clienteId } }));
      }
    } catch {
      // ignore
    }
  }
}

/**
 * Scans localStorage for any draft open orders and purges those that are no longer
 * present on the server (unless they are waiting in the offline queue to be uploaded).
 */
export function reconcileAndCleanOrphanOpenOrders(serverClientIds: Set<string>): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const keysToPurge: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('pedido_')) {
        const clienteId = key.replace('pedido_', '');
        if (clienteId && !serverClientIds.has(clienteId) && !hasPendingOpenOrderSync(clienteId)) {
          keysToPurge.push(key);
        }
      }
    }
    keysToPurge.forEach(k => {
      localStorage.removeItem(k);
      const cId = k.replace('pedido_', '');
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('openOrderPurged', { detail: { clienteId: cId } }));
      }
    });
  } catch (err) {
    console.warn('[OpenOrders] Error reconciling orphan local drafts:', err);
  }
}

export interface RawOpenOrderItem {
  id?: string;
  produto_id?: string;
  produto?: string;
  quantidade?: number;
  qtd?: number;
  tipo_operacao?: string;
  valor_unitario?: number;
  preco_unitario?: number;
  valor_total?: number;
  [key: string]: any;
}

export interface RawOpenOrder {
  cliente_id: string;
  items: RawOpenOrderItem[] | Record<string, any> | null;
  started_at?: string;
  created_at?: string;
  updated_at?: string;
  prazo?: string;
  obs?: string;
}

export function convertOpenOrdersToSales(
  openOrders: RawOpenOrder[],
  clientesList: Cliente[],
  produtosList: Produto[]
): HistVenda[] {
  const productsMap = new Map<string, Produto>();
  (produtosList || []).forEach(p => {
    if (p.id) productsMap.set(p.id, p);
    if (p.produto) productsMap.set(p.produto.toLowerCase(), p);
  });

  const clientsMap = new Map<string, Cliente>();
  (clientesList || []).forEach(c => {
    if (c.id) clientsMap.set(c.id, c);
  });

  const openSales: HistVenda[] = [];

  openOrders.forEach(order => {
    const clienteId = order.cliente_id;
    if (!clienteId) return;

    let itemsArr: RawOpenOrderItem[] = [];
    if (Array.isArray(order.items)) {
      itemsArr = order.items;
    } else if (order.items && typeof order.items === 'object') {
      itemsArr = Object.entries(order.items).map(([pId, val]) => {
        if (typeof val === 'number') {
          return { produto_id: pId, quantidade: val, tipo_operacao: 'VENDA' };
        }
        if (val && typeof val === 'object') {
          return { produto_id: pId, ...val };
        }
        return { produto_id: pId, quantidade: 0, tipo_operacao: 'VENDA' };
      });
    }

    if (itemsArr.length === 0) return;

    const client = clientsMap.get(clienteId);
    const clientName = client?.cliente || 'Cliente ' + clienteId;
    const rawDate = order.updated_at || order.started_at || order.created_at || new Date().toISOString();
    const orderDateStr = rawDate.slice(0, 10);

    // Calculate total order weight for normal sales to determine price tier
    let totalOrderWeight = 0;
    itemsArr.forEach(item => {
      const prodId = item.produto_id || item.id;
      const prod = productsMap.get(prodId || '') || (item.produto ? productsMap.get(String(item.produto).toLowerCase()) : null);
      if (!prod) return;

      const tipoOp = item.tipo_operacao || 'VENDA';
      if (tipoOp === 'VENDA') {
        const qty = Number(item.quantidade ?? item.qtd) || 0;
        totalOrderWeight += qty * (prod.peso_embalagem || 0);
      }
    });

    const currentFaixa = getFaixaPreco(totalOrderWeight);

    itemsArr.forEach((item, idx) => {
      const prodId = item.produto_id || item.id;
      const prod = productsMap.get(prodId || '') || (item.produto ? productsMap.get(String(item.produto).toLowerCase()) : null);
      if (!prod) return;

      const qtdEmbalagens = Number(item.quantidade ?? item.qtd) || 0;
      if (qtdEmbalagens <= 0) return;

      const tipoOp = item.tipo_operacao || 'VENDA';
      let vendasType = 'VENDAS';
      let tabelaName = 'TABELA PADRAO';

      if (tipoOp === 'BONIFICACAO_COMERCIAL') {
        vendasType = 'BONIFICACAO';
        tabelaName = 'BONIFICACAO';
      } else if (tipoOp === 'MERCHANDISING') {
        vendasType = 'BONIFICACAO';
        tabelaName = 'BRINDES';
      }

      // Calculate total value
      let rTotal = 0;
      if (tipoOp === 'VENDA') {
        if (typeof item.valor_total === 'number' && item.valor_total > 0) {
          rTotal = item.valor_total;
        } else if (typeof item.valor_unitario === 'number' && item.valor_unitario > 0) {
          rTotal = item.valor_unitario * qtdEmbalagens * (prod.quant_embalagem || 1);
        } else if (typeof item.preco_unitario === 'number' && item.preco_unitario > 0) {
          rTotal = item.preco_unitario * qtdEmbalagens * (prod.quant_embalagem || 1);
        } else {
          const discount = getValorUnitario(prod, currentFaixa) || 0;
          const unitario = calcularPrecoComDesconto(prod.custo_und, discount);
          rTotal = unitario * qtdEmbalagens * (prod.quant_embalagem || 1);
        }
      }

      openSales.push({
        id: `open_order_${clienteId}_${prod.id}_${idx}`,
        cliente_id: clienteId,
        cliente: clientName,
        produto_id: prod.id,
        produtos: prod.produto,
        qtd: qtdEmbalagens,
        "r$_total": rTotal,
        tabela: tabelaName,
        vendas: vendasType,
        faturamento: orderDateStr,
        data: orderDateStr,
        numero_pedido_erp: `ABERTO_${clienteId}`,
        pedido_id: `ABERTO_${clienteId}`,
        xdt: 0,
        "acresc.": 0,
        importado_em: rawDate
      });
    });
  });

  return openSales;
}

export interface ClientOpenOrderSummary {
  cliente_id: string;
  cliente_nome: string;
  started_at?: string;
  updated_at?: string;
  item_count: number;
  total_weight_kg: number;
  total_value_rs: number;
  items_summary: {
    produto: string;
    quantidade: number;
    peso_kg: number;
    valor_rs: number;
    tipo_operacao: string;
  }[];
}

export async function getClientOpenOrderSummary(
  clienteId: string,
  clientesList: Cliente[],
  produtosList: Produto[]
): Promise<ClientOpenOrderSummary | null> {
  if (!clienteId) return null;

  const productsMap = new Map<string, Produto>();
  (produtosList || []).forEach(p => {
    if (p.id) productsMap.set(p.id, p);
    if (p.produto) productsMap.set(p.produto.toLowerCase(), p);
  });

  const client = (clientesList || []).find(c => c.id === clienteId);
  const clientName = client?.cliente || 'Cliente ' + clienteId;

  let rawOrder: RawOpenOrder | null = null;
  let serverChecked = false;

  // 1. Fetch from Supabase
  if (typeof navigator !== 'undefined' && navigator.onLine !== false) {
    try {
      const { data, error } = await supabase
        .from('pedidos_em_aberto')
        .select('*')
        .eq('cliente_id', clienteId)
        .maybeSingle();

      serverChecked = !error;
      if (!error && data) {
        rawOrder = {
          cliente_id: data.cliente_id,
          items: data.items,
          started_at: data.started_at,
          created_at: data.created_at,
          updated_at: data.updated_at,
          prazo: data.prazo,
          obs: data.obs
        };
      }
    } catch (err) {
      console.error('Erro ao buscar pedido em aberto do cliente:', err);
    }
  }

  // 2. Check localStorage (only accept if pending in offline queue OR server was not reachable)
  try {
    const saved = localStorage.getItem(`pedido_${clienteId}`);
    if (saved) {
      if (serverChecked && !rawOrder) {
        // The server was checked and has no open order. Check if there is an offline creation pending.
        if (!hasPendingOpenOrderSync(clienteId)) {
          // This is an orphan draft (already deleted/invoiced on another device). Purge it!
          purgeOrphanLocalOpenOrder(clienteId);
        } else {
          const parsed = JSON.parse(saved);
          const localItems = parsed.items || (Array.isArray(parsed) ? parsed : null);
          if (localItems) {
            rawOrder = {
              cliente_id: clienteId,
              items: localItems,
              started_at: parsed.startedAt,
              updated_at: parsed.updatedAt || parsed.startedAt,
              prazo: parsed.prazo,
              obs: parsed.obs
            };
          }
        }
      } else {
        const parsed = JSON.parse(saved);
        const localItems = parsed.items || (Array.isArray(parsed) ? parsed : null);
        if (localItems && (!rawOrder || (parsed.updatedAt && new Date(parsed.updatedAt).getTime() > new Date(rawOrder.updated_at || rawOrder.started_at || 0).getTime()))) {
          rawOrder = {
            cliente_id: clienteId,
            items: localItems,
            started_at: parsed.startedAt,
            updated_at: parsed.updatedAt || parsed.startedAt,
            prazo: parsed.prazo,
            obs: parsed.obs
          };
        }
      }
    }
  } catch (e) {
    // ignore
  }

  if (!rawOrder || !rawOrder.items) return null;

  let itemsArr: RawOpenOrderItem[] = [];
  if (Array.isArray(rawOrder.items)) {
    itemsArr = rawOrder.items;
  } else if (typeof rawOrder.items === 'object') {
    itemsArr = Object.entries(rawOrder.items).map(([pId, val]) => {
      if (typeof val === 'number') {
        return { produto_id: pId, quantidade: val, tipo_operacao: 'VENDA' };
      }
      if (val && typeof val === 'object') {
        return { produto_id: pId, ...val };
      }
      return { produto_id: pId, quantidade: 0, tipo_operacao: 'VENDA' };
    });
  }

  if (itemsArr.length === 0) return null;

  // Calculate weight and price
  let totalOrderWeight = 0;
  itemsArr.forEach(item => {
    const prodId = item.produto_id || item.id;
    const prod = productsMap.get(prodId || '') || (item.produto ? productsMap.get(String(item.produto).toLowerCase()) : null);
    if (!prod) return;

    const tipoOp = item.tipo_operacao || 'VENDA';
    if (tipoOp === 'VENDA') {
      const qty = Number(item.quantidade ?? item.qtd) || 0;
      totalOrderWeight += qty * (prod.peso_embalagem || 0);
    }
  });

  const currentFaixa = getFaixaPreco(totalOrderWeight);
  let totalValueRs = 0;
  let totalWeightKg = 0;

  const itemsSummary: ClientOpenOrderSummary['items_summary'] = [];

  itemsArr.forEach(item => {
    const prodId = item.produto_id || item.id;
    const prod = productsMap.get(prodId || '') || (item.produto ? productsMap.get(String(item.produto).toLowerCase()) : null);
    if (!prod) return;

    const qtdEmbalagens = Number(item.quantidade ?? item.qtd) || 0;
    if (qtdEmbalagens <= 0) return;

    const tipoOp = item.tipo_operacao || 'VENDA';
    const pesoItem = qtdEmbalagens * (prod.peso_embalagem || 0);
    totalWeightKg += pesoItem;

    let rTotal = 0;
    if (tipoOp === 'VENDA') {
      if (typeof item.valor_total === 'number' && item.valor_total > 0) {
        rTotal = item.valor_total;
      } else if (typeof item.valor_unitario === 'number' && item.valor_unitario > 0) {
        rTotal = item.valor_unitario * qtdEmbalagens * (prod.quant_embalagem || 1);
      } else if (typeof item.preco_unitario === 'number' && item.preco_unitario > 0) {
        rTotal = item.preco_unitario * qtdEmbalagens * (prod.quant_embalagem || 1);
      } else {
        const discount = getValorUnitario(prod, currentFaixa) || 0;
        const unitario = calcularPrecoComDesconto(prod.custo_und, discount);
        rTotal = unitario * qtdEmbalagens * (prod.quant_embalagem || 1);
      }
      totalValueRs += rTotal;
    }

    itemsSummary.push({
      produto: prod.produto,
      quantidade: qtdEmbalagens,
      peso_kg: pesoItem,
      valor_rs: rTotal,
      tipo_operacao: tipoOp
    });
  });

  if (itemsSummary.length === 0) return null;

  return {
    cliente_id: clienteId,
    cliente_nome: clientName,
    started_at: rawOrder.started_at,
    updated_at: rawOrder.updated_at,
    item_count: itemsSummary.length,
    total_weight_kg: totalWeightKg,
    total_value_rs: totalValueRs,
    items_summary: itemsSummary
  };
}

export async function deleteClientOpenOrder(clienteId: string): Promise<boolean> {
  if (!clienteId) return false;
  try {
    localStorage.removeItem(`pedido_${clienteId}`);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('openOrderPurged', { detail: { clienteId } }));
    }
    // Remove from offline queue if queued
    try {
      const raw = localStorage.getItem('offline_db_pending_queue');
      if (raw) {
        const queue = JSON.parse(raw);
        if (Array.isArray(queue)) {
          const updated = queue.filter(item => 
            !( (item.action === 'save_open_order' || item.action === 'delete_open_order') &&
               (item.payload?.cliente_id === clienteId || item.payload?.clienteId === clienteId) )
          );
          localStorage.setItem('offline_db_pending_queue', JSON.stringify(updated));
        }
      }
    } catch {}

    if (typeof navigator !== 'undefined' && navigator.onLine !== false) {
      const { error } = await supabase
        .from('pedidos_em_aberto')
        .delete()
        .eq('cliente_id', clienteId);

      if (error) {
        console.error('Erro ao deletar pedido em aberto do Supabase:', error);
        return false;
      }
    }
    return true;
  } catch (err) {
    console.error('Falha ao limpar pedido em aberto:', err);
    return false;
  }
}

export async function fetchOpenOrderSales(
  clientesList: Cliente[],
  produtosList: Produto[]
): Promise<HistVenda[]> {
  let dbOpenOrders: any[] = [];
  let serverLoaded = false;
  if (typeof navigator !== 'undefined' && navigator.onLine !== false) {
    try {
      const { data, error } = await supabase.from('pedidos_em_aberto').select('*');
      if (!error && data) {
        dbOpenOrders = data;
        serverLoaded = true;
      }
    } catch (dbErr) {
      console.error('Error fetching pedidos_em_aberto:', dbErr);
    }
  }

  const openOrdersMap = new Map<string, RawOpenOrder>();
  const serverClientIds = new Set<string>();

  // 1. Populate from Supabase DB
  dbOpenOrders.forEach(row => {
    if (row.cliente_id) {
      serverClientIds.add(row.cliente_id);
      if (row.items) {
        openOrdersMap.set(row.cliente_id, {
          cliente_id: row.cliente_id,
          items: row.items,
          started_at: row.started_at,
          created_at: row.created_at,
          updated_at: row.updated_at,
          prazo: row.prazo,
          obs: row.obs
        });
      }
    }
  });

  // Reconcile and purge local drafts on devices that were closed when another device deleted/invoiced the order
  if (serverLoaded) {
    reconcileAndCleanOrphanOpenOrders(serverClientIds);
  }

  // 2. Merge / Fallback with localStorage (compare timestamps if both exist)
  (clientesList || []).forEach(c => {
    try {
      const saved = localStorage.getItem(`pedido_${c.id}`);
      if (saved) {
        // If server responded cleanly and client is NOT in server open orders:
        // Only accept if it is an offline creation waiting in queue.
        if (serverLoaded && !openOrdersMap.has(c.id)) {
          if (!hasPendingOpenOrderSync(c.id)) {
            purgeOrphanLocalOpenOrder(c.id);
            return;
          }
        }

        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === 'object') {
          const localItems = parsed.items || (Array.isArray(parsed) ? parsed : null);
          if (localItems) {
            const existing = openOrdersMap.get(c.id);
            const localTime = parsed.updatedAt ? new Date(parsed.updatedAt).getTime() : (parsed.startedAt ? new Date(parsed.startedAt).getTime() : 0);
            const serverTime = existing ? (existing.updated_at ? new Date(existing.updated_at).getTime() : (existing.started_at ? new Date(existing.started_at).getTime() : 0)) : 0;

            if (!existing || localTime > serverTime) {
              openOrdersMap.set(c.id, {
                cliente_id: c.id,
                items: localItems,
                started_at: parsed.startedAt,
                updated_at: parsed.updatedAt || parsed.startedAt,
                prazo: parsed.prazo,
                obs: parsed.obs
              });
            }
          }
        }
      }
    } catch (e) {
      // ignore parsing errors
    }
  });

  return convertOpenOrdersToSales(
    Array.from(openOrdersMap.values()),
    clientesList,
    produtosList
  );
}
