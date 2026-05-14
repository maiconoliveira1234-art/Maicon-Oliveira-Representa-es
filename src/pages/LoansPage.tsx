import React, { useState, useEffect, useMemo } from 'react';
import { 
  ArrowLeftRight, 
  Plus, 
  Minus,
  Search, 
  Filter, 
  Download, 
  ChevronDown, 
  ChevronUp, 
  CheckCircle2, 
  Clock, 
  Trash2, 
  X,
  Calendar,
  AlertCircle,
  FileDown
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { Cliente, Produto, Emprestimo } from '../types';
import { cn, formatWeight } from '../lib/utils';
import { format, parseISO, differenceInDays } from 'date-fns';
import { motion, AnimatePresence } from 'motion/react';
import { useDataManager } from '../lib/dataManager';
import { jsPDF } from 'jspdf';
import 'jspdf-autotable';

export function LoansPage() {
  const { clientes: clients = [], produtos: allProducts = [] } = useDataManager();
  const [emprestimos, setEmprestimos] = useState<Emprestimo[]>([]);
  const [loading, setLoading] = useState(true);
  const [showPaid, setShowPaid] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  
  // Modal Active Field States
  const [activeField, setActiveField] = useState<'origem' | 'destino' | 'produto' | null>(null);
  const [searchOrigem, setSearchOrigem] = useState('');
  const [searchDestino, setSearchDestino] = useState('');
  const [searchProduto, setSearchProduto] = useState('');
  const [selectedFamilia, setSelectedFamilia] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(-1);

  // Form State
  const [form, setForm] = useState({
    cliente_origem_id: '',
    cliente_destino_id: '',
    produto_id: '',
    quantidade: '',
    data_emprestimo: format(new Date(), 'yyyy-MM-dd')
  });

  // Selected names for display
  const selectedOrigemName = useMemo(() => 
    clients.find(c => c.id === form.cliente_origem_id)?.cliente || '', 
  [clients, form.cliente_origem_id]);

  const selectedDestinoName = useMemo(() => 
    clients.find(c => c.id === form.cliente_destino_id)?.cliente || '', 
  [clients, form.cliente_destino_id]);

  const selectedProductName = useMemo(() => 
    allProducts.find(p => p.id === form.produto_id)?.produto || '', 
  [allProducts, form.produto_id]);

  // Families
  const familias = useMemo(() => {
    const unique = new Set(allProducts.map(p => p.familia).filter(Boolean));
    return Array.from(unique).sort();
  }, [allProducts]);

  // Filtered Options for Modal
  const filteredOrigemClients = useMemo(() => {
    return clients
      .filter(c => {
        const matchesSearch = c.cliente.toLowerCase().includes(searchOrigem.toLowerCase());
        const matchesStatus = showInactive || c.status === 'ativo';
        return matchesSearch && matchesStatus;
      })
      .slice(0, 10);
  }, [clients, searchOrigem, showInactive]);

  const filteredDestinoClients = useMemo(() => {
    return clients
      .filter(c => {
        const matchesSearch = c.cliente.toLowerCase().includes(searchDestino.toLowerCase());
        const matchesStatus = showInactive || c.status === 'ativo';
        return matchesSearch && matchesStatus;
      })
      .slice(0, 10);
  }, [clients, searchDestino, showInactive]);

  const filteredProducts = useMemo(() => {
    return allProducts.filter(p => {
      const matchesFamilia = !selectedFamilia || p.familia === selectedFamilia;
      const matchesSearch = p.produto.toLowerCase().includes(searchProduto.toLowerCase());
      return matchesFamilia && matchesSearch;
    }).slice(0, 10);
  }, [allProducts, selectedFamilia, searchProduto]);
  
  // Sort State
  const [sortField, setSortField] = useState<'data_emprestimo' | 'quantidade'>('data_emprestimo');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  const handleKeyDown = (e: React.KeyboardEvent, field: 'origem' | 'destino' | 'produto', options: any[]) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setFocusedIndex(prev => Math.min(prev + 1, options.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setFocusedIndex(prev => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (focusedIndex >= 0 && focusedIndex < options.length) {
        const selected = options[focusedIndex];
        if (field === 'origem') {
          setForm({...form, cliente_origem_id: selected.id});
          setSearchOrigem('');
        } else if (field === 'destino') {
          setForm({...form, cliente_destino_id: selected.id});
          setSearchDestino('');
        } else {
          setForm({...form, produto_id: selected.id});
          setSearchProduto('');
        }
        setActiveField(null);
        setFocusedIndex(-1);
      }
    } else if (e.key === 'Escape') {
      setActiveField(null);
      setFocusedIndex(-1);
    }
  };

  const adjustQuantity = (amount: number) => {
    const current = parseFloat(form.quantidade) || 0;
    const next = Math.max(0, current + amount);
    setForm({ ...form, quantidade: next.toString() });
  };

  useEffect(() => {
    fetchLoans();
  }, []);

  async function fetchLoans() {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('emprestimos')
        .select(`
          *,
          cliente_origem:clientes!cliente_origem_id(cliente),
          cliente_destino:clientes!cliente_destino_id(cliente),
          produto:produtos!produto_id(produto)
        `);

      if (error) throw error;

      const formatted = (data || []).map((item: any) => ({
        ...item,
        cliente_origem_nome: item.cliente_origem?.cliente || 'N/A',
        cliente_destino_nome: item.cliente_destino?.cliente || 'N/A',
        produto_nome: item.produto?.produto || 'N/A'
      }));

      setEmprestimos(formatted);
    } catch (err) {
      console.error('Erro ao carregar empréstimos:', err);
    } finally {
      setLoading(false);
    }
  }

  const filteredLoans = useMemo(() => {
    return emprestimos
      .filter(l => {
        const matchesStatus = showPaid || l.status === 'pendente';
        const matchesSearch = 
          l.cliente_origem_nome?.toLowerCase().includes(searchTerm.toLowerCase()) ||
          l.cliente_destino_nome?.toLowerCase().includes(searchTerm.toLowerCase()) ||
          l.produto_nome?.toLowerCase().includes(searchTerm.toLowerCase());
        return matchesStatus && matchesSearch;
      })
      .sort((a, b) => {
        const factor = sortOrder === 'asc' ? 1 : -1;
        if (sortField === 'data_emprestimo') {
          return (new Date(a.data_emprestimo).getTime() - new Date(b.data_emprestimo).getTime()) * factor;
        }
        return (a.quantidade - b.quantidade) * factor;
      });
  }, [emprestimos, showPaid, searchTerm, sortField, sortOrder]);

  const toggleSort = (field: 'data_emprestimo' | 'quantidade') => {
    if (sortField === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('desc');
    }
  };

  async function handleAddLoan() {
    try {
      if (!form.cliente_origem_id || !form.cliente_destino_id || !form.produto_id || !form.quantidade) {
        alert('Preencha todos os campos');
        return;
      }

      const { data, error } = await supabase
        .from('emprestimos')
        .insert([{
          cliente_origem_id: form.cliente_origem_id,
          cliente_destino_id: form.cliente_destino_id,
          produto_id: form.produto_id,
          quantidade: parseFloat(form.quantidade),
          data_emprestimo: form.data_emprestimo,
          status: 'pendente'
        }])
        .select();

      if (error) throw error;

      setIsModalOpen(false);
      setForm({
        cliente_origem_id: '',
        cliente_destino_id: '',
        produto_id: '',
        quantidade: '',
        data_emprestimo: format(new Date(), 'yyyy-MM-dd')
      });
      // Reset searches
      setSearchOrigem('');
      setSearchDestino('');
      setSearchProduto('');
      setSelectedFamilia('');
      
      fetchLoans();
    } catch (err) {
      console.error('Erro ao adicionar empréstimo:', err);
    }
  }

  async function toggleStatus(loan: Emprestimo) {
    try {
      const newStatus = loan.status === 'pendente' ? 'pago' : 'pendente';
      const devDate = newStatus === 'pago' ? format(new Date(), 'yyyy-MM-dd') : null;

      const { error } = await supabase
        .from('emprestimos')
        .update({ 
          status: newStatus,
          data_devolucao: devDate
        })
        .eq('id', loan.id);

      if (error) throw error;
      fetchLoans();
    } catch (err) {
      console.error('Erro ao atualizar status:', err);
    }
  }

  async function deleteLoan(id: string) {
    if (!confirm('Deseja excluir este registro?')) return;
    try {
      const { error } = await supabase
        .from('emprestimos')
        .delete()
        .eq('id', id);

      if (error) throw error;
      fetchLoans();
    } catch (err) {
      console.error('Erro ao excluir:', err);
    }
  }

  const exportPDF = () => {
    const doc = new jsPDF() as any;
    
    doc.setFontSize(18);
    doc.text('Relatório de Empréstimos de Mercadoria', 14, 20);
    
    doc.setFontSize(10);
    doc.text(`Gerado em: ${format(new Date(), 'dd/MM/yyyy HH:mm')}`, 14, 28);

    const tableData = filteredLoans.map(l => [
      format(parseISO(l.data_emprestimo), 'dd/MM/yyyy'),
      l.cliente_origem_nome,
      l.cliente_destino_nome,
      l.produto_nome,
      l.quantidade,
      l.status.toUpperCase(),
      l.data_devolucao ? format(parseISO(l.data_devolucao), 'dd/MM/yyyy') : '-'
    ]);

    doc.autoTable({
      startY: 35,
      head: [['Data', 'Origem', 'Destino', 'Produto', 'Qtd', 'Status', 'Devolução']],
      body: tableData,
      theme: 'grid',
      headStyles: { fillColor: [249, 115, 22] }, // Orange-500
      styles: { fontSize: 8 }
    });

    doc.save(`emprestimos_${format(new Date(), 'yyyyMMdd')}.pdf`);
  };

  return (
    <div className="space-y-6 pb-24">
      <header className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-black text-neutral-900 flex items-center gap-2">
            <ArrowLeftRight className="text-orange-600" size={32} />
            Controle de Empréstimos
          </h1>
          <p className="text-sm font-bold text-neutral-400 uppercase tracking-widest mt-1">Gestão de mercadorias entre clientes</p>
        </div>
        
        <div className="flex gap-2 w-full sm:w-auto">
          <button 
            onClick={exportPDF}
            className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2.5 bg-white border border-neutral-200 text-neutral-600 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-neutral-50 transition-all shadow-sm"
          >
            <FileDown size={18} />
            PDF
          </button>
          <button 
            onClick={() => setIsModalOpen(true)}
            className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2.5 bg-orange-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-orange-700 transition-all shadow-lg shadow-orange-600/20 active:scale-95"
          >
            <Plus size={18} />
            Novo Registro
          </button>
        </div>
      </header>

      {/* Filters Bar */}
      <div className="bg-white p-4 rounded-3xl border border-neutral-200 shadow-sm space-y-4">
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1 relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-neutral-400" size={18} />
            <input 
              type="text" 
              placeholder="Buscar por cliente ou produto..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-11 pr-4 py-3 bg-neutral-50 border border-neutral-200 rounded-2xl text-sm font-bold text-neutral-900 placeholder:text-neutral-400 focus:border-orange-500 outline-none transition-all"
            />
          </div>
          
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 cursor-pointer group">
              <div 
                onClick={() => setShowPaid(!showPaid)}
                className={cn(
                  "w-12 h-6 rounded-full transition-all relative",
                  showPaid ? "bg-orange-600" : "bg-neutral-200"
                )}
              >
                <div className={cn(
                  "absolute top-1 w-4 h-4 rounded-full bg-white transition-all shadow-sm",
                  showPaid ? "left-7" : "left-1"
                )} />
              </div>
              <span className="text-xs font-black text-neutral-500 uppercase tracking-widest group-hover:text-neutral-900">Mostrar Pagos</span>
            </label>
          </div>
        </div>
      </div>

      {/* Loans Table */}
      <div className="bg-white rounded-3xl border border-neutral-200 shadow-sm overflow-hidden overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-neutral-50 border-b border-neutral-100">
              <th 
                onClick={() => toggleSort('data_emprestimo')}
                className="p-4 text-[10px] font-black text-neutral-400 uppercase tracking-widest cursor-pointer hover:text-orange-600 transition-colors"
              >
                <div className="flex items-center gap-1">
                  Data
                  {sortField === 'data_emprestimo' && (sortOrder === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />)}
                </div>
              </th>
              <th className="p-4 text-[10px] font-black text-neutral-400 uppercase tracking-widest">Origem</th>
              <th className="p-4 text-[10px] font-black text-neutral-400 uppercase tracking-widest">Destino</th>
              <th className="p-4 text-[10px] font-black text-neutral-400 uppercase tracking-widest">Mercadoria</th>
              <th 
                onClick={() => toggleSort('quantidade')}
                className="p-4 text-[10px] font-black text-neutral-400 uppercase tracking-widest cursor-pointer hover:text-orange-600 transition-colors"
              >
                <div className="flex items-center gap-1">
                  Qtd
                  {sortField === 'quantidade' && (sortOrder === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />)}
                </div>
              </th>
              <th className="p-4 text-[10px] font-black text-neutral-400 uppercase tracking-widest">Status</th>
              <th className="p-4 text-right"></th>
            </tr>
          </thead>
          <tbody>
            <AnimatePresence mode="popLayout">
              {loading ? (
                <tr>
                  <td colSpan={7} className="p-12 text-center text-neutral-400 animate-pulse font-black uppercase text-xs tracking-widest">Carregando...</td>
                </tr>
              ) : filteredLoans.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-20 text-center">
                    <div className="flex flex-col items-center gap-3">
                      <div className="w-16 h-16 bg-neutral-50 rounded-full flex items-center justify-center text-neutral-200">
                        <ArrowLeftRight size={32} />
                      </div>
                      <p className="text-sm font-black text-neutral-300 uppercase tracking-widest">Nenhum empréstimo encontrado</p>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredLoans.map((loan) => {
                  const daysSince = differenceInDays(new Date(), parseISO(loan.data_emprestimo));
                  return (
                    <motion.tr 
                      key={loan.id}
                      layout
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className={cn(
                        "border-b border-neutral-50 last:border-0 hover:bg-neutral-50/50 transition-colors",
                        loan.status === 'pago' && "opacity-50"
                      )}
                    >
                      <td className="p-4">
                        <div className="text-sm font-bold text-neutral-900">{format(parseISO(loan.data_emprestimo), 'dd/MM/yyyy')}</div>
                        {loan.status === 'pendente' && (
                          <div className={cn(
                            "text-[9px] font-black uppercase tracking-tighter mt-0.5",
                            daysSince >= 30 ? "text-rose-600" : daysSince >= 10 ? "text-orange-600" : "text-neutral-400"
                          )}>
                            Há {daysSince} dias
                          </div>
                        )}
                      </td>
                      <td className="p-4">
                        <div className="text-sm font-bold text-neutral-900">{loan.cliente_origem_nome}</div>
                        <div className="text-[10px] font-bold text-neutral-400 uppercase tracking-tight">Cedeu</div>
                      </td>
                      <td className="p-4">
                        <div className="text-sm font-bold text-neutral-900">{loan.cliente_destino_nome}</div>
                        <div className="text-[10px] font-bold text-neutral-400 uppercase tracking-tight">Recebeu</div>
                      </td>
                      <td className="p-4">
                        <div className="text-sm font-bold text-neutral-900">{loan.produto_nome}</div>
                      </td>
                      <td className="p-4">
                        <div className="text-sm font-black text-neutral-900">{loan.quantidade}</div>
                      </td>
                      <td className="p-4">
                        <button 
                          onClick={() => toggleStatus(loan)}
                          className={cn(
                            "px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-widest flex items-center gap-1.5 border transition-all",
                            loan.status === 'pago' 
                              ? "bg-emerald-50 text-emerald-600 border-emerald-100" 
                              : "bg-amber-50 text-amber-600 border-amber-100"
                          )}
                        >
                          {loan.status === 'pago' ? <CheckCircle2 size={12} /> : <Clock size={12} />}
                          {loan.status === 'pago' ? 'Pago' : 'Pendente'}
                        </button>
                        {loan.data_devolucao && (
                          <div className="text-[8px] font-bold text-neutral-400 mt-1 uppercase">
                            Pago em {format(parseISO(loan.data_devolucao), 'dd/MM/yyyy')}
                          </div>
                        )}
                      </td>
                      <td className="p-4 text-right">
                        <button 
                          onClick={() => deleteLoan(loan.id)}
                          className="p-2 text-neutral-300 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-all"
                        >
                          <Trash2 size={16} />
                        </button>
                      </td>
                    </motion.tr>
                  );
                })
              )}
            </AnimatePresence>
          </tbody>
        </table>
      </div>

      {/* Add Modal */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white w-full max-w-lg rounded-[2.5rem] shadow-2xl overflow-hidden"
            >
              <div className="p-6 border-b border-neutral-100 flex justify-between items-center bg-neutral-50/50">
                <div>
                  <h3 className="text-xl font-black text-neutral-900">Novo Empréstimo</h3>
                  <p className="text-[10px] font-black text-neutral-400 uppercase tracking-widest mt-1">Lançamento de movimentação</p>
                </div>
                <button 
                  onClick={() => {
                    setIsModalOpen(false);
                    setSearchOrigem('');
                    setSearchDestino('');
                    setSearchProduto('');
                    setSelectedFamilia('');
                  }} 
                  className="p-2 hover:bg-neutral-200 rounded-full transition-colors transition-all"
                >
                  <X size={24} className="text-neutral-400" />
                </button>
              </div>

                <div className="px-8 flex items-center gap-2">
                  <label className="flex items-center gap-2 cursor-pointer group">
                    <input 
                      type="checkbox" 
                      className="hidden"
                      checked={showInactive}
                      onChange={() => setShowInactive(!showInactive)}
                    />
                    <div className={cn(
                      "w-4 h-4 rounded border flex items-center justify-center transition-all",
                      showInactive ? "bg-orange-600 border-orange-600" : "bg-neutral-50 border-neutral-300"
                    )}>
                      {showInactive && <CheckCircle2 size={10} className="text-white" />}
                    </div>
                    <span className="text-[10px] font-black text-neutral-400 uppercase tracking-widest group-hover:text-orange-600 transition-colors">Exibir Inativos</span>
                  </label>
                </div>

                <div className="p-8 space-y-6 pt-2">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Origin Client */}
                    <div className="space-y-2 relative">
                      <label className="text-[10px] font-black text-neutral-400 uppercase tracking-widest ml-1">Quem Emprestou?</label>
                      <button 
                        onClick={() => {
                          setActiveField(activeField === 'origem' ? null : 'origem');
                          setFocusedIndex(-1);
                        }}
                        className={cn(
                          "w-full flex items-center justify-between px-4 py-3 bg-neutral-50 border border-neutral-200 rounded-2xl text-left transition-all",
                          activeField === 'origem' ? "border-orange-500 ring-4 ring-orange-500/10" : "hover:border-neutral-300"
                        )}
                      >
                        <span className={cn("text-sm font-bold truncate", !selectedOrigemName && "text-neutral-400")}>
                          {selectedOrigemName || "Selecionar cliente..."}
                        </span>
                        <ChevronDown size={16} className={cn("text-neutral-400 transition-transform", activeField === 'origem' && "rotate-180")} />
                      </button>

                      <AnimatePresence>
                        {activeField === 'origem' && (
                          <motion.div 
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: 10 }}
                            className="absolute z-20 top-full left-0 right-0 mt-2 bg-white border border-neutral-200 rounded-2xl shadow-xl overflow-hidden"
                          >
                            <div className="p-2 border-b border-neutral-50">
                              <div className="relative">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" size={14} />
                                <input 
                                  autoFocus
                                  type="text"
                                  placeholder="Buscar cliente..."
                                  value={searchOrigem}
                                  onChange={(e) => {
                                    setSearchOrigem(e.target.value);
                                    setFocusedIndex(-1);
                                  }}
                                  onKeyDown={(e) => handleKeyDown(e, 'origem', filteredOrigemClients)}
                                  className="w-full bg-neutral-50 border-none rounded-xl pl-9 pr-3 py-2 text-xs font-bold text-neutral-900 outline-none"
                                />
                              </div>
                            </div>
                            <div className="max-h-48 overflow-y-auto p-1">
                              {filteredOrigemClients.length === 0 ? (
                                <div className="p-3 text-center text-[10px] font-bold text-neutral-400 uppercase tracking-widest">Nenhum cliente</div>
                              ) : filteredOrigemClients.map((c, idx) => (
                                <button
                                  key={c.id}
                                  onMouseEnter={() => setFocusedIndex(idx)}
                                  onClick={() => {
                                    setForm({...form, cliente_origem_id: c.id});
                                    setActiveField(null);
                                    setSearchOrigem('');
                                    setFocusedIndex(-1);
                                  }}
                                  className={cn(
                                    "w-full text-left px-3 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center justify-between",
                                    focusedIndex === idx 
                                      ? "bg-orange-50 text-orange-600" 
                                      : "text-neutral-600 hover:bg-neutral-50"
                                  )}
                                >
                                  <span>{c.cliente}</span>
                                  {c.status === 'inativo' && (
                                    <span className="text-[8px] bg-neutral-100 px-1.5 py-0.5 rounded text-neutral-400">INATIVO</span>
                                  )}
                                </button>
                              ))}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>

                    {/* Destination Client */}
                    <div className="space-y-2 relative">
                      <label className="text-[10px] font-black text-neutral-400 uppercase tracking-widest ml-1">Quem Recebeu?</label>
                      <button 
                        onClick={() => {
                          setActiveField(activeField === 'destino' ? null : 'destino');
                          setFocusedIndex(-1);
                        }}
                        className={cn(
                          "w-full flex items-center justify-between px-4 py-3 bg-neutral-50 border border-neutral-200 rounded-2xl text-left transition-all",
                          activeField === 'destino' ? "border-orange-500 ring-4 ring-orange-500/10" : "hover:border-neutral-300"
                        )}
                      >
                        <span className={cn("text-sm font-bold truncate", !selectedDestinoName && "text-neutral-400")}>
                          {selectedDestinoName || "Selecionar cliente..."}
                        </span>
                        <ChevronDown size={16} className={cn("text-neutral-400 transition-transform", activeField === 'destino' && "rotate-180")} />
                      </button>

                      <AnimatePresence>
                        {activeField === 'destino' && (
                          <motion.div 
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: 10 }}
                            className="absolute z-20 top-full left-0 right-0 mt-2 bg-white border border-neutral-200 rounded-2xl shadow-xl overflow-hidden"
                          >
                            <div className="p-2 border-b border-neutral-50">
                              <div className="relative">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" size={14} />
                                <input 
                                  autoFocus
                                  type="text"
                                  placeholder="Buscar cliente..."
                                  value={searchDestino}
                                  onChange={(e) => {
                                    setSearchDestino(e.target.value);
                                    setFocusedIndex(-1);
                                  }}
                                  onKeyDown={(e) => handleKeyDown(e, 'destino', filteredDestinoClients)}
                                  className="w-full bg-neutral-50 border-none rounded-xl pl-9 pr-3 py-2 text-xs font-bold text-neutral-900 outline-none"
                                />
                              </div>
                            </div>
                            <div className="max-h-48 overflow-y-auto p-1">
                              {filteredDestinoClients.length === 0 ? (
                                <div className="p-3 text-center text-[10px] font-bold text-neutral-400 uppercase tracking-widest">Nenhum cliente</div>
                              ) : filteredDestinoClients.map((c, idx) => (
                                <button
                                  key={c.id}
                                  onMouseEnter={() => setFocusedIndex(idx)}
                                  onClick={() => {
                                    setForm({...form, cliente_destino_id: c.id});
                                    setActiveField(null);
                                    setSearchDestino('');
                                    setFocusedIndex(-1);
                                  }}
                                  className={cn(
                                    "w-full text-left px-3 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center justify-between",
                                    focusedIndex === idx 
                                      ? "bg-orange-50 text-orange-600" 
                                      : "text-neutral-600 hover:bg-neutral-50"
                                  )}
                                >
                                  <span>{c.cliente}</span>
                                  {c.status === 'inativo' && (
                                    <span className="text-[8px] bg-neutral-100 px-1.5 py-0.5 rounded text-neutral-400">INATIVO</span>
                                  )}
                                </button>
                              ))}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  </div>

                {/* Product Selection */}
                <div className="space-y-4 pt-2">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-end">
                    <div className="space-y-2">
                      <label className="text-[10px] font-black text-neutral-400 uppercase tracking-widest ml-1">Família (Filtro)</label>
                      <select 
                        value={selectedFamilia}
                        onChange={(e) => setSelectedFamilia(e.target.value)}
                        className="w-full bg-neutral-50 border border-neutral-200 rounded-2xl p-3 text-sm font-bold text-neutral-900 outline-none focus:border-orange-500 transition-all"
                      >
                        <option value="">Todas as famílias</option>
                        {familias.map(f => <option key={f} value={f}>{f}</option>)}
                      </select>
                    </div>

                    <div className="space-y-2 relative">
                      <label className="text-[10px] font-black text-neutral-400 uppercase tracking-widest ml-1">Mercadoria</label>
                      <button 
                        onClick={() => {
                          setActiveField(activeField === 'produto' ? null : 'produto');
                          setFocusedIndex(-1);
                        }}
                        className={cn(
                          "w-full flex items-center justify-between px-4 py-3 bg-neutral-50 border border-neutral-200 rounded-2xl text-left transition-all",
                          activeField === 'produto' ? "border-orange-500 ring-4 ring-orange-500/10" : "hover:border-neutral-300"
                        )}
                      >
                        <span className={cn("text-sm font-bold truncate", !selectedProductName && "text-neutral-400")}>
                          {selectedProductName || "Selecionar produto..."}
                        </span>
                        <ChevronDown size={16} className={cn("text-neutral-400 transition-transform", activeField === 'produto' && "rotate-180")} />
                      </button>

                      <AnimatePresence>
                        {activeField === 'produto' && (
                          <motion.div 
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: 10 }}
                            className="absolute z-20 top-full left-0 right-0 mt-2 bg-white border border-neutral-200 rounded-2xl shadow-xl overflow-hidden"
                          >
                            <div className="p-2 border-b border-neutral-50">
                              <div className="relative">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" size={14} />
                                <input 
                                  autoFocus
                                  type="text"
                                  placeholder="Buscar mercadoria..."
                                  value={searchProduto}
                                  onChange={(e) => {
                                    setSearchProduto(e.target.value);
                                    setFocusedIndex(-1);
                                  }}
                                  onKeyDown={(e) => handleKeyDown(e, 'produto', filteredProducts)}
                                  className="w-full bg-neutral-50 border-none rounded-xl pl-9 pr-3 py-2 text-xs font-bold text-neutral-900 outline-none"
                                />
                              </div>
                            </div>
                            <div className="max-h-48 overflow-y-auto p-1">
                              {filteredProducts.length === 0 ? (
                                <div className="p-3 text-center text-[10px] font-bold text-neutral-400 uppercase tracking-widest">Nenhum produto</div>
                              ) : filteredProducts.map((p, idx) => (
                                <button
                                  key={p.id}
                                  onMouseEnter={() => setFocusedIndex(idx)}
                                  onClick={() => {
                                    setForm({...form, produto_id: p.id});
                                    setActiveField(null);
                                    setSearchProduto('');
                                    setFocusedIndex(-1);
                                  }}
                                  className={cn(
                                    "w-full text-left px-3 py-2.5 rounded-xl text-xs font-bold transition-all",
                                    focusedIndex === idx 
                                      ? "bg-orange-50 text-orange-600" 
                                      : "text-neutral-600 hover:bg-neutral-50"
                                  )}
                                >
                                  {p.produto}
                                </button>
                              ))}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-6 pt-2 border-t border-dashed border-neutral-100">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black text-neutral-400 uppercase tracking-widest ml-1">Quantidade</label>
                    <div className="flex items-center bg-neutral-50 border border-neutral-200 rounded-2xl p-1 h-11 transition-all focus-within:border-orange-500">
                      <button 
                        onClick={() => adjustQuantity(-1)}
                        className="w-9 h-full flex items-center justify-center text-neutral-400 hover:text-orange-600 hover:bg-orange-50 rounded-xl transition-all"
                      >
                        <Minus size={18} />
                      </button>
                      <input 
                        type="number"
                        value={form.quantidade}
                        onChange={(e) => setForm({...form, quantidade: e.target.value})}
                        placeholder="0"
                        className="flex-1 bg-transparent text-center text-sm font-black text-neutral-900 outline-none placeholder:text-neutral-300"
                      />
                      <button 
                        onClick={() => adjustQuantity(1)}
                        className="w-9 h-full flex items-center justify-center text-neutral-400 hover:text-orange-600 hover:bg-orange-50 rounded-xl transition-all"
                      >
                        <Plus size={18} />
                      </button>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black text-neutral-400 uppercase tracking-widest ml-1">Data</label>
                    <input 
                      type="date"
                      value={form.data_emprestimo}
                      onChange={(e) => setForm({...form, data_emprestimo: e.target.value})}
                      className="w-full bg-neutral-50 border border-neutral-200 rounded-2xl p-3 text-sm font-bold text-neutral-900 outline-none focus:border-orange-500 transition-all h-11"
                    />
                  </div>
                </div>

                <button 
                  onClick={handleAddLoan}
                  className="w-full bg-orange-600 text-white p-4 rounded-2xl font-black text-sm uppercase tracking-widest shadow-xl shadow-orange-600/20 hover:bg-orange-700 transition-all active:scale-[0.98] mt-4"
                >
                  Registrar Empréstimo
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
