import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, UserPlus, AlertCircle, CheckCircle2, Clock } from 'lucide-react';
import { Cliente } from '../types';
import { supabase } from '../lib/supabase';
import { getAllFromLocal, saveToLocal } from '../lib/offline';
import { cn, formatWeight } from '../lib/utils';
import { differenceInDays } from 'date-fns';

import { MOCK_CLIENTES } from '../lib/mockData';

export function Dashboard() {
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    async function loadClientes() {
      try {
        setError(null);
        // Try local first
        const localData = await getAllFromLocal('clientes');
        if (localData.length > 0) {
          setClientes(localData);
          setLoading(false);
        }

        // Fetch from Supabase
        const { data, error: sError } = await supabase
          .from('clientes')
          .select('*')
          .order('cliente');

        if (sError) {
          console.error('Supabase Error (clientes):', sError.message);
          setError('Não foi possível conectar ao Supabase. Usando dados locais/mock.');
          if (localData.length === 0) {
            setClientes(MOCK_CLIENTES);
          }
          return;
        }

        if (!data || data.length === 0) {
          console.warn('Supabase: Nenhuma linha encontrada na tabela "clientes".');
          if (localData.length === 0) {
            setClientes(MOCK_CLIENTES);
          }
          return;
        }

        if (data) {
          setClientes(data);
          // Update local cache
          for (const cliente of data) {
            await saveToLocal('clientes', cliente);
          }
        }
      } catch (err) {
        console.error('Erro ao carregar clientes:', err);
        setClientes(MOCK_CLIENTES);
      } finally {
        setLoading(false);
      }
    }

    loadClientes();
  }, []);

  const filteredClientes = clientes.filter(c => 
    (c.cliente?.toLowerCase() || '').includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <header className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-neutral-900">Dashboard</h2>
          <p className="text-neutral-500">Gestão de Clientes e Vendas</p>
        </div>
        <button 
          onClick={() => navigate('/cliente/novo')}
          className="bg-orange-600 text-white p-3 rounded-full shadow-lg hover:bg-orange-700 transition-all active:scale-95"
        >
          <UserPlus size={24} />
        </button>
      </header>

      {error && (
        <div className="bg-red-50 border border-red-100 p-4 rounded-2xl flex items-center gap-3 text-red-700 text-sm">
          <AlertCircle size={20} />
          <p>{error}</p>
        </div>
      )}

      {/* Search Bar */}
      <div className="relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-neutral-400" size={20} />
        <input
          type="text"
          placeholder="Buscar cliente por nome ou razão social..."
          className="w-full pl-12 pr-4 py-4 bg-white border border-neutral-200 rounded-2xl shadow-sm focus:ring-2 focus:ring-orange-500 focus:border-orange-500 outline-none transition-all"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>

      {/* Stats Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Total Clientes" value={clientes.length} color="blue" />
        <StatCard label="Ativos (30d)" value={clientes.filter(c => c.ultima_compra && differenceInDays(new Date(), new Date(c.ultima_compra)) <= 30).length} color="green" />
        <StatCard label="Inativos" value={clientes.filter(c => !c.ultima_compra || differenceInDays(new Date(), new Date(c.ultima_compra)) > 30).length} color="red" />
        <StatCard label="Meta Global" value="85%" color="orange" />
      </div>

      {/* Client List */}
      <div className="space-y-3">
        <h3 className="text-lg font-semibold text-neutral-800 px-1">Seus Clientes</h3>
        {loading ? (
          <div className="flex justify-center p-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-600"></div>
          </div>
        ) : filteredClientes.length === 0 ? (
          <div className="bg-white p-8 rounded-2xl border border-dashed border-neutral-300 text-center text-neutral-500">
            Nenhum cliente encontrado.
          </div>
        ) : (
          filteredClientes.map(cliente => (
            <ClienteCard key={cliente.id} cliente={cliente} onClick={() => navigate(`/cliente/${cliente.id}`)} />
          ))
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, color }: { label: string, value: string | number, color: 'blue' | 'green' | 'red' | 'orange' }) {
  const colors = {
    blue: 'bg-blue-50 text-blue-700 border-blue-100',
    green: 'bg-green-50 text-green-700 border-green-100',
    red: 'bg-red-50 text-red-700 border-red-100',
    orange: 'bg-orange-50 text-orange-700 border-orange-100',
  };

  return (
    <div className={cn("p-4 rounded-2xl border shadow-sm", colors[color])}>
      <p className="text-xs font-semibold uppercase tracking-wider opacity-70">{label}</p>
      <p className="text-xl font-bold mt-1">{value}</p>
    </div>
  );
}

interface ClienteCardProps {
  cliente: Cliente;
  onClick: () => void;
  key?: React.Key;
}

function ClienteCard({ cliente, onClick }: ClienteCardProps) {
  const diasInativo = cliente.ultima_compra 
    ? differenceInDays(new Date(), new Date(cliente.ultima_compra))
    : Infinity;

  const status = diasInativo <= 30 ? 'active' : diasInativo <= 60 ? 'warning' : 'danger';

  return (
    <button
      onClick={onClick}
      className="w-full bg-white p-4 rounded-2xl border border-neutral-200 shadow-sm hover:border-orange-300 transition-all flex items-center justify-between group text-left"
    >
      <div className="flex items-center gap-4">
        <div className={cn(
          "w-12 h-12 rounded-xl flex items-center justify-center text-white font-bold text-lg",
          status === 'active' ? 'bg-green-500' : status === 'warning' ? 'bg-orange-500' : 'bg-red-500'
        )}>
          {cliente.cliente.charAt(0)}
        </div>
        <div>
          <h4 className="font-bold text-neutral-900 group-hover:text-orange-600 transition-colors">{cliente.cliente}</h4>
          <p className="text-xs text-neutral-500 truncate max-w-[200px]">{cliente.cidade}</p>
          <div className="flex items-center gap-2 mt-1">
            {status === 'active' ? (
              <CheckCircle2 size={14} className="text-green-500" />
            ) : status === 'warning' ? (
              <Clock size={14} className="text-orange-500" />
            ) : (
              <AlertCircle size={14} className="text-red-500" />
            )}
            <span className="text-[10px] font-medium text-neutral-400">
              {diasInativo === Infinity ? 'Nunca comprou' : `${diasInativo} dias sem comprar`}
            </span>
          </div>
        </div>
      </div>
      <div className="text-right">
        <p className="text-[10px] text-neutral-400 uppercase font-bold tracking-tighter">Meta Mensal</p>
        <p className="text-sm font-bold text-neutral-700">{formatWeight(cliente.meta_kg)}</p>
      </div>
    </button>
  );
}
