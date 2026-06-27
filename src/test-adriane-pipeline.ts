import { supabase } from './lib/supabase';
import { differenceInDays, parseISO } from 'date-fns';
import { classifySaleRecord } from './lib/salesClassifier';

async function run() {
  const clienteId = '2c1fe91b-89ef-45e3-9247-266c6a395b53';
  console.log(`1. clienteId recebido: ${clienteId}`);

  // Fetch client
  const clientRes = await supabase.from('clientes').select('*').eq('id', clienteId).single();
  console.log(`2. Nome do cliente carregado: ${clientRes.data?.cliente}`);

  // Fetch products
  const productsRes = await supabase.from('produtos').select('*');
  console.log(`3. Quantidade de produtos carregados da tabela de produtos: ${productsRes.data?.length}`);

  // Fetch hist_vendas
  const histRes = await supabase.from('hist_vendas').select('*').eq('cliente_id', clienteId);
  console.log(`4. Quantidade de registros em hist_vendas: ${histRes.data?.length}`);

  // Fetch estoque_cliente
  const stockRes = await supabase.from('estoque_cliente').select('*').eq('cliente_id', clienteId);
  console.log(`5. Quantidade de registros em estoque_cliente: ${stockRes.data?.length}`);

  const historico = histRes.data || [];
  const produtos = productsRes.data || [];
  const estoque = stockRes.data || [];

  const productsMap: Record<string, any> = {};
  produtos.forEach(p => { productsMap[p.id] = p; });

  const estoqueMap: Record<string, number> = {};
  estoque.forEach(e => { estoqueMap[e.produto_id] = e.quantidade_atual; });

  const ultimaContagemMap: Record<string, number> = {};
  estoque.forEach(e => { ultimaContagemMap[e.produto_id] = e.quantidade_atual; });

  // Group by product_id
  const items: Record<string, any[]> = {};
  historico.forEach(h => {
    if (!classifySaleRecord(h).influenciaConsumo) return;
    if (!items[h.produto_id]) items[h.produto_id] = [];
    items[h.produto_id].push(h);
  });

  console.log(`   Grouped items count (unique product_ids): ${Object.keys(items).length}`);

  const FAMILY_PRIORITY_ORDER = [
    '01 - FN FRESH', '02 - FN FRESH', '03 - FN FRESH', '04 - FN FRESH',
    '05 - ORIGENS ESPECIAL', '06 - ORIGENS ESPECIAL', '07 - ORIGENS ESPECIAL', '08 - ORIGENS ESPECIAL',
    '09 - HIGH PREMIUM', '10 - PREMIUM 1', '11 - PREMIUM 1', '12 - PREMIUM 1',
    '13 - PREMIUM 2', '14 - PREMIUM 2', '15 - COMBATE 1', '16 - COMBATE 1'
  ];

  const familyPriorityMap: Record<string, number> = {};
  FAMILY_PRIORITY_ORDER.forEach((family, index) => {
    familyPriorityMap[family] = index;
  });

  const result: any[] = Object.entries(items)
    .map(([produtoId, vendas]) => {
      const sortedVendas = [...vendas].sort((a, b) => 
        parseISO(b.faturamento).getTime() - parseISO(a.faturamento).getTime()
      );
      
      const ultVenda = sortedVendas[0];
      const oldestVenda = sortedVendas[sortedVendas.length - 1];
      const diasUltCompra = differenceInDays(new Date(), parseISO(ultVenda.faturamento));
      
      const totalQtd = vendas.reduce((acc, v) => acc + v.qtd, 0);
      const mediaQtd = totalQtd / vendas.length;
      
      const spanDias = Math.max(1, differenceInDays(new Date(), parseISO(oldestVenda.faturamento)));
      const uniqueDates = [...new Set(vendas.map(v => parseISO(v.faturamento).getTime()))];
      const numPurchases = uniqueDates.length;
      
      let mediaCiclo = Math.round(spanDias / numPurchases);
      if (mediaCiclo === 0) mediaCiclo = Math.max(30, diasUltCompra);

      const produto = productsMap[produtoId];
      const quantEmbalagem = produto?.quant_embalagem || 1;
      const consumoDiario = totalQtd / spanDias;
      
      const rawEstoqueIdeal = Math.ceil(consumoDiario * mediaCiclo * quantEmbalagem);
      const currentStock = estoqueMap[produtoId] || 0;
      const estoqueIdeal = Math.max(0, rawEstoqueIdeal - currentStock);

      const tendencia = mediaCiclo > 0 ? Math.floor(diasUltCompra / mediaCiclo) * -1 : 0;
      const lastPurchaseItems = sortedVendas.filter(v => v.faturamento === ultVenda.faturamento);
      const qtdUltCompraInfo = lastPurchaseItems.reduce((acc, v) => acc + v.qtd, 0) * quantEmbalagem;

      return {
        produto_id: produtoId,
        produto_nome: ultVenda.produtos,
        dias_ult_compra: diasUltCompra,
        qtd_ult_compra: qtdUltCompraInfo,
        quantidade_atual: currentStock,
        ultima_contagem_valor: ultimaContagemMap[produtoId] || 0,
        media_qtd: Math.round(mediaQtd * quantEmbalagem),
        media_ciclo: mediaCiclo,
        tendencia,
        peso: produto?.peso_embalagem || 0,
        peso_unitario: (produto?.peso_embalagem || 0) / (produto?.quant_embalagem || 1),
        estoque_ideal: estoqueIdeal,
        raw_estoque_ideal: rawEstoqueIdeal,
        ativo: produto?.ativo ?? true,
        quant_embalagem: quantEmbalagem,
        familia: produto?.familia || 'Sem Família'
      };
    })
    .filter(item => item !== null);

  console.log(`6. Quantidade de produtos após montar a lista base (processedItems): ${result.length}`);

  // Filter active
  const activeItems = result.filter(item => item.ativo);
  console.log(`7. Quantidade após aplicar filtro de ativos (showInactive=false): ${activeItems.length}`);

  // Filter inactive (all of them)
  const inactiveItems = result;
  console.log(`8. Quantidade após aplicar filtro de inativos (showInactive=true): ${inactiveItems.length}`);

  // Apply search
  let filtered = activeItems;
  console.log(`9. Quantidade após aplicar filtro de busca (termo: ""): ${filtered.length}`);

  // Apply family
  console.log(`10. Quantidade após aplicar filtro de categoria ("Todas"): ${filtered.length}`);

  // Apply weight
  console.log(`11. Quantidade após aplicar filtro de peso ("Todos"): ${filtered.length}`);
  
  console.log(`12. Quantidade final entregue para renderização: ${filtered.length}`);
  
  if (filtered.length > 0) {
    console.log("Exemplo de item pronto para renderizar:", filtered[0]);
  }
}

run();
