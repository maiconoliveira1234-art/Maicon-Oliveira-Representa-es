import React from 'react';
import { Visita, VisitaStatus } from '../../types/agenda';
import { 
  MapPin, 
  Phone, 
  MessageCircle, 
  Clock, 
  MoreVertical, 
  CheckCircle2, 
  XCircle, 
  CalendarClock, 
  Navigation 
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { getStatusColor, formatPhoneNumber } from '../../lib/agendaUtils';

interface VisitaCardProps {
  visita: Visita;
  onStatusChange: (status: VisitaStatus) => void | Promise<void>;
  isToday?: boolean;
}

export const VisitaCard: React.FC<VisitaCardProps> = ({ visita, onStatusChange, isToday }) => {
  const openMaps = () => {
    const fullAddress = `${visita.endereco}, ${visita.bairro}, ${visita.cidade}`;
    window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(fullAddress)}`, '_blank');
  };

  const openWhatsApp = () => {
    const cleanPhone = String(visita.telefone || '').replace(/\D/g, '');
    
    // Formata o nome: Primeira letra Maiúscula, restante minúscula
    const rawName = visita.contato || 'Parceiro';
    const contactName = rawName.charAt(0).toUpperCase() + rawName.slice(1).toLowerCase();

    // Saudação dinâmica baseada no horário
    const hour = new Date().getHours();
    let greeting = 'Bom dia';
    if (hour >= 12 && hour < 18) greeting = 'Boa tarde';
    else if (hour >= 18 || hour < 5) greeting = 'Boa noite';

    const message = `${greeting} ${contactName}, tudo bem?`;
    window.open(`https://wa.me/${cleanPhone}?text=${encodeURIComponent(message)}`, '_blank');
  };

  return (
    <div className={cn(
      "group relative bg-white rounded-3xl border-2 transition-all duration-300 p-5 hover:shadow-xl hover:-translate-y-1",
      isToday ? "border-orange-200 shadow-lg shadow-orange-50" : "border-neutral-100"
    )}>
      <div className="flex justify-between items-start mb-4">
        <div className="flex items-center gap-3">
          <div className={cn(
            "w-10 h-10 rounded-2xl flex items-center justify-center transition-colors",
            isToday ? "bg-orange-600 text-white" : "bg-neutral-100 text-neutral-500"
          )}>
            <Clock size={20} />
          </div>
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-neutral-400">Horário</p>
            <p className="text-sm font-bold text-neutral-900 leading-tight">
              {visita.horario_inicio.substring(0, 5)} - {visita.horario_fim.substring(0, 5)}
            </p>
          </div>
        </div>
        
        <div className={cn(
          "px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider border",
          getStatusColor(visita.status)
        )}>
          {visita.status}
        </div>
      </div>

      <div className="space-y-4">
        <div>
          <h3 className="text-lg font-black text-neutral-900 group-hover:text-orange-600 transition-colors leading-tight">
            {visita.cliente_nome}
          </h3>
          <p className="text-xs font-bold text-neutral-500 mt-1 flex items-center gap-1">
            {visita.contato}
          </p>
        </div>

        <div className="space-y-2">
          <div className="flex items-start gap-2 text-neutral-500 text-xs font-medium bg-neutral-50 p-3 rounded-2xl overflow-hidden">
            <MapPin size={16} className="shrink-0 mt-0.5 text-neutral-400" />
            <div className="flex-1">
              <p className="text-neutral-900 font-bold mb-0.5 truncate">{visita.endereco}</p>
              <p className="text-[10px] opacity-75">{visita.bairro} • {visita.cidade}</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={openWhatsApp}
            className="flex items-center justify-center gap-2 py-2.5 bg-green-50 text-green-700 rounded-2xl font-black text-[10px] uppercase tracking-wider hover:bg-green-100 transition-colors"
          >
            <MessageCircle size={16} fill="currentColor" />
            WhatsApp
          </button>
          <a
            href={`tel:${visita.telefone}`}
            className="flex items-center justify-center gap-2 py-2.5 bg-sky-50 text-sky-700 rounded-2xl font-black text-[10px] uppercase tracking-wider hover:bg-sky-100 transition-colors"
          >
            <Phone size={16} />
            Ligar
          </a>
        </div>

        <div className="pt-2 flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-hide">
          <button 
            onClick={() => onStatusChange('concluida')}
            className={cn(
              "flex-1 shrink-0 flex items-center justify-center gap-1.5 py-2 rounded-xl text-[9px] font-black uppercase transition-all",
              visita.status === 'concluida' ? "bg-green-600 text-white" : "bg-neutral-100 text-neutral-500 hover:bg-green-50"
            )}
          >
            <CheckCircle2 size={12} />
            Check
          </button>
          <button 
            onClick={() => onStatusChange('reagendada')}
            className={cn(
              "flex-1 shrink-0 flex items-center justify-center gap-1.5 py-2 rounded-xl text-[9px] font-black uppercase transition-all",
              visita.status === 'reagendada' ? "bg-purple-600 text-white" : "bg-neutral-100 text-neutral-500 hover:bg-purple-50"
            )}
          >
            <CalendarClock size={12} />
            Adiar
          </button>
          <button 
            onClick={() => onStatusChange('cancelada')}
            className={cn(
              "flex-1 shrink-0 flex items-center justify-center gap-1.5 py-2 rounded-xl text-[9px] font-black uppercase transition-all",
              visita.status === 'cancelada' ? "bg-red-600 text-white" : "bg-neutral-100 text-neutral-500 hover:bg-red-50"
            )}
          >
            <XCircle size={12} />
            X
          </button>
        </div>

        <button
          onClick={openMaps}
          className="w-full flex items-center justify-center gap-2 py-3 bg-neutral-900 text-white rounded-2xl font-bold text-xs hover:bg-neutral-800 transition-all shadow-lg active:scale-95"
        >
          <Navigation size={18} className="text-orange-400" />
          Iniciar Rota no Maps
        </button>
      </div>
    </div>
  );
}
