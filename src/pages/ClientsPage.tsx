import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Cliente } from '../types';
import { Loader2, Search, UserCheck, UserX, ChevronRight, Calendar, Filter, X, UserPlus, CheckCircle2, ShoppingCart, Power, ToggleLeft, ToggleRight, Edit3, MessageCircle, MoreHorizontal } from 'lucide-react';
import { cn, deduplicateSales } from '../lib/utils';
import { differenceInDays, parseISO, startOfWeek, endOfWeek, isWithinInterval, addDays } from 'date-fns';
import { logDiagnostic } from '../lib/diagnostics';

import { NewClientModal } from '../components/NewClientModal';
import { runAutoAgendaSyncIfEligible } from '../lib/autoAgendaSync';

import { useDataManager } from '../lib/dataManager';

import { ClientPageSkeleton } from '../components/ui/Skeleton';

export function ClientsPage() {
  const { clientes: cachedClientes, loadingGlobal, loadInitialData, refreshClientes, loadLatestSalesMap } = useDataManager();
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
  const [isActionsMenuOpen, setIsActionsMenuOpen] = useState(false);
  const [editingCliente, setEditingCliente] = useState<Cliente | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const navigate = useNavigate();
  const headerActionBase = "h-9 min-w-0 justify-center px-3 rounded-lg text-xs font-extrabold transition-all inline-flex items-center gap-1.5 border whitespace-nowrap";
  const headerActionIdle = "bg-white text-neutral-700 border-neutral-200 hover:bg-neutral-50 hover:border-neutral-300";
  const headerActionActive = "text-white shadow-md";

  const fetchClientes = useCallback(async () => {
    const startTime = performance.now();
    logDiagnostic('DEBUG_CLIENTS', 'Iniciando carregamento de clientes com enriquecimento de histórico...');
    try {
      // Don't show loading if we have cached data (mode: stale-while-revalidate)
      if (cachedClientes.length === 0) {
        setLoading(true);
        await loadInitialData();
      }

      const latestSalesMap = await loadLatestSalesMap();

      const enrichedClientes = (cachedClientes.length > 0 ? cachedClientes : []).map(c => {
        const lastSale = latestSalesMap[c.id];
        return {
          ...c,
          ultima_compra: c.ultima_compra || lastSale?.date,
          ultima_compra_peso: lastSale?.weight || 0
        };
      });

      setClientes(enrichedClientes);
      setLoading(false);
      logDiagnostic('DEBUG_CLIENTS', `Clientes exibidos em ${(performance.now() - startTime).toFixed(2)}ms. Total: ${enrichedClientes.length}`);

      // Fetch open orders from Supabase first
      let dbOpenOrders: any[] = [];
      if (navigator.onLine !== false) {
        try {
          const { data, error } = await supabase.from('pedidos_em_aberto').select('*');
          if (!error && data) {
            dbOpenOrders = data;
          }
        } catch (dbErr) {
          console.error('Error fetching pedidos_em_aberto:', dbErr);
        }
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

      // 2. Fallback/merge with localStorage
      enrichedClientes.forEach(c => {
        if (!openOrdersMap[c.id]) {
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
                openOrdersMap[c.id] = parsed.startedAt || new Date().toISOString();
              }
            } catch (e) {}
          }
        }
      });
      setOpenOrdersDates(openOrdersMap);
      logDiagnostic('DEBUG_CLIENTS', `Clientes carregados e enriquecidos em ${(performance.now() - startTime).toFixed(2)}ms. Total: ${enrichedClientes.length}`);
    } catch (err: any) {
      console.error('Erro ao carregar clientes:', err);
      logDiagnostic('DEBUG_CLIENTS', `Erro no carregamento de clientes: ${err.message || err}`);
    } finally {
      setLoading(false);
    }
  }, [cachedClientes, loadInitialData, loadLatestSalesMap]);


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
      
      // Se estamos desativando OU se estamos reativando o cliente, removemos a visita correspondente da agenda de visitas.
      // Se estamos reativando, isso força o sistema de sincronização inteligente a agendá-lo no melhor lugar do zero!
      await supabase
        .from('agenda_visitas')
        .delete()
        .eq('cliente_id', id);

      const { error } = await supabase
        .from('clientes')
        .update({ ativo: !currentAtivo })
        .eq('id', id);

      if (error) throw error;
      
      // Update local state immediately for better UX
      setClientes(prev => prev.map(c => c.id === id ? { ...c, ativo: !currentAtivo } : c));
      await refreshClientes(); 

      if (!currentAtivo) {
        // Se estamos reativando o cliente, disparamos a sincronização inteligente da agenda na hora!
        await runAutoAgendaSyncIfEligible(true);
      }
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
    <div className="space-y-4 pb-12">
      <div className="sticky top-0 z-40 -mx-4 px-4 pt-3 pb-3 bg-neutral-50/95 backdrop-blur border-b border-neutral-200/80 shadow-sm">
        <header className="space-y-3">
          <div className="flex items-end justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-xl font-black text-neutral-900 leading-tight">Clientes</h1>
              <p className="text-neutral-500 text-xs truncate">Gerencie sua carteira</p>
            </div>
            <span className="shrink-0 rounded-full bg-white px-2.5 py-1 text-[11px] font-black text-neutral-500 border border-neutral-200">
              {filteredClientes.length}
            </span>
          </div>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" size={17} />
            <input
              type="text"
              placeholder="Buscar cliente ou cidade..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="h-10 w-full pl-10 pr-10 bg-white border border-neutral-200 rounded-lg shadow-sm focus:ring-2 focus:ring-orange-500 outline-none transition-all text-sm"
            />
            {searchTerm && (
              <button
                onClick={() => setSearchTerm('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600 p-1 transition-colors"
                aria-label="Limpar busca"
              >
                <X size={18} />
              </button>
            )}
          </div>

          <div className="relative -mx-1 flex gap-2 px-1 pb-0.5">
            <button
              onClick={() => setFilterRepurchase(!filterRepurchase)}
              className={cn(
                headerActionBase,
                "flex-1",
                filterRepurchase 
                  ? cn(headerActionActive, "bg-green-600 border-green-600 shadow-green-100") 
                  : headerActionIdle
              )}
            >
              <Calendar size={18} />
              {filterRepurchase ? "Ver Todos" : "Recompra"}
            </button>
            <button
              onClick={() => setFilterOpenOrders(!filterOpenOrders)}
              className={cn(
                headerActionBase,
                "flex-1",
                filterOpenOrders 
                  ? cn(headerActionActive, "bg-orange-600 border-orange-600 shadow-orange-100") 
                  : headerActionIdle
              )}
            >
              <ShoppingCart size={18} />
              {filterOpenOrders ? "Ver Todos" : "Pedido em Aberto"}
            </button>
            <button
              onClick={() => setIsActionsMenuOpen((open) => !open)}
              className={cn(
                headerActionBase,
                (isActionsMenuOpen || isEditMode || isManageMode || showInactive)
                  ? cn(headerActionActive, "bg-neutral-900 border-neutral-900")
                  : headerActionIdle
              )}
              aria-expanded={isActionsMenuOpen}
              aria-haspopup="menu"
            >
              <MoreHorizontal size={18} />
              Ações
            </button>

            {isActionsMenuOpen && (
              <div className="absolute right-1 top-11 z-50 w-56 overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-xl" role="menu">
                <button
                  onClick={() => {
                    setIsModalOpen(true);
                    setIsActionsMenuOpen(false);
                  }}
                  className="flex h-11 w-full items-center gap-3 px-3 text-left text-sm font-bold text-neutral-800 hover:bg-neutral-50"
                  role="menuitem"
                >
                  <UserPlus size={17} />
                  Novo
                </button>
                <button
                  onClick={() => {
                    setIsEditMode(!isEditMode);
                    setIsManageMode(false);
                    setIsActionsMenuOpen(false);
                  }}
                  className="flex h-11 w-full items-center gap-3 px-3 text-left text-sm font-bold text-neutral-800 hover:bg-neutral-50"
                  role="menuitem"
                >
                  <Edit3 size={17} />
                  {isEditMode ? "Concluir edição" : "Editar"}
                </button>
                <button
                  onClick={() => {
                    setShowInactive(!showInactive);
                    setIsActionsMenuOpen(false);
                  }}
                  className="flex h-11 w-full items-center gap-3 px-3 text-left text-sm font-bold text-neutral-800 hover:bg-neutral-50"
                  role="menuitem"
                >
                  {showInactive ? <UserCheck size={17} /> : <UserX size={17} />}
                  {showInactive ? "Ocultar Inativos" : "Exibir Inativos"}
                </button>
                <button
                  onClick={() => {
                    setIsManageMode(!isManageMode);
                    setIsEditMode(false);
                    if (!isManageMode) setShowInactive(true);
                    setIsActionsMenuOpen(false);
                  }}
                  className="flex h-11 w-full items-center gap-3 px-3 text-left text-sm font-bold text-neutral-800 hover:bg-neutral-50"
                  role="menuitem"
                >
                  <Power size={17} />
                  {isManageMode ? "Concluir ativação" : "Ativar/Inativar"}
                </button>
              </div>
            )}
          </div>
        </header>
      </div>

      <div className="bg-white rounded-lg border border-neutral-200 shadow-sm overflow-hidden">
        <div className="divide-y divide-neutral-100">
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
                          className="h-7 inline-flex shrink-0 items-center gap-1.5 px-2.5 bg-green-100 text-green-700 rounded-lg text-[10px] font-black uppercase hover:bg-green-200 transition-colors whitespace-nowrap"
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
            <div className="p-12 text-center text-neutral-400">
              <p>Nenhum cliente encontrado</p>
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
          <div className="bg-green-600 text-white px-6 py-3 rounded-lg shadow-2xl flex items-center gap-3 font-bold">
            <CheckCircle2 size={20} />
            {successMessage}
          </div>
        </div>
      )}
    </div>
  );
}
