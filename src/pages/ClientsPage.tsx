import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Cliente } from '../types';
import { Loader2, Search, UserCheck, UserX, ChevronRight, Calendar, Filter, X } from 'lucide-react';
import { cn, deduplicateSales } from '../lib/utils';
import { differenceInDays, parseISO } from 'date-fns';

export function ClientsPage() {
  const [clientes, setClientes] = useState<(Cliente & { ultima_compra_peso?: number })[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [filterRepurchase, setFilterRepurchase] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    async function fetchClientes() {
      try {
        const [clientesRes, produtosRes, histRes] = await Promise.all([
          supabase.from('clientes').select('*').order('cliente'),
          supabase.from('produtos').select('id, peso_embalagem'),
          supabase.from('hist_vendas').select('cliente_id, faturamento, produto_id, qtd').order('faturamento', { ascending: false })
        ]);
        
        if (clientesRes.error) throw clientesRes.error;

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

        const enrichedClientes = (clientesRes.data || []).map(c => {
          const lastSale = latestSalesMap[c.id];
          return {
            ...c,
            ultima_compra: c.ultima_compra || lastSale?.date,
            ultima_compra_peso: lastSale?.weight || 0
          };
        });

        setClientes(enrichedClientes);
      } catch (err) {
        console.error('Erro ao carregar clientes:', err);
      } finally {
        setLoading(false);
      }
    }
    fetchClientes();
  }, []);

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
    const matchesStatus = showInactive ? true : c.ativo;
    const matchesRepurchase = filterRepurchase ? isWithinRepurchase(c) : true;
    
    return matchesSearch && matchesStatus && matchesRepurchase;
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
          <h1 className="text-2xl font-black text-neutral-900">Clientes</h1>
          <p className="text-neutral-500 text-sm">Gerencie sua carteira de clientes</p>
        </div>
        <div className="flex flex-wrap gap-2">
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
        </div>
      </header>

      <div className="relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-neutral-400" size={20} />
        <input
          type="text"
          placeholder="Buscar cliente ou cidade..."
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

      <div className="bg-white rounded-2xl border border-neutral-200 shadow-sm overflow-hidden">
        <div className="divide-y divide-neutral-100">
          {filteredClientes.length > 0 ? (
            filteredClientes.map((cliente) => (
              <button
                key={cliente.id}
                onClick={() => navigate(`/cliente/${cliente.id}`)}
                className="w-full flex items-center justify-between p-4 hover:bg-neutral-50 transition-colors text-left group"
              >
                <div className="flex items-center gap-4">
                  <div className="relative">
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
                  <div>
                    <h3 className={cn(
                      "font-bold text-neutral-900",
                      !cliente.ativo && "text-neutral-400"
                    )}>
                      {cliente.cliente}
                    </h3>
                    <p className="text-xs text-neutral-500">{cliente.cidade}</p>
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
                  {!cliente.ativo && (
                    <span className="text-[10px] font-bold uppercase px-2 py-0.5 bg-neutral-100 text-neutral-500 rounded-full">
                      Inativo
                    </span>
                  )}
                  <ChevronRight size={18} className="text-neutral-300 group-hover:text-orange-500 transition-colors" />
                </div>
              </div>
            </button>
            ))
          ) : (
            <div className="p-12 text-center text-neutral-400">
              <p>Nenhum cliente encontrado</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
