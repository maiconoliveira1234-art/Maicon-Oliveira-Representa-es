import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Cliente } from '../types';
import { Loader2, Search, UserCheck, UserX, ChevronRight } from 'lucide-react';
import { cn } from '../lib/utils';

export function ClientsPage() {
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    async function fetchClientes() {
      try {
        const { data, error } = await supabase
          .from('clientes')
          .select('*')
          .order('cliente');
        
        if (error) throw error;
        setClientes(data || []);
      } catch (err) {
        console.error('Erro ao carregar clientes:', err);
      } finally {
        setLoading(false);
      }
    }
    fetchClientes();
  }, []);

  const filteredClientes = clientes.filter(c => {
    const matchesSearch = c.cliente.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         c.cidade.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = showInactive ? true : c.ativo;
    return matchesSearch && matchesStatus;
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
      </header>

      <div className="relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-neutral-400" size={20} />
        <input
          type="text"
          placeholder="Buscar cliente ou cidade..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full pl-12 pr-4 py-3 bg-white border border-neutral-200 rounded-2xl shadow-sm focus:ring-2 focus:ring-orange-500 outline-none transition-all"
        />
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
                  <div className={cn(
                    "w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm",
                    cliente.ativo ? "bg-orange-100 text-orange-600" : "bg-neutral-100 text-neutral-400"
                  )}>
                    {cliente.cliente.substring(0, 2).toUpperCase()}
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
                <div className="flex items-center gap-2">
                  {!cliente.ativo && (
                    <span className="text-[10px] font-bold uppercase px-2 py-0.5 bg-neutral-100 text-neutral-500 rounded-full">
                      Inativo
                    </span>
                  )}
                  <ChevronRight size={18} className="text-neutral-300 group-hover:text-orange-500 transition-colors" />
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
