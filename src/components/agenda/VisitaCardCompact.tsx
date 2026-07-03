import React from 'react';
import { Clock, MapPin, ChevronRight, Phone, User, AlertTriangle, StickyNote } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Visita } from '../../types/agenda';
import { cn } from '../../lib/utils';
import { getAgendaNoteAlert } from '../../lib/agendaNoteAlert';

interface VisitaCardCompactProps {
  visita: Visita;
  gap?: number;
  onClick: () => void;
  isSelected?: boolean;
}

export const VisitaCardCompact: React.FC<VisitaCardCompactProps> = ({ visita, gap, onClick, isSelected }) => {
  const noteAlert = getAgendaNoteAlert(visita.observacoes);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'concluida': return 'bg-emerald-500';
      case 'pendente': return 'bg-orange-500';
      case 'reagendada': return 'bg-amber-500';
      case 'cancelada': return 'bg-rose-500';
      default: return 'bg-slate-500';
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'concluida': return 'CONCLUÍDA';
      case 'pendente': return 'PENDENTE';
      case 'reagendada': return 'REAGENDADA';
      case 'cancelada': return 'CANCELADA';
      default: return status.toUpperCase();
    }
  };

  const getStatusBadgeClass = (status: string) => {
    switch (status) {
      case 'concluida': return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20';
      case 'pendente': return 'text-orange-400 bg-orange-500/10 border-orange-500/20';
      case 'reagendada': return 'text-amber-400 bg-amber-500/10 border-amber-500/20';
      case 'cancelada': return 'text-rose-400 bg-rose-500/10 border-rose-500/20';
      default: return 'text-slate-400 bg-slate-500/10 border-slate-500/20';
    }
  };

  return (
    <div
      className={cn(
        "w-full transition-all group shadow-sm border rounded-2xl p-2.5 lg:p-3 flex items-center gap-3",
        noteAlert?.level === 'note' && "border-l-4 border-l-sky-400 bg-sky-50/30",
        noteAlert?.level === 'attention' && "border-l-4 border-l-orange-500 bg-orange-50/40",
        noteAlert?.level === 'pending' && "border-l-4 border-l-rose-500 bg-rose-50/50",
        isSelected 
          ? "bg-orange-50/70 border-orange-400 ring-4 ring-orange-500/10 shadow-md" 
          : noteAlert
            ? "hover:bg-white"
            : "bg-white hover:bg-neutral-50 border-neutral-200"
      )}
    >
      {/* Time & Indicator */}
      <div className="flex flex-col items-center gap-1 pr-3 border-r border-neutral-100 min-w-[65px]">
        <div className="text-base font-black text-neutral-900 tracking-tight">
          {(visita.horario_inicio || '').substring(0, 5)}
        </div>
        <div className={cn("w-1 h-1 rounded-full shadow-[0_0_8px]", getStatusColor(visita.status))} />
      </div>

      {/* Main Info */}
      <div className="flex-1 min-w-0 pr-1">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 sm:gap-2 mb-1.5 sm:mb-0.5">
          <Link 
            to={visita.cliente_id ? `/cliente/${visita.cliente_id}` : '#'}
            className={cn(
              "text-sm font-bold truncate hover:text-orange-600 transition-colors cursor-pointer block",
              noteAlert?.level === 'pending' ? "text-rose-700 font-black" : "text-neutral-900"
            )}
            onClick={(e) => {
              if (!visita.cliente_id) e.preventDefault();
            }}
          >
            {visita.cliente_nome}
          </Link>
          <div className="flex items-center gap-1.5 shrink-0">
            {noteAlert && (
              <span className={cn(
                "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[8px] font-black uppercase tracking-tight",
                noteAlert.level === 'note' && "border-sky-100 bg-sky-50 text-sky-700",
                noteAlert.level === 'attention' && "border-orange-100 bg-orange-50 text-orange-700",
                noteAlert.level === 'pending' && "border-rose-100 bg-rose-50 text-rose-700"
              )}>
                {noteAlert.level === 'note' ? <StickyNote size={9} /> : <AlertTriangle size={9} />}
                {noteAlert.label}
              </span>
            )}
            {gap !== undefined && (
              <div className={cn(
                "text-[9px] font-black px-1.5 py-0.5 rounded-md border",
                gap > 0 
                  ? "text-rose-600 bg-rose-50 border-rose-100" 
                  : gap >= -14
                    ? "text-amber-600 bg-amber-50 border-amber-100"
                    : "text-emerald-600 bg-emerald-50 border-emerald-100"
              )}>
                PRÓX: {gap}
              </div>
            )}
            <span className={cn(
              "text-[8px] font-black tracking-tight px-1.5 py-0.5 rounded-md border",
              getStatusBadgeClass(visita.status)
            )}>
              {getStatusLabel(visita.status)}
            </span>
          </div>
        </div>

        <div className="space-y-0.5">
          <div className="flex items-center gap-1.5 text-[10px] text-neutral-500 font-medium">
            <MapPin size={11} className="text-neutral-400 shrink-0" />
            <span className="truncate">{visita.bairro}, {visita.cidade}</span>
          </div>
          <div className="flex items-center gap-3">
             <div className="flex items-center gap-1 text-[9px] text-neutral-400 font-bold uppercase tracking-tight">
               <User size={10} className="text-neutral-300" />
               <span className="truncate max-w-[80px]">{visita.contato}</span>
             </div>
             <div className="flex items-center gap-1 text-[9px] text-neutral-400 font-bold uppercase tracking-tight">
               <Phone size={10} className="text-neutral-300" />
               <span>{visita.telefone}</span>
             </div>
          </div>
          {noteAlert && noteAlert.text && (
            <div className={cn(
              "mt-1 flex items-center gap-1.5 rounded-lg px-2 py-1 text-[10px] font-bold",
              noteAlert.level === 'note' && "bg-sky-50 text-sky-800",
              noteAlert.level === 'attention' && "bg-orange-50 text-orange-800",
              noteAlert.level === 'pending' && "bg-rose-50 text-rose-800"
            )}>
              {noteAlert.level === 'note' ? <StickyNote size={11} className="shrink-0" /> : <AlertTriangle size={11} className="shrink-0" />}
              <span className="truncate">{noteAlert.text}</span>
            </div>
          )}
        </div>
      </div>

      {/* Action Area for Drawer */}
      <button 
        onClick={onClick}
        className="w-8 h-8 rounded-xl bg-neutral-100 flex items-center justify-center text-neutral-400 hover:bg-orange-500 hover:text-white transition-all shrink-0 active:scale-95"
        title="Ver detalhes da visita"
      >
        <ChevronRight size={16} />
      </button>
    </div>
  );
};
