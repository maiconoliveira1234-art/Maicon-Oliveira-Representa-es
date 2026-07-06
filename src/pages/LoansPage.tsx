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
import autoTable from 'jspdf-autotable';
import { ActionButton, PageHeader } from '../components/ui/AppChrome';

export function LoansPage() {
  const { clientes: clients = [], produtos: allProducts = [] } = useDataManager();
  const [emprestimos, setEmprestimos] = useState<Emprestimo[]>([]);
  const [loading, setLoading] = useState(true);
  const [showPaid, setShowPaid] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [loanToPay, setLoanToPay] = useState<Emprestimo | null>(null);
  const [loanToDelete, setLoanToDelete] = useState<Emprestimo | null>(null);
  
  // Refs for focusing
  const origemInputRef = React.useRef<HTMLInputElement>(null);
  const destinoInputRef = React.useRef<HTMLInputElement>(null);
  const produtoInputRef = React.useRef<HTMLInputElement>(null);
  
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
        const matchesStatus = showInactive || c.ativo;
        return matchesSearch && matchesStatus;
      });
  }, [clients, searchOrigem, showInactive]);

  const filteredDestinoClients = useMemo(() => {
    return clients
      .filter(c => {
        const matchesSearch = c.cliente.toLowerCase().includes(searchDestino.toLowerCase());
        const matchesStatus = showInactive || c.ativo;
        return matchesSearch && matchesStatus;
      });
  }, [clients, searchDestino, showInactive]);

  const filteredProducts = useMemo(() => {
    return allProducts.filter(p => {
      const matchesFamilia = !selectedFamilia || p.familia === selectedFamilia;
      const matchesSearch = p.produto.toLowerCase().includes(searchProduto.toLowerCase());
      return matchesFamilia && matchesSearch;
    });
  }, [allProducts, selectedFamilia, searchProduto]);
  
  // Sort State
  const [sortField, setSortField] = useState<'data_emprestimo' | 'quantidade' | 'origem' | 'destino' | 'produto' | 'status'>('data_emprestimo');
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
        if (sortField === 'quantidade') {
          return (a.quantidade - b.quantidade) * factor;
        }
        if (sortField === 'origem') {
          return (a.cliente_origem_nome || '').localeCompare(b.cliente_origem_nome || '') * factor;
        }
        if (sortField === 'destino') {
          return (a.cliente_destino_nome || '').localeCompare(b.cliente_destino_nome || '') * factor;
        }
        if (sortField === 'produto') {
          return (a.produto_nome || '').localeCompare(b.produto_nome || '') * factor;
        }
        if (sortField === 'status') {
          return (a.status || '').localeCompare(b.status || '') * factor;
        }
        return 0;
      });
  }, [emprestimos, showPaid, searchTerm, sortField, sortOrder]);

  const toggleSort = (field: 'data_emprestimo' | 'quantidade' | 'origem' | 'destino' | 'produto' | 'status') => {
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
    if (loan.status === 'pendente') {
      setLoanToPay(loan);
      return;
    }
    
    // For reverting to pending, we can do it directly or add another confirm
    processToggleStatus(loan);
  }

  async function processToggleStatus(loan: Emprestimo) {
    try {
      const isPaying = loan.status === 'pendente';
      const newStatus = isPaying ? 'pago' : 'pendente';
      const devDate = isPaying ? format(new Date(), 'yyyy-MM-dd') : null;

      const { error } = await supabase
        .from('emprestimos')
        .update({ 
          status: newStatus,
          data_devolucao: devDate
        })
        .eq('id', loan.id);

      if (error) throw error;
      setLoanToPay(null);
      fetchLoans();
    } catch (err) {
      console.error('Erro ao atualizar status:', err);
    }
  }

  async function deleteLoan(loan: Emprestimo) {
    setLoanToDelete(loan);
  }

  async function confirmDeleteLoan() {
    if (!loanToDelete) return;
    try {
      const { error } = await supabase
        .from('emprestimos')
        .delete()
        .eq('id', loanToDelete.id);

      if (error) throw error;
      setLoanToDelete(null);
      fetchLoans();
    } catch (err) {
      console.error('Erro ao excluir:', err);
    }
  }

  const exportPDF = () => {
    const doc = new jsPDF();
    
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

    autoTable(doc, {
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
      <PageHeader
        title="Controle de Empréstimos"
        subtitle="Gestão de mercadorias entre clientes"
        icon={<ArrowLeftRight />}
        actions={
          <>
            <ActionButton onClick={exportPDF} variant="secondary" size="sm" icon={<FileDown />}>
              PDF
            </ActionButton>
            <ActionButton onClick={() => setIsModalOpen(true)} variant="primary" size="sm" icon={<Plus />}>
              Novo Registro
            </ActionButton>
          </>
        }
      />

      {/* Filters Bar */}
      <div className="rounded-lg border border-neutral-200 bg-white p-3 shadow-sm md:p-3.5">
        <div className="flex flex-col md:flex-row gap-3 md:items-center">
          <div className="flex-1 relative group">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-neutral-400 group-focus-within:text-orange-500 transition-colors" size={20} />
            <input 
              type="text" 
              placeholder="Pesquisar por cliente, mercadoria ou data..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full rounded-lg border border-neutral-200 bg-neutral-50/70 py-3 pl-12 pr-4 text-sm font-bold text-neutral-900 outline-none transition-all placeholder:text-neutral-400 focus:border-orange-500 focus:bg-white focus:ring-2 focus:ring-orange-500/10"
            />
          </div>
          
          <div className="flex items-center gap-6 px-4 md:border-l border-neutral-100">
            <label className="flex items-center gap-3 cursor-pointer group whitespace-nowrap">
              <div 
                onClick={() => setShowPaid(!showPaid)}
                className={cn(
                  "w-11 h-6 rounded-full transition-all relative ring-4 ring-transparent group-hover:ring-neutral-50 shadow-inner",
                  showPaid ? "bg-orange-600" : "bg-neutral-200"
                )}
              >
                <div className={cn(
                  "absolute top-1 w-4 h-4 rounded-full bg-white transition-all shadow-sm",
                  showPaid ? "left-6" : "left-1"
                )} />
              </div>
              <span className="text-[10px] font-black text-neutral-500 uppercase tracking-widest group-hover:text-neutral-900 transition-colors">Exibir Finalizados</span>
            </label>
          </div>
        </div>
      </div>

      {/* Loans Table */}
      <div className="bg-white rounded-lg border border-neutral-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto custom-scrollbar">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-neutral-50/50 border-b border-neutral-100">
                <th 
                  onClick={() => toggleSort('data_emprestimo')}
                  className="p-5 text-[10px] font-black text-neutral-400 uppercase tracking-widest cursor-pointer hover:text-orange-600 transition-colors group"
                >
                  <div className="flex items-center gap-2">
                    Data
                    <div className={cn(
                      "transition-all",
                      sortField === 'data_emprestimo' ? "text-orange-600" : "opacity-0 group-hover:opacity-100"
                    )}>
                      {sortField === 'data_emprestimo' && sortOrder === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </div>
                  </div>
                </th>
                <th 
                  onClick={() => toggleSort('origem')}
                  className="p-5 text-[10px] font-black text-neutral-400 uppercase tracking-widest cursor-pointer hover:text-orange-600 transition-all group"
                >
                  <div className="flex items-center gap-2">
                    Origem
                    <div className={cn(
                      "transition-all",
                      sortField === 'origem' ? "text-orange-600" : "opacity-0 group-hover:opacity-100"
                    )}>
                      {sortField === 'origem' && sortOrder === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </div>
                  </div>
                </th>
                <th 
                  onClick={() => toggleSort('destino')}
                  className="p-5 text-[10px] font-black text-neutral-400 uppercase tracking-widest cursor-pointer hover:text-orange-600 transition-all group"
                >
                  <div className="flex items-center gap-2">
                    Destino
                    <div className={cn(
                      "transition-all",
                      sortField === 'destino' ? "text-orange-600" : "opacity-0 group-hover:opacity-100"
                    )}>
                      {sortField === 'destino' && sortOrder === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </div>
                  </div>
                </th>
                <th 
                  onClick={() => toggleSort('produto')}
                  className="p-5 text-[10px] font-black text-neutral-400 uppercase tracking-widest cursor-pointer hover:text-orange-600 transition-all group"
                >
                  <div className="flex items-center gap-2">
                    Mercadoria
                    <div className={cn(
                      "transition-all",
                      sortField === 'produto' ? "text-orange-600" : "opacity-0 group-hover:opacity-100"
                    )}>
                      {sortField === 'produto' && sortOrder === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </div>
                  </div>
                </th>
                <th 
                  onClick={() => toggleSort('quantidade')}
                  className="p-5 text-[10px] font-black text-neutral-400 uppercase tracking-widest cursor-pointer hover:text-orange-600 transition-colors group"
                >
                  <div className="flex items-center gap-2">
                    Qtd
                    <div className={cn(
                      "transition-all",
                      sortField === 'quantidade' ? "text-orange-600" : "opacity-0 group-hover:opacity-100"
                    )}>
                      {sortField === 'quantidade' && sortOrder === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </div>
                  </div>
                </th>
                <th 
                  onClick={() => toggleSort('status')}
                  className="p-5 text-[10px] font-black text-neutral-400 uppercase tracking-widest cursor-pointer hover:text-orange-600 transition-all group"
                >
                  <div className="flex items-center gap-2">
                    Status
                    <div className={cn(
                      "transition-all",
                      sortField === 'status' ? "text-orange-600" : "opacity-0 group-hover:opacity-100"
                    )}>
                      {sortField === 'status' && sortOrder === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </div>
                  </div>
                </th>
                <th className="p-5 text-right"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-50">
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
                            "px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest flex items-center gap-2 border transition-all shadow-sm active:scale-95",
                            loan.status === 'pago' 
                              ? "bg-emerald-50 text-emerald-600 border-emerald-100 hover:bg-emerald-100/50" 
                              : "bg-amber-500 text-white border-amber-600 hover:bg-amber-600 shadow-amber-500/10"
                          )}
                        >
                          {loan.status === 'pago' ? <CheckCircle2 size={13} className="stroke-[3]" /> : <Clock size={13} className="stroke-[3]" />}
                          {loan.status === 'pago' ? 'Pago' : 'Pagar'}
                        </button>
                        {loan.data_devolucao && (
                          <div className="text-[8px] font-bold text-neutral-400 mt-1.5 ml-1 uppercase tracking-tighter">
                            Devolvido em {format(parseISO(loan.data_devolucao), 'dd/MM/yyyy')}
                          </div>
                        )}
                      </td>
                      <td className="p-4 text-right">
                        <button 
                          onClick={() => deleteLoan(loan)}
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
    </div>

      {/* Add Modal */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div 
              initial={{ scale: 0.95, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 20 }}
              className="bg-white w-full max-w-xl rounded-lg md:rounded-lg shadow-2xl overflow-hidden flex flex-col max-h-[85vh] md:max-h-[85vh]"
            >
              <div className="p-5 md:p-8 border-b border-neutral-100 flex justify-between items-center bg-white shrink-0">
                <div>
                  <h3 className="text-lg md:text-2xl font-black text-neutral-900 leading-none flex items-center gap-2 md:gap-3">
                    <div className="w-8 h-8 md:w-10 md:h-10 bg-orange-50 rounded-lg flex items-center justify-center shrink-0">
                      <ArrowLeftRight className="text-orange-600" size={16} />
                    </div>
                    Novo Empréstimo
                  </h3>
                  <div className="flex items-center gap-2 mt-1.5 md:mt-2 ml-10 md:ml-[52px]">
                    <div className="w-2 h-2 bg-emerald-500 rounded-full shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                    <p className="text-[8px] md:text-[10px] font-bold text-neutral-400 uppercase tracking-widest">Painel de Registro</p>
                  </div>
                </div>
                <button 
                  onClick={() => {
                    setIsModalOpen(false);
                    setSearchOrigem('');
                    setSearchDestino('');
                    setSearchProduto('');
                    setSelectedFamilia('');
                  }} 
                  className="p-2 md:p-3.5 hover:bg-neutral-50 rounded-lg md:rounded-lg transition-all text-neutral-400 hover:text-rose-600 hover:rotate-90 group"
                >
                  <X size={18} className="group-hover:scale-110 transition-transform" />
                </button>
              </div>

              <div className="p-5 md:p-6 space-y-4 md:space-y-5 flex-1 min-h-0 overflow-y-auto custom-scrollbar">
                {/* Section: Participants */}
                <div className="space-y-4">
                  <div className="flex items-center justify-end">
                    <label className="flex items-center gap-2.5 cursor-pointer group px-3 py-1.5 rounded-lg hover:bg-neutral-50 transition-colors">
                      <input 
                        type="checkbox" 
                        className="hidden"
                        checked={showInactive}
                        onChange={() => setShowInactive(!showInactive)}
                      />
                      <div className={cn(
                        "w-5 h-5 rounded-lg border-2 flex items-center justify-center transition-all",
                        showInactive ? "bg-orange-600 border-orange-600 shadow-sm" : "bg-white border-neutral-200"
                      )}>
                        {showInactive && <CheckCircle2 size={12} className="text-white" />}
                      </div>
                      <span className="text-[10px] font-black text-neutral-400 uppercase tracking-widest group-hover:text-neutral-900 transition-colors">Exibir Inativos</span>
                    </label>
                  </div>

                  <div className="bg-neutral-50/50 p-4 rounded-lg border border-neutral-100 grid grid-cols-1 md:grid-cols-2 gap-5">
                    {/* Origin Client */}
                    <div className="space-y-3 relative group">
                      <div className="flex items-center gap-2 ml-1">
                        <ArrowLeftRight size={12} className="text-orange-500" />
                        <label className="text-[10px] font-black text-neutral-400 uppercase tracking-widest">Quem Emprestou?</label>
                      </div>
                      <div className="relative">
                        <input 
                          ref={origemInputRef}
                          type="text"
                          placeholder="Pesquisar cliente..."
                          value={activeField === 'origem' ? searchOrigem : selectedOrigemName}
                          onChange={(e) => {
                            setSearchOrigem(e.target.value);
                            if (activeField !== 'origem') setActiveField('origem');
                            setFocusedIndex(-1);
                          }}
                          onFocus={() => {
                            setActiveField('origem');
                            setFocusedIndex(-1);
                          }}
                          onKeyDown={(e) => handleKeyDown(e, 'origem', filteredOrigemClients)}
                          className={cn(
                            "w-full pl-4 pr-12 py-3.5 bg-white border rounded-lg transition-all shadow-sm outline-none text-sm font-bold text-neutral-900 placeholder:text-neutral-400",
                            activeField === 'origem' ? "border-orange-500 ring-4 ring-orange-500/10" : "border-neutral-100 hover:border-neutral-200"
                          )}
                        />
                        <button 
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            const isClosing = activeField === 'origem';
                            setActiveField(isClosing ? null : 'origem');
                            if (!isClosing) setTimeout(() => origemInputRef.current?.focus(), 10);
                          }}
                          className="absolute right-0 top-0 bottom-0 px-4 text-neutral-400 hover:text-orange-600 transition-colors z-10"
                        >
                          <ChevronDown size={18} className={cn("transition-transform duration-300", activeField === 'origem' && "rotate-180")} />
                        </button>
                      </div>

                      <AnimatePresence>
                        {activeField === 'origem' && (
                          <motion.div 
                            initial={{ opacity: 0, y: 10, scale: 0.95 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: 10, scale: 0.95 }}
                            className="absolute z-[60] top-[calc(100%+8px)] left-0 right-0 bg-white border border-neutral-200 rounded-lg shadow-2xl overflow-hidden"
                          >
                            <div className="max-h-56 overflow-y-auto p-2" onMouseDown={(e) => e.preventDefault()}>
                              {filteredOrigemClients.length === 0 ? (
                                <div className="p-6 text-center text-[10px] font-bold text-neutral-400 uppercase tracking-widest italic">Nenhum cliente ativo encontrado</div>
                              ) : filteredOrigemClients.map((c, idx) => (
                                <button
                                  type="button"
                                  key={c.id}
                                  onMouseEnter={() => setFocusedIndex(idx)}
                                  onClick={() => {
                                    setForm({...form, cliente_origem_id: c.id});
                                    setActiveField(null);
                                    setSearchOrigem('');
                                    setFocusedIndex(-1);
                                  }}
                                  className={cn(
                                    "w-full text-left px-4 py-3.5 rounded-lg text-xs font-bold transition-all flex items-center justify-between",
                                    focusedIndex === idx 
                                      ? "bg-orange-50 text-orange-600 shadow-sm" 
                                      : "text-neutral-600 hover:bg-neutral-50"
                                  )}
                                >
                                  <span>{c.cliente}</span>
                                  {!c.ativo && (
                                    <span className="text-[8px] bg-rose-50 px-2 py-0.5 rounded-full text-rose-500 font-black">INATIVO</span>
                                  )}
                                </button>
                              ))}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>

                    {/* Destination Client */}
                    <div className="space-y-3 relative group">
                      <div className="flex items-center gap-2 ml-1">
                        <Plus size={12} className="text-orange-500" />
                        <label className="text-[10px] font-black text-neutral-400 uppercase tracking-widest">Quem Recebeu?</label>
                      </div>
                      <div className="relative">
                        <input 
                          ref={destinoInputRef}
                          type="text"
                          placeholder="Pesquisar cliente..."
                          value={activeField === 'destino' ? searchDestino : selectedDestinoName}
                          onChange={(e) => {
                            setSearchDestino(e.target.value);
                            if (activeField !== 'destino') setActiveField('destino');
                            setFocusedIndex(-1);
                          }}
                          onFocus={() => {
                            setActiveField('destino');
                            setFocusedIndex(-1);
                          }}
                          onKeyDown={(e) => handleKeyDown(e, 'destino', filteredDestinoClients)}
                          className={cn(
                            "w-full pl-4 pr-12 py-3.5 bg-white border rounded-lg transition-all shadow-sm outline-none text-sm font-bold text-neutral-900 placeholder:text-neutral-400",
                            activeField === 'destino' ? "border-orange-500 ring-4 ring-orange-500/10" : "border-neutral-100 hover:border-neutral-200"
                          )}
                        />
                        <button 
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            const isClosing = activeField === 'destino';
                            setActiveField(isClosing ? null : 'destino');
                            if (!isClosing) setTimeout(() => destinoInputRef.current?.focus(), 10);
                          }}
                          className="absolute right-0 top-0 bottom-0 px-4 text-neutral-400 hover:text-orange-600 transition-colors z-10"
                        >
                          <ChevronDown size={18} className={cn("transition-transform duration-300", activeField === 'destino' && "rotate-180")} />
                        </button>
                      </div>

                      <AnimatePresence>
                        {activeField === 'destino' && (
                          <motion.div 
                            initial={{ opacity: 0, y: 10, scale: 0.95 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: 10, scale: 0.95 }}
                            className="absolute z-[60] top-[calc(100%+8px)] left-0 right-0 bg-white border border-neutral-200 rounded-lg shadow-2xl overflow-hidden"
                          >
                            <div className="max-h-56 overflow-y-auto p-2" onMouseDown={(e) => e.preventDefault()}>
                              {filteredDestinoClients.length === 0 ? (
                                <div className="p-6 text-center text-[10px] font-bold text-neutral-400 uppercase tracking-widest italic">Nenhum cliente ativo encontrado</div>
                              ) : filteredDestinoClients.map((c, idx) => (
                                <button
                                  type="button"
                                  key={c.id}
                                  onMouseEnter={() => setFocusedIndex(idx)}
                                  onClick={() => {
                                    setForm({...form, cliente_destino_id: c.id});
                                    setActiveField(null);
                                    setSearchDestino('');
                                    setFocusedIndex(-1);
                                  }}
                                  className={cn(
                                    "w-full text-left px-4 py-3.5 rounded-lg text-xs font-bold transition-all flex items-center justify-between",
                                    focusedIndex === idx 
                                      ? "bg-orange-50 text-orange-600 shadow-sm" 
                                      : "text-neutral-600 hover:bg-neutral-50"
                                  )}
                                >
                                  <span>{c.cliente}</span>
                                  {!c.ativo && (
                                    <span className="text-[8px] bg-rose-50 px-2 py-0.5 rounded-full text-rose-500 font-black">INATIVO</span>
                                  )}
                                </button>
                              ))}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  </div>
                </div>

                {/* Section: Merchandising */}
                <div className="bg-neutral-50/50 p-4 rounded-lg border border-neutral-100 grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 ml-1">
                      <Filter size={12} className="text-orange-500" />
                      <label className="text-[10px] font-black text-neutral-400 uppercase tracking-widest">Família (Filtro)</label>
                    </div>
                    <select 
                      value={selectedFamilia}
                      onChange={(e) => setSelectedFamilia(e.target.value)}
                      className="w-full bg-white border border-neutral-100 rounded-lg px-4 py-3.5 text-sm font-bold text-neutral-900 outline-none focus:border-orange-500 focus:shadow-sm transition-all appearance-none cursor-pointer shadow-sm"
                      style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 fill=%27none%27 viewBox=%270 0 24 24%27 stroke=%27%23a3a3a3%27%3E%3Cpath stroke-linecap=%27round%27 stroke-linejoin=%27round%27 stroke-width=%272%27 d=%27M19 9l-7 7-7-7%27/%3E%3C/svg%3E")', backgroundRepeat: 'no-repeat', backgroundPosition: 'right 1rem center', backgroundSize: '1em' }}
                    >
                      <option value="">Todas as famílias</option>
                      {familias.map(f => <option key={f} value={f}>{f}</option>)}
                    </select>
                  </div>

                  <div className="space-y-3 relative group">
                    <div className="flex items-center gap-2 ml-1">
                      <Search size={12} className="text-orange-500" />
                      <label className="text-[10px] font-black text-neutral-400 uppercase tracking-widest">Produto</label>
                    </div>
                    <div className="relative">
                      <input 
                        ref={produtoInputRef}
                        type="text"
                        placeholder="Buscar item..."
                        value={activeField === 'produto' ? searchProduto : selectedProductName}
                        onChange={(e) => {
                          setSearchProduto(e.target.value);
                          if (activeField !== 'produto') setActiveField('produto');
                          setFocusedIndex(-1);
                        }}
                        onFocus={() => {
                          setActiveField('produto');
                          setFocusedIndex(-1);
                        }}
                        onKeyDown={(e) => handleKeyDown(e, 'produto', filteredProducts)}
                        className={cn(
                          "w-full pl-4 pr-12 py-3.5 bg-white border rounded-lg transition-all shadow-sm outline-none text-sm font-bold text-neutral-900 placeholder:text-neutral-400",
                          activeField === 'produto' ? "border-orange-500 ring-4 ring-orange-500/10" : "border-neutral-100 hover:border-neutral-200"
                        )}
                      />
                      <button 
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          const isClosing = activeField === 'produto';
                          setActiveField(isClosing ? null : 'produto');
                          if (!isClosing) setTimeout(() => produtoInputRef.current?.focus(), 10);
                        }}
                        className="absolute right-0 top-0 bottom-0 px-4 text-neutral-400 hover:text-orange-600 transition-colors z-10"
                      >
                        <ChevronDown size={18} className={cn("transition-transform duration-300", activeField === 'produto' && "rotate-180")} />
                      </button>
                    </div>

                      <AnimatePresence>
                        {activeField === 'produto' && (
                          <motion.div 
                            initial={{ opacity: 0, y: 10, scale: 0.95 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: 10, scale: 0.95 }}
                            className="absolute z-[60] top-[calc(100%+8px)] left-0 right-0 bg-white border border-neutral-200 rounded-lg shadow-2xl overflow-hidden"
                          >
                            <div className="max-h-56 overflow-y-auto p-2" onMouseDown={(e) => e.preventDefault()}>
                              {filteredProducts.length === 0 ? (
                                <div className="p-6 text-center text-[10px] font-bold text-neutral-400 uppercase tracking-widest italic">Nenhum item encontrado</div>
                              ) : filteredProducts.map((p, idx) => (
                                <button
                                  type="button"
                                  key={p.id}
                                  onMouseEnter={() => setFocusedIndex(idx)}
                                  onClick={() => {
                                    setForm({...form, produto_id: p.id});
                                    setActiveField(null);
                                    setSearchProduto('');
                                    setFocusedIndex(-1);
                                  }}
                                  className={cn(
                                    "w-full text-left px-4 py-3.5 rounded-lg text-xs font-bold transition-all",
                                    focusedIndex === idx 
                                      ? "bg-orange-50 text-orange-600 shadow-sm" 
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

                {/* Section: Logistics */}
                <div className="bg-neutral-50/50 p-4 rounded-lg border border-neutral-100 grid grid-cols-2 gap-5">
                  <div className="space-y-3">
                    <label className="text-[10px] font-black text-neutral-400 uppercase tracking-widest ml-1">Quantidade</label>
                    <div className="flex items-center bg-white border border-neutral-100 rounded-lg p-1 h-14 transition-all focus-within:border-orange-500 focus-within:shadow-sm shadow-sm overflow-hidden">
                      <button 
                        type="button"
                        onClick={() => adjustQuantity(-1)}
                        className="w-10 h-10 flex-shrink-0 flex items-center justify-center text-neutral-400 hover:text-orange-600 hover:bg-orange-50 rounded-lg transition-all"
                      >
                        <Minus size={18} />
                      </button>
                      <input 
                        type="text"
                        inputMode="decimal"
                        value={form.quantidade}
                        onChange={(e) => {
                          const val = e.target.value.replace(/[^0-9.]/g, '');
                          setForm({...form, quantidade: val});
                        }}
                        placeholder="0"
                        className="flex-1 min-w-0 bg-transparent text-center text-lg font-black text-neutral-900 outline-none placeholder:text-neutral-200"
                      />
                      <button 
                        type="button"
                        onClick={() => adjustQuantity(1)}
                        className="w-10 h-10 flex-shrink-0 flex items-center justify-center text-neutral-400 hover:text-orange-600 hover:bg-orange-50 rounded-lg transition-all"
                      >
                        <Plus size={18} />
                      </button>
                    </div>
                  </div>
                  <div className="space-y-3">
                    <label className="text-[10px] font-black text-neutral-400 uppercase tracking-widest ml-1">Data do Registro</label>
                    <div className="relative group shadow-sm rounded-lg">
                      <Calendar size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-neutral-400 group-focus-within:text-orange-500 transition-colors pointer-events-none" />
                      <input 
                        type="date"
                        value={form.data_emprestimo}
                        onChange={(e) => setForm({...form, data_emprestimo: e.target.value})}
                        className="w-full bg-white border border-neutral-100 rounded-lg pl-12 pr-4 h-14 text-sm font-bold text-neutral-900 outline-none focus:border-orange-500 focus:shadow-sm transition-all"
                      />
                    </div>
                  </div>
                </div>

                <div className="pt-2">
                  <button 
                    onClick={handleAddLoan}
                    className="w-full h-16 bg-gradient-to-br from-orange-600 to-orange-500 text-white rounded-lg font-black text-sm uppercase tracking-[0.2em] shadow-xl shadow-orange-600/20 hover:shadow-orange-600/40 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98] transition-all flex items-center justify-center gap-3"
                  >
                    <Plus size={20} className="text-orange-100" />
                    Confirmar Registro
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Payment Confirmation Modal */}
      <AnimatePresence>
        {loanToPay && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white w-full max-w-md rounded-lg shadow-2xl overflow-hidden"
            >
              <div className="p-8 text-center border-b border-neutral-100">
                <div className="w-20 h-20 bg-amber-50 rounded-lg flex items-center justify-center text-amber-600 mx-auto mb-6 shadow-sm border border-amber-100">
                  <CheckCircle2 size={40} className="stroke-[2.5]" />
                </div>
                <h3 className="text-2xl font-black text-neutral-900 leading-tight">Confirmar Devolução?</h3>
                <p className="text-neutral-500 font-medium mt-3 px-4">
                  Deseja registrar que <span className="font-black text-neutral-900">{loanToPay.cliente_destino_nome}</span> pagou a mercadoria para <span className="font-black text-neutral-900">{loanToPay.cliente_origem_nome}</span>?
                </p>
              </div>
              
              <div className="p-8 bg-neutral-50/50 space-y-4">
                <div className="bg-white p-4 rounded-lg border border-neutral-100 flex items-center gap-3">
                  <div className="w-10 h-10 bg-orange-50 rounded-lg flex items-center justify-center text-orange-600 shrink-0">
                    <ArrowLeftRight size={18} />
                  </div>
                  <div className="text-left overflow-hidden">
                    <div className="text-[10px] font-black text-neutral-400 uppercase tracking-widest leading-none mb-1">Mercadoria</div>
                    <div className="text-sm font-black text-neutral-900 truncate">
                      {loanToPay.quantidade}x {loanToPay.produto_nome}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <button 
                    onClick={() => setLoanToPay(null)}
                    className="h-14 bg-white border border-neutral-200 text-neutral-500 rounded-lg font-black text-xs uppercase tracking-widest hover:bg-neutral-50 transition-all active:scale-[0.98]"
                  >
                    Cancelar
                  </button>
                  <button 
                    onClick={() => processToggleStatus(loanToPay)}
                    className="h-14 bg-emerald-600 text-white rounded-lg font-black text-xs uppercase tracking-widest shadow-lg shadow-emerald-600/20 hover:bg-emerald-700 transition-all active:scale-[0.98]"
                  >
                    Confirmar Pago
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Delete Confirmation Modal */}
      <AnimatePresence>
        {loanToDelete && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white w-full max-w-md rounded-lg shadow-2xl overflow-hidden"
            >
              <div className="p-8 text-center border-b border-neutral-100">
                <div className="w-20 h-20 bg-rose-50 rounded-lg flex items-center justify-center text-rose-600 mx-auto mb-6 shadow-sm border border-rose-100">
                  <Trash2 size={40} className="stroke-[2.5]" />
                </div>
                <h3 className="text-2xl font-black text-neutral-900 leading-tight">Excluir Registro?</h3>
                <p className="text-neutral-500 font-medium mt-3 px-4">
                  Esta ação não pode ser desfeita. Deseja realmente excluir este empréstimo de <span className="font-black text-neutral-900">{loanToDelete.produto_nome}</span>?
                </p>
              </div>
              
              <div className="p-8 bg-neutral-50/50 flex gap-3">
                <button 
                  onClick={() => setLoanToDelete(null)}
                  className="flex-1 h-14 bg-white border border-neutral-200 text-neutral-500 rounded-lg font-black text-xs uppercase tracking-widest hover:bg-neutral-50 transition-all active:scale-[0.98]"
                >
                  Cancelar
                </button>
                <button 
                  onClick={confirmDeleteLoan}
                  className="flex-1 h-14 bg-rose-600 text-white rounded-lg font-black text-xs uppercase tracking-widest shadow-lg shadow-rose-600/20 hover:bg-rose-700 transition-all active:scale-[0.98]"
                >
                  Excluir
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
