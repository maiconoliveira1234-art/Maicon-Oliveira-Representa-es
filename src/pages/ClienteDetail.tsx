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
  Coins
} from 'lucide-react';
import { Cliente, HistVenda, EstoqueCliente } from '../types';
import { supabase } from '../lib/supabase';
import { cn, formatWeight, formatCurrency } from '../lib/utils';
import { classifySaleRecord } from '../lib/salesClassifier';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  Cell
} from 'recharts';
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
import { Produto } from '../types';
import { shouldExcludeSale } from '../constants';

import { useDataManager } from '../lib/dataManager';
import { Emprestimo } from '../types';

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
  const { clientes: cachedClientes = [], produtos: allProducts = [], loadClientDetails, prefetchClientData } = useDataManager();
  
  const [cliente, setCliente] = useState<Cliente | null>(null);
  const [historico, setHistorico] = useState<HistVenda[]>([]);
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [estoque, setEstoque] = useState<EstoqueCliente[]>([]);
  const [emprestimos, setEmprestimos] = useState<Emprestimo[]>([]);
  const [visitaAgenda, setVisitaAgenda] = useState<{ semana: 1 | 2; dia_semana: string } | null>(null);
  const [flexExtrato, setFlexExtrato] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedOrderDate, setSelectedOrderDate] = useState<string | null>(null);
  const [showAllHistory, setShowAllHistory] = useState(false);

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

        const clientePromise = supabase
          .from('clientes')
          .select('*')
          .eq('id', id)
          .single();

        const metaPromise = supabase
          .from('metas')
          .select('meta')
          .eq('cliente_id', id)
          .single();

        const loansPromise = supabase
          .from('emprestimos')
          .select(`
            *,
            cliente_origem:clientes!cliente_origem_id(cliente),
            produto:produtos!produto_id(produto)
          `)
          .eq('cliente_destino_id', id)
          .eq('status', 'pendente');

        const agendaPromise = supabase
          .from('agenda_visitas')
          .select('semana, dia_semana, ativo')
          .eq('cliente_id', id)
          .maybeSingle();

        const flexPromise = supabase
          .from('verba_flex_extrato')
          .select('*')
          .eq('cliente_id', id)
          .order('criado_em', { ascending: false });

        const [clienteRes, metaRes] = await Promise.all([clientePromise, metaPromise]);
        if (cancelled) return;

        if (clienteRes.error) {
          console.error('Supabase Error (cliente detail):', clienteRes.error.message);
          setError('Erro ao conectar ao Supabase. Usando dados mock.');
          setCliente(cachedCliente || MOCK_CLIENTES.find(c => c.id === id) || null);
        } else if (!clienteRes.data) {
          setCliente(cachedCliente || MOCK_CLIENTES.find(c => c.id === id) || null);
        } else {
          setCliente({
            ...clienteRes.data,
            meta: metaRes.data?.meta || 0
          });
        }
        setLoading(false);

        const [cache, loanRes, agendaRes, flexRes] = await Promise.all([
          detailsPromise,
          loansPromise,
          agendaPromise,
          flexPromise
        ]);
        if (cancelled) return;

        if (loanRes.data) {
          setEmprestimos(loanRes.data.map((l: any) => ({
            ...l,
            cliente_origem_nome: l.cliente_origem?.cliente || 'N/A',
            produto_nome: l.produto?.produto || 'N/A'
          })));
        } else {
          setEmprestimos([]);
        }

        if (!agendaRes.error && agendaRes.data && agendaRes.data.ativo !== false) {
          setVisitaAgenda({
            semana: agendaRes.data.semana as 1 | 2,
            dia_semana: agendaRes.data.dia_semana
          });
        } else {
          setVisitaAgenda(null);
        }

        if (!flexRes.error && flexRes.data) {
          setFlexExtrato(flexRes.data);
        } else {
          setFlexExtrato([]);
        }

        if (cache) {
          setHistorico(cache.historico);
          setEstoque(cache.estoque);
        } else {
          setHistorico(MOCK_HISTORICO.filter(h => h.cliente_id === id));
          setEstoque([]);
        }
      } catch (err) {
        if (cancelled) return;
        console.error('Erro ao carregar dados do cliente:', err);
        setCliente(cachedCliente || MOCK_CLIENTES.find(c => c.id === id) || null);
        setHistorico(MOCK_HISTORICO.filter(h => h.cliente_id === id));
        setProdutos(MOCK_PRODUTOS);
        setLoading(false);
      }
    }

    loadClienteData();

    return () => {
      cancelled = true;
    };
  }, [id, allProducts, cachedClientes, loadClientDetails]);

  const handleResetTrimestral = async () => {
    if (!id || !cliente) return;
    const currentSaldo = cliente.flex_saldo || 0;
    if (currentSaldo === 0) {
      alert('O saldo acumulado já é R$ 0,00.');
      return;
    }
    
    if (!window.confirm(`Confirma o zeramento trimestral de R$ ${currentSaldo.toFixed(2)} do saldo flex deste cliente? O histórico completo de extratos será mantido para auditoria.`)) {
      return;
    }

    try {
      setLoading(true);
      
      const { error: updError } = await supabase
        .from('clientes')
        .update({ flex_saldo: 0 })
        .eq('id', id);

      if (updError) throw updError;

      const { error: insError } = await supabase
        .from('verba_flex_extrato')
        .insert([{
          cliente_id: id,
          valor: -currentSaldo,
          tipo: 'AJUSTE',
          descricao: 'Zeramento Trimestral de Conta Flex Comercial'
        }]);

      if (insError) {
        const errMsg = insError.message || '';
        const isMissingTable = errMsg.includes('verba_flex_extrato') || 
                               errMsg.includes('relation') || 
                               errMsg.includes('schema cache') || 
                               insError.code === '42P01';
        if (isMissingTable) {
          console.warn('Tabela verba_flex_extrato não encontrada no banco. Saldo flex foi zerado na tabela de clientes, mas log do extrato não pôde ser salvo.');
        } else {
          throw insError;
        }
      }

      setCliente(prev => prev ? { ...prev, flex_saldo: 0 } : null);
      
      const { data: freshExtrato } = await supabase
        .from('verba_flex_extrato')
        .select('*')
        .eq('cliente_id', id)
        .order('criado_em', { ascending: false });
        
      if (freshExtrato) {
        setFlexExtrato(freshExtrato);
      }
      
      alert('Conta Flex zerada com sucesso e evento registrado no extrato histórico!');
    } catch(err: any) {
      console.error('Erro ao realizar zeramento trimestral:', err.message);
      alert('Erro ao realizar zeramento trimestral: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

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

  const ordersByDate = React.useMemo(() => {
    const groups: Record<string, HistVenda[]> = {};
    historico.forEach(h => {
      const date = h.faturamento;
      if (!groups[date]) groups[date] = [];
      groups[date].push(h);
    });
    
    return Object.entries(groups)
      .map(([date, items]) => {
        // Group items by product to avoid duplicates
        const groupedItems: Record<string, HistVenda> = {};
        items.forEach(item => {
          const key = item.produto_id || item.produtos;
          if (!groupedItems[key]) {
            groupedItems[key] = { ...item };
          } else {
            groupedItems[key].qtd += item.qtd;
            groupedItems[key]["r$_total"] += item["r$_total"];
          }
        });

        const finalItems = Object.values(groupedItems);

        return {
          date,
          items: finalItems,
          total: finalItems.reduce((acc, item) => acc + (item["r$_total"] || 0), 0),
          totalWeight: finalItems.reduce((acc, item) => {
            const prod = produtosMap[item.produto_id];
            return acc + (item.qtd * (prod?.peso_embalagem || 0));
          }, 0)
        };
      })
      .sort((a, b) => parseISO(b.date).getTime() - parseISO(a.date).getTime());
  }, [historico, produtosMap]);

  const selectedOrder = React.useMemo(() => {
    if (!selectedOrderDate) return null;
    return ordersByDate.find(o => o.date === selectedOrderDate);
  }, [ordersByDate, selectedOrderDate]);

  if (loading) return <StockCountSkeleton />;
  if (!cliente) return <div className="p-8 text-center">Cliente não encontrado.</div>;

  // Calculations
  const now = new Date();
  const startOfCurrentMonth = startOfMonth(now);
  const endOfCurrentMonth = endOfMonth(now);

  // Realizado (Current Month)
  const realizado = historico
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

  // Média 6m (excluding current month)
  const sixMonthsAgo = startOfMonth(subMonths(now, 6));
  const media6mData = historico
    .filter(h => {
      // Selective cutoff filter
      if (shouldExcludeSale(cliente.cliente, h.faturamento)) return false;

      const date = parseISO(h.faturamento);
      return date >= sixMonthsAgo && date < startOfCurrentMonth && classifySaleRecord(h).entraMetas;
    });
  const media6m = media6mData.reduce((acc, h) => {
    const prod = produtosMap[h.produto_id];
    return acc + (h.qtd * (prod?.peso_embalagem || 0));
  }, 0) / 6;

  // Média 12m (excluding current month)
  const twelveMonthsAgo = startOfMonth(subMonths(now, 12));
  const media12mData = historico
    .filter(h => {
      // Selective cutoff filter
      if (shouldExcludeSale(cliente.cliente, h.faturamento)) return false;

      const date = parseISO(h.faturamento);
      return date >= twelveMonthsAgo && date < startOfCurrentMonth && classifySaleRecord(h).entraMetas;
    });
  const media12m = media12mData.reduce((acc, h) => {
    const prod = produtosMap[h.produto_id];
    return acc + (h.qtd * (prod?.peso_embalagem || 0));
  }, 0) / 12;

  // Ciclo de Compra
  let mediaCiclo = 0;
  let diasUltima = 0;
  
  const recompraHistorico = historico.filter(h => classifySaleRecord(h).influenciaConsumo);
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

  const chartData = [
    { name: 'Média 12m', valor: media12m },
    { name: 'Média 6m', valor: media6m },
    { name: 'Meta', valor: cliente.meta },
    { name: 'Realizado', valor: realizado },
  ];

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

      {error && (
        <div className="bg-red-50 border border-red-100 p-4 rounded-2xl flex items-center gap-3 text-red-700 text-sm">
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
                    "p-4 rounded-3xl flex items-center gap-4 border transition-all",
                    isUrgent 
                      ? "bg-rose-50 border-rose-200 text-rose-900 shadow-sm animate-pulse" 
                      : isWarning 
                        ? "bg-orange-50 border-orange-200 text-orange-900 shadow-sm"
                        : "bg-white border-neutral-200 text-neutral-900"
                  )}
                >
                  <div className={cn(
                    "w-10 h-10 rounded-2xl flex items-center justify-center shrink-0",
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
                        "text-[10px] font-black uppercase tracking-widest px-3 py-1.5 rounded-xl border transition-all",
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
          className="bg-orange-600 text-white py-2 px-4 rounded-xl font-bold flex flex-row items-center justify-center gap-2 shadow-md active:scale-95 transition-all text-sm"
        >
          <ShoppingCart size={16} />
          <span>Novo Pedido</span>
        </button>
        <button 
          onClick={() => navigate(`/estoque/${cliente.id}`)}
          onMouseEnter={() => prefetchClientData(cliente.id)}
          className="bg-white text-neutral-700 py-2 px-4 rounded-xl font-bold flex flex-row items-center justify-center gap-2 border border-neutral-200 shadow-xs active:scale-95 transition-all text-sm"
        >
          <Package size={16} className="text-orange-600" />
          <span>Contar Estoque</span>
        </button>
      </div>

      {/* Goal Progress */}
      <section className="bg-white p-6 rounded-3xl border border-neutral-200 shadow-sm">
        <div className="flex justify-between items-center mb-6">
          <h3 className="font-bold text-neutral-800 flex items-center gap-2">
            <Target className="text-orange-600" size={20} />
            Desempenho (kg)
          </h3>
          <span className="text-xs font-bold text-orange-600 bg-orange-50 px-2 py-1 rounded-lg">Mês Atual</span>
        </div>
        
        <div className="h-64 w-full min-h-[256px]">
          <ResponsiveContainer width="100%" height="100%" minHeight={256} minWidth={0}>
            <BarChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
              <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 10, fontWeight: 600 }} />
              <YAxis hide />
              <Tooltip 
                cursor={{ fill: '#f9fafb' }}
                contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
              />
              <Bar dataKey="valor" radius={[6, 6, 0, 0]} barSize={40}>
                {chartData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.name === 'Meta' ? '#ea580c' : entry.name === 'Realizado' ? '#16a34a' : '#94a3b8'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="mt-4 p-4 bg-neutral-50 rounded-2xl flex justify-between items-center">
          <div>
            <p className="text-[10px] font-bold text-neutral-400 uppercase">Falta para Meta</p>
            <p className="text-lg font-black text-neutral-800">{formatWeight(Math.max(0, cliente.meta - realizado))}</p>
          </div>
          <div className="text-right">
            <p className="text-[10px] font-bold text-neutral-400 uppercase">Progresso</p>
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
      <section className="bg-white p-6 rounded-3xl border border-neutral-200 shadow-sm">
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
      <section className="bg-white p-6 rounded-3xl border border-neutral-200 shadow-sm space-y-4">
        <div className="flex justify-between items-center pb-2 border-b border-neutral-100">
          <h3 className="font-bold text-neutral-800 flex items-center gap-2">
            <Coins className="text-orange-600" size={20} />
            Conta Flex & Extrato Coerente
          </h3>
          <button
            onClick={handleResetTrimestral}
            className="text-[10px] bg-rose-50 text-rose-600 border border-rose-100 hover:bg-rose-155 px-3 py-1 rounded-full font-bold transition-all active:scale-95"
            title="Zera o saldo acumulado trimestral mantendo o extrato completo para fins de compliance."
          >
            Zerar Saldo Trimestral
          </button>
        </div>

        <div className="bg-neutral-50 p-4 rounded-2xl flex justify-between items-center">
          <div>
            <p className="text-[10px] font-bold text-neutral-400 uppercase tracking-wider">Saldo Comercial Disponível</p>
            <p className="text-2xl font-black text-neutral-900 mt-1">{formatCurrency(cliente?.flex_saldo || 0)}</p>
          </div>
          <span className="text-[9px] font-black uppercase text-neutral-400 border border-neutral-200 bg-white shadow-xs px-2.5 py-1 rounded-xl">
            COMENTÁRIO INTERNO
          </span>
        </div>

        <div className="space-y-2">
          <h4 className="text-[10px] font-black uppercase text-neutral-400 tracking-wider">Histórico de Movimentações</h4>
          {flexExtrato.length === 0 ? (
            <p className="text-xs text-neutral-400 italic bg-neutral-50 p-4 rounded-xl text-center border border-dashed">
              Nenhuma movimentação de verba flex registrada até o momento.
            </p>
          ) : (
            <div className="max-h-60 overflow-y-auto space-y-2 rounded-xl border border-neutral-100 p-2">
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
                        {item.criado_em ? format(parseISO(item.criado_em), "dd/MM/yyyy HH:mm", { locale: ptBR }) : 'Pendente'}
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
        
        {ordersByDate.slice(0, 3).map((order) => {
          const classifs = getOrderClassificationsList(order.items);
          return (
            <button 
              key={order.date} 
              onClick={() => setSelectedOrderDate(order.date)}
              className="w-full bg-white p-4 pl-6 rounded-2xl border border-neutral-200 shadow-sm flex justify-between items-center transition-all text-left relative overflow-hidden hover:bg-neutral-50/80 active:scale-[0.99]"
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
                  <p className="font-bold text-neutral-950">Pedido em {format(parseISO(order.date), 'dd/MM/yyyy')}</p>
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
          <div className="bg-white w-full max-w-lg rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
            <div className="p-6 border-b border-neutral-100 flex justify-between items-center bg-neutral-50">
              <div>
                <h3 className="text-xl font-black text-neutral-900">Detalhes do Pedido</h3>
                <p className="text-sm text-neutral-500 font-bold">{format(parseISO(selectedOrder.date), 'dd/MM/yyyy')}</p>
              </div>
              <button 
                onClick={() => setSelectedOrderDate(null)}
                className="p-2 hover:bg-neutral-200 rounded-full transition-colors"
              >
                <XCircle size={24} className="text-neutral-400" />
              </button>
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

            <div className="p-6 bg-orange-50 border-t border-orange-100">
              <div className="flex justify-between items-center">
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
        </div>
      )}

      {/* Full History View */}
      {showAllHistory && (
        <div className="fixed inset-0 z-40 bg-neutral-50 flex flex-col md:pl-20">
          <header className="bg-white p-4 border-b border-neutral-200 flex items-center justify-between sticky top-0">
            <h2 className="text-xl font-black text-neutral-900 ml-2">Histórico Completo</h2>
            <button 
              onClick={() => setShowAllHistory(false)} 
              className="flex items-center gap-2 px-3 py-2 hover:bg-neutral-100 rounded-xl transition-colors text-neutral-600 font-bold"
            >
              <span>Voltar</span>
              <ArrowLeft size={20} className="rotate-180" />
            </button>
          </header>
          
          <div className="flex-1 overflow-y-auto p-4 max-w-4xl mx-auto w-full space-y-3">
            {ordersByDate.map((order) => {
              const classifs = getOrderClassificationsList(order.items);
              return (
                <button 
                  key={order.date} 
                  onClick={() => setSelectedOrderDate(order.date)}
                  className="w-full bg-white p-4 pl-6 rounded-2xl border border-neutral-200 shadow-sm flex justify-between items-center text-left transition-all relative overflow-hidden hover:bg-neutral-50/80 active:scale-[0.99]"
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
                      <p className="font-bold text-neutral-950">{format(parseISO(order.date), 'dd/MM/yyyy')}</p>
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
    </div>
  );
}
