import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Cliente } from '../types';
import { Loader2, Search, UserCheck, UserX, ChevronRight, Calendar, Filter, X, UserPlus, CheckCircle2, ShoppingCart, Power, ToggleLeft, ToggleRight, Edit3, MessageCircle } from 'lucide-react';
import { cn, deduplicateSales } from '../lib/utils';
import { differenceInDays, parseISO, startOfWeek, endOfWeek, isWithinInterval, addDays } from 'date-fns';

import { NewClientModal } from '../components/NewClientModal';

import { useDataManager } from '../lib/dataManager';

import { ClientPageSkeleton } from '../components/ui/Skeleton';

export function ClientsPage() {
  const { clientes: cachedClientes, loadingGlobal, loadInitialData, refreshClientes } = useDataManager();
  const [clientes, setClientes] = useState<(Cliente & { ultima_compra_peso?: number })[]>([]);
  const [loading, setLoading] = useState(true);

  const sendWhatsAppMessage = (cliente: Cliente) => {
    if (!cliente.telefone) {
      alert('Cliente sem telefone cadastrado.');
      return;
    }

    const rawName = cliente.contato || 'Parceiro';
    const contactName = rawName.charAt(0).toUpperCase() + rawName.slice(1).toLowerCase();
    
    // Saudação dinâmica baseada no horário
    const hour = new Date().getHours();
    let greeting = 'Bom dia';
    if (hour >= 12 && hour < 18) greeting = 'Boa tarde';
    else if (hour >= 18 || hour < 5) greeting = 'Boa noite';

    const message = `${greeting} ${contactName}, tudo bem?`;
    const cleanPhone = String(cliente.telefone || '').replace(/\D/g, '');
    const encodedMessage = encodeURIComponent(message);
    window.open(`https://wa.me/${cleanPhone}?text=${encodedMessage}`, '_blank');
  };
  const [searchTerm, setSearchTerm] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [filterRepurchase, setFilterRepurchase] = useState(false);
  const [filterOpenOrders, setFilterOpenOrders] = useState(false);
  const [openOrdersDates, setOpenOrdersDates] = useState<Record<string, string>>({});
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [showSuccessToast, setShowSuccessToast] = useState(false);
  const [isManageMode, setIsManageMode] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [editingCliente, setEditingCliente] = useState<Cliente | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const navigate = useNavigate();

  const fetchClientes = useCallback(async () => {
    try {
      // Don't show loading if we have cached data (mode: stale-while-revalidate)
      if (cachedClientes.length === 0) {
        setLoading(true);
        await loadInitialData();
      }

      const [produtosRes, histRes] = await Promise.all([
        supabase.from('produtos').select('id, peso_embalagem'),
        supabase.from('hist_vendas').select('cliente_id, faturamento, produto_id, qtd').order('faturamento', { ascending: false })
      ]);
      
      const productWeights: Record<string, number> = {};
      produtosRes.data?.forEach(p => {
        productWeights[p.id] = p.peso_embalagem || 0;
      });

      const latestSalesMap: Record<string, { date: string, weight: number }> = {};
      if (histRes.data) {
        const uniqueSales = deduplicateSales(histRes.data);
        uniqueSales.forEach(h => {
          const weight = (h.qtd || 0) * (productWeights[h.produto_id] || 0);
          if (!latestSalesMap[h.cliente_id]) {
            latestSalesMap[h.cliente_id] = { date: h.faturamento, weight: weight };
          } else if (latestSalesMap[h.cliente_id].date === h.faturamento) {
            latestSalesMap[h.cliente_id].weight += weight;
          }
        });
      }

      const enrichedClientes = (cachedClientes.length > 0 ? cachedClientes : []).map(c => {
        const lastSale = latestSalesMap[c.id];
        return {
          ...c,
          ultima_compra: c.ultima_compra || lastSale?.date,
          ultima_compra_peso: lastSale?.weight || 0
        };
      });

      // Fetch open orders from Supabase first
      let dbOpenOrders: any[] = [];
      try {
        const { data, error } = await supabase.from('pedidos_em_aberto').select('*');
        if (!error && data) {
          dbOpenOrders = data;
        }
      } catch (dbErr) {
        console.error('Error fetching pedidos_em_aberto:', dbErr);
      }

      // Check for open orders in Supabase and fallback to localStorage
      const openOrdersMap: Record<string, string> = {};
      
      // 1. Populate from Supabase DB
      dbOpenOrders.forEach(row => {
        let hasItems = false;
        if (row.items) {
          if (Array.isArray(row.items)) {
            hasItems = row.items.length > 0;
          } else if (typeof row.items === 'object') {
            hasItems = Object.keys(row.items).length > 0;
          }
        }
        if (hasItems) {
          openOrdersMap[row.cliente_id] = row.started_at || row.created_at || new Date().toISOString();
        }
      });

      // 2. Fallback/merge with localStorage based on whichever is more recent
      enrichedClientes.forEach(c => {
        const saved = localStorage.getItem(`pedido_${c.id}`);
        if (saved) {
          try {
            const parsed = JSON.parse(saved);
            let hasItems = false;
            if (parsed && typeof parsed === 'object') {
              if ('items' in parsed) {
                if (Array.isArray(parsed.items)) {
                  hasItems = parsed.items.length > 0;
                } else if (parsed.items && typeof parsed.items === 'object') {
                  hasItems = Object.keys(parsed.items).length > 0;
                }
              } else {
                hasItems = Object.keys(parsed).length > 0;
              }
            }
            if (hasItems) {
              const row = dbOpenOrders.find(r => r.cliente_id === c.id);
              if (row) {
                const supabaseTime = row.updated_at ? new Date(row.updated_at).getTime() : 0;
                const localTime = parsed.updatedAt ? new Date(parsed.updatedAt).getTime() : 0;
                if (localTime > supabaseTime) {
                  openOrdersMap[c.id] = parsed.startedAt || new Date().toISOString();
                }
              } else {
                openOrdersMap[c.id] = parsed.startedAt || new Date().toISOString();
              }
            }
          } catch (e) {}
        }
      });
      setOpenOrdersDates(openOrdersMap);
      setClientes(enrichedClientes);
    } catch (err) {
      console.error('Erro ao carregar clientes:', err);
    } finally {
      setLoading(false);
    }
  }, [cachedClientes, loadInitialData]);

  useEffect(() => {
    fetchClientes();
  }, [fetchClientes]);

  const [successMessage, setSuccessMessage] = useState('Cliente cadastrado com sucesso!');

  const handleSuccess = (isEdit?: boolean) => {
    setSuccessMessage(isEdit ? 'Cliente atualizado com sucesso!' : 'Cliente cadastrado com sucesso!');
    refreshClientes();
    setEditingCliente(null);
    setIsEditMode(false);
    setShowSuccessToast(true);
    setTimeout(() => setShowSuccessToast(false), 3000);
  };

  const toggleClienteAtivo = async (id: string, currentAtivo: boolean) => {
    try {
      setTogglingId(id);
      const { error } = await supabase
        .from('clientes')
        .update({ ativo: !currentAtivo })
        .eq('id', id);

      if (error) throw error;
      
      // Update local state immediately for better UX
      setClientes(prev => prev.map(c => c.id === id ? { ...c, ativo: !currentAtivo } : c));
      await refreshClientes(); 
    } catch (err) {
      console.error('Erro ao alternar status do cliente:', err);
    } finally {
      setTogglingId(null);
    }
  };

  const isWithinRepurchase = (cliente: Cliente) => {
    if (!cliente.ultima_compra) return false;
    try {
      const lastPurchase = parseISO(cliente.ultima_compra);
      const today = new Date();
      const daysSince = differenceInDays(today, lastPurchase);
      return daysSince >= 0 && daysSince <= 28;
    } catch (e) {
      return false;
    }
  };

  const filteredClientes = clientes.filter(c => {
    const searchWords = searchTerm.toLowerCase().split(' ').filter(word => word.length > 0);
    const clienteName = c.cliente || '';
    const clienteCidade = c.cidade || '';
    const targetString = `${clienteName} ${clienteCidade}`.toLowerCase();
    
    const matchesSearch = searchWords.length === 0 || searchWords.every(word => targetString.includes(word));
    const matchesStatus = showInactive ? true : (c.ativo === true);
    const matchesRepurchase = filterRepurchase ? isWithinRepurchase(c) : true;
    const matchesOpenOrders = filterOpenOrders ? !!openOrdersDates[c.id] : true;
    
    return matchesSearch && matchesStatus && matchesRepurchase && matchesOpenOrders;
  }).sort((a, b) => {
    if (filterRepurchase) {
      const dateA = a.ultima_compra || '9999-99-99';
      const dateB = b.ultima_compra || '9999-99-99';
      
      if (dateA !== dateB) {
        return dateA.localeCompare(dateB); // Oldest first
      }
      
      // If same date, largest weight first
      return (b.ultima_compra_peso || 0) - (a.ultima_compra_peso || 0);
    }
    return 0; // Keep original order (by name from Supabase)
  });

  if (loading) return <ClientPageSkeleton />;

  return (
    <div className="space-y-6 pb-12">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-neutral-900 tracking-tight">Clientes</h1>
          <p className="text-neutral-500 text-sm mt-0.5">
            {filteredClientes.length} cliente{filteredClientes.length !== 1 ? 's' : ''}{!showInactive ? ' ativos' : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setIsModalOpen(true)}
            className="px-4 py-2 bg-neutral-900 text-white rounded-xl font-bold transition-all flex items-center gap-2 hover:bg-neutral-800 active:scale-95 shadow-lg shadow-neutral-200"
          >
            <UserPlus size={18} />
            Novo
          </button>
          <button
            onClick={() => {
              setIsEditMode(!isEditMode);
              setIsManageMode(false);
            }}
            className={cn(
              "px-4 py-2 rounded-xl font-bold transition-all flex items-center gap-2 border",
              isEditMode 
                ? "bg-purple-600 text-white border-purple-600 shadow-lg shadow-purple-200" 
                : "bg-white text-neutral-600 border-neutral-200 hover:bg-neutral-50"
            )}
          >
            <Edit3 size={18} />
            {isEditMode ? "Concluir" : "Editar"}
          </button>
          <button
            onClick={() => setFilterRepurchase(!filterRepurchase)}
            className={cn(
              "px-4 py-2 rounded-xl font-bold transition-all flex items-center gap-2 border",
              filterRepurchase 
                ? "bg-green-600 text-white border-green-600 shadow-lg shadow-green-200" 
                : "bg-white text-neutral-600 border-neutral-200 hover:bg-neutral-50"
            )}
          >
            <Calendar size={18} />
            {filterRepurchase ? "Ver Todos" : "Recompra"}
          </button>
          <button
            onClick={() => setFilterOpenOrders(!filterOpenOrders)}
            className={cn(
              "px-4 py-2 rounded-xl font-bold transition-all flex items-center gap-2 border",
              filterOpenOrders 
                ? "bg-orange-600 text-white border-orange-600 shadow-lg shadow-orange-200" 
                : "bg-white text-neutral-600 border-neutral-200 hover:bg-neutral-50"
            )}
          >
            <ShoppingCart size={18} />
            {filterOpenOrders ? "Ver Todos" : "Pedido em Aberto"}
          </button>
          <button
            onClick={() => setShowInactive(!showInactive)}
            className={cn(
              "px-4 py-2 rounded-xl font-bold transition-all flex items-center gap-2 border",
              showInactive 
                ? "bg-orange-600 text-white border-orange-600 shadow-lg shadow-orange-200" 
                : "bg-white text-neutral-600 border-neutral-200 hover:bg-neutral-50"
            )}
          >
            {showInactive ? <UserCheck size={18} /> : <UserX size={18} />}
            {showInactive ? "Ocultar Inativos" : "Exibir Inativos"}
          </button>
          <button
            onClick={() => {
              setIsManageMode(!isManageMode);
              setIsEditMode(false);
              if (!isManageMode) setShowInactive(true);
            }}
            className={cn(
              "px-4 py-2 rounded-xl font-bold transition-all flex items-center gap-2 border",
              isManageMode 
                ? "bg-purple-600 text-white border-purple-600 shadow-lg shadow-purple-200" 
                : "bg-white text-neutral-600 border-neutral-200 hover:bg-neutral-50"
            )}
          >
            <Power size={18} />
            {isManageMode ? "Concluir" : "Ativar/Inativar"}
          </button>
        </div>
      </header>

      <div className="relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-neutral-400" size={18} />
        <input
          type="text"
          placeholder="Buscar cliente ou cidade..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full pl-11 pr-11 py-3 bg-white border border-neutral-200 rounded-xl shadow-sm focus:ring-2 focus:ring-orange-400 focus:border-orange-400 outline-none transition-all text-sm"
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

      <div className="bg-white rounded-2xl border border-neutral-200 shadow-sm overflow-hidden divide-y divide-neutral-100">
        <div>
          {filteredClientes.length > 0 ? (
            filteredClientes.map((cliente) => (
              <div
                key={cliente.id}
                onClick={() => {
                  if (togglingId === cliente.id) return;
                  if (isManageMode) {
                    toggleClienteAtivo(cliente.id, cliente.ativo);
                  } else if (isEditMode) {
                    setEditingCliente(cliente);
                    setIsModalOpen(true);
                  } else {
                    navigate(openOrdersDates[cliente.id] ? `/pedido/novo/${cliente.id}` : `/cliente/${cliente.id}`);
                  }
                }}
                className={cn(
                  "w-full flex items-center justify-between p-4 hover:bg-neutral-50 transition-colors text-left group border-l-4 cursor-pointer",
                  isManageMode ? (cliente.ativo ? "border-green-500" : "border-red-500") : 
                  isEditMode ? "border-purple-500" : "border-transparent",
                  togglingId === cliente.id && "opacity-50 pointer-events-none"
                )}
              >
                <div className="flex items-center gap-4 min-w-0 flex-1">
                  <div className="relative shrink-0">
                    <div className={cn(
                      "w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm",
                      cliente.ativo ? "bg-orange-100 text-orange-600" : "bg-neutral-100 text-neutral-400"
                    )}>
                      {cliente.cliente.substring(0, 2).toUpperCase()}
                    </div>
                    <div className={cn(
                      "absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-white",
                      isWithinRepurchase(cliente) ? "bg-green-500" : "bg-red-500"
                    )} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className={cn(
                      "font-bold text-neutral-900 truncate",
                      !cliente.ativo && "text-neutral-400"
                    )}>
                      {cliente.cliente}
                    </h3>
                    <div className="flex flex-wrap items-center gap-2 mt-0.5">
                      <p className="text-xs text-neutral-500">{cliente.cidade}</p>
                      {openOrdersDates[cliente.id] && (
                        <span className="text-[10px] bg-orange-50 text-orange-700 font-extrabold px-1.5 py-0.5 rounded-lg border border-orange-100 flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-orange-500 animate-pulse" />
                          Aberto em {(() => {
                            try {
                              const d = new Date(openOrdersDates[cliente.id]);
                              if (isNaN(d.getTime())) return '';
                              const day = String(d.getDate()).padStart(2, '0');
                              const month = String(d.getMonth() + 1).padStart(2, '0');
                              const year = d.getFullYear();
                              const hours = String(d.getHours()).padStart(2, '0');
                              const minutes = String(d.getMinutes()).padStart(2, '0');
                              return `${day}/${month}/${year} ${hours}:${minutes}`;
                            } catch (e) {
                              return '';
                            }
                          })()}
                        </span>
                      )}
                      {filterRepurchase && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            sendWhatsAppMessage(cliente);
                          }}
                          className="flex items-center gap-1.5 px-2 py-0.5 bg-green-100 text-green-700 rounded-lg text-[10px] font-black uppercase hover:bg-green-200 transition-colors"
                        >
                          <MessageCircle size={12} fill="currentColor" className="text-green-600" />
                          Relembrar Recompra
                        </button>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  {filterRepurchase && cliente.ultima_compra && (
                    <div className="text-right">
                      <p className="text-sm font-black text-orange-600">
                        {differenceInDays(new Date(), parseISO(cliente.ultima_compra))} dias
                      </p>
                      <p className="text-[10px] font-bold text-neutral-400 uppercase">
                        {Math.round(cliente.ultima_compra_peso || 0)}kg
                      </p>
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    {isManageMode ? (
                      <div className="flex items-center gap-2 px-2">
                        {togglingId === cliente.id ? (
                          <Loader2 size={18} className="animate-spin text-neutral-400" />
                        ) : cliente.ativo ? (
                          <ToggleRight size={28} className="text-green-500" />
                        ) : (
                          <ToggleLeft size={28} className="text-neutral-400" />
                        )}
                      </div>
                    ) : isEditMode ? (
                      <div className="flex items-center gap-2 px-2">
                        <Edit3 size={18} className="text-purple-500" />
                      </div>
                    ) : (
                      <>
                        {!cliente.ativo && (
                          <span className="text-[10px] font-bold uppercase px-2 py-0.5 bg-neutral-100 text-neutral-500 rounded-full">
                            Inat.
                          </span>
                        )}
                        <ChevronRight size={18} className="text-neutral-300 group-hover:text-orange-500 transition-colors" />
                      </>
                    )}
                  </div>
                </div>
              </div>
            ))
          ) : (
            <div className="py-16 text-center">
              <Users size={36} className="mx-auto text-neutral-200 mb-3" />
              <p className="text-neutral-400 font-medium">Nenhum cliente encontrado</p>
              {searchTerm && (
                <button onClick={() => setSearchTerm('')} className="mt-2 text-orange-600 text-sm font-semibold hover:underline">
                  Limpar busca
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      <NewClientModal 
        isOpen={isModalOpen} 
        onClose={() => {
          setIsModalOpen(false);
          setEditingCliente(null);
        }} 
        onSuccess={handleSuccess}
        editingCliente={editingCliente}
      />

      {showSuccessToast && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[300] animate-in fade-in slide-in-from-bottom-4 duration-300">
          <div className="bg-green-600 text-white px-6 py-3 rounded-2xl shadow-2xl flex items-center gap-3 font-bold">
            <CheckCircle2 size={20} />
            {successMessage}
          </div>
        </div>
      )}
    </div>
  );
}
