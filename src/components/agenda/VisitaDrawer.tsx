import React, { useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { 
  X, 
  MapPin, 
  Phone, 
  MessageCircle, 
  Calendar, 
  Clock, 
  Navigation, 
  CheckCircle2, 
  XCircle, 
  Repeat, 
  StickyNote,
  Target,
  ShoppingBag,
  Loader2,
  Trash2
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { parseISO, isSameMonth, isSameYear } from 'date-fns';
import { Visita, VisitaStatus } from '../../types/agenda';
import { useDataManager } from '../../lib/dataManager';
import { cn } from '../../lib/utils';
import { supabase } from '../../lib/supabase';

interface VisitaDrawerProps {
  visita: Visita | null;
  isOpen: boolean;
  onClose: () => void;
  onStatusChange: (status: VisitaStatus) => void;
  onNoteChange: (note: string) => void;
  onAgendaUpdate: (fields: Partial<Visita>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

export const VisitaDrawer: React.FC<VisitaDrawerProps> = ({ 
  visita, 
  isOpen, 
  onClose, 
  onStatusChange, 
  onNoteChange,
  onAgendaUpdate,
  onDelete
}) => {
  const { loadClientDetails, clientCache, produtos } = useDataManager();
  const clientData = visita?.cliente_id ? clientCache[visita.cliente_id] : null;

  const [isEditingNote, setIsEditingNote] = React.useState(false);
  const [isEditingSchedule, setIsEditingSchedule] = React.useState(false);
  const [tempNote, setTempNote] = React.useState('');
  
  const [tempSchedule, setTempSchedule] = React.useState({
    semana: 1 as 1 | 2,
    dia_semana: 'Segunda' as any,
    horario_inicio: '08:00',
    horario_fim: '09:00'
  });

  const [isSavingNote, setIsSavingNote] = React.useState(false);
  const [isSavingSchedule, setIsSavingSchedule] = React.useState(false);
  const [isDeleting, setIsDeleting] = React.useState(false);
  const [clientMeta, setClientMeta] = React.useState<number>(0);

  useEffect(() => {
    async function fetchMeta() {
      if (visita?.cliente_id) {
        const { data } = await supabase
          .from('metas')
          .select('meta')
          .eq('cliente_id', visita.cliente_id)
          .single();
        if (data) setClientMeta(data.meta);
        else setClientMeta(0);
      }
    }

    if (isOpen && visita?.cliente_id) {
      loadClientDetails(visita.cliente_id);
      fetchMeta();
    }
    if (isOpen && visita) {
      setTempNote(visita.observacoes || '');
      setTempSchedule({
        semana: visita.semana || 1,
        dia_semana: visita.dia_semana || 'Segunda',
        horario_inicio: visita.horario_inicio?.substring(0, 5) || '08:00',
        horario_fim: visita.horario_fim?.substring(0, 5) || '09:00'
      });
      setIsEditingSchedule(false);
    }
  }, [isOpen, visita?.cliente_id, visita, loadClientDetails]);

  const stats = useMemo(() => {
    try {
      if (!clientData?.historico || !Array.isArray(clientData.historico) || !produtos.length) {
        return { total: 0, count: 0, totalKg: 0 };
      }
      
      const now = new Date();
      const produtosMap: Record<string, any> = {};
      produtos.forEach(p => produtosMap[p.id] = p);

      const monthlyHistory = clientData.historico.filter(h => {
        if (!h) return false;
        const dateStr = h.faturamento || h.data;
        if (!dateStr) return false;
        try {
          const date = parseISO(dateStr);
          return !isNaN(date.getTime()) && isSameMonth(date, now) && isSameYear(date, now);
        } catch {
          return false;
        }
      });

      // Sum revenue from all rows
      const total = monthlyHistory.reduce((acc, h) => {
        const rawVal = h["r$_total"];
        const val = typeof rawVal === 'number' 
          ? rawVal 
          : parseFloat(String(rawVal || 0).replace('R$', '').replace(/\./g, '').replace(',', '.'));
        return acc + (isNaN(val) ? 0 : val);
      }, 0);

      // Sum KG using products table logic from MetasPage
      const totalKgCalculated = monthlyHistory.reduce((acc, v) => {
        const prod = produtosMap[v.produto_id];
        if (!prod) return acc;
        const weight = (v.qtd || 0) * (prod.peso_embalagem || 0);
        return acc + weight;
      }, 0);

      // Count distinct orders (by faturamento date/ID)
      const distinctOrders = new Set(monthlyHistory.map(h => h.faturamento).filter(Boolean)).size;

      return { total, count: distinctOrders > 0 ? distinctOrders : monthlyHistory.length, totalKg: totalKgCalculated };
    } catch (error) {
      console.error("Error calculating performance stats:", error);
      return { total: 0, count: 0, totalKg: 0 };
    }
  }, [clientData, produtos]);

  if (!visita) return null;

  const openWhatsApp = () => {
    const cleanPhone = String(visita.telefone || '').replace(/\D/g, '');
    const rawName = visita.contato || 'Parceiro';
    const contactName = rawName.charAt(0).toUpperCase() + rawName.slice(1).toLowerCase();
    const message = `Bom dia ${contactName}, tudo bem?`;
    window.open(`https://wa.me/${cleanPhone}?text=${encodeURIComponent(message)}`, '_blank');
  };

  const openMaps = () => {
    const fullAddress = `${visita.endereco}, ${visita.bairro}, ${visita.cidade}`;
    window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(fullAddress)}`, '_blank');
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/20 backdrop-blur-sm z-[100]"
          />

          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="fixed top-0 right-0 h-full w-full max-w-lg bg-white border-l border-neutral-200 shadow-2xl z-[101] overflow-y-auto"
          >
            {/* Header */}
            <div className="sticky top-0 bg-white/80 backdrop-blur-md p-6 flex items-center justify-between border-b border-neutral-100 z-10">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-orange-500/10 rounded-2xl flex items-center justify-center text-orange-600">
                  <ShoppingBag size={24} />
                </div>
                <div>
                  <Link 
                    to={`/cliente/${visita.cliente_id}`}
                    className="text-xl font-black text-neutral-900 leading-tight hover:text-orange-600 transition-colors inline-block"
                  >
                    {visita.cliente_nome}
                  </Link>
                  <p className="text-[10px] font-black text-neutral-400 uppercase tracking-widest mt-1">
                    Gestão Comercial
                  </p>
                </div>
              </div>
              <button 
                onClick={onClose}
                className="w-10 h-10 bg-neutral-50 border border-neutral-200 rounded-full flex items-center justify-center text-neutral-400 hover:text-neutral-900 transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            <div className="p-6 space-y-8 pb-32">
              {/* Informações Section */}
              <section className="space-y-4">
                <h3 className="text-[10px] font-black text-neutral-400 uppercase tracking-[0.2em] mb-2 px-2">
                  Dados do Cliente
                </h3>
                <div className="bg-neutral-50 border border-neutral-200 rounded-[2rem] p-3 lg:p-4 space-y-4">
                  <div className="flex items-start gap-4">
                    <MapPin className="text-neutral-400 shrink-0 mt-1" size={18} />
                    <div>
                      <p className="text-sm font-bold text-neutral-900">{visita.endereco}</p>
                      <p className="text-xs text-neutral-500">{visita.bairro}, {visita.cidade}</p>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div className="flex items-center gap-3">
                      <div className="w-1 h-1 rounded-full bg-neutral-300" />
                      <div className="flex flex-col">
                        <span className="text-[10px] font-black text-neutral-400 uppercase tracking-widest">Contato</span>
                        <span className="text-sm font-bold text-neutral-900 truncate">{visita.contato}</span>
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex flex-col">
                        <span className="text-[10px] font-black text-neutral-400 uppercase tracking-widest">Telefone</span>
                        <span className="text-sm font-bold text-neutral-900">{visita.telefone}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-start gap-4">
                    <StickyNote className="text-neutral-400 shrink-0 mt-1" size={18} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-[10px] font-black text-neutral-400 uppercase tracking-widest">Observações</p>
                        {!isEditingNote && (
                          <button 
                            onClick={() => setIsEditingNote(true)}
                            className="text-[9px] font-black text-orange-600 uppercase tracking-widest hover:underline"
                          >
                            Editar
                          </button>
                        )}
                      </div>
                      
                      {isEditingNote ? (
                        <div className="space-y-2">
                          <textarea
                            value={tempNote}
                            onChange={(e) => setTempNote(e.target.value)}
                            className="w-full h-24 bg-white border border-neutral-200 rounded-xl p-3 text-sm text-neutral-900 outline-none focus:border-orange-500 transition-all font-medium resize-none"
                            placeholder="Digite as observações da visita..."
                            autoFocus
                          />
                          <div className="flex items-center gap-2">
                            <button
                              onClick={async () => {
                                setIsSavingNote(true);
                                await onNoteChange(tempNote);
                                setIsSavingNote(false);
                                setIsEditingNote(false);
                              }}
                              disabled={isSavingNote}
                              className="px-3 py-1.5 bg-orange-600 text-white rounded-lg text-[9px] font-black uppercase tracking-widest hover:bg-orange-700 transition-all disabled:opacity-50"
                            >
                              {isSavingNote ? 'Salvando...' : 'Salvar'}
                            </button>
                            <button
                              onClick={() => {
                                setTempNote(visita.observacoes || '');
                                setIsEditingNote(false);
                              }}
                              disabled={isSavingNote}
                              className="px-3 py-1.5 bg-neutral-200 text-neutral-600 rounded-lg text-[9px] font-black uppercase tracking-widest hover:bg-neutral-300 transition-all disabled:opacity-50"
                            >
                              Cancelar
                            </button>
                          </div>
                        </div>
                      ) : (
                        <p className="text-sm text-neutral-500 italic leading-relaxed">
                          {visita.observacoes || 'Nenhuma observação registrada para este ciclo.'}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              </section>

              {/* Performance Section */}
              <section className="grid grid-cols-2 gap-2 lg:gap-3">
               <div className="bg-gradient-to-br from-orange-600 to-orange-700 rounded-[2rem] p-3 lg:p-4 text-white shadow-xl shadow-orange-500/10">
                   <div className="flex items-center gap-2 mb-4">
                     <div className="w-6 h-6 bg-white/20 rounded-lg flex items-center justify-center">
                       <Target size={14} />
                     </div>
                     <span className="text-[10px] font-black uppercase tracking-widest">Performance</span>
                   </div>
                   {!clientData ? (
                     <div className="flex items-center gap-2 text-white/60">
                       <Loader2 size={16} className="animate-spin" />
                       <span className="text-[10px] font-bold">CARREGANDO...</span>
                     </div>
                   ) : (
                     <>
                        <div className="flex items-center justify-between mb-1">
                          <p className="text-[10px] font-bold text-orange-200 uppercase">Atingimento Meta</p>
                          <p className="text-[10px] font-bold text-white">{clientMeta > 0 ? Math.round((stats.totalKg / clientMeta) * 100) : 0}%</p>
                        </div>
                        <div className="w-full h-2 bg-white/20 rounded-full overflow-hidden mb-2">
                           <motion.div 
                             initial={{ width: 0 }}
                             animate={{ width: `${clientMeta > 0 ? Math.min(100, (stats.totalKg / clientMeta) * 100) : 0}%` }}
                             className="h-full bg-white rounded-full shadow-[0_0_8px_rgba(255,255,255,0.5)]"
                           />
                        </div>
                        <p className="text-xl font-black">{Math.round(clientMeta)}kg</p>
                        <div className="mt-2 flex items-center justify-between">
                           <span className="text-[10px] font-black text-orange-100/60">{Math.round(stats.totalKg)}kg realizados</span>
                           <span className="text-[10px] font-black bg-white/20 px-1.5 py-0.5 rounded uppercase">Mês</span>
                        </div>
                     </>
                   )}
                </div>

                <div className="bg-white border border-neutral-200 shadow-sm rounded-[2rem] p-3 lg:p-4 space-y-3">
                   <div className="flex items-center justify-between">
                     <div className="flex items-center gap-2">
                       <Clock size={16} className="text-emerald-500" />
                       <span className="text-[10px] font-black text-neutral-400 uppercase tracking-widest">Agendamento</span>
                     </div>
                     {!isEditingSchedule && (
                       <button 
                         onClick={() => setIsEditingSchedule(true)}
                         className="text-[9px] font-black text-orange-600 uppercase tracking-widest hover:underline"
                       >
                         Editar
                       </button>
                     )}
                   </div>

                   {isEditingSchedule ? (
                     <div className="space-y-3 pb-2">
                       <div className="grid grid-cols-2 gap-2">
                         <div className="space-y-1">
                           <label className="text-[8px] font-black text-neutral-400 uppercase">Semana</label>
                           <select 
                             value={tempSchedule.semana}
                             onChange={(e) => setTempSchedule({...tempSchedule, semana: parseInt(e.target.value) as 1 | 2})}
                             className="w-full bg-neutral-50 border border-neutral-200 rounded-lg p-1.5 text-xs font-bold"
                           >
                             <option value={1}>Semana 1</option>
                             <option value={2}>Semana 2</option>
                           </select>
                         </div>
                         <div className="space-y-1">
                           <label className="text-[8px] font-black text-neutral-400 uppercase">Dia</label>
                           <select 
                             value={tempSchedule.dia_semana}
                             onChange={(e) => setTempSchedule({...tempSchedule, dia_semana: e.target.value})}
                             className="w-full bg-neutral-50 border border-neutral-200 rounded-lg p-1.5 text-xs font-bold"
                           >
                             <option value="Segunda">Segunda</option>
                             <option value="Terça">Terça</option>
                             <option value="Quarta">Quarta</option>
                             <option value="Quinta">Quinta</option>
                           </select>
                         </div>
                       </div>

                       <div className="grid grid-cols-2 gap-2">
                         <div className="space-y-1">
                           <label className="text-[8px] font-black text-neutral-400 uppercase">Início</label>
                           <input 
                             type="time" 
                             value={tempSchedule.horario_inicio}
                             onChange={(e) => setTempSchedule({...tempSchedule, horario_inicio: e.target.value})}
                             className="w-full bg-neutral-50 border border-neutral-200 rounded-lg p-1.5 text-xs font-bold"
                           />
                         </div>
                         <div className="space-y-1">
                           <label className="text-[8px] font-black text-neutral-400 uppercase">Fim</label>
                           <input 
                             type="time" 
                             value={tempSchedule.horario_fim}
                             onChange={(e) => setTempSchedule({...tempSchedule, horario_fim: e.target.value})}
                             className="w-full bg-neutral-50 border border-neutral-200 rounded-lg p-1.5 text-xs font-bold"
                           />
                         </div>
                       </div>

                       <div className="flex gap-2">
                         <button 
                           onClick={async () => {
                             setIsSavingSchedule(true);
                             await onAgendaUpdate(tempSchedule);
                             setIsSavingSchedule(false);
                             setIsEditingSchedule(false);
                           }}
                           disabled={isSavingSchedule}
                           className="flex-1 py-1.5 bg-orange-600 text-white rounded-lg text-[9px] font-black uppercase tracking-widest disabled:opacity-50"
                         >
                           {isSavingSchedule ? 'Salvando...' : 'Confirmar'}
                         </button>
                         <button 
                           onClick={() => {
                             setTempSchedule({
                               semana: visita.semana || 1,
                               dia_semana: visita.dia_semana || 'Segunda',
                               horario_inicio: visita.horario_inicio?.substring(0, 5) || '08:00',
                               horario_fim: visita.horario_fim?.substring(0, 5) || '09:00'
                             });
                             setIsEditingSchedule(false);
                           }}
                           disabled={isSavingSchedule}
                           className="px-3 py-1.5 bg-neutral-100 text-neutral-500 rounded-lg text-[9px] font-black uppercase tracking-widest"
                         >
                           X
                         </button>
                       </div>
                     </div>
                   ) : (
                     <>
                       <div>
                         <p className="text-sm font-black text-neutral-900">{(visita.horario_inicio || '').substring(0,5)} - {(visita.horario_fim || '').substring(0,5)}</p>
                         <p className="text-[10px] font-bold text-neutral-500 mt-1 uppercase">{visita.dia_semana} • Semana {visita.semana}</p>
                       </div>
                       <div className="pt-2 border-t border-neutral-100">
                          <span className="text-[9px] font-black text-[#f54900] uppercase tracking-widest">Ordem: {visita.ordem_visita}º do dia</span>
                       </div>
                     </>
                   )}
                </div>
              </section>

              {/* Ações Section */}
              <section className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <button 
                    onClick={() => onStatusChange('concluida')}
                    className="flex items-center gap-3 p-4 bg-emerald-500 text-white rounded-2xl font-black uppercase text-[10px] tracking-widest hover:brightness-110 active:scale-95 transition-all shadow-lg shadow-emerald-500/20"
                  >
                    <CheckCircle2 size={18} />
                    Finalizar Visita
                  </button>

                  <button 
                    onClick={openMaps}
                    className="flex items-center gap-3 p-4 bg-orange-600 text-white rounded-2xl font-black uppercase text-[10px] tracking-widest hover:brightness-110 active:scale-95 transition-all shadow-lg shadow-orange-500/20"
                  >
                    <Navigation size={18} />
                    Abrir Rota
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <button 
                    onClick={openWhatsApp}
                    className="flex items-center gap-3 p-4 bg-neutral-50 border border-neutral-200 rounded-2xl font-bold text-xs text-neutral-700 hover:bg-neutral-100 transition-all"
                  >
                    <MessageCircle size={18} className="text-emerald-600" />
                    WhatsApp
                  </button>

                  <button 
                    onClick={() => setIsEditingSchedule(true)}
                    className="flex items-center gap-3 p-4 bg-neutral-50 border border-neutral-200 rounded-2xl font-bold text-xs text-neutral-700 hover:bg-neutral-100 transition-all"
                  >
                    <Repeat size={18} className="text-amber-600" />
                    Reagendar
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <button 
                    onClick={() => setIsEditingNote(true)}
                    className="flex items-center gap-3 p-4 bg-neutral-50 border border-neutral-200 rounded-2xl font-bold text-xs text-neutral-700 hover:bg-neutral-100 transition-all"
                  >
                    <StickyNote size={18} className="text-neutral-500" />
                    Nota
                  </button>

                  <button 
                    onClick={() => onStatusChange('cancelada')}
                    className="flex items-center gap-3 p-4 bg-rose-50 border border-rose-100 rounded-2xl font-bold text-xs text-rose-600 hover:bg-rose-100 transition-all"
                  >
                    <XCircle size={18} className="text-rose-500" />
                    Cancelar
                  </button>
                </div>

                <div className="pt-4 border-t border-neutral-100">
                  <button 
                    onClick={async () => {
                      if (window.confirm('Tem certeza que deseja remover este cliente da agenda?')) {
                        setIsDeleting(true);
                        await onDelete(visita.id);
                        setIsDeleting(false);
                        onClose();
                      }
                    }}
                    disabled={isDeleting}
                    className="w-full flex items-center justify-center gap-3 p-4 bg-white border border-rose-200 rounded-2xl font-black uppercase text-[10px] tracking-widest text-rose-600 hover:bg-rose-50 transition-all disabled:opacity-50"
                  >
                    <Trash2 size={18} />
                    {isDeleting ? 'Excluindo...' : 'Remover da Agenda'}
                  </button>
                </div>
              </section>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};
