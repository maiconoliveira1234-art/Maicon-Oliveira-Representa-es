import React, { useState, useEffect, useMemo, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { Produto, PrecoFaixa } from '../types';
import { Loader2, Search, Filter, Download, CheckSquare, Square, XCircle } from 'lucide-react';
import { cn } from '../lib/utils';
import { toJpeg } from 'html-to-image';

export function PriceInquiryPage() {
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedFamily, setSelectedFamily] = useState<string>('all');
  const [selectedTable, setSelectedTable] = useState<PrecoFaixa>('livre');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);
  const exportRef = useRef<HTMLDivElement>(null);

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
  }, []);

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
      return matchesSearch && matchesFamily;
    });
  }, [produtos, searchTerm, selectedFamily]);

  const toggleSelect = (id: string) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedIds(newSelected);
  };

  const deselectAll = () => {
    setSelectedIds(new Set());
  };

  const handleExport = async () => {
    if (selectedIds.size === 0) {
      alert('Selecione ao menos um produto para exportar.');
      return;
    }

    if (!exportRef.current) return;

    setExporting(true);
    try {
      const dataUrl = await toJpeg(exportRef.current, { quality: 0.95, backgroundColor: '#fff' });
      
      // Convert dataUrl to a File object for sharing
      const res = await fetch(dataUrl);
      const blob = await res.blob();
      const file = new File([blob], `lista-precos-${new Date().getTime()}.jpeg`, { type: 'image/jpeg' });

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
            triggerDownload(dataUrl);
          }
        }
      } else {
        // Fallback to download if sharing is not supported
        triggerDownload(dataUrl);
      }
    } catch (err) {
      console.error('Erro ao exportar imagem:', err);
      alert('Erro ao exportar imagem. Tente novamente.');
    } finally {
      setExporting(false);
    }
  };

  const triggerDownload = (dataUrl: string) => {
    const link = document.createElement('a');
    link.download = `lista-precos-${new Date().getTime()}.jpeg`;
    link.href = dataUrl;
    link.click();
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
          <h1 className="text-2xl font-black text-neutral-900">Consulta de Preço</h1>
          <p className="text-neutral-500 text-sm">Gere listas de preços para seus clientes</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={deselectAll}
            className="px-4 py-2 bg-white border border-neutral-200 text-neutral-600 rounded-xl font-bold hover:bg-neutral-50 transition-all flex items-center gap-2"
          >
            <XCircle size={18} />
            Desmarcar Todos
          </button>
          <button
            onClick={handleExport}
            disabled={exporting}
            className="px-4 py-2 bg-orange-600 text-white rounded-xl font-bold hover:bg-orange-700 transition-all flex items-center gap-2 shadow-lg shadow-orange-200 disabled:opacity-50"
          >
            {exporting ? <Loader2 className="animate-spin" size={18} /> : <Download size={18} />}
            Exportar / Enviar
          </button>
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-neutral-400" size={20} />
          <input
            type="text"
            placeholder="Buscar produto..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-12 pr-4 py-3 bg-white border border-neutral-200 rounded-2xl shadow-sm focus:ring-2 focus:ring-orange-500 outline-none transition-all"
          />
        </div>
        <div className="relative">
          <Filter className="absolute left-4 top-1/2 -translate-y-1/2 text-neutral-400" size={20} />
          <select
            value={selectedFamily}
            onChange={(e) => {
              setSelectedFamily(e.target.value);
              setSearchTerm('');
            }}
            className="w-full pl-12 pr-4 py-3 bg-white border border-neutral-200 rounded-2xl shadow-sm focus:ring-2 focus:ring-orange-500 outline-none transition-all appearance-none"
          >
            <option value="all">Todas as Famílias</option>
            {families.map(f => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>
        </div>
        <div className="relative">
          <CheckSquare className="absolute left-4 top-1/2 -translate-y-1/2 text-neutral-400" size={20} />
          <select
            value={selectedTable}
            onChange={(e) => setSelectedTable(e.target.value as PrecoFaixa)}
            className="w-full pl-12 pr-4 py-3 bg-white border border-neutral-200 rounded-2xl shadow-sm focus:ring-2 focus:ring-orange-500 outline-none transition-all appearance-none"
          >
            <option value="livre">Tabela Livre</option>
            <option value="200kg">Tabela 200kg</option>
            <option value="500kg">Tabela 500kg</option>
            <option value="1000kg">Tabela 1000kg</option>
            <option value="2000kg">Tabela 2000kg</option>
            <option value="4000kg">Tabela 4000kg</option>
          </select>
        </div>
      </div>

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
                      R$ {((produto.custo_und || 0) * (1 - (produto[selectedTable] || 0))).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
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

      {/* Hidden Export Area */}
      <div className="fixed -left-[2000px] top-0">
        <div 
          ref={exportRef} 
          className="w-[800px] bg-white p-12 space-y-8"
        >
          <div className="flex items-center justify-between border-b-4 border-orange-600 pb-6">
            <div>
              <h1 className="text-4xl font-black text-neutral-900">Lista de Preços</h1>
              <p className="text-xl text-neutral-500 font-bold">Tabela: {selectedTable.toUpperCase()}</p>
            </div>
            <div className="text-right">
              <p className="text-lg font-bold text-neutral-400">{new Date().toLocaleDateString('pt-BR')}</p>
            </div>
          </div>

          <div className="space-y-2">
            {selectedProductsList.map((p) => (
              <div key={p.id} className="flex items-center justify-between py-3 border-b border-neutral-100">
                <div>
                  <h3 className="text-2xl font-black text-neutral-900">{p.produto}</h3>
                </div>
                <div className="flex items-center gap-8">
                  <div className="text-right">
                    <p className="text-sm text-neutral-400 font-bold uppercase">Sugestão</p>
                    <p className="text-xl font-bold text-neutral-400">
                      R$ {(p.sugestao || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-3xl font-black text-orange-600">
                      R$ {((p.custo_und || 0) * (1 - (p[selectedTable] || 0))).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </p>
                    <p className="text-sm text-neutral-400 font-bold uppercase">Unidade</p>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="pt-8 text-center border-t border-neutral-200">
            <p className="text-neutral-400 font-bold italic">Preços sujeitos a alteração sem aviso prévio.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
