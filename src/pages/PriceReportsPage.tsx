import React, { useMemo, useState } from 'react';
import {
  BarChart3,
  Check,
  ChevronDown,
  FileDown,
  History,
  PackagePlus,
  Plus,
  Search,
  SlidersHorizontal,
  X
} from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useDataManager } from '../lib/dataManager';
import { supabase } from '../lib/supabase';
import { classifySaleRecord } from '../lib/salesClassifier';
import { cn, deduplicateSales, formatCurrency, formatWeight } from '../lib/utils';
import { Cliente, HistVenda, PrecoFaixa, Produto } from '../types';

type ReportMode = 'comparison' | 'history' | 'custom';
type NewProductForm = Omit<Produto, 'id'>;

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
  const discount = Number(product[table]) || 0;
  return (Number(product.custo_und) || 0) * (1 - discount);
};

const unitWeight = (product: Pick<Produto, 'peso_embalagem' | 'quant_embalagem'>) =>
  (Number(product.peso_embalagem) || 0) / Math.max(1, Number(product.quant_embalagem) || 1);

const markup = (suggested: number, purchasePrice: number) => {
  if (suggested <= 0 || purchasePrice <= 0) return null;
  return ((suggested - purchasePrice) / purchasePrice) * 100;
};

const productKey = (sale: HistVenda) => sale.produto_id || sale.produtos?.trim().toLowerCase();

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
    new Set(['livre', '500kg', '1000kg', '2000kg'])
  );
  const [historyProductId, setHistoryProductId] = useState('');
  const [onlyPurchased, setOnlyPurchased] = useState(false);
  const [onlyNeverPurchased, setOnlyNeverPurchased] = useState(false);
  const [showNewProduct, setShowNewProduct] = useState(false);
  const [newProduct, setNewProduct] = useState<NewProductForm>(EMPTY_PRODUCT);
  const [savingProduct, setSavingProduct] = useState(false);
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

  const filteredProducts = useMemo(() => products
    .filter(product => product.ativo !== false)
    .filter(product => family === 'all' || product.familia === family)
    .filter(product => packageWeight === 'all' || Number(unitWeight(product).toFixed(3)) === Number(packageWeight))
    .filter(product => {
      const term = search.trim().toLocaleLowerCase('pt-BR');
      return !term || product.produto.toLocaleLowerCase('pt-BR').includes(term);
    })
    .filter(product => !onlyPurchased || purchasedKeys.has(product.id))
    .filter(product => !onlyNeverPurchased || !purchasedKeys.has(product.id))
    .sort((a, b) => `${a.familia} ${a.produto}`.localeCompare(`${b.familia} ${b.produto}`, 'pt-BR')),
  [products, family, packageWeight, search, onlyPurchased, onlyNeverPurchased, purchasedKeys]);

  const selectedProducts = useMemo(
    () => products.filter(product => selectedIds.has(product.id)),
    [products, selectedIds]
  );

  const selectedClient = clientes.find(client => client.id === clientId);

  const priceStats = useMemo(() => {
    const map = new Map<string, { last: number; average: number; quantity: number }>();
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
      map.set(key, {
        last: (Number(lastSale?.['r$_total']) || 0) / Math.max(1, Number(lastSale?.qtd) || 1),
        average: totalValue / Math.max(1, totalQuantity),
        quantity: totalQuantity
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

  const historySummary = useMemo(() => {
    const totalValue = historyRows.reduce((sum, sale) => sum + (Number(sale['r$_total']) || 0), 0);
    const totalQuantity = historyRows.reduce((sum, sale) => sum + (Number(sale.qtd) || 0), 0);
    const product = products.find(item => item.id === historyProductId);
    const totalWeight = totalQuantity * (Number(product?.peso_embalagem) || 0);
    const distinctClients = new Set(historyRows.map(sale => sale.cliente_id)).size;
    const distinctDates = new Set(historyRows.map(sale => sale.faturamento)).size;
    return {
      totalValue,
      totalQuantity,
      totalWeight,
      distinctClients,
      distinctDates,
      averagePrice: totalValue / Math.max(1, totalQuantity)
    };
  }, [historyRows, products, historyProductId]);

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
      const activeTables = PRICE_TABLES.filter(table => selectedTables.has(table.key));
      const detail = `Tabelas: ${activeTables.map(table => table.label).join(' | ')}`;
      autoTable(doc, {
        startY: 48,
        margin: { top: 48, right: 14, bottom: 20, left: 14 },
        head: [['Produto', ...activeTables.map(table => table.label), 'Sugerido']],
        body: selectedProducts.map(product => [
          product.produto,
          ...activeTables.map(table => formatCurrency(priceForTable(product, table.key))),
          formatCurrency(product.sugestao)
        ]),
        styles: { fontSize: 8 },
        headStyles: { fillColor: [23, 23, 23] },
        alternateRowStyles: { fillColor: [250, 250, 250] },
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
        head: [['Data', 'Cliente', 'Qtd.', 'Peso', 'Tabela', 'Preco medio', 'Total']],
        body: historyRows.map(sale => [
          format(parseISO(sale.faturamento), 'dd/MM/yyyy'),
          sale.cliente,
          sale.qtd,
          formatWeight((Number(sale.qtd) || 0) * (Number(product.peso_embalagem) || 0)),
          sale.tabela || '-',
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

  if (loadingGlobal && !products.length) {
    return <div className="py-20 text-center font-bold text-neutral-400">Carregando produtos...</div>;
  }

  return (
    <div className="space-y-5 pb-10">
      <div className="flex flex-col gap-4 border-b border-neutral-200 pb-5 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-xs font-bold uppercase text-orange-600">Nova area paralela</p>
          <h1 className="text-2xl font-black text-neutral-900">Preços e relatórios</h1>
          <p className="mt-1 text-sm text-neutral-500">Monte consultas, compare tabelas e analise o histórico de cada produto.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setShowNewProduct(true)} className="flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm font-bold text-neutral-700 hover:bg-neutral-50">
            <PackagePlus size={17} /> Novo produto
          </button>
          <button
            onClick={mode === 'history' ? generateHistoryPdf : generateComparisonPdf}
            disabled={exporting || (mode === 'history' ? !historyRows.length : !selectedProducts.length)}
            className="flex items-center gap-2 rounded-lg bg-orange-600 px-3 py-2 text-sm font-bold text-white hover:bg-orange-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <FileDown size={17} /> {exporting ? 'Gerando...' : 'Gerar PDF'}
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
            <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar produto" className="w-full rounded-lg border border-neutral-200 py-2.5 pl-10 pr-3 text-sm outline-none focus:border-orange-400" />
          </label>
          <div className="min-w-0 xl:col-span-3"><Select value={clientId} onChange={setClientId} label={mode === 'comparison' ? 'Cliente do relatório' : 'Filtrar cliente'} options={[
            ['all', mode === 'comparison' ? 'Cliente não identificado' : 'Todos os clientes'],
            ...clientes.filter(client => client.ativo !== false).map(client => [client.id, client.cliente] as [string, string])
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
          <div className="mt-3 grid min-w-0 w-full grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
            <div className="flex flex-col min-w-0 w-full">
              <label className="text-xs font-bold text-neutral-500 mb-1">Data inicial</label>
              <input
                type="date"
                value={dateFrom}
                onChange={event => setDateFrom(event.target.value)}
                className="block w-full min-w-0 max-w-full box-border rounded-lg border border-neutral-200 px-3 py-2.5 text-sm text-neutral-800 outline-none focus:border-orange-400"
              />
            </div>
            <div className="flex flex-col min-w-0 w-full">
              <label className="text-xs font-bold text-neutral-500 mb-1">Data final</label>
              <input
                type="date"
                value={dateTo}
                onChange={event => setDateTo(event.target.value)}
                className="block w-full min-w-0 max-w-full box-border rounded-lg border border-neutral-200 px-3 py-2.5 text-sm text-neutral-800 outline-none focus:border-orange-400"
              />
            </div>
            {mode === 'custom' && <>
              <Toggle checked={onlyPurchased} onChange={() => { setOnlyPurchased(value => !value); setOnlyNeverPurchased(false); }} label="Somente comprados" />
              <Toggle checked={onlyNeverPurchased} onChange={() => { setOnlyNeverPurchased(value => !value); setOnlyPurchased(false); }} label="Nunca comprados" />
            </>}
          </div>
        )}
      </section>

      {mode === 'history' ? (
        <HistoryReport products={filteredProducts} selectedId={historyProductId} onSelect={setHistoryProductId} rows={historyRows} summary={historySummary} />
      ) : (
        <ComparisonReport
          products={filteredProducts}
          selectedIds={selectedIds}
          selectedTables={selectedTables}
          priceStats={priceStats}
          custom={mode === 'custom'}
          onToggleProduct={toggleProduct}
          onToggleTable={toggleTable}
          onClear={() => setSelectedIds(new Set())}
        />
      )}

      {showNewProduct && (
        <NewProductModal form={newProduct} saving={savingProduct} families={allFamilies} products={activeProducts} onChange={setNewProduct} onClose={() => setShowNewProduct(false)} onSave={saveNewProduct} />
      )}
    </div>
  );
}

function Select({ value, onChange, label, options }: { value: string; onChange: (value: string) => void; label: string; options: Array<[string, string]> }) {
  return <label className="relative block min-w-0 max-w-full">
    <span className="sr-only">{label}</span>
    <select value={value} onChange={event => onChange(event.target.value)} className="block w-full min-w-0 max-w-full appearance-none truncate rounded-lg border border-neutral-200 bg-white px-3 py-2.5 pr-9 text-sm font-semibold text-neutral-700 outline-none focus:border-orange-400">
      {options.map(([optionValue, optionLabel]) => <option key={optionValue} value={optionValue}>{optionLabel}</option>)}
    </select>
    <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400" size={16} />
  </label>;
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return <button onClick={onChange} className="flex w-full min-w-0 items-center justify-between gap-2 self-end rounded-lg border border-neutral-200 px-3 py-2.5 text-sm font-bold text-neutral-700 sm:w-auto sm:justify-start">
    <span className={cn('flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors', checked ? 'bg-orange-600' : 'bg-neutral-200')}><span className={cn('h-4 w-4 rounded-full bg-white transition-transform', checked && 'translate-x-4')} /></span>
    <span className="truncate">{label}</span>
  </button>;
}

function ComparisonReport({ products, selectedIds, selectedTables, priceStats, custom, onToggleProduct, onToggleTable, onClear }: {
  products: Produto[]; selectedIds: Set<string>; selectedTables: Set<PrecoFaixa>; priceStats: Map<string, { last: number; average: number; quantity: number }>;
  custom: boolean; onToggleProduct: (id: string) => void; onToggleTable: (table: PrecoFaixa) => void; onClear: () => void;
}) {
  const activeTables = PRICE_TABLES.filter(table => selectedTables.has(table.key));
  return <div className="space-y-4">
    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex flex-wrap gap-2">
        {PRICE_TABLES.map(table => <button key={table.key} onClick={() => onToggleTable(table.key)} className={cn('flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-bold', selectedTables.has(table.key) ? 'border-orange-300 bg-orange-50 text-orange-700' : 'border-neutral-200 bg-white text-neutral-500')}>
          <span className={cn('flex h-4 w-4 items-center justify-center rounded border', selectedTables.has(table.key) ? 'border-orange-600 bg-orange-600 text-white' : 'border-neutral-300')}>{selectedTables.has(table.key) && <Check size={11} />}</span>{table.label}
        </button>)}
      </div>
      <div className="flex items-center gap-3 text-sm"><span className="font-bold text-neutral-600">{selectedIds.size} selecionados</span>{selectedIds.size > 0 && <button onClick={onClear} className="font-bold text-red-600">Limpar</button>}</div>
    </div>
    <div className="overflow-x-auto border-y border-neutral-200 bg-white">
      <table className="w-full min-w-[900px] border-collapse text-sm">
        <thead className="sticky top-0 z-10 bg-neutral-900 text-white"><tr>
          <th className="w-12 px-3 py-3"></th><th className="px-3 py-3 text-left">Produto</th>
          {custom && <><th className="px-3 py-3 text-right">Último preço</th><th className="px-3 py-3 text-right">Custo médio</th></>}
          {activeTables.map(table => <th key={table.key} className="px-3 py-3 text-right">{table.label}</th>)}<th className="px-3 py-3 text-right">Sugerido</th>{custom && <th className="px-3 py-3 text-right">Markup medio</th>}
        </tr></thead>
        <tbody className="divide-y divide-neutral-100">{products.map(product => {
          const stat = priceStats.get(product.id) || priceStats.get(product.produto.trim().toLowerCase());
          const averageMarkup = markup(product.sugestao, stat?.average || 0);
          return <tr key={product.id} onClick={() => onToggleProduct(product.id)} className={cn('cursor-pointer hover:bg-orange-50/50', selectedIds.has(product.id) && 'bg-orange-50')}>
            <td className="px-3 py-3"><span className={cn('flex h-5 w-5 items-center justify-center rounded border', selectedIds.has(product.id) ? 'border-orange-600 bg-orange-600 text-white' : 'border-neutral-300')}>{selectedIds.has(product.id) && <Check size={13} />}</span></td>
            <td className="px-3 py-3"><p className="font-bold text-neutral-900">{product.produto}</p></td>
            {custom && <><td className="px-3 py-3 text-right font-semibold">{stat ? formatCurrency(stat.last) : '-'}</td><td className="px-3 py-3 text-right font-semibold">{stat ? formatCurrency(stat.average) : '-'}</td></>}
            {activeTables.map(table => <td key={table.key} className="px-3 py-3 text-right font-bold text-neutral-800">{formatCurrency(priceForTable(product, table.key))}</td>)}
            <td className="px-3 py-3 text-right font-black text-orange-700">{formatCurrency(product.sugestao)}</td>{custom && <td className="px-3 py-3 text-right font-black">{averageMarkup === null ? '-' : `${averageMarkup.toFixed(1)}%`}</td>}
          </tr>;
        })}</tbody>
      </table>
      {!products.length && <div className="py-16 text-center text-sm font-bold text-neutral-400">Nenhum produto encontrado com estes filtros.</div>}
    </div>
  </div>;
}

function HistoryReport({ products, selectedId, onSelect, rows, summary }: { products: Produto[]; selectedId: string; onSelect: (id: string) => void; rows: HistVenda[]; summary: { totalValue: number; totalQuantity: number; totalWeight: number; distinctClients: number; distinctDates: number; averagePrice: number } }) {
  const product = products.find(item => item.id === selectedId);
  return <div className="space-y-5">
    <div className="max-w-xl"><Select value={selectedId} onChange={onSelect} label="Produto para historico" options={[['', 'Selecione um produto'], ...products.map(item => [item.id, item.produto] as [string, string])]} /></div>
    {product && <>
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-neutral-200 bg-neutral-200 md:grid-cols-3 xl:grid-cols-6">
        {[
          ['Quantidade', summary.totalQuantity.toLocaleString('pt-BR')], ['Peso', formatWeight(summary.totalWeight)], ['Faturamento', formatCurrency(summary.totalValue)],
          ['Preço médio', formatCurrency(summary.averagePrice)], ['Pedidos', String(summary.distinctDates)], ['Clientes', String(summary.distinctClients)]
        ].map(([label, value]) => <div key={label} className="bg-white px-4 py-3"><p className="text-[10px] font-bold uppercase text-neutral-400">{label}</p><p className="mt-1 text-lg font-black text-neutral-900">{value}</p></div>)}
      </div>
      <div className="overflow-x-auto border-y border-neutral-200 bg-white"><table className="w-full min-w-[850px] text-sm"><thead className="bg-neutral-900 text-white"><tr>{['Data','Cliente','Quantidade','Peso','Tabela','Preço médio','Total'].map(label => <th key={label} className="px-3 py-3 text-left">{label}</th>)}</tr></thead>
        <tbody className="divide-y divide-neutral-100">{rows.map(sale => <tr key={sale.id}><td className="px-3 py-3 font-semibold">{format(parseISO(sale.faturamento), 'dd/MM/yyyy')}</td><td className="px-3 py-3 font-bold">{sale.cliente}</td><td className="px-3 py-3">{sale.qtd}</td><td className="px-3 py-3">{formatWeight((Number(sale.qtd) || 0) * product.peso_embalagem)}</td><td className="px-3 py-3">{sale.tabela || '-'}</td><td className="px-3 py-3">{formatCurrency((Number(sale['r$_total']) || 0) / Math.max(1, Number(sale.qtd) || 1))}</td><td className="px-3 py-3 font-black">{formatCurrency(sale['r$_total'])}</td></tr>)}</tbody>
      </table>{!rows.length && <div className="py-16 text-center font-bold text-neutral-400">Nenhuma venda encontrada no periodo selecionado.</div>}</div>
    </>}
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
    <div className="grid gap-4 md:grid-cols-2"><label className="text-xs font-bold text-neutral-500 md:col-span-2">Nome do produto<input value={form.produto} onChange={event => onChange({ ...form, produto: event.target.value })} className="mt-1 w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm text-neutral-900 outline-none focus:border-orange-400" /></label>
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
