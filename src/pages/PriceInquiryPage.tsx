import React, { useState, useEffect, useMemo, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { Produto, PrecoFaixa, HistVenda } from '../types';
import { Loader2, Search, Filter, Download, CheckSquare, Square, XCircle, Users, X, ChevronDown, History, TrendingUp } from 'lucide-react';
import { cn } from '../lib/utils';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { FilterDropdown } from '../components/FilterDropdown';
import { format, parseISO } from 'date-fns';

export function PriceInquiryPage() {
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
      try {
        const { data, error } = await supabase
          .from('produtos')
          .select('*')
          .eq('ativo', true)
          .order('familia')
          .order('produto');
        
        if (error) throw error;
        setProdutos(data || []);
      } catch (err) {
        console.error('Erro ao carregar produtos:', err);
      } finally {
        setLoading(false);
      }
    }
    fetchProdutos();

    async function fetchClients() {
      try {
        const { data, error } = await supabase
          .from('hist_vendas')
          .select('cliente')
          .not('cliente', 'is', null);
        
        if (error) throw error;
        if (data) {
          const uniqueClients = Array.from(new Set(data.map(d => d.cliente))).filter(Boolean).sort();
          console.log('Loaded', uniqueClients.length, 'unique clients from history');
          setClients(uniqueClients as string[]);
        }
      } catch (err) {
        console.error('Erro ao carregar clientes:', err);
      }
    }
    fetchClients();
  }, []);

  useEffect(() => {
    if (selectedClient === 'all') {
      setClientLastPrices({});
      return;
    }

    async function fetchLastPrices() {
      try {
        console.log('Fetching last prices for client:', selectedClient);
        const { data, error } = await supabase
          .from('hist_vendas')
          .select('produto_id, produtos, "r$_total", qtd, faturamento')
          .eq('cliente', selectedClient);
        
        if (error) throw error;
        if (data) {
          console.log('Sales data received:', data.length, 'records for', selectedClient);
          const sortedData = [...data].sort((a, b) => {
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
          
          console.log('Processed last prices for', Object.keys(lastPrices).length, 'products by ID and', Object.keys(lastPricesByName).length, 'by name');
          setClientLastPrices(lastPrices);
          setClientLastPricesByName(lastPricesByName);
        }
      } catch (err) {
        console.error('Erro ao carregar últimos preços:', err);
      }
    }
    fetchLastPrices();
  }, [selectedClient]);

  useEffect(() => {
    if (!showHistory || !historyProductId) {
      setHistoryData([]);
      return;
    }

    async function fetchHistory() {
      setHistoryLoading(true);
      try {
        const { data, error } = await supabase
          .from('hist_vendas')
          .select('*')
          .eq('produto_id', historyProductId)
          .order('faturamento', { ascending: false });

        if (error) throw error;
        setHistoryData(data || []);
      } catch (err) {
        console.error('Erro ao carregar histórico de vendas:', err);
      } finally {
        setHistoryLoading(false);
      }
    }

    fetchHistory();
  }, [showHistory, historyProductId]);

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
    const fams = new Set(produtos.map(p => p.familia || 'Sem Família'));
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
          backgroundColor: '#ffffff',
          windowWidth: 800
        });
        
        const imgData = canvas.toDataURL('image/jpeg', 1.0);
        
        if (i > 0) pdf.addPage();
        
        // A4 is 210mm x 297mm
        const imgWidth = 210;
        const imgHeight = (canvas.height * imgWidth) / canvas.width;
        
        pdf.addImage(imgData, 'JPEG', 0, 0, imgWidth, imgHeight);
      }

      const pdfBlob = pdf.output('blob');
      const fileName = `lista-precos-${new Date().getTime()}.pdf`;
      const file = new File([pdfBlob], fileName, { type: 'application/pdf' });

      // Check if sharing is supported
      if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({
            files: [file],
            title: 'Lista de Preços',
            text: 'Segue nossa lista de preços atualizada.'
          });
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
            className="w-full pl-12 pr-12 py-3 bg-white border border-neutral-200 rounded-2xl shadow-sm focus:ring-2 focus:ring-orange-500 outline-none transition-all"
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
              className="w-full pl-12 pr-10 py-3 bg-white border border-neutral-200 rounded-2xl shadow-sm focus:ring-2 focus:ring-orange-500 outline-none transition-all appearance-none font-bold text-neutral-700"
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
        <div className="bg-white rounded-2xl border border-neutral-200 shadow-sm overflow-hidden animate-in fade-in slide-in-from-top-4 duration-300">
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

      <div className="bg-white rounded-2xl border border-neutral-200 shadow-sm overflow-hidden flex-1">
        <div className="divide-y divide-neutral-100">
          {filteredProdutos.length > 0 ? (
            filteredProdutos.map((produto) => (
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
                <div className="flex items-center gap-6">
                  <div className="text-right">
                    <p className="text-[10px] text-neutral-400 uppercase font-bold">Sugestão</p>
                    <p className="text-sm font-bold text-neutral-500">
                      R$ {(produto.sugestao || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-neutral-400 uppercase font-bold">Preço Unitário</p>
                    <p className="text-lg font-black text-neutral-900">
                      R$ {(selectedClient !== 'all' 
                        ? (clientLastPrices[produto.id] || clientLastPricesByName[produto.produto?.toLowerCase() || ''] || 0)
                        : ((produto.custo_und || 0) * (1 - (produto[selectedTable] || 0)))
                      ).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </p>
                  </div>
                </div>
              </div>
            ))
          ) : (
            <div className="p-12 text-center text-neutral-400">
              <p>Nenhum produto encontrado</p>
            </div>
          )}
        </div>
      </div>

      {/* Hidden Export Area - Professional A4 Format */}
      <div className="fixed -left-[9999px] top-0" ref={exportRef}>
        {(() => {
          const itemsPerPage = 18;
          const chunks = [];
          for (let i = 0; i < selectedProductsList.length; i += itemsPerPage) {
            chunks.push(selectedProductsList.slice(i, i + itemsPerPage));
          }

          return chunks.map((chunk, pageIdx) => (
            <div 
              key={pageIdx}
              className="pdf-page w-[800px] h-[1130px] bg-[#ffffff] p-[40px] flex flex-col font-sans text-[#171717] mb-10"
              style={{ fontFamily: 'Arial, sans-serif' }}
            >
              {/* Header */}
              <div className="flex justify-between items-start border-b-2 border-[#262626] pb-6 mb-8">
                <div className="flex flex-col">
                  <h1 className="text-3xl font-black uppercase tracking-tighter text-[#171717]">Lista de Preços</h1>
                  <div className="mt-2 space-y-1">
                    <p className="text-sm font-bold text-[#737373]">Tabela: {selectedTable.toUpperCase()}</p>
                    <p className="text-sm font-bold text-[#737373]">Data: {new Date().toLocaleDateString('pt-BR')}</p>
                  </div>
                </div>
                <div className="flex flex-col items-end">
                  <img 
                    src="https://www.adimax.com.br/wp-content/themes/adimax/assets/img/logo-adimax.png" 
                    alt="ADIMAX" 
                    className="h-12 w-auto mb-2"
                    crossOrigin="anonymous"
                    referrerPolicy="no-referrer"
                  />
                  <span className="text-[8px] font-black text-[#a3a3a3] uppercase tracking-widest">Parceiro Oficial</span>
                </div>
              </div>

              {/* Table */}
              <div className="flex-1">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="bg-[#171717] text-[#ffffff]">
                      <th className="py-3 px-4 text-left text-[10px] font-black uppercase tracking-widest rounded-tl-lg">Produto</th>
                      <th className="py-3 px-4 text-right text-[10px] font-black uppercase tracking-widest">Sugestão</th>
                      <th className="py-3 px-4 text-right text-[10px] font-black uppercase tracking-widest rounded-tr-lg">Preço Unitário</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#f5f5f5]">
                    {chunk.map((p, idx) => {
                      const price = selectedClient !== 'all'
                        ? (clientLastPrices[p.id] || clientLastPricesByName[p.produto?.toLowerCase() || ''] || 0)
                        : ((p.custo_und || 0) * (1 - (p[selectedTable] || 0)));
                      
                      return (
                        <tr key={p.id} className={cn("text-sm", idx % 2 === 0 ? "bg-[#ffffff]" : "bg-[#fafafa]")}>
                          <td className="py-4 px-4 font-bold text-[#262626] leading-tight break-words">
                            {p.produto}
                          </td>
                          <td className="py-4 px-4 text-right font-bold text-[#a3a3a3]">
                            R$ {(p.sugestao || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </td>
                          <td className="py-4 px-4 text-right font-black text-[#171717] text-lg">
                            R$ {price.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Footer */}
              <div className="mt-12 pt-8 border-t border-[#f5f5f5] text-center">
                <p className="text-[10px] font-bold text-[#a3a3a3] mt-2 italic uppercase tracking-wider">Preços sujeitos a alteração sem aviso prévio. Este documento não possui validade fiscal.</p>
                <p className="text-[10px] font-black text-[#d4d4d4] uppercase tracking-[0.3em] mt-4">MAICON OLIVEIRA REPRESENTAÇÕES</p>
                <p className="text-[10px] font-bold text-[#a3a3a3] mt-4">Página {pageIdx + 1} de {chunks.length}</p>
              </div>
            </div>
          ));
        })()}
      </div>
    </div>
  );
}
