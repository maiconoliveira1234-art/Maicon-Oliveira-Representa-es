import React, { useState, useEffect, useMemo, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { Produto, PrecoFaixa, HistVenda } from '../types';
import { Loader2, Search, Filter, Download, CheckSquare, Square, XCircle, Users, X, ChevronDown, History, TrendingUp, Pencil } from 'lucide-react';
import { cn, deduplicateSales } from '../lib/utils';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas-pro';
import { FilterDropdown } from '../components/FilterDropdown';
import { format, parseISO } from 'date-fns';
import { logDiagnostic } from '../lib/diagnostics';
import { useDataManager } from '../lib/dataManager';
import { Link } from 'react-router-dom';
import { FileChartColumn } from 'lucide-react';
import { calcularPrecoComDesconto } from '../lib/calculations';

export function PriceInquiryPage() {
  const { produtos: cachedProdutos, hist_vendas: cachedHistorico } = useDataManager();
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedFamily, setSelectedFamily] = useState<string>('all');
  const [selectedTable, setSelectedTable] = useState<PrecoFaixa>('livre');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [clients, setClients] = useState<string[]>([]);
  const [selectedClient, setSelectedClient] = useState<string>('all');
  const [clientLastPrices, setClientLastPrices] = useState<Record<string, number>>({});
  const [clientLastPricesByName, setClientLastPricesByName] = useState<Record<string, number>>({});
  const [exporting, setExporting] = useState(false);
  const exportRef = useRef<HTMLDivElement>(null);

  const [showMargin, setShowMargin] = useState(false);

  const applyLastPrices = (sales: HistVenda[]) => {
    const sortedData = [...sales].sort((a, b) => {
      const dateA = a.faturamento || '';
      const dateB = b.faturamento || '';
      return dateB.localeCompare(dateA);
    });

    const lastPrices: Record<string, number> = {};
    const lastPricesByName: Record<string, number> = {};
    
    sortedData.forEach(sale => {
      const total = sale['r$_total'] || 0;
      const qty = sale.qtd || 1;
      const unitPrice = total / qty;

      if (sale.produto_id && !lastPrices[sale.produto_id]) {
        lastPrices[sale.produto_id] = unitPrice;
      }
      if (sale.produtos && !lastPricesByName[sale.produtos.toLowerCase()]) {
        lastPricesByName[sale.produtos.toLowerCase()] = unitPrice;
      }
    });
    
    setClientLastPrices(lastPrices);
    setClientLastPricesByName(lastPricesByName);
  };

  const getMarginString = (sugestao: number | undefined | null, valorUnitario: number): string => {
    if (sugestao === undefined || sugestao === null || sugestao <= 0 || valorUnitario === undefined || valorUnitario === null || valorUnitario <= 0) {
      return '-';
    }
    const markup = ((sugestao - valorUnitario) / valorUnitario) * 100;
    if (isNaN(markup) || !isFinite(markup)) {
      return '-';
    }
    return markup.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';
  };

  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editForm, setEditForm] = useState<Produto | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const handleSaveProduct = async () => {
    if (!editForm) return;
    setIsSaving(true);
    try {
      const { error } = await supabase
        .from('produtos')
        .update({
          produto: editForm.produto,
          ativo: editForm.ativo,
          familia: editForm.familia,
          custo_total: Number(editForm.custo_total || 0),
          custo_und: Number(editForm.custo_und || 0),
          sugestao: Number(editForm.sugestao || 0),
          comissao: Number(editForm.comissao || 0),
          peso_embalagem: Number(editForm.peso_embalagem || 0),
          quant_embalagem: Number(editForm.quant_embalagem || 1),
        })
        .eq('id', editForm.id);

      if (error) throw error;

      // Update local state is crucial
      setProdutos(prev => prev.map(p => p.id === editForm.id ? { ...p, ...editForm } : p));
      setIsEditModalOpen(false);
    } catch (err) {
      console.error('Erro ao salvar produto:', err);
      alert('Erro ao salvar alterações no produto.');
    } finally {
      setIsSaving(false);
    }
  };

  // Sales History States
  const [showHistory, setShowHistory] = useState(false);
  const [historyProductId, setHistoryProductId] = useState<string | null>(null);
  const [historyData, setHistoryData] = useState<HistVenda[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historySort, setHistorySort] = useState<{ key: keyof HistVenda | 'unit_price'; direction: 'asc' | 'desc' }>({
    key: 'faturamento',
    direction: 'desc'
  });

  useEffect(() => {
    async function fetchProdutos() {
      const startTime = performance.now();
      logDiagnostic('DEBUG_PRICE', 'Iniciando busca de produtos para consulta de preços...');
      try {
        const localProducts = cachedProdutos.filter(p => p.ativo !== false);
        if (localProducts.length > 0) {
          setProdutos([...localProducts].sort((a, b) => `${a.familia || ''}${a.produto}`.localeCompare(`${b.familia || ''}${b.produto}`)));
        }
        if (navigator.onLine === false) return;

        const { data, error } = await supabase
          .from('produtos')
          .select('*')
          .eq('ativo', true)
          .order('familia')
          .order('produto');
        
        if (error) throw error;
        setProdutos(data || []);
        logDiagnostic('DEBUG_PRICE', `Produtos carregados com sucesso em ${(performance.now() - startTime).toFixed(2)}ms. Total: ${data?.length || 0} itens`);
      } catch (err: any) {
        console.error('Erro ao carregar produtos:', err);
        logDiagnostic('DEBUG_PRICE', `Falha ao carregar produtos: ${err.message || err}`);
      } finally {
        setLoading(false);
      }
    }
    fetchProdutos();

    async function fetchClients() {
      const startTime = performance.now();
      logDiagnostic('DEBUG_PRICE', 'Buscando clientes a partir do histórico de vendas...');
      try {
        if (cachedHistorico.length > 0) {
          const uniqueClients = Array.from(new Set(cachedHistorico.map(d => d.cliente))).filter(Boolean).sort();
          setClients(uniqueClients as string[]);
          return;
        }
        if (navigator.onLine === false) return;

        const { data, error } = await supabase
          .from('hist_vendas')
          .select('cliente')
          .gte('faturamento', '2024-01-01')
          .not('cliente', 'is', null);
        
        if (error) throw error;
        if (data) {
          const uniqueClients = Array.from(new Set(data.map(d => d.cliente))).filter(Boolean).sort();
          logDiagnostic('DEBUG_PRICE', `Clientes únicos carregados em ${(performance.now() - startTime).toFixed(2)}ms: ${uniqueClients.length} clientes`);
          setClients(uniqueClients as string[]);
        }
      } catch (err: any) {
        console.error('Erro ao carregar clientes:', err);
        logDiagnostic('DEBUG_PRICE', `Falha ao carregar clientes do histórico: ${err.message || err}`);
      }
    }
    fetchClients();
  }, [cachedProdutos, cachedHistorico]);

  useEffect(() => {
    if (selectedClient === 'all') {
      setClientLastPrices({});
      return;
    }

    async function fetchLastPrices() {
      try {
        const localSales = cachedHistorico.filter(sale => sale.cliente === selectedClient);
        if (localSales.length > 0) {
          applyLastPrices(localSales);
        }
        if (navigator.onLine === false) return;

        console.log('Fetching last prices for client:', selectedClient);
        const { data, error } = await supabase
          .from('hist_vendas')
          .select('produto_id, produtos, "r$_total", qtd, faturamento')
          .eq('cliente', selectedClient);
        
        if (error) throw error;
        if (data) {
          console.log('Sales data received:', data.length, 'records for', selectedClient);
          applyLastPrices(data as HistVenda[]);
        }
      } catch (err) {
        console.error('Erro ao carregar últimos preços:', err);
      }
    }
    fetchLastPrices();
  }, [selectedClient, cachedHistorico]);

  useEffect(() => {
    if (!showHistory || !historyProductId) {
      setHistoryData([]);
      return;
    }

    async function fetchHistory() {
      setHistoryLoading(true);
      try {
        const localHistory = cachedHistorico.filter(h => h.produto_id === historyProductId);
        if (localHistory.length > 0) {
          setHistoryData(deduplicateSales(localHistory));
        }
        if (navigator.onLine === false) return;

        const { data, error } = await supabase
          .from('hist_vendas')
          .select('*')
          .eq('produto_id', historyProductId)
          .order('faturamento', { ascending: false });

        if (error) throw error;
        
        // Apply deduplication to avoid showing duplicated records from the database
        const uniqueData = deduplicateSales(data || []);
        setHistoryData(uniqueData);
      } catch (err) {
        console.error('Erro ao carregar histórico de vendas:', err);
      } finally {
        setHistoryLoading(false);
      }
    }

    fetchHistory();
  }, [showHistory, historyProductId, cachedHistorico]);

  const sortedHistoryData = useMemo(() => {
    if (!historyData.length) return [];
    
    return [...historyData].sort((a, b) => {
      let valA: any;
      let valB: any;

      if (historySort.key === 'unit_price') {
        valA = (a['r$_total'] || 0) / (a.qtd || 1);
        valB = (b['r$_total'] || 0) / (b.qtd || 1);
      } else {
        valA = a[historySort.key];
        valB = b[historySort.key];
      }

      if (valA === undefined || valA === null) return 1;
      if (valB === undefined || valB === null) return -1;

      if (typeof valA === 'string' && typeof valB === 'string') {
        return historySort.direction === 'asc' 
          ? valA.localeCompare(valB) 
          : valB.localeCompare(valA);
      }

      return historySort.direction === 'asc' 
        ? (valA > valB ? 1 : -1) 
        : (valB > valA ? 1 : -1);
    });
  }, [historyData, historySort]);

  const toggleHistorySort = (key: keyof HistVenda | 'unit_price') => {
    setHistorySort(prev => ({
      key,
      direction: prev.key === key && prev.direction === 'desc' ? 'asc' : 'desc'
    }));
  };

  const families = useMemo(() => {
    const activeProducts = produtos.filter(p => p.ativo !== false);
    const fams = new Set(activeProducts.map(p => p.familia || 'Sem Família'));
    return Array.from(fams).sort();
  }, [produtos]);

  const filteredProdutos = useMemo(() => {
    const searchWords = searchTerm.toLowerCase().split(' ').filter(word => word.length > 0);
    
    return produtos.filter(p => {
      const productName = p.produto || '';
      const productFamily = p.familia || '';
      const targetString = `${productName} ${productFamily}`.toLowerCase();
      
      const matchesSearch = searchWords.length === 0 || searchWords.every(word => targetString.includes(word));
      const matchesFamily = selectedFamily === 'all' || productFamily === selectedFamily;
      
      if (selectedClient !== 'all') {
        const hasBeenBought = clientLastPrices.hasOwnProperty(p.id) || 
                             (p.produto && clientLastPricesByName.hasOwnProperty(p.produto.toLowerCase()));
        const hasSuggestion = (p.sugestao || 0) > 0;
        
        return matchesSearch && matchesFamily && hasBeenBought && hasSuggestion;
      }

      return matchesSearch && matchesFamily;
    });
  }, [produtos, searchTerm, selectedFamily, selectedClient, clientLastPrices, clientLastPricesByName]);

  const selectAll = () => {
    const allIds = filteredProdutos.map(p => p.id);
    setSelectedIds(new Set(allIds));
  };

  const toggleSelect = (id: string) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
      if (historyProductId === id) {
        // If we removed the current history product, pick another one from the set if available
        const remaining = Array.from(newSelected);
        setHistoryProductId(remaining.length > 0 ? remaining[remaining.length - 1] : null);
      }
    } else {
      newSelected.add(id);
      setHistoryProductId(id);
    }
    setSelectedIds(newSelected);
  };

  const deselectAll = () => {
    setSelectedIds(new Set());
    setHistoryProductId(null);
  };

  const handleExport = async () => {
    if (selectedIds.size === 0) {
      alert('Selecione ao menos um produto para exportar.');
      return;
    }

    if (!exportRef.current) return;

    setExporting(true);
    try {
      if (document.fonts) {
        try {
          await document.fonts.ready;
        } catch (e) {
          // continue
        }
      }
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      await new Promise(resolve => setTimeout(resolve, 350));

      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4'
      });

      const pages = exportRef.current?.querySelectorAll('.pdf-page');
      if (!pages || pages.length === 0) return;

      for (let i = 0; i < pages.length; i++) {
        const page = pages[i] as HTMLElement;
        const canvas = await html2canvas(page, {
          scale: 2,
          useCORS: true,
          allowTaint: true,
          logging: false,
          backgroundColor: '#ffffff',
          windowWidth: 800,
          windowHeight: 1130,
          scrollX: 0,
          scrollY: 0,
          x: 0,
          y: 0,
          width: 800,
          height: 1130
        });
        
        const imgData = canvas.toDataURL('image/jpeg', 0.90);
        
        if (i > 0) pdf.addPage();
        
        // A4 is 210mm x 297mm
        const imgWidth = 210;
        const imgHeight = (canvas.height * imgWidth) / canvas.width;
        
        pdf.addImage(imgData, 'JPEG', 0, 0, imgWidth, Math.min(imgHeight, 297));
      }

      const pdfBlob = pdf.output('blob');
      const fileName = `lista-precos-${new Date().getTime()}.pdf`;
      const file = new File([pdfBlob], fileName, { type: 'application/pdf' });

      // sharing logic
      const shareData = {
        files: [file],
        title: 'Lista de Preços',
        text: 'Segue nossa lista de preços atualizada.'
      };

      // Check if sharing is supported
      if (navigator.share && navigator.canShare && navigator.canShare(shareData)) {
        try {
          await navigator.share(shareData);
        } catch (shareErr) {
          // If user cancels or share fails, fallback to download
          if ((shareErr as Error).name !== 'AbortError') {
            pdf.save(fileName);
          }
        }
      } else {
        // Fallback to download if sharing is not supported
        pdf.save(fileName);
      }
    } catch (err) {
      console.error('Erro ao exportar PDF:', err);
      alert('Erro ao exportar PDF. Tente novamente.');
    } finally {
      setExporting(false);
    }
  };

  const selectedProductsList = useMemo(() => {
    return produtos.filter(p => selectedIds.has(p.id));
  }, [produtos, selectedIds]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="animate-spin text-orange-600" size={32} />
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-12">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-neutral-900">Consulta Preço</h1>
          <p className="text-neutral-500 text-sm">Gere listas de preços</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            to="/relatorios-precos"
            className="px-3 py-1.5 bg-neutral-900 text-white rounded-lg font-bold hover:bg-neutral-800 transition-all flex items-center gap-2 text-xs shadow-md"
          >
            <FileChartColumn size={15} />
            Nova consulta e relatórios
          </Link>
          {historyProductId && (
            <button
               onClick={() => {
                 const prod = produtos.find(p => p.id === historyProductId);
                 if (prod) {
                   setEditForm({ ...prod });
                   setIsEditModalOpen(true);
                 }
               }}
               className="px-3 py-1.5 bg-neutral-900 border border-transparent text-white rounded-lg font-bold hover:bg-neutral-800 transition-all flex items-center gap-2 text-xs shadow-md"
            >
              <Pencil size={14} />
              Editar Selecionado
            </button>
          )}
          <button
            onClick={() => setShowHistory(!showHistory)}
            className={cn(
              "px-3 py-1.5 rounded-lg font-bold transition-all flex items-center gap-2 border text-xs",
              showHistory 
                ? "bg-orange-100 text-orange-600 border-orange-200 shadow-sm" 
                : "bg-white text-neutral-600 border-neutral-200 hover:bg-neutral-50"
            )}
          >
            <History size={16} />
            {showHistory ? "Ocultar Histórico" : "Ver Histórico"}
          </button>
          <button
            onClick={() => setShowMargin(!showMargin)}
            className={cn(
              "px-3 py-1.5 rounded-lg font-bold transition-all flex items-center gap-2 border text-xs",
              showMargin 
                ? "bg-orange-100 text-orange-600 border-orange-200 shadow-sm" 
                : "bg-white text-neutral-600 border-neutral-200 hover:bg-neutral-50"
            )}
          >
            <TrendingUp size={16} />
            {showMargin ? "Ocultar Markup" : "Exibir Markup"}
          </button>
          <button
            onClick={deselectAll}
            className="px-3 py-1.5 bg-white border border-neutral-200 text-neutral-600 rounded-lg font-bold hover:bg-neutral-50 transition-all flex items-center gap-2 text-xs"
          >
            <XCircle size={16} />
            Desmarcar Todos
          </button>
          <button
            onClick={selectAll}
            className="px-3 py-1.5 bg-white border border-neutral-200 text-neutral-600 rounded-lg font-bold hover:bg-neutral-50 transition-all flex items-center gap-2 text-xs"
          >
            <CheckSquare size={16} />
            Marcar Todos
          </button>
          <button
            onClick={handleExport}
            disabled={exporting}
            className="px-3 py-1.5 bg-orange-600 text-white rounded-lg font-bold hover:bg-orange-700 transition-all flex items-center gap-2 shadow-lg shadow-orange-200 disabled:opacity-50 text-xs"
          >
            {exporting ? <Loader2 className="animate-spin" size={16} /> : <Download size={16} />}
            Exportar / Enviar
          </button>
        </div>
      </header>

      <div className="space-y-4">
        <div className="relative max-w-2xl mx-auto">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-neutral-400" size={20} />
          <input
            type="text"
            placeholder="Buscar produto..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-12 pr-12 py-3 bg-white border border-neutral-200 rounded-lg shadow-sm focus:ring-2 focus:ring-orange-500 outline-none transition-all"
          />
          {searchTerm && (
            <button
              onClick={() => setSearchTerm('')}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600 p-1 transition-colors"
            >
              <X size={20} />
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 max-w-5xl mx-auto">
          <div className="relative">
            <FilterDropdown 
              label="Todas as Famílias"
              options={[
                { id: 'all', label: 'Todas as Famílias' },
                ...families.map(f => ({ id: f, label: f }))
              ]}
              selected={selectedFamily}
              onChange={(value) => {
                setSelectedFamily(value);
                setSearchTerm('');
              }}
              placeholder="Buscar família..."
              icon={<Filter size={20} />}
            />
          </div>
          <div className="relative">
            <FilterDropdown 
              label="Todos os Clientes"
              options={[
                { id: 'all', label: 'Todos os Clientes' },
                ...clients.map(c => ({ id: c, label: c }))
              ]}
              selected={selectedClient}
              onChange={(value) => {
                setSelectedClient(value);
                setSearchTerm('');
              }}
              placeholder="Buscar cliente..."
              icon={<Users size={20} />}
            />
          </div>
          <div className="relative">
            <CheckSquare className="absolute left-4 top-1/2 -translate-y-1/2 text-neutral-400" size={20} />
            <select
              value={selectedTable}
              onChange={(e) => setSelectedTable(e.target.value as PrecoFaixa)}
              className="w-full pl-12 pr-10 py-3 bg-white border border-neutral-200 rounded-lg shadow-sm focus:ring-2 focus:ring-orange-500 outline-none transition-all appearance-none font-bold text-neutral-700"
            >
              <option value="livre">Tabela Livre</option>
              <option value="200kg">Tabela 200kg</option>
              <option value="500kg">Tabela 500kg</option>
              <option value="1000kg">Tabela 1000kg</option>
              <option value="2000kg">Tabela 2000kg</option>
              <option value="4000kg">Tabela 4000kg</option>
            </select>
            <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-neutral-400">
              <ChevronDown size={20} />
            </div>
          </div>
        </div>
      </div>

      {showHistory && (
        <div className="bg-white rounded-lg border border-neutral-200 shadow-sm overflow-hidden animate-in fade-in slide-in-from-top-4 duration-300">
          <div className="p-4 border-b border-neutral-100 bg-neutral-50 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <TrendingUp className="text-orange-600" size={20} />
              <h2 className="font-bold text-neutral-900">Histórico de Vendas</h2>
              {historyProductId && (
                <span className="text-xs font-bold text-neutral-400 bg-neutral-200 px-2 py-0.5 rounded-full uppercase">
                  {produtos.find(p => p.id === historyProductId)?.produto}
                </span>
              )}
            </div>
            {historyLoading && <Loader2 className="animate-spin text-orange-600" size={18} />}
          </div>

          <div className="p-0">
            {!historyProductId ? (
              <div className="p-8 text-center text-neutral-400">
                <p className="font-medium">Selecione um produto para visualizar o histórico</p>
              </div>
            ) : historyLoading ? (
              <div className="p-8 flex justify-center">
                <Loader2 className="animate-spin text-orange-600" size={24} />
              </div>
            ) : historyData.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-neutral-50 text-[10px] uppercase font-bold text-neutral-500 border-b border-neutral-100">
                      <th 
                        className="px-4 py-3 cursor-pointer hover:bg-neutral-100 transition-colors group w-[40%]"
                        onClick={() => toggleHistorySort('cliente')}
                      >
                        <div className="flex items-center gap-1">
                          Cliente
                          <ChevronDown size={12} className={cn("transition-transform", historySort.key === 'cliente' && historySort.direction === 'asc' && "rotate-180", historySort.key !== 'cliente' && "opacity-0 group-hover:opacity-100")} />
                        </div>
                      </th>
                      <th 
                        className="px-2 py-3 cursor-pointer hover:bg-neutral-100 transition-colors group w-[12%]"
                        onClick={() => toggleHistorySort('faturamento')}
                      >
                        <div className="flex items-center gap-1">
                          Data
                          <ChevronDown size={12} className={cn("transition-transform", historySort.key === 'faturamento' && historySort.direction === 'asc' && "rotate-180", historySort.key !== 'faturamento' && "opacity-0 group-hover:opacity-100")} />
                        </div>
                      </th>
                      <th 
                        className="px-2 py-3 text-right cursor-pointer hover:bg-neutral-100 transition-colors group w-[10%]"
                        onClick={() => toggleHistorySort('qtd')}
                      >
                        <div className="flex items-center justify-end gap-1">
                          Quant.
                          <ChevronDown size={12} className={cn("transition-transform", historySort.key === 'qtd' && historySort.direction === 'asc' && "rotate-180", historySort.key !== 'qtd' && "opacity-0 group-hover:opacity-100")} />
                        </div>
                      </th>
                      <th 
                        className="px-4 py-3 text-right cursor-pointer hover:bg-neutral-100 transition-colors group w-[18%]"
                        onClick={() => toggleHistorySort('unit_price')}
                      >
                        <div className="flex items-center justify-end gap-1">
                          Val. Unit.
                          <ChevronDown size={12} className={cn("transition-transform", historySort.key === 'unit_price' && historySort.direction === 'asc' && "rotate-180", historySort.key !== 'unit_price' && "opacity-0 group-hover:opacity-100")} />
                        </div>
                      </th>
                      <th 
                        className="px-4 py-3 text-right cursor-pointer hover:bg-neutral-100 transition-colors group w-[20%]"
                        onClick={() => toggleHistorySort('r$_total')}
                      >
                        <div className="flex items-center justify-end gap-1">
                          Total
                          <ChevronDown size={12} className={cn("transition-transform", historySort.key === 'r$_total' && historySort.direction === 'asc' && "rotate-180", historySort.key !== 'r$_total' && "opacity-0 group-hover:opacity-100")} />
                        </div>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100">
                    {sortedHistoryData.map((venda) => (
                      <tr key={venda.id} className="text-[11px] hover:bg-neutral-50 transition-colors">
                        <td className="px-4 py-2 font-bold text-neutral-900 truncate max-w-0">{venda.cliente}</td>
                        <td className="px-2 py-2 text-neutral-500">
                          {venda.faturamento ? format(parseISO(venda.faturamento), 'dd/MM/yy') : '-'}
                        </td>
                        <td className="px-2 py-2 text-right font-medium text-neutral-700">{venda.qtd}</td>
                        <td className="px-4 py-2 text-right font-medium text-neutral-700">
                          R$ {((venda['r$_total'] || 0) / (venda.qtd || 1)).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>
                        <td className="px-4 py-2 text-right font-black text-orange-600">
                          R$ {(venda['r$_total'] || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="p-8 text-center text-neutral-400">
                <p>Nenhuma venda encontrada para este produto.</p>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="bg-white rounded-lg border border-neutral-200 shadow-sm overflow-hidden flex-1">
        <div className="divide-y divide-neutral-100">
          {filteredProdutos.length > 0 ? (
            filteredProdutos.map((produto) => {
              const unitPrice = selectedClient !== 'all' 
                ? (clientLastPrices[produto.id] || clientLastPricesByName[produto.produto?.toLowerCase() || ''] || 0)
                : calcularPrecoComDesconto(produto.custo_und, produto[selectedTable]);

              return (
                <div
                  key={produto.id}
                  onClick={() => toggleSelect(produto.id)}
                  className="flex items-center justify-between p-4 hover:bg-neutral-50 transition-colors group cursor-pointer"
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={cn(
                        "transition-colors",
                        selectedIds.has(produto.id) ? "text-orange-600" : "text-neutral-300"
                      )}
                    >
                      {selectedIds.has(produto.id) ? <CheckSquare size={24} /> : <Square size={24} />}
                    </div>
                    <div>
                      <h3 className="font-bold text-neutral-900 text-base">{produto.produto}</h3>
                      <p className="text-[10px] text-neutral-400 font-bold uppercase">{produto.familia}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 md:gap-6">
                    <div className="text-right">
                      <p className="text-[10px] text-neutral-400 uppercase font-bold">Sugestão</p>
                      <p className="text-sm font-bold text-neutral-500">
                        R$ {(produto.sugestao || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-neutral-400 uppercase font-bold">Preço Unitário</p>
                      <p className="text-lg font-black text-neutral-900">
                        R$ {unitPrice.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </p>
                    </div>
                    {showMargin && (
                      <div className="text-right">
                        <p className="text-xs text-neutral-400 uppercase font-bold">Markup</p>
                        <p className="text-lg font-black text-orange-600">
                          {getMarginString(produto.sugestao, unitPrice)}
                        </p>
                      </div>
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditForm({ ...produto });
                        setIsEditModalOpen(true);
                      }}
                      className="p-2 bg-neutral-50 hover:bg-orange-50 text-neutral-400 hover:text-orange-600 rounded-lg transition-all border border-transparent hover:border-orange-200"
                      title="Editar produto"
                    >
                      <Pencil size={15} />
                    </button>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="p-12 text-center text-neutral-400">
              <p className="font-medium text-neutral-600">Nenhum produto encontrado</p>
              {selectedClient !== 'all' ? (
                <p className="text-xs text-neutral-400 mt-1">
                  O filtro por cliente exibe apenas os produtos que o cliente já comprou no histórico. Para ver toda a tabela ou produtos novos, selecione &quot;Todos os Clientes&quot;.
                </p>
              ) : (
                <p className="text-xs text-neutral-400 mt-1">
                  Tente ajustar a busca ou selecione &quot;Todas as Famílias&quot;.
                </p>
              )}
            </div>
          )}
        </div>
      </div>

<div 
  ref={exportRef}
  style={{ 
    position: 'fixed', 
    left: '-9999px', 
    top: '0px', 
    width: '800px', 
    color: '#171717', 
    backgroundColor: '#ffffff',
    zIndex: -999,
    pointerEvents: 'none' 
  }}
>
  {(() => {
    const itemsPerPage = 20;
    const chunks: (typeof selectedProductsList)[] = [];
    const total = selectedProductsList.length;

    if (total <= itemsPerPage) {
      chunks.push(selectedProductsList);
    } else if (total <= itemsPerPage * 2) {
      const mid = Math.ceil(total / 2);
      chunks.push(selectedProductsList.slice(0, mid));
      chunks.push(selectedProductsList.slice(mid));
    } else {
      for (let i = 0; i < selectedProductsList.length; i += itemsPerPage) {
        chunks.push(selectedProductsList.slice(i, i + itemsPerPage));
      }
    }

    if (chunks.length === 0) {
      chunks.push([]);
    }

    return chunks.map((chunk, pageIdx) => (
      <div 
        key={pageIdx}
        className="pdf-page"
        style={{ 
          width: '800px', 
          minHeight: '1130px', 
          height: '1130px', 
          boxSizing: 'border-box', 
          overflow: 'hidden',
          padding: '36px 40px',
          fontFamily: 'Arial, sans-serif', 
          backgroundColor: '#ffffff', 
          color: '#171717',
          display: 'flex',
          flexDirection: 'column',
          position: 'relative'
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '2px solid #262626', paddingBottom: '14px', marginBottom: '18px' }}>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <h1 style={{ margin: 0, fontSize: '22px', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '-0.02em', color: '#171717' }}>Lista de Preços</h1>
            <div style={{ marginTop: '4px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '11px', fontWeight: 600, color: '#525252' }}>Tabela: {selectedTable.toUpperCase()}</span>
              <span style={{ fontSize: '11px', color: '#d4d4d4' }}>•</span>
              <span style={{ fontSize: '11px', fontWeight: 600, color: '#525252' }}>Data: {new Date().toLocaleDateString('pt-BR')}</span>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
            <div style={{ height: '36px', display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
              <img 
                src="https://wsrv.nl/?url=https://adimax.com.br/wp-content/uploads/2021/06/logo_adimax-04968c974e8e5d15ddb822152395b3f6.png&w=400&output=png" 
                alt="ADIMAX" 
                style={{ height: '32px', width: 'auto', maxHeight: '32px', maxWidth: '140px', objectFit: 'contain', display: 'block' }}
                crossOrigin="anonymous"
                referrerPolicy="no-referrer"
                onError={(e) => { (e.target as HTMLElement).style.display = 'none'; }}
              />
            </div>
            <span style={{ fontSize: '8px', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#8c8c8c', marginTop: '2px' }}>Parceiro Oficial</span>
          </div>
        </div>

        {/* Table */}
        <div style={{ flex: 1, minHeight: 0 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
            <thead>
              <tr style={{ backgroundColor: '#171717', color: '#ffffff' }}>
                <th 
                  style={{ width: showMargin ? '45%' : '55%', padding: '9px 12px', textAlign: 'left', fontSize: '9px', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.08em', borderTopLeftRadius: '6px', color: '#ffffff' }}
                >
                  Produto
                </th>
                <th 
                  style={{ width: showMargin ? '18%' : '22%', padding: '9px 12px', textAlign: 'right', fontSize: '9px', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#ffffff' }}
                >
                  Sugestão
                </th>
                <th 
                  style={{ width: showMargin ? '22%' : '23%', padding: '9px 12px', textAlign: 'right', fontSize: '9px', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.08em', borderTopRightRadius: !showMargin ? '6px' : undefined, color: '#ffffff' }}
                >
                  Preço Unitário
                </th>
                {showMargin && (
                  <th 
                    style={{ width: '15%', padding: '9px 12px', textAlign: 'right', fontSize: '9px', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.08em', borderTopRightRadius: '6px', color: '#ffffff' }}
                  >
                    Markup
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {chunk.map((p, idx) => {
                const price = selectedClient !== 'all'
                  ? (clientLastPrices[p.id] || clientLastPricesByName[p.produto?.toLowerCase() || ''] || 0)
                  : calcularPrecoComDesconto(p.custo_und, p[selectedTable]);
                
                return (
                  <tr key={p.id} style={{ backgroundColor: idx % 2 === 0 ? '#ffffff' : '#f9fafb', borderBottom: '1px solid #f0f0f0' }}>
                    <td style={{ padding: '7px 12px', fontSize: '11px', fontWeight: 700, lineHeight: '14px', color: '#171717', wordBreak: 'break-word', width: showMargin ? '45%' : '55%' }}>
                      {p.produto}
                    </td>
                    <td style={{ padding: '7px 12px', textAlign: 'right', fontSize: '11px', fontWeight: 500, color: '#525252', width: showMargin ? '18%' : '22%' }}>
                      R$ {(p.sugestao || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                    <td style={{ padding: '7px 12px', textAlign: 'right', fontSize: '11px', fontWeight: 900, color: '#171717', width: showMargin ? '22%' : '23%' }}>
                      R$ {price.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                    {showMargin && (
                      <td style={{ padding: '7px 12px', textAlign: 'right', fontSize: '11px', fontWeight: 900, color: '#ea580c', width: '15%' }}>
                        {getMarginString(p.sugestao, price)}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div style={{ marginTop: 'auto', paddingTop: '10px', borderTop: '1px solid #f0f0f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '9px', fontWeight: 700, color: '#737373' }}>
          <p style={{ margin: 0, letterSpacing: '0.08em', textTransform: 'uppercase' }}>MAICON OLIVEIRA REPRESENTAÇÕES</p>
          <p style={{ margin: 0, fontStyle: 'italic' }}>Preços sujeitos a alteração sem aviso prévio</p>
          <p style={{ margin: 0 }}>Página {pageIdx + 1} de {chunks.length}</p>
        </div>
      </div>
    ));
  })()}
</div>

      {/* Elegant Edit Product Modal */}
      {isEditModalOpen && editForm && (
        <div className="fixed inset-0 bg-neutral-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl animate-in zoom-in-95 duration-200 overflow-hidden">
            
            {/* Modal Header */}
            <div className="p-6 border-b border-neutral-100 flex items-center justify-between bg-neutral-50">
              <div>
                <h2 className="text-xl font-black text-neutral-900">Editar Produto</h2>
                <p className="text-neutral-500 text-xs mt-0.5">Editando configurações do banco de dados</p>
              </div>
              <button 
                onClick={() => setIsEditModalOpen(false)}
                className="p-2 hover:bg-neutral-200 text-neutral-400 hover:text-neutral-700 rounded-full transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            {/* Modal Body / Form */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              
              {/* Product Info Section */}
              <div className="space-y-4">
                <h3 className="text-xs font-black text-neutral-400 uppercase tracking-wider">Identificação do Produto</h3>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Name field */}
                  <div className="space-y-1">
                    <label className="text-xs font-black text-neutral-500 uppercase tracking-wider block">Nome do Produto</label>
                    <input 
                      type="text" 
                      value={editForm.produto || ''} 
                      onChange={(e) => setEditForm({ ...editForm, produto: e.target.value })}
                      className="w-full px-4 py-2.5 bg-neutral-50 border border-neutral-200 rounded-lg font-bold text-neutral-800 outline-none focus:ring-2 focus:ring-orange-500 transition-all text-sm"
                      placeholder="Ex: MAGNUS BISCOITO ORIGINAL 10X4000G"
                    />
                  </div>

                  {/* Family Field */}
                  <div className="space-y-1">
                    <label className="text-xs font-black text-neutral-500 uppercase tracking-wider block">Família</label>
                    <input 
                      type="text" 
                      value={editForm.familia || ''} 
                      onChange={(e) => setEditForm({...editForm, familia: e.target.value})}
                      className="w-full px-4 py-2.5 bg-neutral-50 border border-neutral-200 rounded-lg font-bold text-neutral-800 outline-none focus:ring-2 focus:ring-orange-500 transition-all text-sm"
                      placeholder="Ex: MAGNUS"
                    />
                  </div>
                </div>

                {/* Ativo Status Toggle Block */}
                <div className="p-4 bg-neutral-50 rounded-lg border border-neutral-100 flex items-center justify-between">
                  <div>
                    <h4 className="text-sm font-bold text-neutral-900">Produto Ativo</h4>
                    <p className="text-neutral-400 text-xs mt-0.5">Se desativado, o produto é marcado como inativo no banco de dados</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setEditForm({...editForm, ativo: !editForm.ativo})}
                    className={cn(
                      "w-12 h-6 rounded-full p-1 transition-all duration-300 outline-none relative flex items-center",
                      editForm.ativo ? "bg-orange-600 justify-end" : "bg-neutral-300 justify-start"
                    )}
                  >
                    <span className="w-4 h-4 bg-white rounded-full shadow-md" />
                  </button>
                </div>
              </div>

              {/* Finance Section */}
              <div className="space-y-4 pt-4 border-t border-neutral-100">
                <h3 className="text-xs font-black text-neutral-400 uppercase tracking-wider">Custos, Sugestão e Comissão</h3>
                
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {/* Custo Total */}
                  <div className="space-y-1">
                    <label className="text-xs font-black text-neutral-500 uppercase tracking-wider block">Custo Total (R$)</label>
                    <input 
                      type="number" 
                      step="0.01"
                      value={editForm.custo_total || 0} 
                      onChange={(e) => setEditForm({...editForm, custo_total: parseFloat(e.target.value) || 0})}
                      className="w-full px-3 py-2 bg-neutral-50 border border-neutral-200 rounded-lg font-bold text-neutral-800 outline-none focus:ring-2 focus:ring-orange-500 transition-all text-sm"
                    />
                  </div>

                  {/* Custo Und */}
                  <div className="space-y-1">
                    <label className="text-xs font-black text-neutral-500 uppercase tracking-wider block">Custo Unitário (R$)</label>
                    <input 
                      type="number" 
                      step="0.01"
                      value={editForm.custo_und || 0} 
                      onChange={(e) => setEditForm({...editForm, custo_und: parseFloat(e.target.value) || 0})}
                      className="w-full px-3 py-2 bg-neutral-50 border border-neutral-200 rounded-lg font-bold text-neutral-800 outline-none focus:ring-2 focus:ring-orange-500 transition-all text-sm"
                    />
                  </div>

                  {/* Sugestao */}
                  <div className="space-y-1">
                    <label className="text-xs font-black text-neutral-500 uppercase tracking-wider block">Sugestão (R$)</label>
                    <input 
                      type="number" 
                      step="0.01"
                      value={editForm.sugestao || 0} 
                      onChange={(e) => setEditForm({...editForm, sugestao: parseFloat(e.target.value) || 0})}
                      className="w-full px-3 py-2 bg-neutral-50 border border-neutral-200 rounded-lg font-bold text-neutral-800 outline-none focus:ring-2 focus:ring-orange-500 transition-all text-sm"
                    />
                  </div>

                  {/* Comissao */}
                  <div className="space-y-1">
                    <label className="text-xs font-black text-neutral-500 uppercase tracking-wider block">Comissão (%)</label>
                    <input 
                      type="number" 
                      step="0.001"
                      value={editForm.comissao || 0} 
                      onChange={(e) => setEditForm({...editForm, comissao: parseFloat(e.target.value) || 0})}
                      className="w-full px-3 py-2 bg-neutral-50 border border-neutral-200 rounded-lg font-bold text-neutral-800 outline-none focus:ring-2 focus:ring-orange-500 transition-all text-sm"
                    />
                  </div>
                </div>
              </div>

              {/* Packaging section */}
              <div className="space-y-4 pt-4 border-t border-neutral-100">
                <h3 className="text-xs font-black text-neutral-400 uppercase tracking-wider">Logística & Embalagem</h3>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Peso Embalagem */}
                  <div className="space-y-1">
                    <label className="text-xs font-black text-neutral-500 uppercase tracking-wider block">Peso total da Embalagem (KG)</label>
                    <input 
                      type="number" 
                      step="any"
                      value={editForm.peso_embalagem || 0} 
                      onChange={(e) => setEditForm({...editForm, peso_embalagem: parseFloat(e.target.value) || 0})}
                      className="w-full px-4 py-2.5 bg-neutral-50 border border-neutral-200 rounded-lg font-bold text-neutral-800 outline-none focus:ring-2 focus:ring-orange-500 transition-all text-sm"
                    />
                  </div>

                  {/* Quantidade na Embalagem */}
                  <div className="space-y-1">
                    <label className="text-xs font-black text-neutral-500 uppercase tracking-wider block">Quantidade de Unidades na Embalagem</label>
                    <input 
                      type="number" 
                      step="1"
                      value={editForm.quant_embalagem || 1} 
                      onChange={(e) => setEditForm({...editForm, quant_embalagem: parseInt(e.target.value) || 1})}
                      className="w-full px-4 py-2.5 bg-neutral-50 border border-neutral-200 rounded-lg font-bold text-neutral-800 outline-none focus:ring-2 focus:ring-orange-500 transition-all text-sm"
                    />
                  </div>
                </div>
              </div>

            </div>

            {/* Modal Actions Footer */}
            <div className="p-6 border-t border-neutral-100 bg-neutral-50 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setIsEditModalOpen(false)}
                disabled={isSaving}
                className="px-5 py-2.5 bg-white border border-neutral-200 hover:bg-neutral-50 text-neutral-700 font-bold rounded-lg transition-all text-sm disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSaveProduct}
                disabled={isSaving}
                className="px-6 py-2.5 bg-orange-600 hover:bg-orange-700 text-white font-bold rounded-lg transition-all text-sm flex items-center gap-2 shadow-lg shadow-orange-100 disabled:opacity-50"
              >
                {isSaving ? (
                  <>
                    <Loader2 className="animate-spin" size={16} />
                    Salvando...
                  </>
                ) : (
                  'Salvar Alterações'
                )}
              </button>
            </div>

          </div>
        </div>
      )}
    </div>
  );
}
