import React, { useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  BarChart3,
  Check,
  ChevronDown,
  FileDown,
  History,
  Loader2,
  PackagePlus,
  Plus,
  Save,
  Search,
  SlidersHorizontal,
  X
} from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { differenceInCalendarDays, differenceInCalendarMonths, format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useDataManager } from '../lib/dataManager';
import { supabase } from '../lib/supabase';
import { classifySaleRecord } from '../lib/salesClassifier';
import { cn, deduplicateSales, formatCurrency, formatWeight } from '../lib/utils';
import { calcularPrecoComDesconto } from '../lib/calculations';
import { Cliente, HistVenda, PrecoFaixa, Produto } from '../types';

type ReportMode = 'comparison' | 'history' | 'custom';
type NewProductForm = Omit<Produto, 'id'>;
type CustomColumn = 'product' | 'family' | 'units' | 'unitWeight' | 'lastPrice' | 'averageCost' | 'suggested' | 'markup' | 'tableMarkup' | 'lastPurchaseDate' | 'lastPurchaseQty' | 'purchaseCount' | 'totalPurchased' | 'monthlyAverage' | 'daysSincePurchase' | 'tableSavings' | 'negotiatedPrice' | 'extraDiscount' | `table:${PrecoFaixa}`;

const PRICE_TABLES: Array<{ key: PrecoFaixa; label: string }> = [
  { key: 'livre', label: 'Livre' },
  { key: '200kg', label: '200 kg' },
  { key: '500kg', label: '500 kg' },
  { key: '1000kg', label: '1.000 kg' },
  { key: '2000kg', label: '2.000 kg' },
  { key: '4000kg', label: '4.000 kg' }
];

const EMPTY_PRODUCT: NewProductForm = {
  produto: '',
  ativo: true,
  familia: '',
  livre: 0,
  '200kg': 0,
  '500kg': 0,
  '1000kg': 0,
  '2000kg': 0,
  '4000kg': 0,
  custo_total: 0,
  custo_und: 0,
  sugestao: 0,
  comissao: 0,
  peso_embalagem: 0,
  quant_embalagem: 1
};

const priceForTable = (product: Produto, table: PrecoFaixa) => {
  return calcularPrecoComDesconto(product.custo_und, product[table]);
};

const unitWeight = (product: Pick<Produto, 'peso_embalagem' | 'quant_embalagem'>) =>
  (Number(product.peso_embalagem) || 0) / Math.max(1, Number(product.quant_embalagem) || 1);

const markup = (suggested: number, purchasePrice: number) => {
  if (suggested <= 0 || purchasePrice <= 0) return null;
  return ((suggested - purchasePrice) / purchasePrice) * 100;
};

const productKey = (sale: HistVenda) => sale.produto_id || sale.produtos?.trim().toLowerCase();
const saleOrderKey = (sale: HistVenda) => {
  const orderNumber = (sale as HistVenda & { numero_pedido_erp?: string }).numero_pedido_erp?.trim();
  return orderNumber ? `${sale.cliente_id}|${orderNumber}` : `${sale.cliente_id}|${sale.faturamento}`;
};

const loadReportLogo = () => new Promise<string | null>(resolve => {
  const image = new Image();
  let settled = false;
  const finish = (value: string | null) => {
    if (settled) return;
    settled = true;
    resolve(value);
  };
  window.setTimeout(() => finish(null), 3500);
  image.crossOrigin = 'anonymous';
  image.onload = () => {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      canvas.getContext('2d')?.drawImage(image, 0, 0);
      finish(canvas.toDataURL('image/png'));
    } catch {
      finish(null);
    }
  };
  image.onerror = () => finish(null);
  image.src = 'https://wsrv.nl/?url=https://adimax.com.br/wp-content/uploads/2021/06/logo_adimax-04968c974e8e5d15ddb822152395b3f6.png&w=400&output=png';
});

const drawReportHeader = (
  doc: jsPDF,
  logo: string | null,
  title: string,
  detail: string,
  clientName: string
) => {
  const pageWidth = doc.internal.pageSize.getWidth();
  doc.setTextColor(23, 23, 23);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(17);
  doc.text(title.toUpperCase(), 14, 14);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(115, 115, 115);
  doc.setFontSize(8);
  doc.text(detail, 14, 20);
  doc.text(`Data: ${format(new Date(), 'dd/MM/yyyy HH:mm', { locale: ptBR })}`, 14, 24);

  if (logo) {
    doc.addImage(logo, 'PNG', pageWidth - 48, 7, 34, 10);
  } else {
    doc.setTextColor(234, 88, 12);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(15);
    doc.text('ADIMAX', pageWidth - 14, 14, { align: 'right' });
  }
  doc.setTextColor(163, 163, 163);
  doc.setFontSize(6);
  doc.text('PARCEIRO OFICIAL', pageWidth - 14, 21, { align: 'right' });
  doc.setDrawColor(38, 38, 38);
  doc.setLineWidth(0.6);
  doc.line(14, 28, pageWidth - 14, 28);

  doc.setFillColor(250, 250, 250);
  doc.roundedRect(14, 32, 124, 11, 1.5, 1.5, 'F');
  doc.roundedRect(142, 32, 124, 11, 1.5, 1.5, 'F');
  doc.setTextColor(163, 163, 163);
  doc.setFontSize(6);
  doc.text('CLIENTE', 18, 36);
  doc.text('VENDEDOR', 146, 36);
  doc.setTextColor(23, 23, 23);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.text(clientName || 'NAO IDENTIFICADO', 18, 40);
  doc.text('MAICON OLIVEIRA - REPRESENTANTE COMERCIAL', 146, 40);
};

const addReportFooters = (doc: jsPDF, disclaimer: string) => {
  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page += 1) {
    doc.setPage(page);
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    doc.setDrawColor(229, 229, 229);
    doc.setLineWidth(0.2);
    doc.line(14, pageHeight - 15, pageWidth - 14, pageHeight - 15);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(163, 163, 163);
    doc.setFontSize(6.5);
    doc.text(disclaimer, pageWidth / 2, pageHeight - 10, { align: 'center' });
    doc.setFont('helvetica', 'bold');
    doc.text('MAICON OLIVEIRA REPRESENTACOES', 14, pageHeight - 5);
    doc.text(`Pagina ${page} de ${pages}`, pageWidth - 14, pageHeight - 5, { align: 'right' });
  }
};

export function PriceReportsPage() {
  const {
    produtos: managedProducts,
    clientes,
    hist_vendas: managedHistory,
    refreshProdutos,
    loadingGlobal
  } = useDataManager();
  const [products, setProducts] = useState<Produto[]>(managedProducts);
  const [mode, setMode] = useState<ReportMode>('comparison');
  const [search, setSearch] = useState('');
  const [family, setFamily] = useState('all');
  const [packageWeight, setPackageWeight] = useState('all');
  const [clientId, setClientId] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectedTables, setSelectedTables] = useState<Set<PrecoFaixa>>(
    new Set(['livre'])
  );
  const [comparisonShowMarkup, setComparisonShowMarkup] = useState(true);
  const [historyProductId, setHistoryProductId] = useState('');
  const [onlyPurchased, setOnlyPurchased] = useState(false);
  const [customColumnDraft, setCustomColumnDraft] = useState<Set<CustomColumn>>(new Set(['product', 'lastPrice', 'averageCost', 'table:livre', 'table:500kg', 'table:1000kg', 'table:2000kg', 'suggested', 'markup']));
  const [customColumns, setCustomColumns] = useState<Set<CustomColumn> | null>(null);
  const [savingsTables, setSavingsTables] = useState<[PrecoFaixa, PrecoFaixa]>(['livre', '1000kg']);
  const [negotiatedPrices, setNegotiatedPrices] = useState<Record<string, number>>({});
  const [extraDiscounts, setExtraDiscounts] = useState<Record<string, number>>({});
  const [proposalValidity, setProposalValidity] = useState('');
  const [showNewProduct, setShowNewProduct] = useState(false);
  const [newProduct, setNewProduct] = useState<NewProductForm>(EMPTY_PRODUCT);
  const [savingProduct, setSavingProduct] = useState(false);
  const [viewedProduct, setViewedProduct] = useState<Produto | null>(null);
  const [editForm, setEditForm] = useState<Produto | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportMessage, setExportMessage] = useState('');

  React.useEffect(() => setProducts(managedProducts), [managedProducts]);

  const history = useMemo(() => deduplicateSales(managedHistory), [managedHistory]);
  const normalSales = useMemo(
    () => history.filter(sale => classifySaleRecord(sale).entraFaturamento),
    [history]
  );

  const activeProducts = useMemo(
    () => products.filter(product => product.ativo !== false),
    [products]
  );
  const allFamilies = useMemo(
    () => Array.from(new Set(activeProducts.map(product => product.familia).filter(Boolean))).sort(),
    [activeProducts]
  );
  const families = useMemo(
    () => Array.from(new Set(activeProducts
      .filter(product => packageWeight === 'all' || Number(unitWeight(product).toFixed(3)) === Number(packageWeight))
      .map(product => product.familia)
      .filter(Boolean))).sort(),
    [activeProducts, packageWeight]
  );
  const packageWeights = useMemo(
    () => Array.from(new Set(activeProducts
      .filter(product => family === 'all' || product.familia === family)
      .map(product => Number(unitWeight(product).toFixed(3)))))
      .filter(Boolean)
      .sort((a, b) => a - b),
    [activeProducts, family]
  );

  React.useEffect(() => {
    if (family !== 'all' && !families.includes(family)) setFamily('all');
  }, [families, family]);

  React.useEffect(() => {
    if (packageWeight !== 'all' && !packageWeights.includes(Number(packageWeight))) setPackageWeight('all');
  }, [packageWeights, packageWeight]);

  const periodSales = useMemo(() => normalSales.filter(sale => {
    if (clientId !== 'all' && sale.cliente_id !== clientId) return false;
    if (dateFrom && sale.faturamento < dateFrom) return false;
    if (dateTo && sale.faturamento > dateTo) return false;
    return true;
  }), [normalSales, clientId, dateFrom, dateTo]);

  const purchasedKeys = useMemo(() => new Set(periodSales.map(productKey)), [periodSales]);

  const historyClientIds = useMemo(() => {
    if (!historyProductId) return null;
    const product = products.find(item => item.id === historyProductId);
    if (!product) return null;
    return new Set(normalSales
      .filter(sale => !dateFrom || sale.faturamento >= dateFrom)
      .filter(sale => !dateTo || sale.faturamento <= dateTo)
      .filter(sale => productKey(sale) === product.id || sale.produtos?.trim().toLowerCase() === product.produto.trim().toLowerCase())
      .map(sale => sale.cliente_id)
      .filter(Boolean));
  }, [historyProductId, products, normalSales, dateFrom, dateTo]);

  const availableClients = useMemo(
    () => clientes.filter(client => client.ativo !== false && (mode !== 'history' || !historyClientIds || historyClientIds.has(client.id))),
    [clientes, mode, historyClientIds]
  );

  React.useEffect(() => {
    if (mode === 'history' && clientId !== 'all' && !availableClients.some(client => client.id === clientId)) setClientId('all');
  }, [mode, clientId, availableClients]);

  const filteredProducts = useMemo(() => products
    .filter(product => product.ativo !== false)
    .filter(product => family === 'all' || product.familia === family)
    .filter(product => packageWeight === 'all' || Number(unitWeight(product).toFixed(3)) === Number(packageWeight))
    .filter(product => {
      const term = search.trim().toLocaleLowerCase('pt-BR');
      return !term || product.produto.toLocaleLowerCase('pt-BR').includes(term);
    })
    .filter(product => !onlyPurchased || purchasedKeys.has(product.id))
    .sort((a, b) => `${a.familia} ${a.produto}`.localeCompare(`${b.familia} ${b.produto}`, 'pt-BR')),
  [products, family, packageWeight, search, onlyPurchased, purchasedKeys]);

  const selectedProducts = useMemo(
    () => products.filter(product => selectedIds.has(product.id)),
    [products, selectedIds]
  );

  const selectedClient = clientes.find(client => client.id === clientId);

  const priceStats = useMemo(() => {
    const map = new Map<string, { last: number; average: number; quantity: number; lastDate: string; lastQuantity: number; purchaseCount: number; monthlyAverage: number; daysSince: number }>();
    const grouped = new Map<string, HistVenda[]>();
    periodSales.forEach(sale => {
      const key = productKey(sale);
      if (!key) return;
      grouped.set(key, [...(grouped.get(key) || []), sale]);
    });
    grouped.forEach((sales, key) => {
      const sorted = [...sales].sort((a, b) => b.faturamento.localeCompare(a.faturamento));
      const totalQuantity = sales.reduce((sum, sale) => sum + (Number(sale.qtd) || 0), 0);
      const totalValue = sales.reduce((sum, sale) => sum + (Number(sale['r$_total']) || 0), 0);
      const lastSale = sorted[0];
      const firstSale = sorted[sorted.length - 1];
      const months = Math.max(1, differenceInCalendarMonths(parseISO(lastSale.faturamento), parseISO(firstSale.faturamento)) + 1);
      map.set(key, {
        last: (Number(lastSale?.['r$_total']) || 0) / Math.max(1, Number(lastSale?.qtd) || 1),
        average: totalValue / Math.max(1, totalQuantity),
        quantity: totalQuantity,
        lastDate: lastSale.faturamento,
        lastQuantity: Number(lastSale.qtd) || 0,
        purchaseCount: new Set(sales.map(sale => sale.faturamento)).size,
        monthlyAverage: totalQuantity / months,
        daysSince: differenceInCalendarDays(new Date(), parseISO(lastSale.faturamento))
      });
    });
    return map;
  }, [periodSales]);

  const historyRows = useMemo(() => {
    if (!historyProductId) return [];
    const product = products.find(item => item.id === historyProductId);
    if (!product) return [];
    return periodSales
      .filter(sale => productKey(sale) === product.id || sale.produtos?.trim().toLowerCase() === product.produto.trim().toLowerCase())
      .sort((a, b) => b.faturamento.localeCompare(a.faturamento));
  }, [historyProductId, products, periodSales]);

  const orderWeightMap = useMemo(() => {
    const productById = new Map(products.map(product => [product.id, product]));
    const productByName = new Map(products.map(product => [product.produto.trim().toLowerCase(), product]));
    const weights = new Map<string, number>();
    normalSales.forEach(sale => {
      const product = productById.get(sale.produto_id) || productByName.get(sale.produtos?.trim().toLowerCase());
      const lineWeight = (Number(sale.qtd) || 0) * (Number(product?.peso_embalagem) || 0);
      const key = saleOrderKey(sale);
      weights.set(key, (weights.get(key) || 0) + lineWeight);
    });
    return weights;
  }, [normalSales, products]);

  const toggleProduct = (id: string) => setSelectedIds(current => {
    const next = new Set(current);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const toggleTable = (table: PrecoFaixa) => setSelectedTables(current => {
    const next = new Set(current);
    next.has(table) ? next.delete(table) : next.add(table);
    return next;
  });

  const deliverPdf = async (doc: jsPDF, filename: string, title: string) => {
    const blob = doc.output('blob');
    const file = new File([blob], filename, { type: 'application/pdf' });
    if (navigator.share && navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title });
        return 'Relatório pronto para compartilhamento.';
      } catch (error: any) {
        if (error?.name === 'AbortError') throw error;
        // Some browsers report file sharing support but reject the native sheet.
        // In that case, continue with a regular download below.
      }
    }
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    return 'PDF gerado e enviado para downloads.';
  };

  const generateComparisonPdf = async () => {
    if (!selectedProducts.length || !selectedTables.size) return;
    setExporting(true);
    setExportMessage('');
    try {
      const logo = await loadReportLogo();
      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
      const activeTables = PRICE_TABLES.filter(table => mode === 'custom' ? customColumns?.has(`table:${table.key}`) : selectedTables.has(table.key));
      const detail = `Tabelas: ${activeTables.map(table => table.label).join(' | ')}${mode === 'custom' && proposalValidity ? ` | Valida ate ${format(parseISO(proposalValidity), 'dd/MM/yyyy')}` : ''}`;
      const customHeaders = mode === 'custom' ? [
        ...(customColumns?.has('family') ? ['Familia'] : []),
        ...(customColumns?.has('units') ? ['Unid. embalagem'] : []),
        ...(customColumns?.has('unitWeight') ? ['Peso unitario'] : []),
        ...(customColumns?.has('lastPrice') ? ['Ultimo preco'] : []),
        ...(customColumns?.has('averageCost') ? ['Custo medio unitario'] : []),
        ...(customColumns?.has('lastPurchaseDate') ? ['Ultima compra'] : []),
        ...(customColumns?.has('lastPurchaseQty') ? ['Qtd ultima'] : []),
        ...(customColumns?.has('purchaseCount') ? ['Compras'] : []),
        ...(customColumns?.has('totalPurchased') ? ['Qtd total'] : []),
        ...(customColumns?.has('monthlyAverage') ? ['Media mensal'] : []),
        ...(customColumns?.has('daysSincePurchase') ? ['Sem comprar'] : [])
      ] : [];
      const tableStartColumn = (mode !== 'custom' || customColumns?.has('product') ? 1 : 0) + customHeaders.length;
      const showTableMarkup = mode === 'custom' ? Boolean(customColumns?.has('tableMarkup')) : comparisonShowMarkup;
      const markupColumnIndexes = new Set(activeTables.map((_, index) => tableStartColumn + (index * 2) + 1));
      const valueColumnIndexes = new Set(activeTables.map((_, index) => tableStartColumn + (index * (showTableMarkup ? 2 : 1))));
      autoTable(doc, {
        startY: 48,
        margin: { top: 48, right: 14, bottom: 20, left: 14 },
        head: [[...(mode !== 'custom' || customColumns?.has('product') ? ['Produto'] : []), ...customHeaders, ...activeTables.flatMap(table => [table.label, ...(showTableMarkup ? ['Markup'] : [])]), ...(mode === 'custom' && customColumns?.has('tableSavings') ? ['Economia'] : []), ...(mode === 'custom' && customColumns?.has('markup') ? ['Markup medio'] : []), ...(mode === 'custom' && customColumns?.has('negotiatedPrice') ? ['Preco negociado', ...(showTableMarkup ? ['Markup'] : [])] : []), ...(mode === 'custom' && customColumns?.has('extraDiscount') ? ['Custo com desconto', ...(showTableMarkup ? ['Markup'] : [])] : []), ...(mode !== 'custom' || customColumns?.has('suggested') ? ['Sugerido'] : [])]],
        body: selectedProducts.map(product => {
          const stat = priceStats.get(product.id) || priceStats.get(product.produto.trim().toLowerCase());
          const quantity = Math.max(1, Number(product.quant_embalagem) || 1);
          const averageUnitCost = (stat?.average || 0) / quantity;
          const lastUnitPrice = (stat?.last || 0) / quantity;
          const averageMarkup = markup(product.sugestao, averageUnitCost);
          const negotiatedPrice = negotiatedPrices[product.id] || 0;
          const discountedCost = (Number(product.custo_und) || 0) * (1 - ((extraDiscounts[product.id] || 0) / 100));
          const negotiatedMarkup = markup(product.sugestao, negotiatedPrice);
          const discountedMarkup = markup(product.sugestao, discountedCost);
          return [
            ...(mode !== 'custom' || customColumns?.has('product') ? [product.produto] : []),
            ...(mode === 'custom' && customColumns?.has('family') ? [product.familia] : []),
            ...(mode === 'custom' && customColumns?.has('units') ? [product.quant_embalagem] : []),
            ...(mode === 'custom' && customColumns?.has('unitWeight') ? [formatWeight(unitWeight(product))] : []),
            ...(mode === 'custom' && customColumns?.has('lastPrice') ? [stat ? formatCurrency(lastUnitPrice) : '-'] : []),
            ...(mode === 'custom' && customColumns?.has('averageCost') ? [stat ? formatCurrency(averageUnitCost) : '-'] : []),
            ...(mode === 'custom' && customColumns?.has('lastPurchaseDate') ? [stat ? format(parseISO(stat.lastDate), 'dd/MM/yyyy') : '-'] : []),
            ...(mode === 'custom' && customColumns?.has('lastPurchaseQty') ? [stat?.lastQuantity ?? '-'] : []),
            ...(mode === 'custom' && customColumns?.has('purchaseCount') ? [stat?.purchaseCount ?? '-'] : []),
            ...(mode === 'custom' && customColumns?.has('totalPurchased') ? [stat?.quantity ?? '-'] : []),
            ...(mode === 'custom' && customColumns?.has('monthlyAverage') ? [stat ? stat.monthlyAverage.toFixed(1) : '-'] : []),
            ...(mode === 'custom' && customColumns?.has('daysSincePurchase') ? [stat ? `${stat.daysSince} dias` : '-'] : []),
            ...activeTables.flatMap(table => {
              const value = markup(product.sugestao, priceForTable(product, table.key));
              return [formatCurrency(priceForTable(product, table.key)), ...(showTableMarkup ? [value === null ? '-' : `${value.toFixed(1)}%`] : [])];
            }),
            ...(mode === 'custom' && customColumns?.has('tableSavings') ? [formatCurrency(Math.abs(priceForTable(product, savingsTables[0]) - priceForTable(product, savingsTables[1])))] : []),
            ...(mode === 'custom' && customColumns?.has('markup') ? [averageMarkup === null ? '-' : `${averageMarkup.toFixed(1)}%`] : []),
            ...(mode === 'custom' && customColumns?.has('negotiatedPrice') ? [negotiatedPrice ? formatCurrency(negotiatedPrice) : '-', ...(showTableMarkup ? [negotiatedMarkup === null ? '-' : `${negotiatedMarkup.toFixed(1)}%`] : [])] : []),
            ...(mode === 'custom' && customColumns?.has('extraDiscount') ? [formatCurrency(discountedCost), ...(showTableMarkup ? [discountedMarkup === null ? '-' : `${discountedMarkup.toFixed(1)}%`] : [])] : []),
            ...(mode !== 'custom' || customColumns?.has('suggested') ? [formatCurrency(product.sugestao)] : [])
          ];
        }),
        styles: { fontSize: 8 },
        headStyles: { fillColor: [23, 23, 23] },
        alternateRowStyles: { fillColor: [250, 250, 250] },
        didParseCell: data => {
          if (showTableMarkup && markupColumnIndexes.has(data.column.index)) data.cell.styles.fillColor = data.section === 'head' ? [48, 48, 48] : [245, 245, 245];
          if (valueColumnIndexes.has(data.column.index)) {
            data.cell.styles.lineColor = [180, 180, 180];
            data.cell.styles.lineWidth = { left: 0.35 };
          }
        },
        didDrawPage: () => drawReportHeader(
          doc,
          logo,
          'Consulta comparativa de precos',
          detail,
          selectedClient?.cliente || 'Nao identificado'
        )
      });
      addReportFooters(doc, 'Precos sujeitos a alteracao sem aviso previo. Este documento nao possui validade fiscal.');
      const filename = `consulta-precos-${format(new Date(), 'yyyy-MM-dd')}.pdf`;
      setExportMessage(await deliverPdf(doc, filename, 'Consulta de preços'));
    } catch (error: any) {
      if (error?.name !== 'AbortError') {
        console.error('Erro ao gerar PDF:', error);
        setExportMessage('Não foi possível gerar o PDF. Tente novamente.');
      }
    } finally {
      setExporting(false);
    }
  };

  const generateHistoryPdf = async () => {
    const product = products.find(item => item.id === historyProductId);
    if (!product || !historyRows.length) return;
    setExporting(true);
    setExportMessage('');
    try {
      const logo = await loadReportLogo();
      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
      const detail = `Produto: ${product.produto}`;
      autoTable(doc, {
        startY: 48,
        margin: { top: 48, right: 14, bottom: 20, left: 14 },
        head: [['Data', 'Cliente', 'Qtd', 'Peso', 'Peso pedido', 'Preco pago', 'Total']],
        body: historyRows.map(sale => [
          format(parseISO(sale.faturamento), 'dd/MM/yyyy'),
          sale.cliente,
          sale.qtd,
          formatWeight((Number(sale.qtd) || 0) * (Number(product.peso_embalagem) || 0)),
          formatWeight(orderWeightMap.get(saleOrderKey(sale)) || 0),
          formatCurrency((Number(sale['r$_total']) || 0) / Math.max(1, Number(sale.qtd) || 1)),
          formatCurrency(sale['r$_total'])
        ]),
        styles: { fontSize: 8 },
        headStyles: { fillColor: [23, 23, 23] },
        alternateRowStyles: { fillColor: [250, 250, 250] },
        didDrawPage: () => drawReportHeader(
          doc,
          logo,
          'Historico de vendas do produto',
          detail,
          selectedClient?.cliente || 'Todos os clientes'
        )
      });
      addReportFooters(doc, 'Relatorio interno de historico comercial. Este documento nao possui validade fiscal.');
      const filename = `historico-${product.produto.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.pdf`;
      setExportMessage(await deliverPdf(doc, filename, 'Histórico de vendas'));
    } catch (error: any) {
      if (error?.name !== 'AbortError') {
        console.error('Erro ao gerar histórico em PDF:', error);
        setExportMessage('Não foi possível gerar o PDF. Tente novamente.');
      }
    } finally {
      setExporting(false);
    }
  };

  const saveNewProduct = async () => {
    if (!newProduct.produto.trim() || !newProduct.familia.trim()) return;
    const familyTemplate = activeProducts.find(product => product.familia === newProduct.familia);
    if (!familyTemplate) {
      alert('Selecione uma família existente para copiar os descontos praticados.');
      return;
    }
    setSavingProduct(true);
    try {
      const quantity = Math.max(1, Number(newProduct.quant_embalagem) || 1);
      const productToInsert: NewProductForm = {
        ...newProduct,
        custo_und: (Number(newProduct.custo_total) || 0) / quantity,
        livre: Number(familyTemplate.livre) || 0,
        '200kg': Number(familyTemplate['200kg']) || 0,
        '500kg': Number(familyTemplate['500kg']) || 0,
        '1000kg': Number(familyTemplate['1000kg']) || 0,
        '2000kg': Number(familyTemplate['2000kg']) || 0,
        '4000kg': Number(familyTemplate['4000kg']) || 0
      };
      const { data, error } = await supabase.from('produtos').insert(productToInsert).select('*').single();
      if (error) throw error;
      setProducts(current => [...current, data as Produto]);
      setSelectedIds(current => new Set(current).add(data.id));
      setNewProduct(EMPTY_PRODUCT);
      setShowNewProduct(false);
      await refreshProdutos();
    } catch (error) {
      console.error('Erro ao cadastrar produto:', error);
      alert('Não foi possível cadastrar o produto. Verifique os campos e tente novamente.');
    } finally {
      setSavingProduct(false);
    }
  };

  const openProduct = (product: Produto, editing = false) => {
    setViewedProduct(product);
    setEditForm(editing ? { ...product } : null);
  };

  const closeProduct = () => {
    if (savingEdit) return;
    setViewedProduct(null);
    setEditForm(null);
  };

  const saveEditedProduct = async () => {
    if (!editForm) return;
    setSavingEdit(true);
    try {
      const quantity = Math.max(1, Number(editForm.quant_embalagem) || 1);
      const updatedProduct: Produto = {
        ...editForm,
        quant_embalagem: quantity,
        peso_embalagem: Number(editForm.peso_embalagem) || 0,
        custo_total: Number(editForm.custo_total) || 0,
        custo_und: (Number(editForm.custo_total) || 0) / quantity,
        sugestao: Number(editForm.sugestao) || 0,
        comissao: Number(editForm.comissao) || 0
      };
      const { id, ...changes } = updatedProduct;
      const { error } = await supabase.from('produtos').update(changes).eq('id', id);
      if (error) throw error;
      setProducts(current => current.map(product => product.id === id ? updatedProduct : product));
      setViewedProduct(updatedProduct);
      setEditForm(null);
      await refreshProdutos();
    } catch (error) {
      console.error('Erro ao salvar produto:', error);
      alert('Nao foi possivel salvar as alteracoes do produto.');
    } finally {
      setSavingEdit(false);
    }
  };

  if (loadingGlobal && !products.length) {
    return <div className="py-20 text-center font-bold text-neutral-400">Carregando produtos...</div>;
  }

  return (
    <div className="space-y-5 pb-10">
      <div className="flex flex-col gap-4 border-b border-neutral-200 pb-5 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-xs font-bold uppercase text-orange-600">Cadastro, precos e analise</p>
          {/* Previous parallel-area title replaced after consolidation.
          <h1 className="text-2xl font-black text-neutral-900">Preços e relatórios</h1>
          <p className="mt-1 text-sm text-neutral-500">Monte consultas, compare tabelas e analise o histórico de cada produto.</p>
          */}
          <h1 className="text-2xl font-black text-neutral-900">Produto</h1>
          <p className="mt-1 text-sm text-neutral-500">Consulte produtos, compare tabelas e gere relatorios comerciais.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setShowNewProduct(true)} className="flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm font-bold text-neutral-700 hover:bg-neutral-50">
            <PackagePlus size={17} /> Novo produto
          </button>
          <button
            onClick={mode === 'history' ? generateHistoryPdf : generateComparisonPdf}
            disabled={exporting || (mode === 'history' ? !historyRows.length : !selectedProducts.length) || (mode === 'custom' && !customColumns)}
            className="flex items-center gap-2 rounded-lg bg-orange-600 px-3 py-2 text-sm font-bold text-white hover:bg-orange-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <FileDown size={17} /> {exporting ? 'Gerando...' : mode === 'custom' ? 'Gerar relatorio' : 'Gerar PDF'}
          </button>
        </div>
      </div>
      {exportMessage && <div className={cn(
        'rounded-lg border px-3 py-2 text-sm font-bold',
        exportMessage.startsWith('Não') ? 'border-red-200 bg-red-50 text-red-700' : 'border-green-200 bg-green-50 text-green-700'
      )}>{exportMessage}</div>}

      <div className="inline-flex w-full overflow-x-auto rounded-lg border border-neutral-200 bg-white p-1 md:w-auto">
        {([
          ['comparison', 'Comparar preços', SlidersHorizontal],
          ['history', 'Histórico do produto', History],
          ['custom', 'Relatório personalizado', BarChart3]
        ] as const).map(([key, label, Icon]) => (
          <button key={key} onClick={() => setMode(key)} className={cn(
            'flex min-w-max items-center gap-2 rounded-md px-3 py-2 text-sm font-bold transition-colors',
            mode === key ? 'bg-neutral-900 text-white' : 'text-neutral-500 hover:bg-neutral-50'
          )}>
            <Icon size={16} /> {label}
          </button>
        ))}
      </div>

      <section className="overflow-hidden rounded-lg border border-neutral-200 bg-white p-4">
        <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-12">
          <label className="relative min-w-0 xl:col-span-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" size={17} />
            <ClearableTextInput value={search} onChange={setSearch} placeholder="Buscar produto" className="w-full rounded-lg border border-neutral-200 py-2.5 pl-10 pr-10 text-sm outline-none focus:border-orange-400" />
          </label>
          <div className="min-w-0 xl:col-span-3"><Select value={clientId} onChange={setClientId} label={mode === 'comparison' ? 'Cliente do relatório' : 'Filtrar cliente'} options={[
            ['all', mode === 'comparison' ? 'Cliente não identificado' : 'Todos os clientes'],
            ...availableClients.map(client => [client.id, client.cliente] as [string, string])
          ]} /></div>
          <div className="min-w-0 xl:col-span-3"><Select value={family} onChange={setFamily} label="Família" options={[
            ['all', 'Todas as famílias'],
            ...families.map(item => [item, item] as [string, string])
          ]} /></div>
          <div className="min-w-0 xl:col-span-2"><Select value={packageWeight} onChange={setPackageWeight} label="Peso unitário" options={[
            ['all', 'Todos os pesos unitários'],
            ...packageWeights.map(item => [String(item), formatWeight(item)] as [string, string])
          ]} /></div>
        </div>
        {mode === 'comparison' && <p className="mt-3 text-xs font-semibold text-neutral-500">
          {selectedClient
            ? `${selectedClient.cliente} será identificado no cabeçalho do PDF.`
            : 'O cliente é opcional e serve apenas para identificar o destinatário no PDF; os preços das tabelas não são alterados.'}
        </p>}
        {(mode === 'history' || mode === 'custom') && (
          <div className="mt-3 grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
            <label className="block min-w-0 max-w-full overflow-hidden text-xs font-bold text-neutral-500">Data inicial<input type="date" value={dateFrom} onChange={event => setDateFrom(event.target.value)} className="mt-1 block min-w-0 max-w-full [inline-size:100%] rounded-lg border border-neutral-200 px-3 py-2 text-sm text-neutral-800" /></label>
            <label className="block min-w-0 max-w-full overflow-hidden text-xs font-bold text-neutral-500">Data final<input type="date" value={dateTo} onChange={event => setDateTo(event.target.value)} className="mt-1 block min-w-0 max-w-full [inline-size:100%] rounded-lg border border-neutral-200 px-3 py-2 text-sm text-neutral-800" /></label>
            {mode === 'custom' && <>
              <Toggle checked={onlyPurchased} onChange={() => setOnlyPurchased(value => !value)} label="Itens positivados" />
              <ColumnSelector draft={customColumnDraft} onChange={setCustomColumnDraft} savingsTables={savingsTables} onSavingsTablesChange={setSavingsTables} onConfirm={() => setCustomColumns(new Set(customColumnDraft))} />
            </>}
          </div>
        )}
      </section>

      {mode === 'history' ? (
        <HistoryReport products={filteredProducts} selectedId={historyProductId} onSelect={setHistoryProductId} rows={historyRows} orderWeightMap={orderWeightMap} />
      ) : mode === 'custom' && !customColumns ? (
        <div className="border-y border-neutral-200 bg-white py-16 text-center"><p className="font-bold text-neutral-700">Escolha e confirme as colunas do relatorio.</p><p className="mt-1 text-sm text-neutral-500">O formulario sera exibido somente depois da confirmacao.</p></div>
      ) : (
        <ComparisonReport
          products={filteredProducts}
          selectedIds={selectedIds}
          selectedTables={selectedTables}
          priceStats={priceStats}
          custom={mode === 'custom'}
          customColumns={customColumns}
          comparisonShowMarkup={comparisonShowMarkup}
          onComparisonShowMarkupChange={() => setComparisonShowMarkup(value => !value)}
          savingsTables={savingsTables}
          negotiatedPrices={negotiatedPrices}
          onNegotiatedPriceChange={(id, price) => setNegotiatedPrices(current => ({ ...current, [id]: price }))}
          extraDiscounts={extraDiscounts}
          onExtraDiscountChange={(id, discount) => setExtraDiscounts(current => ({ ...current, [id]: Math.min(100, Math.max(0, discount)) }))}
          onToggleProduct={toggleProduct}
          onToggleTable={toggleTable}
          onClear={() => setSelectedIds(new Set())}
          onToggleAllVisible={() => setSelectedIds(current => {
            const visibleIds = filteredProducts.map(product => product.id);
            const allVisibleSelected = visibleIds.length > 0 && visibleIds.every(id => current.has(id));
            const next = new Set(current);
            visibleIds.forEach(id => allVisibleSelected ? next.delete(id) : next.add(id));
            return next;
          })}
          onOpenProduct={product => openProduct(product)}
        />
      )}
      {mode === 'custom' && customColumns && <div className="flex justify-end"><label className="w-full max-w-xs text-xs font-bold text-neutral-500">Validade da proposta<input type="date" min={format(new Date(), 'yyyy-MM-dd')} value={proposalValidity} onChange={event => setProposalValidity(event.target.value)} className="mt-1 w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm" /></label></div>}

      {showNewProduct && (
        <NewProductModal form={newProduct} saving={savingProduct} families={allFamilies} products={activeProducts} onChange={setNewProduct} onClose={() => setShowNewProduct(false)} onSave={saveNewProduct} />
      )}
      {viewedProduct && (
        <ProductDrawer
          product={viewedProduct}
          form={editForm}
          saving={savingEdit}
          families={allFamilies}
          onEdit={() => setEditForm({ ...viewedProduct })}
          onChange={setEditForm}
          onCancelEdit={() => setEditForm(null)}
          onClose={closeProduct}
          onSave={saveEditedProduct}
        />
      )}
    </div>
  );
}

function ClearableTextInput({ value, onChange, placeholder, className, ariaLabel }: { value: string; onChange: (value: string) => void; placeholder?: string; className: string; ariaLabel?: string }) {
  return <span className="relative block w-full">
    <input type="text" value={value} onChange={event => onChange(event.target.value)} placeholder={placeholder} aria-label={ariaLabel} className={className} />
    {value && <button type="button" onClick={() => onChange('')} className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700" title="Limpar campo" aria-label={`Limpar ${ariaLabel || placeholder || 'campo'}`}><X size={15}/></button>}
  </span>;
}

function SearchableSelect({ value, onChange, label, options }: { value: string; onChange: (value: string) => void; label: string; options: Array<[string, string]> }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const selectedLabel = options.find(([optionValue]) => optionValue === value)?.[1] || '';
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [popupPosition, setPopupPosition] = useState({ top: 0, left: 0, width: 0 });
  const openDropdown = () => {
    if (open) {
      setOpen(false);
      return;
    }
    const rect = rootRef.current?.getBoundingClientRect();
    if (rect) setPopupPosition({ top: rect.bottom + 4, left: rect.left, width: rect.width });
    setQuery('');
    setOpen(true);
  };
  React.useEffect(() => {
    const close = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !popupRef.current?.contains(target)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  const normalizedQuery = query.trim().toLocaleLowerCase('pt-BR');
  const filtered = options.filter(([, optionLabel], index) => index === 0 || !normalizedQuery || optionLabel.toLocaleLowerCase('pt-BR').includes(normalizedQuery));
  return <div ref={rootRef} className="relative min-w-0">
    <button type="button" onClick={openDropdown} aria-label={label} aria-expanded={open} className="flex w-full items-center rounded-lg border border-neutral-200 bg-white px-3 py-2.5 text-left text-sm font-semibold text-neutral-700 outline-none hover:border-neutral-300 focus:border-orange-400">
      <span className="min-w-0 flex-1 truncate">{selectedLabel || label}</span>
      {value !== options[0]?.[0] && <span role="button" tabIndex={0} onClick={event => { event.stopPropagation(); onChange(options[0]?.[0] || ''); }} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onChange(options[0]?.[0] || ''); } }} className="mr-1 flex h-6 w-6 items-center justify-center rounded-md text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700" title="Limpar cliente" aria-label="Limpar cliente"><X size={14}/></span>}
      <ChevronDown size={16} className={cn('shrink-0 text-neutral-400 transition-transform', open && 'rotate-180')}/>
    </button>
    {open && createPortal(<div ref={popupRef} style={{ position: 'fixed', top: popupPosition.top, left: popupPosition.left, width: popupPosition.width }} className="z-[300] overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-2xl">
      <div className="border-b border-neutral-100 p-2"><ClearableTextInput value={query} onChange={setQuery} ariaLabel="Buscar cliente" placeholder="Buscar cliente" className="w-full rounded-lg border border-neutral-200 px-3 py-2 pr-10 text-sm outline-none focus:border-orange-400" /></div>
      <div className="max-h-64 overflow-y-auto p-1">
        {filtered.map(([optionValue, optionLabel]) => <button key={optionValue} type="button" onClick={() => { onChange(optionValue); setOpen(false); }} className={cn('block w-full rounded-md px-3 py-2 text-left text-sm hover:bg-orange-50', value === optionValue ? 'bg-orange-50 font-bold text-orange-700' : 'text-neutral-700')}>{optionLabel}</button>)}
        {!filtered.length && <p className="px-3 py-4 text-center text-sm font-semibold text-neutral-400">Nenhum cliente encontrado.</p>}
      </div>
    </div>, document.body)}
  </div>;
}

function Select({ value, onChange, label, options }: { value: string; onChange: (value: string) => void; label: string; options: Array<[string, string]> }) {
  if (label.toLocaleLowerCase('pt-BR').includes('cliente')) return <SearchableSelect value={value} onChange={onChange} label={label} options={options} />;
  return <label className="relative block min-w-0 max-w-full">
    <span className="sr-only">{label}</span>
    <select value={value} onChange={event => onChange(event.target.value)} className="block w-full min-w-0 max-w-full appearance-none truncate rounded-lg border border-neutral-200 bg-white px-3 py-2.5 pr-9 text-sm font-semibold text-neutral-700 outline-none focus:border-orange-400">
      {options.map(([optionValue, optionLabel]) => <option key={optionValue} value={optionValue}>{optionLabel}</option>)}
    </select>
    <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400" size={16} />
  </label>;
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return <button onClick={onChange} className="flex items-center gap-2 self-end rounded-lg border border-neutral-200 px-3 py-2.5 text-sm font-bold text-neutral-700">
    <span className={cn('flex h-5 w-9 items-center rounded-full p-0.5 transition-colors', checked ? 'bg-orange-600' : 'bg-neutral-200')}><span className={cn('h-4 w-4 rounded-full bg-white transition-transform', checked && 'translate-x-4')} /></span>{label}
  </button>;
}

const CUSTOM_COLUMN_GROUPS: Array<{ title: string; options: Array<[CustomColumn, string]> }> = [
  { title: 'Produto e embalagem', options: [
    ['product', 'Produto'], ['family', 'Familia'], ['units', 'Unidades por embalagem'], ['unitWeight', 'Peso unitario']
  ] },
  { title: 'Historico de compras', options: [
    ['lastPrice', 'Ultimo preco pago'], ['averageCost', 'Custo medio unitario'],
    ['lastPurchaseDate', 'Data da ultima compra'], ['lastPurchaseQty', 'Quantidade da ultima compra'],
    ['purchaseCount', 'Numero de compras no periodo'], ['totalPurchased', 'Quantidade total comprada'],
    ['monthlyAverage', 'Media mensal comprada'], ['daysSincePurchase', 'Tempo sem comprar']
  ] },
  { title: 'Tabelas e rentabilidade', options: [
    ['table:livre', 'Tabela Livre'], ['table:200kg', 'Tabela 200 kg'], ['table:500kg', 'Tabela 500 kg'],
    ['table:1000kg', 'Tabela 1.000 kg'], ['table:2000kg', 'Tabela 2.000 kg'], ['table:4000kg', 'Tabela 4.000 kg'],
    ['tableMarkup', 'Markup por tabela'], ['tableSavings', 'Economia entre duas tabelas'],
    ['suggested', 'Preco sugerido'], ['markup', 'Markup medio']
  ] },
  { title: 'Negociacao', options: [
    ['negotiatedPrice', 'Preco negociado manualmente'], ['extraDiscount', 'Desconto extra']
  ] }
];

function ColumnSelector({ draft, onChange, savingsTables, onSavingsTablesChange, onConfirm }: { draft: Set<CustomColumn>; onChange: (value: Set<CustomColumn>) => void; savingsTables: [PrecoFaixa, PrecoFaixa]; onSavingsTablesChange: (value: [PrecoFaixa, PrecoFaixa]) => void; onConfirm: () => void }) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0, width: 0 });
  const toggle = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!open && rect) setPosition({ top: rect.bottom + 4, left: rect.left, width: rect.width });
    setOpen(value => !value);
  };
  React.useEffect(() => {
    const close = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !popupRef.current?.contains(target)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  return <div className="self-end">
    <button ref={triggerRef} type="button" onClick={toggle} aria-expanded={open} className="flex w-full items-center justify-between gap-2 rounded-lg border border-neutral-200 bg-white px-3 py-2.5 text-sm font-bold text-neutral-700">Colunas do relatorio <ChevronDown size={16} className={cn('shrink-0 transition-transform', open && 'rotate-180')}/></button>
    {open && createPortal(<div ref={popupRef} style={{ position: 'fixed', top: position.top, left: position.left, width: position.width, maxHeight: `calc(100vh - ${position.top + 12}px)` }} className="z-[300] overflow-y-auto rounded-lg border border-neutral-200 bg-white p-3 shadow-2xl">
      <div className="space-y-4">{CUSTOM_COLUMN_GROUPS.map(group => {
        const allGroupSelected = group.options.every(([key]) => draft.has(key));
        return <section key={group.title} className="border-b border-neutral-100 pb-3 last:border-b-0 last:pb-0">
        <div className="mb-1 flex items-start justify-between gap-2 px-2"><p className="min-w-0 text-[10px] font-black uppercase text-neutral-400">{group.title}</p><button type="button" onClick={() => { const next = new Set(draft); group.options.forEach(([key]) => allGroupSelected ? next.delete(key) : next.add(key)); onChange(next); }} className="shrink-0 text-[10px] font-bold text-orange-700">{allGroupSelected ? 'Desmarcar' : 'Selecionar'}</button></div>
        <div className="space-y-0.5">{group.options.map(([key, label]) => <label key={key} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-50"><input type="checkbox" checked={draft.has(key)} onChange={() => { const next = new Set(draft); next.has(key) ? next.delete(key) : next.add(key); onChange(next); }} className="h-4 w-4 accent-orange-600"/>{label}</label>)}</div>
      </section>;})}</div>
      {draft.has('tableSavings') && <div className="mt-3 grid grid-cols-2 gap-2 border-t border-neutral-100 pt-3">{([0, 1] as const).map(index => <select key={index} value={savingsTables[index]} onChange={event => { const next: [PrecoFaixa, PrecoFaixa] = [...savingsTables]; next[index] = event.target.value as PrecoFaixa; onSavingsTablesChange(next); }} className="rounded-lg border border-neutral-200 px-2 py-2 text-xs">{PRICE_TABLES.map(table => <option key={table.key} value={table.key}>{table.label}</option>)}</select>)}</div>}
      {draft.has('tableSavings') && savingsTables[0] === savingsTables[1] && <p className="mt-2 text-xs font-bold text-red-600">Escolha duas tabelas diferentes.</p>}
      <div className="sticky bottom-0 bg-white pt-3"><button type="button" onClick={() => { onConfirm(); setOpen(false); }} disabled={!draft.size || (draft.has('tableSavings') && savingsTables[0] === savingsTables[1])} className="w-full rounded-lg bg-orange-600 px-3 py-2 text-sm font-bold text-white disabled:opacity-40">Confirmar colunas</button></div>
    </div>, document.body)}
  </div>;
}

function ComparisonReport({ products, selectedIds, selectedTables, priceStats, custom, customColumns, comparisonShowMarkup, onComparisonShowMarkupChange, savingsTables, negotiatedPrices, onNegotiatedPriceChange, extraDiscounts, onExtraDiscountChange, onToggleProduct, onToggleTable, onClear, onToggleAllVisible, onOpenProduct }: {
  products: Produto[]; selectedIds: Set<string>; selectedTables: Set<PrecoFaixa>; priceStats: Map<string, { last: number; average: number; quantity: number; lastDate: string; lastQuantity: number; purchaseCount: number; monthlyAverage: number; daysSince: number }>;
  custom: boolean; onToggleProduct: (id: string) => void; onToggleTable: (table: PrecoFaixa) => void; onClear: () => void;
  customColumns: Set<CustomColumn> | null;
  comparisonShowMarkup: boolean; onComparisonShowMarkupChange: () => void;
  savingsTables: [PrecoFaixa, PrecoFaixa]; negotiatedPrices: Record<string, number>; onNegotiatedPriceChange: (id: string, price: number) => void;
  extraDiscounts: Record<string, number>; onExtraDiscountChange: (id: string, discount: number) => void;
  onToggleAllVisible: () => void;
  onOpenProduct: (product: Produto) => void;
}) {
  const activeTables = PRICE_TABLES.filter(table => custom ? customColumns?.has(`table:${table.key}`) : selectedTables.has(table.key));
  const showTableMarkup = custom ? Boolean(customColumns?.has('tableMarkup')) : comparisonShowMarkup;
  const allVisibleSelected = products.length > 0 && products.every(product => selectedIds.has(product.id));
  return <div className="space-y-4">
    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
      {!custom && <div className="flex flex-wrap gap-2">
        {PRICE_TABLES.map(table => <button key={table.key} onClick={() => onToggleTable(table.key)} className={cn('flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-bold', selectedTables.has(table.key) ? 'border-orange-300 bg-orange-50 text-orange-700' : 'border-neutral-200 bg-white text-neutral-500')}>
          <span className={cn('flex h-4 w-4 items-center justify-center rounded border', selectedTables.has(table.key) ? 'border-orange-600 bg-orange-600 text-white' : 'border-neutral-300')}>{selectedTables.has(table.key) && <Check size={11} />}</span>{table.label}
        </button>)}
        <button type="button" onClick={onComparisonShowMarkupChange} className={cn('flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-bold', comparisonShowMarkup ? 'border-orange-300 bg-orange-50 text-orange-700' : 'border-neutral-200 bg-white text-neutral-500')}><span className={cn('flex h-4 w-4 items-center justify-center rounded border', comparisonShowMarkup ? 'border-orange-600 bg-orange-600 text-white' : 'border-neutral-300')}>{comparisonShowMarkup && <Check size={11}/>}</span>Markup</button>
      </div>}
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="font-bold text-neutral-600">{selectedIds.size} selecionados</span>
        {products.length > 0 && <button type="button" onClick={onToggleAllVisible} className="font-bold text-orange-700 hover:text-orange-800">{allVisibleSelected ? 'Desmarcar todos' : 'Selecionar todos'}</button>}
        {selectedIds.size > 0 && <button type="button" onClick={onClear} className="font-bold text-red-600">Limpar</button>}
      </div>
    </div>
    <div className="mobile-card-table overflow-x-auto border-y border-neutral-200 bg-white p-2 md:p-0">
      <table className="w-full min-w-[900px] border-collapse text-sm">
        <thead className="sticky top-0 z-10 bg-neutral-900 text-white"><tr>
          <th className="w-16 px-3 py-3"><span className="sr-only">Selecionar</span></th>{(!custom || customColumns?.has('product')) && <th className="px-3 py-3 text-left">Produto</th>}
          {/* Legacy fixed custom columns replaced by the confirmed selection.
          {custom && <><th className="px-3 py-3 text-right">Último preço</th><th className="px-3 py-3 text-right">Custo médio</th></>}
          {activeTables.map(table => <th key={table.key} className="px-3 py-3 text-right">{table.label}</th>)}<th className="px-3 py-3 text-right">Sugerido</th>{custom && <th className="px-3 py-3 text-right">Markup medio</th>}
          */}
          {custom && <>
            {customColumns?.has('family') && <th className="px-3 py-3 text-left">Familia</th>}
            {customColumns?.has('units') && <th className="px-3 py-3 text-right">Unid. embalagem</th>}
            {customColumns?.has('unitWeight') && <th className="px-3 py-3 text-right">Peso unitario</th>}
            {customColumns?.has('lastPrice') && <th className="px-3 py-3 text-right">Ultimo preco</th>}
            {customColumns?.has('averageCost') && <th className="px-3 py-3 text-right">Custo medio unitario</th>}
            {customColumns?.has('lastPurchaseDate') && <th className="px-3 py-3 text-right">Ultima compra</th>}
            {customColumns?.has('lastPurchaseQty') && <th className="px-3 py-3 text-right">Qtd ultima</th>}
            {customColumns?.has('purchaseCount') && <th className="px-3 py-3 text-right">Compras</th>}
            {customColumns?.has('totalPurchased') && <th className="px-3 py-3 text-right">Qtd total</th>}
            {customColumns?.has('monthlyAverage') && <th className="px-3 py-3 text-right">Media mensal</th>}
            {customColumns?.has('daysSincePurchase') && <th className="px-3 py-3 text-right">Sem comprar</th>}
          </>}
          {activeTables.map(table => <React.Fragment key={table.key}><th className="border-l-2 border-neutral-600 px-3 py-3 text-right">{table.label}</th>{showTableMarkup && <th className="bg-neutral-800 px-3 py-3 text-right text-neutral-200">Markup</th>}</React.Fragment>)}
          {custom && customColumns?.has('tableSavings') && <th className="px-3 py-3 text-right">Economia</th>}
          {custom && customColumns?.has('markup') && <th className="px-3 py-3 text-right">Markup medio</th>}
          {custom && customColumns?.has('negotiatedPrice') && <><th className="border-l-2 border-neutral-600 px-3 py-3 text-right">Preco negociado</th>{showTableMarkup && <th className="bg-neutral-800 px-3 py-3 text-right text-neutral-200">Markup</th>}</>}
          {custom && customColumns?.has('extraDiscount') && <><th className="border-l-2 border-neutral-600 px-3 py-3 text-right">Desconto extra</th>{showTableMarkup && <th className="bg-neutral-800 px-3 py-3 text-right text-neutral-200">Markup</th>}</>}
          {(!custom || customColumns?.has('suggested')) && <th className="px-3 py-3 text-right">Sugerido</th>}
        </tr></thead>
        <tbody className="divide-y divide-neutral-100">{products.map(product => {
          const stat = priceStats.get(product.id) || priceStats.get(product.produto.trim().toLowerCase());
          const lastUnitPrice = (stat?.last || 0) / Math.max(1, Number(product.quant_embalagem) || 1);
          const averageUnitCost = (stat?.average || 0) / Math.max(1, Number(product.quant_embalagem) || 1);
          const averageMarkup = markup(product.sugestao, averageUnitCost);
          const negotiatedPrice = negotiatedPrices[product.id] || 0;
          const discountedCost = (Number(product.custo_und) || 0) * (1 - ((extraDiscounts[product.id] || 0) / 100));
          const negotiatedMarkup = markup(product.sugestao, negotiatedPrice);
          const discountedMarkup = markup(product.sugestao, discountedCost);
          return <tr key={product.id} onClick={() => onOpenProduct(product)} className={cn('cursor-pointer hover:bg-orange-50/50', selectedIds.has(product.id) && 'bg-orange-50')}>
            <td className="mobile-compact-row" colSpan={30}>
              <div className="mobile-compact-line">
                <button
                  type="button"
                  onClick={event => {
                    event.stopPropagation();
                    onToggleProduct(product.id);
                  }}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded"
                  aria-label={`Selecionar ${product.produto}`}
                  aria-pressed={selectedIds.has(product.id)}
                >
                  <span className={cn('flex h-4 w-4 items-center justify-center rounded border', selectedIds.has(product.id) ? 'border-orange-600 bg-orange-600 text-white' : 'border-neutral-300')}>{selectedIds.has(product.id) && <Check size={11} />}</span>
                </button>
                <span className="mobile-compact-primary">{product.produto}</span>
                {(!custom || customColumns?.has('suggested')) && <span className="mobile-compact-value text-orange-700">{formatCurrency(product.sugestao)}</span>}
              </div>
              <div className="mobile-compact-line pl-7">
                <span className="mobile-compact-secondary">
                  {activeTables.map(table => `${table.label} ${formatCurrency(priceForTable(product, table.key))}`).join(' · ')}
                  {custom && customColumns?.has('negotiatedPrice') && ` · Neg. ${negotiatedPrice ? formatCurrency(negotiatedPrice) : '-'}`}
                  {custom && customColumns?.has('extraDiscount') && ` · Desc. ${formatCurrency(discountedCost)}`}
                </span>
              </div>
            </td>
            <td
              data-label="Selecionar"
              data-mobile-summary
              className="cursor-default px-2 py-1.5"
              onClick={event => {
                event.stopPropagation();
                onToggleProduct(product.id);
              }}
            >
              <button
                type="button"
                className="flex h-10 w-12 items-center justify-center rounded-lg hover:bg-orange-100"
                aria-label={`Selecionar ${product.produto}`}
                aria-pressed={selectedIds.has(product.id)}
              >
                <span className={cn('flex h-5 w-5 items-center justify-center rounded border', selectedIds.has(product.id) ? 'border-orange-600 bg-orange-600 text-white' : 'border-neutral-300')}>{selectedIds.has(product.id) && <Check size={13} />}</span>
              </button>
            </td>
            {(!custom || customColumns?.has('product')) && <td data-label="Produto" data-mobile-summary data-mobile-title className="px-3 py-3"><p className="font-bold text-neutral-900">{product.produto}</p></td>}
            {custom && <>
              {customColumns?.has('family') && <td data-label="Familia" className="px-3 py-3 font-semibold">{product.familia}</td>}
              {customColumns?.has('units') && <td data-label="Unid. embalagem" className="px-3 py-3 text-right font-semibold">{product.quant_embalagem}</td>}
              {customColumns?.has('unitWeight') && <td data-label="Peso unitario" className="px-3 py-3 text-right font-semibold">{formatWeight(unitWeight(product))}</td>}
              {customColumns?.has('lastPrice') && <td data-label="Ultimo preco" data-mobile-summary className="px-3 py-3 text-right font-semibold">{stat ? formatCurrency(lastUnitPrice) : '-'}</td>}
              {customColumns?.has('averageCost') && <td data-label="Custo medio unitario" data-mobile-summary className="px-3 py-3 text-right font-semibold">{stat ? formatCurrency(averageUnitCost) : '-'}</td>}
              {customColumns?.has('lastPurchaseDate') && <td data-label="Ultima compra" className="px-3 py-3 text-right">{stat ? format(parseISO(stat.lastDate), 'dd/MM/yyyy') : '-'}</td>}
              {customColumns?.has('lastPurchaseQty') && <td data-label="Qtd ultima" className="px-3 py-3 text-right">{stat?.lastQuantity ?? '-'}</td>}
              {customColumns?.has('purchaseCount') && <td data-label="Compras" className="px-3 py-3 text-right">{stat?.purchaseCount ?? '-'}</td>}
              {customColumns?.has('totalPurchased') && <td data-label="Qtd total" className="px-3 py-3 text-right">{stat?.quantity ?? '-'}</td>}
              {customColumns?.has('monthlyAverage') && <td data-label="Media mensal" className="px-3 py-3 text-right">{stat ? stat.monthlyAverage.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) : '-'}</td>}
              {customColumns?.has('daysSincePurchase') && <td data-label="Sem comprar" className="px-3 py-3 text-right">{stat ? `${stat.daysSince} dias` : '-'}</td>}
            </>}
            {activeTables.map(table => { const tableMarkup = markup(product.sugestao, priceForTable(product, table.key)); return <React.Fragment key={table.key}><td data-label={table.label} data-mobile-summary className="border-l-2 border-neutral-200 px-3 py-3 text-right font-bold text-neutral-800">{formatCurrency(priceForTable(product, table.key))}</td>{showTableMarkup && <td data-label={`Markup ${table.label}`} className="bg-neutral-50 px-3 py-3 text-right font-semibold text-neutral-600">{tableMarkup === null ? '-' : `${tableMarkup.toFixed(1)}%`}</td>}</React.Fragment>; })}
            {custom && customColumns?.has('tableSavings') && <td data-label="Economia" className="px-3 py-3 text-right font-semibold">{formatCurrency(Math.abs(priceForTable(product, savingsTables[0]) - priceForTable(product, savingsTables[1])))}</td>}
            {custom && customColumns?.has('markup') && <td data-label="Markup medio" className="px-3 py-3 text-right font-black">{averageMarkup === null ? '-' : `${averageMarkup.toFixed(1)}%`}</td>}
            {custom && customColumns?.has('negotiatedPrice') && <><td data-label="Preco negociado" data-mobile-summary className="border-l-2 border-neutral-200 px-3 py-2"><input type="number" min="0" step="0.01" value={negotiatedPrice || ''} onClick={event => event.stopPropagation()} onChange={event => onNegotiatedPriceChange(product.id, Number(event.target.value))} className="w-28 rounded-md border border-neutral-200 px-2 py-1.5 text-right" placeholder="R$ 0,00" /></td>{showTableMarkup && <td data-label="Markup negociado" className="bg-neutral-50 px-3 py-3 text-right font-semibold text-neutral-600">{negotiatedMarkup === null ? '-' : `${negotiatedMarkup.toFixed(1)}%`}</td>}</>}
            {custom && customColumns?.has('extraDiscount') && <><td data-label="Desconto extra" data-mobile-summary className="border-l-2 border-neutral-200 px-3 py-2" onClick={event => event.stopPropagation()}><div className="flex min-w-36 items-center gap-2"><input type="number" min="0" max="100" step="0.01" value={extraDiscounts[product.id] || ''} onChange={event => onExtraDiscountChange(product.id, Number(event.target.value))} className="w-20 rounded-md border border-neutral-200 px-2 py-1.5 text-right" placeholder="0"/><span className="text-xs font-bold text-neutral-400">%</span><span className="ml-auto text-sm font-black text-orange-700">{formatCurrency(discountedCost)}</span></div></td>{showTableMarkup && <td data-label="Markup desconto" className="bg-neutral-50 px-3 py-3 text-right font-semibold text-neutral-600">{discountedMarkup === null ? '-' : `${discountedMarkup.toFixed(1)}%`}</td>}</>}
            {(!custom || customColumns?.has('suggested')) && <td data-label="Sugerido" data-mobile-summary className="px-3 py-3 text-right font-black text-orange-700">{formatCurrency(product.sugestao)}</td>}
          </tr>;
        })}</tbody>
      </table>
      {!products.length && <div className="py-16 text-center text-sm font-bold text-neutral-400">Nenhum produto encontrado com estes filtros.</div>}
    </div>
  </div>;
}

function HistoryReport({ products, selectedId, onSelect, rows, orderWeightMap }: { products: Produto[]; selectedId: string; onSelect: (id: string) => void; rows: HistVenda[]; orderWeightMap: Map<string, number> }) {
  const product = products.find(item => item.id === selectedId);
  const historyColumns = ['Data', 'Cliente', 'Qtd', 'Peso', 'Peso pedido', 'Preco pago', 'Total'];
  return <div className="space-y-5">
    <div className="max-w-xl"><Select value={selectedId} onChange={onSelect} label="Produto para historico" options={[['', 'Selecione um produto'], ...products.map(item => [item.id, item.produto] as [string, string])]} /></div>
    {product && <>
      {/* Summary cards intentionally removed: this view is focused on individual orders.
        {[
          ['Quantidade', summary.totalQuantity.toLocaleString('pt-BR')], ['Peso', formatWeight(summary.totalWeight)], ['Faturamento', formatCurrency(summary.totalValue)],
          ['Preço médio', formatCurrency(summary.averagePrice)], ['Pedidos', String(summary.distinctDates)], ['Clientes', String(summary.distinctClients)]
        ].map(([label, value]) => <div key={label} className="bg-white px-4 py-3"><p className="text-[10px] font-bold uppercase text-neutral-400">{label}</p><p className="mt-1 text-lg font-black text-neutral-900">{value}</p></div>)}
      </div>
      <div className="overflow-x-auto border-y border-neutral-200 bg-white"><table className="w-full min-w-[850px] text-sm"><thead className="bg-neutral-900 text-white"><tr>{['Data','Cliente','Quantidade','Peso','Tabela','Preço médio','Total'].map(label => <th key={label} className="px-3 py-3 text-left">{label}</th>)}</tr></thead>
      */}
      <div className="mobile-card-table overflow-x-auto border-y border-neutral-200 bg-white p-2 md:p-0"><table className="w-full min-w-[720px] text-sm"><thead className="bg-neutral-900 text-white"><tr>{historyColumns.map(label => <th key={label} className="px-3 py-3 text-left">{label}</th>)}</tr></thead>
        <tbody className="divide-y divide-neutral-100">{rows.map(sale => <tr key={sale.id}><td className="mobile-compact-row" colSpan={7}><div className="mobile-compact-line"><span className="shrink-0 text-[10px] font-black text-neutral-500">{format(parseISO(sale.faturamento), 'dd/MM')}</span><span className="mobile-compact-primary">{sale.cliente}</span><span className="mobile-compact-value">{formatCurrency((Number(sale['r$_total']) || 0) / Math.max(1, Number(sale.qtd) || 1))}</span></div><div className="mobile-compact-line"><span className="mobile-compact-secondary">{sale.qtd} un. · Pedido {formatWeight(orderWeightMap.get(saleOrderKey(sale)) || 0)}</span><span className="mobile-compact-value">Total {formatCurrency(sale['r$_total'])}</span></div></td><td data-label="Data" data-mobile-summary className="px-3 py-3 font-semibold">{format(parseISO(sale.faturamento), 'dd/MM/yyyy')}</td><td data-label="Cliente" data-mobile-summary data-mobile-title className="px-3 py-3 font-bold">{sale.cliente}</td><td data-label="Qtd" className="px-3 py-3">{sale.qtd}</td><td data-label="Peso" className="px-3 py-3">{formatWeight((Number(sale.qtd) || 0) * product.peso_embalagem)}</td><td data-label="Peso pedido" data-mobile-summary className="px-3 py-3 font-semibold">{formatWeight(orderWeightMap.get(saleOrderKey(sale)) || 0)}</td><td data-label="Preco pago" data-mobile-summary className="px-3 py-3 font-semibold">{formatCurrency((Number(sale['r$_total']) || 0) / Math.max(1, Number(sale.qtd) || 1))}</td><td data-label="Total" data-mobile-summary className="px-3 py-3 font-black">{formatCurrency(sale['r$_total'])}</td></tr>)}</tbody>
      </table>{!rows.length && <div className="py-16 text-center font-bold text-neutral-400">Nenhuma venda encontrada no periodo selecionado.</div>}</div>
    </>}
  </div>;
}

function ProductDrawer({ product, form, saving, families, onEdit, onChange, onCancelEdit, onClose, onSave }: {
  product: Produto; form: Produto | null; saving: boolean; families: string[];
  onEdit: () => void; onChange: (form: Produto) => void; onCancelEdit: () => void; onClose: () => void; onSave: () => void;
}) {
  const current = form || product;
  const quantity = Math.max(1, Number(current.quant_embalagem) || 1);
  const calculatedCost = (Number(current.custo_total) || 0) / quantity;
  const calculatedWeight = (Number(current.peso_embalagem) || 0) / quantity;
  const changed = form ? Object.keys(product).some(key => product[key as keyof Produto] !== form[key as keyof Produto]) : false;
  const setNumber = (key: keyof Produto, value: string) => form && onChange({ ...form, [key]: Number(value) });
  const fieldClass = 'mt-1 w-full rounded-lg border border-neutral-200 bg-white px-3 py-2.5 text-sm font-semibold text-neutral-900 outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100';

  return <div className="fixed inset-0 z-[100] flex items-center justify-center bg-neutral-900/45 p-3 lg:justify-end lg:p-0" onMouseDown={event => event.target === event.currentTarget && onClose()}>
    <aside className="flex max-h-[92dvh] w-full max-w-2xl flex-col overflow-hidden rounded-lg bg-white shadow-2xl animate-in zoom-in-95 duration-200 lg:h-full lg:max-h-none lg:max-w-xl lg:rounded-none lg:animate-in lg:slide-in-from-right">
      <header className="flex items-start justify-between border-b border-neutral-200 px-5 py-4">
        <div className="min-w-0 pr-4"><p className="text-xs font-bold uppercase text-orange-600">{form ? 'Editando cadastro' : 'Detalhes do produto'}</p><h2 className="mt-1 truncate text-xl font-black text-neutral-900">{product.produto}</h2><p className="mt-1 text-sm text-neutral-500">{product.familia}</p></div>
        <button type="button" onClick={onClose} disabled={saving} className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-neutral-500 hover:bg-neutral-100" title="Fechar"><X size={21}/></button>
      </header>

      <div className="flex-1 overflow-y-auto px-5 py-5">
        {!form ? <div className="space-y-5">
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-neutral-200 bg-neutral-200">
            {[
              ['Custo total', formatCurrency(product.custo_total)], ['Custo unitario', formatCurrency(product.custo_und)],
              ['Peso total', formatWeight(product.peso_embalagem)], ['Peso unitario', formatWeight(unitWeight(product))],
              ['Unidades', String(product.quant_embalagem)], ['Preco sugerido', formatCurrency(product.sugestao)]
            ].map(([label, value]) => <div key={label} className="bg-white p-4"><p className="text-[10px] font-bold uppercase text-neutral-400">{label}</p><p className="mt-1 text-base font-black text-neutral-900">{value}</p></div>)}
          </div>
          <div><p className="mb-2 text-xs font-black uppercase text-neutral-400">Precos por tabela</p><div className="divide-y divide-neutral-100 rounded-lg border border-neutral-200">{PRICE_TABLES.map(table => <div key={table.key} className="flex items-center justify-between px-4 py-3 text-sm"><span className="font-semibold text-neutral-600">{table.label}</span><span className="font-black text-neutral-900">{formatCurrency(priceForTable(product, table.key))}</span></div>)}</div></div>
        </div> : <div className="space-y-6">
          <section><h3 className="mb-3 text-xs font-black uppercase text-neutral-400">Identificacao</h3><div className="grid gap-4 sm:grid-cols-2">
            <label className="text-xs font-bold text-neutral-500 sm:col-span-2">Nome do produto<ClearableTextInput value={form.produto} onChange={value => onChange({ ...form, produto: value })} ariaLabel="Nome do produto" className={`${fieldClass} pr-10`}/></label>
            <label className="text-xs font-bold text-neutral-500">Familia<select value={form.familia} onChange={event => onChange({ ...form, familia: event.target.value })} className={fieldClass}>{families.map(item => <option key={item} value={item}>{item}</option>)}</select></label>
            <label className="flex items-center justify-between self-end rounded-lg border border-neutral-200 px-3 py-2.5 text-sm font-bold text-neutral-700">Produto ativo<input type="checkbox" checked={form.ativo !== false} onChange={event => onChange({ ...form, ativo: event.target.checked })} className="h-5 w-5 accent-orange-600"/></label>
          </div></section>
          <section className="border-t border-neutral-100 pt-5"><h3 className="mb-3 text-xs font-black uppercase text-neutral-400">Custos e embalagem</h3><div className="grid gap-4 sm:grid-cols-2">
            <label className="text-xs font-bold text-neutral-500">Custo total da embalagem<input type="number" min="0" step="0.01" value={form.custo_total} onChange={event => setNumber('custo_total', event.target.value)} className={fieldClass}/></label>
            <label className="text-xs font-bold text-neutral-500">Preco sugerido<input type="number" min="0" step="0.01" value={form.sugestao} onChange={event => setNumber('sugestao', event.target.value)} className={fieldClass}/></label>
            <label className="text-xs font-bold text-neutral-500">Peso total da embalagem (kg)<input type="number" min="0" step="0.001" value={form.peso_embalagem} onChange={event => setNumber('peso_embalagem', event.target.value)} className={fieldClass}/></label>
            <label className="text-xs font-bold text-neutral-500">Quantidade de unidades<input type="number" min="1" step="1" value={form.quant_embalagem} onChange={event => setNumber('quant_embalagem', event.target.value)} className={fieldClass}/></label>
          </div><div className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-neutral-200 bg-neutral-200"><div className="bg-neutral-50 p-3"><p className="text-[10px] font-bold uppercase text-neutral-400">Custo unitario calculado</p><p className="mt-1 font-black">{formatCurrency(calculatedCost)}</p></div><div className="bg-neutral-50 p-3"><p className="text-[10px] font-bold uppercase text-neutral-400">Peso unitario calculado</p><p className="mt-1 font-black">{formatWeight(calculatedWeight)}</p></div></div></section>
          <section className="border-t border-neutral-100 pt-5"><h3 className="mb-3 text-xs font-black uppercase text-neutral-400">Descontos das tabelas</h3><div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{PRICE_TABLES.map(table => <label key={table.key} className="text-xs font-bold text-neutral-500">{table.label} (%)<input type="number" min="0" max="100" step="0.01" value={((Number(form[table.key]) || 0) * 100).toFixed(2)} onChange={event => onChange({ ...form, [table.key]: Number(event.target.value) / 100 })} className={fieldClass}/></label>)}</div></section>
        </div>}
      </div>

      <footer className="border-t border-neutral-200 bg-neutral-50 px-5 py-4">
        {!form ? <button type="button" onClick={onEdit} className="flex w-full items-center justify-center rounded-lg bg-orange-600 px-4 py-3 text-sm font-bold text-white hover:bg-orange-700">Editar produto</button> : <div className="flex items-center justify-end gap-2"><button type="button" onClick={onCancelEdit} disabled={saving} className="rounded-lg border border-neutral-200 bg-white px-4 py-2.5 text-sm font-bold text-neutral-700">Cancelar</button><button type="button" onClick={onSave} disabled={saving || !changed || !form.produto.trim() || !form.familia.trim()} className="flex items-center gap-2 rounded-lg bg-orange-600 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-40">{saving ? <Loader2 className="animate-spin" size={17}/> : <Save size={17}/>} {saving ? 'Salvando...' : 'Salvar alteracoes'}</button></div>}
      </footer>
    </aside>
  </div>;
}

function NewProductModal({ form, saving, families, products, onChange, onClose, onSave }: { form: NewProductForm; saving: boolean; families: string[]; products: Produto[]; onChange: (form: NewProductForm) => void; onClose: () => void; onSave: () => void }) {
  const numberField = (key: keyof NewProductForm, label: string) => <label className="text-xs font-bold text-neutral-500">{label}<input type="number" min="0" step="0.01" value={Number(form[key])} onChange={event => onChange({ ...form, [key]: Number(event.target.value) })} className="mt-1 w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm text-neutral-900 outline-none focus:border-orange-400" /></label>;
  const quantity = Math.max(1, Number(form.quant_embalagem) || 1);
  const calculatedUnitCost = (Number(form.custo_total) || 0) / quantity;
  const calculatedUnitWeight = (Number(form.peso_embalagem) || 0) / quantity;
  const familyTemplate = products.find(product => product.familia === form.familia);
  return <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/50 p-0 md:items-center md:p-4"><div className="max-h-[92dvh] w-full max-w-3xl overflow-y-auto rounded-t-lg bg-white p-5 shadow-2xl md:rounded-lg md:p-6">
    <div className="mb-5 flex items-center justify-between"><div><h2 className="text-xl font-black">Novo produto</h2><p className="text-sm text-neutral-500">O item ficara disponivel tambem na importacao e nos pedidos.</p></div><button onClick={onClose} className="p-2 text-neutral-400 hover:text-neutral-700"><X size={22}/></button></div>
    <div className="grid gap-4 md:grid-cols-2"><label className="text-xs font-bold text-neutral-500 md:col-span-2">Nome do produto<ClearableTextInput value={form.produto} onChange={value => onChange({ ...form, produto: value })} ariaLabel="Nome do produto" className="mt-1 w-full rounded-lg border border-neutral-200 px-3 py-2 pr-10 text-sm text-neutral-900 outline-none focus:border-orange-400" /></label>
      <label className="text-xs font-bold text-neutral-500">Família<select value={form.familia} onChange={event => onChange({ ...form, familia: event.target.value })} className="mt-1 w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-orange-400"><option value="">Selecione uma família</option>{families.map(item => <option key={item} value={item}>{item}</option>)}</select></label>
      {numberField('sugestao','Preço sugerido')}{numberField('custo_total','Custo total da embalagem')}{numberField('peso_embalagem','Peso total da embalagem')}{numberField('quant_embalagem','Quantidade de unidades na embalagem')}
    </div>
    <div className="mt-5 grid gap-px overflow-hidden rounded-lg border border-neutral-200 bg-neutral-200 sm:grid-cols-2">
      <div className="bg-neutral-50 p-3"><p className="text-[10px] font-bold uppercase text-neutral-400">Custo unitário calculado</p><p className="mt-1 text-lg font-black text-neutral-900">{formatCurrency(calculatedUnitCost)}</p></div>
      <div className="bg-neutral-50 p-3"><p className="text-[10px] font-bold uppercase text-neutral-400">Peso unitário calculado</p><p className="mt-1 text-lg font-black text-neutral-900">{formatWeight(calculatedUnitWeight)}</p></div>
    </div>
    <p className={cn('mt-3 text-xs font-semibold', familyTemplate ? 'text-green-700' : 'text-neutral-500')}>
      {familyTemplate ? `Os descontos serão copiados da família ${form.familia}.` : 'Selecione uma família para copiar automaticamente os descontos praticados.'}
    </p>
    <div className="mt-6 flex justify-end gap-2"><button onClick={onClose} className="rounded-lg border border-neutral-200 px-4 py-2 text-sm font-bold text-neutral-600">Cancelar</button><button onClick={onSave} disabled={saving || !form.produto.trim() || !form.familia.trim()} className="flex items-center gap-2 rounded-lg bg-orange-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-40"><Plus size={16}/>{saving ? 'Salvando...' : 'Cadastrar produto'}</button></div>
  </div></div>;
}
