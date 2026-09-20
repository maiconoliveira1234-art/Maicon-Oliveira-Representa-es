import { ClientCommercialPriorities } from '../components/CommercialPriorities';
import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { 
  ArrowLeft, 
  ShoppingCart, 
  History, 
  Package, 
  Target, 
  TrendingUp, 
  Calendar,
  ChevronRight,
  AlertCircle,
  XCircle,
  ArrowLeftRight,
  MapPin,
  Phone,
  Coins,
  Eye,
  EyeOff,
  Pencil,
  Layers
} from 'lucide-react';
import { Cliente, HistVenda, EstoqueCliente, Produto, Emprestimo } from '../types';
import { supabase } from '../lib/supabase';
import { cn, formatWeight, formatCurrency } from '../lib/utils';
import { classifySaleRecord } from '../lib/salesClassifier';
import { getSalesOrderIdentity } from '../lib/orderIdentity';
import { OrderEditModal, EditableOrderGroup } from '../components/orders/OrderEditModal';
import { 
  ComposedChart,
  Area,
  Line,
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer
} from 'recharts';
import { 
  computeSingleClientEvolutionFromFirstSale,
  TrendMode,
  TREND_CATEGORIES
} from '../lib/salesTrendAnalysis';
import { fetchOpenOrderSales } from '../lib/openOrderSales';
import { 
  subMonths, 
  startOfMonth, 
  endOfMonth, 
  differenceInDays, 
  parseISO, 
  format,
  isWithinInterval,
  startOfToday,
  addDays,
  differenceInWeeks,
  startOfYear
} from 'date-fns';
import { ptBR } from 'date-fns/locale';

import { MOCK_CLIENTES, MOCK_HISTORICO, MOCK_PRODUTOS } from '../lib/mockData';
import { shouldExcludeSale } from '../constants';
import { useDataManager } from '../lib/dataManager';
import { StockCountSkeleton } from '../components/ui/Skeleton';

// Helper to determine order core category visual styling list
const getOrderClassificationsList = (items: HistVenda[]) => {
  const typesSet = new Set(items.map(item => classifySaleRecord(item).tipoOperacao));
  const list: Array<{
    type: 'VENDA' | 'BONIFICACAO_COMERCIAL' | 'MERCHANDISING';
    label: string;
    dotColor: string;
    textColor: string;
    barBgColor: string;
    bgColor: string;
  }> = [];

  if (typesSet.has('VENDA')) {
    list.push({
      type: 'VENDA',
      label: 'Venda Normal',
      dotColor: 'bg-blue-600',
      textColor: 'text-blue-700 font-bold',
      barBgColor: 'bg-blue-500',
      bgColor: 'bg-blue-50/5'
    });
  }
  if (typesSet.has('BONIFICACAO_COMERCIAL')) {
    list.push({
      type: 'BONIFICACAO_COMERCIAL',
      label: 'Bonificação Comercial',
      dotColor: 'bg-orange-500',
      textColor: 'text-orange-700 font-bold',
      barBgColor: 'bg-orange-500',
      bgColor: 'bg-orange-50/5'
    });
  }
  if (typesSet.has('MERCHANDISING')) {
    list.push({
      type: 'MERCHANDISING',
      label: 'Merchandising / Brinde',
      dotColor: 'bg-purple-600',
      textColor: 'text-purple-700 font-bold',
      barBgColor: 'bg-purple-500',
      bgColor: 'bg-purple-50/5'
    });
  }

  if (list.length === 0) {
    list.push({
      type: 'VENDA',
      label: 'Venda Normal',
      dotColor: 'bg-blue-600',
      textColor: 'text-blue-700 font-bold',
      barBgColor: 'bg-blue-500',
      bgColor: 'bg-blue-50/5'
    });
  }

  return list;
};

export function ClienteDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { 
    clientes: cachedClientes = [], 
    produtos: allProducts = [], 
    metas: cachedMetas = {},
    agenda_visitas: cachedVisitas = [],
    emprestimos: cachedLoans = [],
    verba_flex_extrato: cachedFlex = [],
    hist_vendas: cachedHistVendas = [],
    loadClientDetails, 
    prefetchClientData 
  } = useDataManager();
  
  const [cliente, setCliente] = useState<Cliente | null>(null);
  const [historico, setHistorico] = useState<HistVenda[]>([]);
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [estoque, setEstoque] = useState<EstoqueCliente[]>([]);
  const [emprestimos, setEmprestimos] = useState<Emprestimo[]>([]);
  const [visitaAgenda, setVisitaAgenda] = useState<{ semana: 1 | 2; dia_semana: string } | null>(null);
  const [flexExtrato, setFlexExtrato] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedOrderKey, setSelectedOrderKey] = useState<string | null>(null);
  const [editingOrderGroup, setEditingOrderGroup] = useState<EditableOrderGroup | null>(null);
  const [showAllHistory, setShowAllHistory] = useState(false);
  const [showFlex, setShowFlex] = useState(false);
  const [evolutionTrendMode, setEvolutionTrendMode] = useState<TrendMode>('quarterly');
  const [openOrderSales, setOpenOrderSales] = useState<HistVenda[]>([]);

  // Real-time synchronization of Open Orders converted to HistVenda for this client
  useEffect(() => {
    let active = true;

    async function loadClientOpenOrders() {
      if (!id) return;
      const targetClients = cliente ? [cliente] : cachedClientes.filter(c => c.id === id);
      const targetProducts = produtos.length > 0 ? produtos : (allProducts.length > 0 ? allProducts : MOCK_PRODUTOS);
      if (targetClients.length === 0 || targetProducts.length === 0) return;

      try {
        const sales = await fetchOpenOrderSales(targetClients, targetProducts);
        if (active) {
          setOpenOrderSales(sales.filter(s => s.cliente_id === id));
        }
      } catch (err) {
        console.error('Error fetching open order sales for client:', err);
      }
    }

    void loadClientOpenOrders();

    const handleStorageChange = (e: StorageEvent) => {
      if (!e.key || e.key === `pedido_${id}`) {
        void loadClientOpenOrders();
      }
    };
    window.addEventListener('storage', handleStorageChange);

    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      return () => {
        active = false;
        window.removeEventListener('storage', handleStorageChange);
      };
    }

    const channel = supabase
      .channel(`client-detail-pedidos-em-aberto-${id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'pedidos_em_aberto', filter: `cliente_id=eq.${id}` },
        () => {
          void loadClientOpenOrders();
        }
      )
      .subscribe();

    return () => {
      active = false;
      window.removeEventListener('storage', handleStorageChange);
      void supabase.removeChannel(channel);
    };
  }, [id, cliente, cachedClientes, produtos, allProducts]);

  useEffect(() => {
    let cancelled = false;

    async function loadClienteData() {
      if (!id) return;

      const cachedCliente = cachedClientes.find(c => c.id === id) || null;
      const detailsPromise = loadClientDetails(id);

      try {
        setError(null);
        setProdutos(allProducts.length > 0 ? allProducts : MOCK_PRODUTOS);

        if (cachedCliente) {
          setCliente(prev => prev?.id === cachedCliente.id ? prev : cachedCliente);
          setLoading(false);
        } else {
          setLoading(true);
        }

        // 1. Safe query wrappers for each parallel Supabase fetch
        const safeClientePromise = (async () => {
          try {
            const res = await supabase.from('clientes').select('*').eq('id', id).single();
            if (res.error) throw res.error;
            return res.data;
          } catch (err) {
            console.warn('[Offline Fallback] Erro ao carregar cliente do Supabase, usando cache local:', err);
            return cachedCliente || MOCK_CLIENTES.find(c => c.id === id) || null;
          }
        })();

        const safeMetaPromise = (async () => {
          try {
            const res = await supabase.from('metas').select('meta').eq('cliente_id', id).single();
            if (res.error) throw res.error;
            return res.data?.meta || 0;
          } catch (err) {
            console.warn('[Offline Fallback] Erro ao carregar meta do Supabase, usando cache local:', err);
            return cachedMetas[id] || 0;
          }
        })();

        const safeLoansPromise = (async () => {
          try {
            const res = await supabase
              .from('emprestimos')
              .select(`
                *,
                cliente_origem:clientes!cliente_origem_id(cliente),
                produto:produtos!produto_id(produto)
              `)
              .eq('cliente_destino_id', id)
              .eq('status', 'pendente');
            if (res.error) throw res.error;
            return (res.data || []).map((l: any) => ({
              ...l,
              cliente_origem_nome: l.cliente_origem?.cliente || 'N/A',
              produto_nome: l.produto?.produto || 'N/A'
            }));
          } catch (err) {
            console.warn('[Offline Fallback] Erro ao carregar empréstimos do Supabase, usando cache local:', err);
            return cachedLoans
              .filter((l: any) => l.cliente_destino_id === id && l.status === 'pendente')
              .map((l: any) => {
                const origClient = cachedClientes.find(c => c.id === l.cliente_origem_id);
                const prod = allProducts.find(p => p.id === l.produto_id) || MOCK_PRODUTOS.find(p => p.id === l.produto_id);
                return {
                  ...l,
                  cliente_origem_nome: origClient?.cliente || 'N/A',
                  produto_nome: prod?.produto || 'N/A'
                };
              });
          }
        })();

        const safeAgendaPromise = (async () => {
          try {
            const res = await supabase
              .from('agenda_visitas')
              .select('semana, dia_semana, ativo')
              .eq('cliente_id', id)
              .maybeSingle();
            if (res.error) throw res.error;
            return res.data;
          } catch (err) {
            console.warn('[Offline Fallback] Erro ao carregar agenda do Supabase, usando cache local:', err);
            const localVisita = cachedVisitas.find(v => v.cliente_id === id);
            return localVisita ? { semana: localVisita.semana, dia_semana: localVisita.dia_semana, ativo: localVisita.ativo } : null;
          }
        })();

        const safeFlexPromise = (async () => {
          try {
            const res = await supabase
              .from('verba_flex_extrato')
              .select('*')
              .eq('cliente_id', id)
              .order('created_at', { ascending: false });
            if (res.error) throw res.error;
            return res.data || [];
          } catch (err) {
            console.warn('[Offline Fallback] Erro ao carregar extrato flex do Supabase, usando cache local:', err);
            return cachedFlex.filter(f => f.cliente_id === id);
          }
        })();

        // 2. Resolve all queries in parallel without propagating rejections
        const [
          dbClienteData,
          dbMetaVal,
          dbLoansList,
          dbAgendaItem,
          dbFlexList,
          cache
        ] = await Promise.all([
          safeClientePromise,
          safeMetaPromise,
          safeLoansPromise,
          safeAgendaPromise,
          safeFlexPromise,
          detailsPromise
        ]);

        if (cancelled) return;

        // Set Client with its Meta
        if (dbClienteData) {
          setCliente({
            ...dbClienteData,
            meta: dbMetaVal
          });
        } else {
          setCliente(cachedCliente || MOCK_CLIENTES.find(c => c.id === id) || null);
        }

        // Set Loans
        setEmprestimos(dbLoansList);

        // Set Agenda Visitas
        if (dbAgendaItem && dbAgendaItem.ativo !== false) {
          setVisitaAgenda({
            semana: dbAgendaItem.semana as 1 | 2,
            dia_semana: dbAgendaItem.dia_semana
          });
        } else {
          setVisitaAgenda(null);
        }

        // Set Flex Extrato
        setFlexExtrato(dbFlexList);

        // Set Historico and Estoque
        if (cache) {
          setHistorico(cache.historico);
          setEstoque(cache.estoque);
        } else {
          setHistorico(MOCK_HISTORICO.filter(h => h.cliente_id === id));
          setEstoque([]);
        }

        setLoading(false);

      } catch (err) {
        if (cancelled) return;
        console.error('Erro crítico ao carregar dados do cliente:', err);
        
        // Final fallback block in case of absolute catastrophic failure
        const fallbackCliente = cachedCliente || MOCK_CLIENTES.find(c => c.id === id) || null;
        setCliente(fallbackCliente);
        
        const fallbackLoans = cachedLoans
          .filter((l: any) => l.cliente_destino_id === id && l.status === 'pendente')
          .map((l: any) => {
            const origClient = cachedClientes.find(c => c.id === l.cliente_origem_id);
            const prod = allProducts.find(p => p.id === l.produto_id) || MOCK_PRODUTOS.find(p => p.id === l.produto_id);
            return {
              ...l,
              cliente_origem_nome: origClient?.cliente || 'N/A',
              produto_nome: prod?.produto || 'N/A'
            };
          });
        setEmprestimos(fallbackLoans);
        
        const localVisita = cachedVisitas.find(v => v.cliente_id === id);
        if (localVisita && localVisita.ativo !== false) {
          setVisitaAgenda({
            semana: localVisita.semana,
            dia_semana: localVisita.dia_semana
          });
        } else {
          setVisitaAgenda(null);
        }

        setFlexExtrato(cachedFlex.filter(f => f.cliente_id === id));

        const cache = await detailsPromise;
        if (cache) {
          setHistorico(cache.historico);
          setEstoque(cache.estoque);
        } else {
          setHistorico(MOCK_HISTORICO.filter(h => h.cliente_id === id));
          setEstoque([]);
        }
        setLoading(false);
      }
    }

    loadClienteData();

    return () => {
      cancelled = true;
    };
  }, [id, allProducts, cachedClientes, cachedMetas, cachedVisitas, cachedLoans, cachedFlex, loadClientDetails]);

  const formattedNextVisit = React.useMemo(() => {
    if (!visitaAgenda) return null;
    
    const getCycleWeek = (date: Date): 1 | 2 => {
      const anchor = startOfYear(date);
      const weeksSinceAnchor = differenceInWeeks(date, anchor);
      return (weeksSinceAnchor % 2 === 0) ? 1 : 2;
    };

    const getDayName = (date: Date): string | null => {
      const daysMap: Record<number, string> = {
        1: 'Segunda',
        2: 'Terça',
        3: 'Quarta',
        4: 'Quinta',
        5: 'Sexta'
      };
      const dayIdx = date.getDay();
      return daysMap[dayIdx] || null;
    };

    const today = startOfToday();
    let computedDate: Date | null = null;
    for (let i = 0; i <= 21; i++) {
      const candidate = addDays(today, i);
      const candidateWeek = getCycleWeek(candidate);
      const candidateDayName = getDayName(candidate);
      if (candidateWeek === visitaAgenda.semana && candidateDayName === visitaAgenda.dia_semana) {
        computedDate = candidate;
        break;
      }
    }

    if (!computedDate) return null;

    let rawFormatted = format(computedDate, "EEEE, dd/MM", { locale: ptBR });
    const capitalized = rawFormatted.charAt(0).toUpperCase() + rawFormatted.slice(1);
    
    return {
      date: computedDate,
      label: capitalized
    };
  }, [visitaAgenda]);

  const handleNextVisitClick = () => {
    if (formattedNextVisit) {
      navigate('/', { state: { selectedDate: format(formattedNextVisit.date, 'yyyy-MM-dd') } });
    } else {
      navigate('/');
    }
  };

  const produtosMap = React.useMemo(() => {
    return produtos.reduce((acc, p) => {
      acc[p.id] = p;
      return acc;
    }, {} as Record<string, Produto>);
  }, [produtos]);

  // Reative Client History synchronized with Global DataManager
  const activeHistorico = React.useMemo(() => {
    if (!id) return [];
    const fromDM = cachedHistVendas.filter(h => h.cliente_id === id);
    if (fromDM.length > 0) return fromDM;
    return historico;
  }, [cachedHistVendas, id, historico]);

  // Combined sales dataset: historical sales + open orders dynamically unified as HistVenda
  const combinedHistorico = React.useMemo(() => {
    if (openOrderSales.length === 0) return activeHistorico;
    return [...activeHistorico, ...openOrderSales];
  }, [activeHistorico, openOrderSales]);

  const ordersGrouped = React.useMemo<EditableOrderGroup[]>(() => {
    const groups: Record<string, HistVenda[]> = {};
    activeHistorico.forEach(h => {
      const key = getSalesOrderIdentity(h);
      if (!groups[key]) groups[key] = [];
      groups[key].push(h);
    });
    
    return Object.entries(groups)
      .map(([key, items]) => {
        const date = items[0]?.faturamento || '';
        const pedidoId = items[0]?.pedido_id;
        const numeroPedidoErp = items[0]?.numero_pedido_erp;
        const clienteId = items[0]?.cliente_id || id || '';
        const clienteNome = items[0]?.cliente || cliente?.cliente || '';

        return {
          key,
          pedidoId,
          numeroPedidoErp,
          date,
          clienteId,
          clienteNome,
          items,
          total: items.reduce((acc, item) => acc + (Number(item["r$_total"]) || 0), 0),
          totalWeight: items.reduce((acc, item) => {
            const prod = produtosMap[item.produto_id];
            return acc + ((Number(item.qtd) || 0) * (prod?.peso_embalagem || 0));
          }, 0)
        };
      })
      .sort((a, b) => {
        const timeA = a.date ? parseISO(a.date).getTime() : 0;
        const timeB = b.date ? parseISO(b.date).getTime() : 0;
        return timeB - timeA;
      });
  }, [activeHistorico, produtosMap, id, cliente]);

  const selectedOrder = React.useMemo(() => {
    if (!selectedOrderKey) return null;
    return ordersGrouped.find(o => o.key === selectedOrderKey) || null;
  }, [ordersGrouped, selectedOrderKey]);

  // Evolução de Vendas a partir da primeira compra (inclui pedidos em aberto)
  const clientEvolution = React.useMemo(() => {
    if (!cliente) return null;
    return computeSingleClientEvolutionFromFirstSale(
      combinedHistorico,
      produtosMap,
      evolutionTrendMode,
      cliente
    );
  }, [combinedHistorico, produtosMap, evolutionTrendMode, cliente]);

  if (loading) return <StockCountSkeleton />;
  if (!cliente) return <div className="p-8 text-center">Cliente não encontrado.</div>;

  // Calculations
  const now = new Date();
  const startOfCurrentMonth = startOfMonth(now);
  const endOfCurrentMonth = endOfMonth(now);

  // Realizado (Current Month) - reflects both completed sales and open orders
  const realizado = combinedHistorico
    .filter(h => {
      // Selective cutoff filter
      if (shouldExcludeSale(cliente.cliente, h.faturamento)) return false;

      const date = parseISO(h.faturamento);
      return date >= startOfCurrentMonth && date <= endOfCurrentMonth && classifySaleRecord(h).entraMetas;
    })
    .reduce((acc, h) => {
      const prod = produtosMap[h.produto_id];
      return acc + (h.qtd * (prod?.peso_embalagem || 0));
    }, 0);

  // Ciclo de Compra
  let mediaCiclo = 0;
  let diasUltima = 0;
  
  const recompraHistorico = combinedHistorico.filter(h => classifySaleRecord(h).influenciaConsumo);
  if (recompraHistorico.length > 0) {
    const sortedVendas = [...recompraHistorico].sort((a, b) => parseISO(b.faturamento).getTime() - parseISO(a.faturamento).getTime());
    const ultVenda = sortedVendas[0];
    diasUltima = differenceInDays(now, parseISO(ultVenda.faturamento));

    const oldest = parseISO(sortedVendas[sortedVendas.length - 1].faturamento);
    const totalDaysSinceFirst = differenceInDays(now, oldest);
    const uniqueDays = new Set(recompraHistorico.map(v => format(parseISO(v.faturamento), 'yyyy-MM-dd')));
    if (uniqueDays.size > 0) {
      mediaCiclo = Math.round(totalDaysSinceFirst / uniqueDays.size);
    }
  }

  const progresso = cliente.meta > 0 ? Math.round((realizado / cliente.meta) * 100) : 0;
  const statusCiclo = diasUltima <= 28 ? "Válido" : "Inválido";

  return (
    <div className="space-y-6 pb-24">
      <header className="flex items-center gap-4">
        <button 
          onClick={() => {
            if (location.state?.fromMetas) {
              navigate('/metas');
            } else {
              navigate('/');
            }
          }} 
          className="p-2 hover:bg-white rounded-full transition-colors"
        >
          <ArrowLeft size={24} />
        </button>
        <div className="flex-1 min-w-0">
          <h2 className="text-xl font-bold text-neutral-900 truncate leading-tight mb-2" id="cliente-nome-header">
            {cliente.cliente}
          </h2>
          
          <div className="flex flex-col gap-1.5 mt-1" id="cliente-contact-info">
            {cliente.endereco && (
              <a 
                href={
                  cliente.latitude && cliente.longitude
                    ? `https://www.google.com/maps/search/?api=1&query=${cliente.latitude},${cliente.longitude}`
                    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${cliente.endereco}, ${cliente.cidade}`)}`
                }
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-xs text-neutral-600 hover:text-orange-600 transition-colors group cursor-pointer"
                id="link-gps-navegacao"
              >
                <MapPin size={14} className="text-orange-500 shrink-0 group-hover:scale-110 transition-transform" />
                <span className="underline decoration-neutral-300 group-hover:decoration-orange-400 truncate">
                  {cliente.endereco}
                </span>
              </a>
            )}
            
            {cliente.telefone && (
              <a 
                href={(() => {
                  const rawPhone = String(cliente.telefone || '');
                  const digits = rawPhone.replace(/\D/g, '');
                  const cleanedPhone = (digits.length <= 11 && digits.length > 0 && !digits.startsWith('55')) ? '55' + digits : digits;
                  const contactName = cliente.contato || cliente.cliente;
                  const hour = new Date().getHours();
                  const greeting = hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';
                  const textMessage = `${greeting} ${contactName}, tudo bem?`;
                  return `https://wa.me/${cleanedPhone}?text=${encodeURIComponent(textMessage)}`;
                })()}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-xs text-neutral-600 hover:text-orange-600 transition-colors group cursor-pointer"
                id="link-whatsapp-mensagem"
              >
                <Phone size={14} className="text-emerald-500 shrink-0 group-hover:scale-110 transition-transform" />
                <span className="underline decoration-neutral-300 group-hover:decoration-orange-400">
                  {String(cliente.telefone)} {cliente.contato ? `(${cliente.contato})` : ''}
                </span>
              </a>
            )}

            <button 
              onClick={handleNextVisitClick}
              className="flex items-center gap-1.5 text-xs text-neutral-600 hover:text-orange-600 transition-colors group cursor-pointer text-left font-medium w-full sm:w-auto"
              id="link-proxima-visita"
            >
              <Calendar size={14} className="text-orange-500 shrink-0 group-hover:scale-110 transition-transform" />
              <span className="underline decoration-neutral-300 group-hover:decoration-orange-400">
                {formattedNextVisit 
                  ? `Próxima visita: ${formattedNextVisit.label}`
                  : 'Próxima visita: Não agendada'}
              </span>
            </button>
          </div>
        </div>
      </header>

      <ClientCommercialPriorities key={cliente.id} clienteId={cliente.id} />

      {error && (
        <div className="bg-red-50 border border-red-100 p-4 rounded-lg flex items-center gap-3 text-red-700 text-sm">
          <AlertCircle size={20} />
          <p>{error}</p>
        </div>
      )}
      
      {/* Loans Warnings */}
      {emprestimos.length > 0 && (
        <section className="space-y-3">
          <h3 className="text-xs font-black text-neutral-400 uppercase tracking-widest px-1">Débitos de Empréstimo</h3>
          <div className="space-y-2">
            {emprestimos.map((loan) => {
              const days = differenceInDays(new Date(), parseISO(loan.data_emprestimo));
              const isUrgent = days >= 30;
              const isWarning = days >= 10;
              
              return (
                <div 
                  key={loan.id}
                  className={cn(
                    "p-4 rounded-lg flex items-center gap-4 border transition-all",
                    isUrgent 
                      ? "bg-rose-50 border-rose-200 text-rose-900 shadow-sm animate-pulse" 
                      : isWarning 
                        ? "bg-orange-50 border-orange-200 text-orange-900 shadow-sm"
                        : "bg-white border-neutral-200 text-neutral-900"
                  )}
                >
                  <div className={cn(
                    "w-10 h-10 rounded-lg flex items-center justify-center shrink-0",
                    isUrgent ? "bg-rose-200 text-rose-600" : isWarning ? "bg-orange-200 text-orange-600" : "bg-neutral-100 text-neutral-400"
                  )}>
                    <ArrowLeftRight size={20} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-black truncate leading-tight">
                      {loan.quantidade} un de {loan.produto_nome}
                    </p>
                    <p className={cn(
                      "text-[10px] font-bold uppercase mt-0.5",
                      isUrgent ? "text-rose-500" : isWarning ? "text-orange-500" : "text-neutral-400"
                    )}>
                      Emprestado por: {loan.cliente_origem_nome} • Há {days} dias
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <button 
                      onClick={() => navigate('/emprestimos')}
                      className={cn(
                        "text-[10px] font-black uppercase tracking-widest px-3 py-1.5 rounded-lg border transition-all",
                        isUrgent ? "bg-rose-600 text-white border-rose-600" : isWarning ? "bg-orange-600 text-white border-orange-600" : "bg-neutral-900 text-white border-neutral-900"
                      )}
                    >
                      Ver Detalhes
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Quick Actions */}
      <div className="grid grid-cols-2 gap-3">
        <button 
          onClick={() => navigate(`/pedido/novo/${cliente.id}`)}
          onMouseEnter={() => prefetchClientData(cliente.id)}
          className="bg-orange-600 text-white py-2 px-4 rounded-lg font-bold flex flex-row items-center justify-center gap-2 shadow-md active:scale-95 transition-all text-sm"
        >
          <ShoppingCart size={16} />
          <span>Novo Pedido</span>
        </button>
        <button 
          onClick={() => navigate(`/estoque/${cliente.id}`)}
          onMouseEnter={() => prefetchClientData(cliente.id)}
          className="bg-white text-neutral-700 py-2 px-4 rounded-lg font-bold flex flex-row items-center justify-center gap-2 border border-neutral-200 shadow-xs active:scale-95 transition-all text-sm"
        >
          <Package size={16} className="text-orange-600" />
          <span>Contar Estoque</span>
        </button>
      </div>

      {/* Evolução de Vendas (a partir da primeira compra) */}
      <section className="bg-white p-5 sm:p-6 rounded-xl border border-neutral-200 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <TrendingUp className="text-orange-600" size={20} />
              <h3 className="font-bold text-neutral-900 text-base">Evolução de Vendas</h3>
              {clientEvolution && clientEvolution.trend && (
                <span className={cn(
                  "px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider flex items-center gap-1 border",
                  clientEvolution.trend.categoryInfo.badgeClass
                )}>
                  <span>{clientEvolution.trend.categoryInfo.emoji}</span>
                  <span>{clientEvolution.trend.categoryInfo.shortLabel}</span>
                  {clientEvolution.trend.totalTrendChangePct !== 0 && (
                    <span className="font-bold ml-0.5">
                      ({clientEvolution.trend.totalTrendChangePct > 0 ? '+' : ''}
                      {clientEvolution.trend.totalTrendChangePct.toFixed(0)}%)
                    </span>
                  )}
                </span>
              )}
              {openOrderSales.length > 0 && (
                <span 
                  className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider flex items-center gap-1 bg-amber-50 text-amber-800 border border-amber-200"
                  title="Pedidos em aberto integrados ao período em andamento"
                >
                  <ShoppingCart size={11} className="text-amber-600" />
                  <span>Pedido em Aberto ({formatWeight(openOrderSales.reduce((acc, s) => acc + (s.qtd * (produtosMap[s.produto_id]?.peso_embalagem || 0)), 0))})</span>
                </span>
              )}
            </div>
            <p className="text-xs text-neutral-400 mt-0.5">
              Média mensal (kg/mês) desde a 1ª compra do cliente • Atualizado com pedidos em aberto
            </p>
          </div>

          <div className="flex items-center gap-2 self-start sm:self-auto">
            <div className="flex bg-neutral-100 p-1 rounded-lg border border-neutral-200">
              <button
                type="button"
                onClick={() => setEvolutionTrendMode('quarterly')}
                className={cn(
                  "px-2.5 py-1 text-xs font-bold rounded-md transition-all",
                  evolutionTrendMode === 'quarterly'
                    ? "bg-white text-neutral-900 shadow-xs"
                    : "text-neutral-500 hover:text-neutral-700"
                )}
              >
                Trimestral
              </button>
              <button
                type="button"
                onClick={() => setEvolutionTrendMode('annual')}
                className={cn(
                  "px-2.5 py-1 text-xs font-bold rounded-md transition-all",
                  evolutionTrendMode === 'annual'
                    ? "bg-white text-neutral-900 shadow-xs"
                    : "text-neutral-500 hover:text-neutral-700"
                )}
              >
                Anual
              </button>
            </div>
          </div>
        </div>

        {/* Legend */}
        <div className="flex items-center gap-4 text-xs font-bold text-neutral-500 pb-3 border-b border-neutral-100">
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-full bg-orange-500 inline-block"></span>
            <span>Média Mensal Realizada</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-4 h-0.5 bg-blue-600 border-b border-dashed border-blue-600 inline-block"></span>
            <span className="text-blue-600 font-bold">Linha de Tendência</span>
          </div>
        </div>

        {/* Chart */}
        <div className="h-64 sm:h-72 w-full min-h-[256px] pt-4">
          {!clientEvolution || clientEvolution.series.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-neutral-400 py-10">
              <Package size={32} className="mb-2 opacity-50 text-orange-500" />
              <p className="text-xs font-bold">Nenhum dado de compra registrado para este cliente.</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%" minHeight={256} minWidth={0}>
              <ComposedChart data={clientEvolution.series} margin={{ top: 12, right: 16, left: -10, bottom: 8 }}>
                <defs>
                  <linearGradient id="colorClientSalesKg" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#ea580c" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#ea580c" stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                <XAxis 
                  dataKey="label" 
                  axisLine={{ stroke: '#e5e5e5' }}
                  tickLine={false} 
                  tick={{ fontSize: 10, fontWeight: 700, fill: '#737373' }}
                  dy={6}
                />
                <YAxis 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fontSize: 10, fontWeight: 700, fill: '#a3a3a3' }}
                  tickFormatter={(val) => val >= 1000 ? `${(val / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}k` : `${val}`}
                  width={42}
                />
                <Tooltip 
                  contentStyle={{ 
                    borderRadius: '12px', 
                    border: '1px solid #e5e5e5', 
                    boxShadow: '0 10px 25px rgba(0,0,0,0.08)', 
                    fontSize: '11px',
                    padding: '10px 14px'
                  }}
                  formatter={(value: any, name: string) => {
                    const formatted = `${formatWeight(Number(value))} / mês`;
                    if (name === 'trendKg') {
                      return [formatted, 'Linha de Tendência'];
                    }
                    return [
                      formatted, 
                      evolutionTrendMode === 'quarterly' ? 'Média Mensal no Trimestre' : 'Média Mensal no Ano'
                    ];
                  }}
                  labelFormatter={(label) => `Período: ${label}`}
                />
                <Area 
                  type="monotone" 
                  dataKey="chartKg" 
                  name="chartKg"
                  stroke="#ea580c" 
                  strokeWidth={3}
                  fillOpacity={1} 
                  fill="url(#colorClientSalesKg)"
                  dot={{ r: 4, fill: '#ffffff', stroke: '#ea580c', strokeWidth: 2 }}
                  activeDot={{ r: 6, fill: '#ea580c', stroke: '#ffffff', strokeWidth: 2 }}
                />
                <Line 
                  type="linear" 
                  dataKey="trendKg" 
                  name="trendKg"
                  stroke="#2563eb" 
                  strokeWidth={2.5} 
                  strokeDasharray="6 6" 
                  dot={false}
                  activeDot={{ r: 5, fill: '#2563eb', stroke: '#ffffff', strokeWidth: 2 }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Goal / Realizado summary cards */}
        <div className="mt-4 p-4 bg-neutral-50 rounded-xl flex justify-between items-center border border-neutral-100">
          <div>
            <p className="text-[10px] font-bold text-neutral-400 uppercase">Mês Atual (Realizado)</p>
            <p className="text-lg font-black text-neutral-800">{formatWeight(realizado)}</p>
          </div>
          <div className="text-center">
            <p className="text-[10px] font-bold text-neutral-400 uppercase">Meta Mensal</p>
            <p className="text-lg font-black text-neutral-800">{formatWeight(cliente.meta)}</p>
          </div>
          <div className="text-right">
            <p className="text-[10px] font-bold text-neutral-400 uppercase">Progresso Mês</p>
            <p className={cn(
              "text-lg font-black",
              progresso >= 100 ? "text-green-600" : "text-orange-600"
            )}>
              {progresso}%
            </p>
          </div>
        </div>
      </section>

      {/* Purchase Cycle */}
      <section className="bg-white p-6 rounded-lg border border-neutral-200 shadow-sm">
        <h3 className="font-bold text-neutral-800 mb-4 flex items-center gap-2">
          <Calendar className="text-orange-600" size={20} />
          Recompra
        </h3>
        <div className="grid grid-cols-3 gap-4 text-center">
          <div>
            <p className="text-[10px] font-bold text-neutral-400 uppercase">Média</p>
            <p className="text-xl font-bold text-neutral-800">{mediaCiclo}</p>
            <p className="text-[10px] text-neutral-400">dias</p>
          </div>
          <div className="border-x border-neutral-100">
            <p className="text-[10px] font-bold text-neutral-400 uppercase">Última</p>
            <p className="text-xl font-bold text-neutral-800">{diasUltima}</p>
            <p className="text-[10px] text-neutral-400">dias atrás</p>
          </div>
          <div>
            <p className="text-[10px] font-bold text-neutral-400 uppercase">Recompra</p>
            <p className={cn(
              "text-sm font-bold mt-2 uppercase tracking-tighter",
              statusCiclo === "Válido" ? "text-green-600" : "text-red-600"
            )}>
              {statusCiclo}
            </p>
          </div>
        </div>
      </section>

      {/* Conta de Verba Flex Comercial & Extrato de Auditoria (Interno CRM) */}
      {!showFlex ? (
        <button
          type="button"
          onClick={() => setShowFlex(true)}
          className="flex h-12 w-full items-center justify-between rounded-lg border border-neutral-200 bg-white px-4 text-sm font-black text-neutral-700 shadow-sm transition-colors hover:bg-neutral-50"
        >
          <span className="flex items-center gap-2">
            <Coins className="text-orange-600" size={19} />
            Conta Flex
          </span>
          <Eye size={18} className="text-neutral-400" />
        </button>
      ) : (
      <section className="bg-white p-4 sm:p-6 rounded-lg border border-neutral-200 shadow-sm space-y-4">
        <div className="flex justify-between items-center pb-2 border-b border-neutral-100">
          <h3 className="font-bold text-neutral-800 flex items-center gap-2">
            <Coins className="text-orange-600" size={20} />
            Conta Flex
          </h3>
          <button
            type="button"
            onClick={() => setShowFlex(false)}
            className="flex h-9 items-center gap-1.5 rounded-lg border border-neutral-200 px-3 text-[10px] font-black uppercase text-neutral-500 transition-colors hover:bg-neutral-50"
          >
            <EyeOff size={15} />
            Ocultar
          </button>
        </div>

        <div className="bg-neutral-50 p-4 rounded-lg flex justify-between items-center">
          <div>
            <p className="text-[10px] font-bold text-neutral-400 uppercase tracking-wider">Saldo Comercial Disponível</p>
            <p className="text-2xl font-black text-neutral-900 mt-1">{formatCurrency(cliente?.flex_saldo || 0)}</p>
          </div>
          <span className="text-[9px] font-black uppercase text-neutral-400 border border-neutral-200 bg-white shadow-xs px-2.5 py-1 rounded-lg">
            COMENTÁRIO INTERNO
          </span>
        </div>

        <div className="space-y-2">
          <h4 className="text-[10px] font-black uppercase text-neutral-400 tracking-wider">Histórico de Movimentações</h4>
          {flexExtrato.length === 0 ? (
            <p className="text-xs text-neutral-400 italic bg-neutral-50 p-4 rounded-lg text-center border border-dashed">
              Nenhuma movimentação de verba flex registrada até o momento.
            </p>
          ) : (
            <div className="max-h-60 overflow-y-auto space-y-2 rounded-lg border border-neutral-100 p-2">
              {flexExtrato.map((item, idx) => {
                const val = item.valor || 0;
                const isPositive = val > 0;
                
                let valColor = "text-emerald-600 font-extrabold";
                let badgeTxt = "Gerado";
                let badgeColor = "bg-emerald-50 text-emerald-700 border-emerald-100";
                
                if (val < 0) {
                  const isAjuste = item.tipo === 'AJUSTE';
                  valColor = isAjuste ? "text-purple-600 font-extrabold" : "text-rose-600 font-extrabold";
                  badgeTxt = isAjuste ? "Zeramento" : "Consumido";
                  badgeColor = isAjuste ? "bg-purple-50 text-purple-700 border-purple-100" : "bg-rose-50 text-rose-700 border-rose-100";
                }

                return (
                  <div key={item.id || idx} className="flex justify-between items-center bg-white p-2.5 rounded-lg border border-neutral-100 text-xs shadow-3xs">
                    <div className="space-y-0.5">
                      <p className="font-bold text-neutral-800 leading-tight">{item.descricao || 'Lote faturado'}</p>
                      <p className="text-[10px] text-neutral-400 font-medium">
                        {(item.created_at || item.criado_em) ? format(parseISO(item.created_at || item.criado_em), "dd/MM/yyyy HH:mm", { locale: ptBR }) : 'Pendente'}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={cn("text-[8px] uppercase tracking-wider font-extrabold px-1.5 py-0.5 rounded-md border", badgeColor)}>
                        {badgeTxt}
                      </span>
                      <span className={valColor}>
                        {isPositive ? '+' : ''}{formatCurrency(val)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>
      )}

      {/* Recent History */}
      <section className="space-y-3">
        <div className="flex justify-between items-center px-1">
          <h3 className="font-bold text-neutral-800 flex items-center gap-2">
            <History className="text-orange-600" size={20} />
            Últimos Pedidos
          </h3>
          <button 
            onClick={() => setShowAllHistory(true)}
            className="text-orange-600 text-xs font-bold"
          >
            Ver Tudo
          </button>
        </div>
        
        {ordersGrouped.slice(0, 3).map((order) => {
          const classifs = getOrderClassificationsList(order.items);
          return (
            <button 
              key={order.key} 
              onClick={() => setSelectedOrderKey(order.key)}
              className="w-full bg-white p-4 pl-6 rounded-lg border border-neutral-200 shadow-sm flex justify-between items-center transition-all text-left relative overflow-hidden hover:bg-neutral-50/80 active:scale-[0.99]"
            >
              {/* Custom multi-color indicator side bar */}
              <div className="absolute left-0 top-0 bottom-0 w-1.5 flex flex-col overflow-hidden rounded-l-2xl">
                {classifs.map((c) => (
                  <div key={c.type} className={cn("flex-1", c.barBgColor)} />
                ))}
              </div>

              <div>
                <div className="flex items-center gap-2 mb-1">
                  <div className="flex items-center -space-x-1">
                    {classifs.map((c) => (
                      <span 
                        key={c.type} 
                        className={cn("w-2.5 h-2.5 rounded-full border border-white ring-1 ring-neutral-200/50", c.dotColor)} 
                        title={c.label} 
                      />
                    ))}
                  </div>
                  <p className="font-bold text-neutral-950">Pedido em {order.date ? format(parseISO(order.date), 'dd/MM/yyyy') : 'Sem data'}</p>
                  {order.numeroPedidoErp && (
                    <span className="text-[10px] font-extrabold uppercase px-1.5 py-0.2 bg-neutral-100 text-neutral-600 rounded">
                      ERP: {order.numeroPedidoErp}
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-1.5 mt-1">
                  {classifs.map((c) => (
                    <span 
                      key={c.type} 
                      className={cn(
                        "text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded border border-neutral-100/60",
                        c.type === 'VENDA' && "bg-blue-50 text-blue-700",
                        c.type === 'BONIFICACAO_COMERCIAL' && "bg-orange-50 text-orange-700",
                        c.type === 'MERCHANDISING' && "bg-purple-50 text-purple-700"
                      )}
                    >
                      {c.label}
                    </span>
                  ))}
                  <span className="text-neutral-300 font-normal select-none">•</span>
                  <span className="text-xs text-neutral-400 font-bold">{order.items.length} itens</span>
                  <span className="text-neutral-300 font-normal select-none">•</span>
                  <span className="text-xs text-neutral-400 font-bold">{formatWeight(order.totalWeight)}</span>
                </div>
              </div>
              <div className="text-right flex items-center gap-2">
                <p className="font-black text-neutral-900">{formatCurrency(order.total)}</p>
                <ChevronRight size={16} className="text-neutral-300" />
              </div>
            </button>
          );
        })}
      </section>

      {/* Order Detail Modal */}
      {selectedOrder && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white w-full max-w-lg rounded-t-lg sm:rounded-lg shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
            <div className="p-5 sm:p-6 border-b border-neutral-100 flex justify-between items-center bg-neutral-50">
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <h3 className="text-xl font-black text-neutral-900">Detalhes do Pedido</h3>
                  {selectedOrder.numeroPedidoErp && (
                    <span className="text-[10px] font-extrabold uppercase px-2 py-0.5 bg-neutral-200 text-neutral-700 rounded-md">
                      ERP: {selectedOrder.numeroPedidoErp}
                    </span>
                  )}
                </div>
                <p className="text-sm text-neutral-500 font-bold">
                  {selectedOrder.date ? format(parseISO(selectedOrder.date), 'dd/MM/yyyy') : 'Data não informada'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setEditingOrderGroup(selectedOrder)}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-orange-50 hover:bg-orange-100 text-orange-700 text-xs font-black rounded-lg transition-colors border border-orange-200/60"
                  title="Editar pedido"
                >
                  <Pencil size={13} />
                  <span>Editar</span>
                </button>
                <button 
                  onClick={() => setSelectedOrderKey(null)}
                  className="p-2 hover:bg-neutral-200 rounded-full transition-colors"
                >
                  <XCircle size={24} className="text-neutral-400" />
                </button>
              </div>
            </div>
            
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {selectedOrder.items.map((item, idx) => {
                const prod = produtosMap[item.produto_id];
                const pesoTotalLinha = item.qtd * (prod?.peso_embalagem || 0);
                const valorUnitario = item.qtd > 0 ? item["r$_total"] / item.qtd : 0;
                const classification = classifySaleRecord(item);
                
                return (
                  <div key={idx} className="flex justify-between items-start pb-4 border-b border-neutral-50 last:border-0">
                    <div className="flex-1 pr-4">
                      <div className="flex flex-wrap items-center gap-1.5 leading-tight">
                        <span className="font-bold text-neutral-900">{item.produtos}</span>
                        {classification.tipoOperacao !== 'VENDA' && (
                          <span className={cn(
                            "text-[9px] font-bold px-2 py-0.5 rounded-full border shrink-0 uppercase tracking-wider",
                            classification.badgeStyle
                          )}>
                            {classification.label}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-neutral-400 mt-1">
                        Qtd: {item.qtd} un • Peso Total: {formatWeight(pesoTotalLinha)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className={cn(
                        "font-bold",
                        classification.tipoOperacao === 'VENDA' ? "text-neutral-900" : classification.textStyle
                      )}>
                        {classification.tipoOperacao === 'VENDA' 
                          ? formatCurrency(item["r$_total"])
                          : classification.label}
                      </p>
                      {classification.tipoOperacao === 'VENDA' && (
                        <p className="text-[10px] font-bold text-neutral-400 uppercase">Unit: {formatCurrency(valorUnitario)}</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="p-5 sm:p-6 bg-orange-50 border-t border-orange-100 flex justify-between items-center">
              <div>
                <p className="text-[10px] font-bold text-orange-400 uppercase">Total do Pedido</p>
                <p className="text-2xl font-black text-orange-600">{formatCurrency(selectedOrder.total)}</p>
              </div>
              <div className="text-right">
                <p className="text-[10px] font-bold text-orange-400 uppercase">Peso Total</p>
                <p className="text-xl font-black text-neutral-700">{formatWeight(selectedOrder.totalWeight)}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Full History View */}
      {showAllHistory && (
        <div className="fixed inset-0 z-40 bg-neutral-50 flex flex-col md:pl-20">
          <header className="bg-white p-4 border-b border-neutral-200 flex items-center justify-between sticky top-0">
            <h2 className="text-xl font-black text-neutral-900 ml-2">Histórico Completo</h2>
            <button 
              onClick={() => setShowAllHistory(false)} 
              className="flex items-center gap-2 px-3 py-2 hover:bg-neutral-100 rounded-lg transition-colors text-neutral-600 font-bold"
            >
              <span>Voltar</span>
              <ArrowLeft size={20} className="rotate-180" />
            </button>
          </header>
          
          <div className="flex-1 overflow-y-auto p-4 max-w-4xl mx-auto w-full space-y-3">
            {ordersGrouped.map((order) => {
              const classifs = getOrderClassificationsList(order.items);
              return (
                <button 
                  key={order.key} 
                  onClick={() => setSelectedOrderKey(order.key)}
                  className="w-full bg-white p-4 pl-6 rounded-lg border border-neutral-200 shadow-sm flex justify-between items-center text-left transition-all relative overflow-hidden hover:bg-neutral-50/80 active:scale-[0.99]"
                >
                  {/* Custom multi-color indicator side bar */}
                  <div className="absolute left-0 top-0 bottom-0 w-1.5 flex flex-col overflow-hidden rounded-l-2xl">
                    {classifs.map((c) => (
                      <div key={c.type} className={cn("flex-1", c.barBgColor)} />
                    ))}
                  </div>

                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <div className="flex items-center -space-x-1">
                        {classifs.map((c) => (
                          <span 
                            key={c.type} 
                            className={cn("w-2.5 h-2.5 rounded-full border border-white ring-1 ring-neutral-200/50", c.dotColor)} 
                            title={c.label} 
                          />
                        ))}
                      </div>
                      <p className="font-bold text-neutral-950">Pedido em {order.date ? format(parseISO(order.date), 'dd/MM/yyyy') : 'Sem data'}</p>
                      {order.numeroPedidoErp && (
                        <span className="text-[10px] font-extrabold uppercase px-1.5 py-0.2 bg-neutral-100 text-neutral-600 rounded">
                          ERP: {order.numeroPedidoErp}
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 mt-1">
                      {classifs.map((c) => (
                        <span 
                          key={c.type} 
                          className={cn(
                            "text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded border border-neutral-100/60",
                            c.type === 'VENDA' && "bg-blue-50 text-blue-700",
                            c.type === 'BONIFICACAO_COMERCIAL' && "bg-orange-50 text-orange-700",
                            c.type === 'MERCHANDISING' && "bg-purple-50 text-purple-700"
                          )}
                        >
                          {c.label}
                        </span>
                      ))}
                      <span className="text-neutral-300 font-normal select-none">•</span>
                      <span className="text-xs text-neutral-400 font-bold">{order.items.length} itens</span>
                      <span className="text-neutral-300 font-normal select-none">•</span>
                      <span className="text-xs text-neutral-400 font-bold">{formatWeight(order.totalWeight)}</span>
                    </div>
                  </div>
                  <div className="text-right flex items-center gap-2">
                    <p className="font-black text-neutral-900">{formatCurrency(order.total)}</p>
                    <ChevronRight size={16} className="text-neutral-300" />
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Order Edit Modal */}
      {editingOrderGroup && (
        <OrderEditModal
          isOpen={!!editingOrderGroup}
          onClose={() => setEditingOrderGroup(null)}
          order={editingOrderGroup}
          clienteOriginal={cliente}
          clientes={cachedClientes}
          produtos={produtos}
          onSaved={() => {
            setSelectedOrderKey(null);
            setEditingOrderGroup(null);
          }}
        />
      )}
    </div>
  );
}
