import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Search, 
  Filter, 
  ChevronLeft, 
  ChevronRight, 
  Calendar, 
  AlertCircle,
  RefreshCw,
  LayoutGrid,
  List,
  MapPin,
  Loader2
} from 'lucide-react';
import { cn } from '../lib/utils';
import { Visita, VisitaStatus, DiaSemana } from '../types/agenda';
import { agendaService } from '../services/agendaService';
import { getCurrentCycleWeek, DIAS_SEMANA } from '../lib/agendaUtils';
import { VisitaCard } from '../components/agenda/VisitaCard';
import { AgendaDashboard } from '../components/agenda/AgendaDashboard';

export function AgendaPage() {
  const [visitas, setVisitas] = useState<Visita[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // States para filtros e visualização
  const [activeWeek, setActiveWeek] = useState<1 | 2>(1);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterCity, setFilterCity] = useState('');
  const [filterBairro, setFilterBairro] = useState('');
  const [filterStatus, setFilterStatus] = useState<VisitaStatus | 'todos'>('todos');
  const [filterDia, setFilterDia] = useState<DiaSemana | 'todos'>('todos');
  
  const currentIntervalWeek = useMemo(() => getCurrentCycleWeek(), []);
  const todayDayName = useMemo(() => {
    const days = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta'];
    const idx = new Date().getDay() - 1; // 0 is Monday
    return idx >= 0 && idx < 5 ? days[idx] : null;
  }, []);

  useEffect(() => {
    setActiveWeek(currentIntervalWeek);
    fetchAgenda();
  }, [currentIntervalWeek]);

  async function fetchAgenda() {
    try {
      setLoading(true);
      setError(null);
      const data = await agendaService.getVisitas();
      console.log('Dados da agenda carregados:', data);
      setVisitas(data);
    } catch (err: any) {
      console.error('Erro ao buscar agenda:', err);
      setError(err.message || 'Erro ao carregar os dados do banco.');
    } finally {
      setLoading(false);
    }
  }

  async function handleStatusChange(id: string, newStatus: VisitaStatus) {
    try {
      const updated = await agendaService.updateStatus(id, newStatus);
      setVisitas(prev => prev.map(v => v.id === id ? updated : v));
    } catch (err: any) {
      alert('Erro ao atualizar status: ' + err.message);
    }
  }

  const filteredVisitas = visitas.filter(v => {
    const matchesWeek = v.semana === activeWeek;
    const matchesSearch = v.cliente_nome.toLowerCase().includes(searchTerm.toLowerCase()) ||
                        v.cidade.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCity = !filterCity || v.cidade === filterCity;
    const matchesBairro = !filterBairro || v.bairro === filterBairro;
    const matchesStatus = filterStatus === 'todos' || v.status === filterStatus;
    const matchesDia = filterDia === 'todos' || v.dia_semana === filterDia;

    return matchesWeek && matchesSearch && matchesCity && matchesBairro && matchesStatus && matchesDia;
  });

  const uniqueCities = Array.from(new Set(visitas.map(v => v.cidade))).sort();
  const uniqueBairros = Array.from(new Set(visitas.filter(v => !filterCity || v.cidade === filterCity).map(v => v.bairro))).sort();

  if (loading) {
    return (
      <div className="min-h-screen bg-neutral-50 flex items-center justify-center">
        <div className="text-center space-y-4">
          <Loader2 className="w-12 h-12 text-orange-600 animate-spin mx-auto" />
          <p className="text-sm font-bold text-neutral-500 uppercase tracking-widest">Carregando Agenda...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-neutral-50 flex items-center justify-center p-6">
        <div className="bg-white p-8 rounded-[2.5rem] border-2 border-red-100 shadow-xl max-w-md text-center">
          <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-4">
            <AlertCircle className="text-red-500" size={32} />
          </div>
          <h2 className="text-xl font-black text-neutral-900 mb-2">Erro de Conexão</h2>
          <p className="text-sm text-neutral-500 font-medium mb-6">{error}</p>
          <button 
            onClick={fetchAgenda}
            className="w-full py-3 bg-neutral-900 text-white rounded-2xl font-bold flex items-center justify-center gap-2"
          >
            <RefreshCw size={18} />
            Tentar Novamente
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-50 pb-24">
      {/* Header */}
      <header className="bg-white border-b border-neutral-100 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                <span className="text-[10px] font-black text-neutral-400 uppercase tracking-widest">Sistema Comercial</span>
              </div>
              <h1 className="text-2xl font-black text-neutral-900 flex items-center gap-2">
                Minha Agenda
                <span className="text-sm font-bold text-orange-600 bg-orange-50 px-2 py-0.5 rounded-lg border border-orange-100">
                  Semana {currentIntervalWeek}
                </span>
              </h1>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setActiveWeek(1)}
                className={cn(
                  "px-4 py-2 rounded-2xl font-black text-[10px] uppercase tracking-wider transition-all border",
                  activeWeek === 1 ? "bg-orange-600 text-white border-orange-600 shadow-lg shadow-orange-100" : "bg-white text-neutral-500 border-neutral-100 hover:bg-neutral-50"
                )}
              >
                Semana 1
              </button>
              <button
                onClick={() => setActiveWeek(2)}
                className={cn(
                  "px-4 py-2 rounded-2xl font-black text-[10px] uppercase tracking-wider transition-all border",
                  activeWeek === 2 ? "bg-orange-600 text-white border-orange-600 shadow-lg shadow-orange-100" : "bg-white text-neutral-500 border-neutral-100 hover:bg-neutral-50"
                )}
              >
                Semana 2
              </button>
              <button 
                onClick={fetchAgenda}
                className="w-10 h-10 flex items-center justify-center bg-white border border-neutral-100 rounded-2xl text-neutral-400 hover:text-orange-600 hover:border-orange-200 transition-all"
              >
                <RefreshCw size={18} />
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 pt-8">
        <AgendaDashboard visitas={visitas.filter(v => v.semana === activeWeek)} currentWeek={activeWeek} />

        {/* Filters */}
        <div className="bg-white rounded-[2.5rem] p-4 border border-neutral-100 shadow-sm mb-8 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <div className="relative md:col-span-2">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-neutral-400" size={18} />
              <input
                type="text"
                placeholder="Buscar cliente ou cidade..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-11 pr-4 py-3 bg-neutral-50 border border-neutral-100 rounded-2xl focus:ring-2 focus:ring-orange-500 outline-none transition-all font-bold text-neutral-900 placeholder:text-neutral-400 text-sm"
              />
            </div>

            <select
              value={filterDia}
              onChange={(e) => setFilterDia(e.target.value as any)}
              className="px-4 py-3 bg-neutral-50 border border-neutral-100 rounded-2xl font-bold text-sm text-neutral-900 outline-none focus:ring-2 focus:ring-orange-500"
            >
              <option value="todos">Todos os dias</option>
              {DIAS_SEMANA.map(dia => <option key={dia} value={dia}>{dia}</option>)}
            </select>

            <select
              value={filterCity}
              onChange={(e) => setFilterCity(e.target.value)}
              className="px-4 py-3 bg-neutral-50 border border-neutral-100 rounded-2xl font-bold text-sm text-neutral-900 outline-none focus:ring-2 focus:ring-orange-500"
            >
              <option value="">Todas as Cidades</option>
              {uniqueCities.map(city => <option key={city} value={city}>{city}</option>)}
            </select>

            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value as any)}
              className="px-4 py-3 bg-neutral-50 border border-neutral-100 rounded-2xl font-bold text-sm text-neutral-900 outline-none focus:ring-2 focus:ring-orange-500"
            >
              <option value="todos">Todos os Status</option>
              <option value="pendente">Pendentes</option>
              <option value="concluida">Concluídas</option>
              <option value="reagendada">Reagendadas</option>
              <option value="cancelada">Canceladas</option>
            </select>

            <button
              onClick={() => {
                setSearchTerm('');
                setFilterCity('');
                setFilterBairro('');
                setFilterStatus('todos');
                setFilterDia('todos');
              }}
              className="px-4 py-3 bg-neutral-100 text-neutral-600 rounded-2xl font-bold text-sm hover:bg-neutral-200 transition-colors"
            >
              Limpar
            </button>
          </div>
        </div>

        {/* Agenda Content */}
        <div className="space-y-12">
          {DIAS_SEMANA.map((dia) => {
            const visitasDoDia = filteredVisitas.filter(v => v.dia_semana === dia);
            const isToday = activeWeek === currentIntervalWeek && dia === todayDayName;

            if (visitasDoDia.length === 0 && filterDia !== 'todos' && filterDia !== dia) return null;

            return (
              <section key={dia} className="space-y-6">
                <div className="flex items-end justify-between border-b-2 border-neutral-100 pb-4">
                  <div className="flex items-center gap-4">
                    <div className={cn(
                      "w-12 h-12 rounded-2xl flex items-center justify-center font-black text-xl border-2",
                      isToday ? "bg-orange-600 text-white border-orange-600 shadow-lg" : "bg-white text-neutral-900 border-neutral-100"
                    )}>
                      {dia.charAt(0)}
                    </div>
                    <div>
                      <h2 className="text-xl font-black text-neutral-900 flex items-center gap-2">
                        {dia}
                        {isToday && (
                          <span className="text-[10px] bg-orange-100 text-orange-600 px-2 py-0.5 rounded-full font-black uppercase tracking-widest border border-orange-200">
                            Hoje
                          </span>
                        )}
                        {dia === 'Sexta' && (
                          <span className="text-[10px] bg-sky-100 text-sky-600 px-2 py-0.5 rounded-full font-black uppercase tracking-widest border border-sky-200">
                            Prospecção
                          </span>
                        )}
                      </h2>
                      <p className="text-xs font-bold text-neutral-400 uppercase tracking-widest">
                        {visitasDoDia.length} {visitasDoDia.length === 1 ? 'visita' : 'visitas'} programadas
                      </p>
                    </div>
                  </div>
                </div>

                {visitasDoDia.length > 0 ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                    {visitasDoDia.map((visita) => (
                      <VisitaCard 
                        key={visita.id} 
                        visita={visita} 
                        isToday={isToday}
                        onStatusChange={(status) => { handleStatusChange(visita.id, status); }}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="bg-white rounded-3xl border-2 border-dashed border-neutral-100 p-12 text-center">
                    <div className="w-16 h-16 bg-neutral-50 rounded-full flex items-center justify-center mx-auto mb-4">
                      <Calendar className="text-neutral-300" size={32} />
                    </div>
                    <h3 className="text-lg font-black text-neutral-900">Sem visitas para {dia}</h3>
                    <p className="text-sm text-neutral-500 font-medium max-w-xs mx-auto mt-2">
                      {dia === 'Sexta' 
                        ? 'Aproveite para prospectar novos clientes e atualizar seu CRM.' 
                        : 'Nenhuma visita cadastrada para este dia na semana atual.'}
                    </p>
                  </div>
                )}
              </section>
            );
          })}
        </div>
      </main>

      {/* Floating Action Hint */}
      <AnimatePresence>
        {filteredVisitas.length > 0 && (
          <motion.div 
            initial={{ opacity: 0, y: 100 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 100 }}
            className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[100]"
          >
            <div className="bg-neutral-900 text-white px-8 py-4 rounded-full shadow-2xl flex items-center gap-6 border border-neutral-800">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-orange-500 rounded-full animate-ping" />
                <span className="text-[10px] font-black uppercase tracking-widest">Ativo Agora</span>
              </div>
              <div className="h-4 w-px bg-neutral-700" />
              <div className="text-xs font-bold whitespace-nowrap">
                Agenda Semana <span className="text-orange-400">{activeWeek}</span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
