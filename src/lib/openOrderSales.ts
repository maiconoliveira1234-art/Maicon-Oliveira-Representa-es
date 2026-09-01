import { supabase } from './supabase';
import { HistVenda, Cliente, Produto } from '../types';
import { getFaixaPreco, getValorUnitario, calcularPrecoComDesconto } from './calculations';

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

  // 1. Fetch from Supabase
  if (typeof navigator !== 'undefined' && navigator.onLine !== false) {
    try {
      const { data, error } = await supabase
        .from('pedidos_em_aberto')
        .select('*')
        .eq('cliente_id', clienteId)
        .maybeSingle();

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

  // 2. Check localStorage
  try {
    const saved = localStorage.getItem(`pedido_${clienteId}`);
    if (saved) {
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
  if (typeof navigator !== 'undefined' && navigator.onLine !== false) {
    try {
      const { data, error } = await supabase.from('pedidos_em_aberto').select('*');
      if (!error && data) {
        dbOpenOrders = data;
      }
    } catch (dbErr) {
      console.error('Error fetching pedidos_em_aberto:', dbErr);
    }
  }

  const openOrdersMap = new Map<string, RawOpenOrder>();

  // 1. Populate from Supabase DB
  dbOpenOrders.forEach(row => {
    if (row.cliente_id && row.items) {
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
  });

  // 2. Merge / Fallback with localStorage (compare timestamps if both exist)
  (clientesList || []).forEach(c => {
    try {
      const saved = localStorage.getItem(`pedido_${c.id}`);
      if (saved) {
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
