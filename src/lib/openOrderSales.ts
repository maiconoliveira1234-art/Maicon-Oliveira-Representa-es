import { supabase } from './supabase';
import { HistVenda, Cliente, Produto } from '../types';

export async function fetchOpenOrderSales(
  clientesList: Cliente[],
  produtosList: Produto[]
): Promise<HistVenda[]> {
  const productsMap = new Map<string, Produto>();
  (produtosList || []).forEach(p => {
    if (p.id) productsMap.set(p.id, p);
    if (p.produto) productsMap.set(p.produto.toLowerCase(), p);
  });

  const clientsMap = new Map<string, Cliente>();
  (clientesList || []).forEach(c => {
    if (c.id) clientsMap.set(c.id, c);
  });

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

  const openOrdersByClient = new Map<string, { cliente_id: string; items: any[]; started_at?: string }>();

  // 1. Populate from Supabase DB
  dbOpenOrders.forEach(row => {
    if (row.cliente_id && row.items) {
      let itemsArr: any[] = [];
      if (Array.isArray(row.items)) {
        itemsArr = row.items;
      } else if (typeof row.items === 'object') {
        itemsArr = Object.values(row.items);
      }
      if (itemsArr.length > 0) {
        openOrdersByClient.set(row.cliente_id, {
          cliente_id: row.cliente_id,
          items: itemsArr,
          started_at: row.started_at || row.created_at || row.updated_at
        });
      }
    }
  });

  // 2. Fallback / Merge with localStorage
  (clientesList || []).forEach(c => {
    if (!openOrdersByClient.has(c.id)) {
      try {
        const saved = localStorage.getItem(`pedido_${c.id}`);
        if (saved) {
          const parsed = JSON.parse(saved);
          let itemsArr: any[] = [];
          if (parsed && typeof parsed === 'object') {
            if (Array.isArray(parsed.items)) {
              itemsArr = parsed.items;
            } else if (parsed.items && typeof parsed.items === 'object') {
              itemsArr = Object.values(parsed.items);
            } else if (Array.isArray(parsed)) {
              itemsArr = parsed;
            }
          }
          if (itemsArr.length > 0) {
            openOrdersByClient.set(c.id, {
              cliente_id: c.id,
              items: itemsArr,
              started_at: parsed.startedAt || new Date().toISOString()
            });
          }
        }
      } catch (e) {
        // ignore
      }
    }
  });

  const openSales: HistVenda[] = [];

  openOrdersByClient.forEach((order, clienteId) => {
    const client = clientsMap.get(clienteId);
    const clientName = client?.cliente || 'Cliente ' + clienteId;
    const rawDate = order.started_at || new Date().toISOString();
    const orderDateStr = rawDate.slice(0, 10);

    order.items.forEach((item: any, idx: number) => {
      const prodId = item.produto_id || item.id;
      const prod = productsMap.get(prodId) || (item.produto ? productsMap.get(String(item.produto).toLowerCase()) : null);
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
          const unitario = prod.custo_und || prod.livre || 0;
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
        xdt: 0,
        "acresc.": 0
      });
    });
  });

  return openSales;
}
