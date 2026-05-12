import React from 'react';
import { useNavigate } from 'react-router-dom';
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
  const navigate = useNavigate();

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
          <button 
            onClick={() => {
              if (visita.cliente_id) {
                navigate(`/cliente/${visita.cliente_id}`);
              }
            }}
            disabled={!visita.cliente_id}
            className={cn(
              "text-left group/name block w-full outline-none",
              visita.cliente_id ? "cursor-pointer" : "cursor-help opacity-80"
            )}
            title={!visita.cliente_id ? "Cliente não vinculado ao cadastro" : "Ver detalhes do cliente"}
          >
            <h3 className={cn(
              "text-lg font-black text-neutral-900 leading-tight transition-colors",
              visita.cliente_id ? "group-hover/name:text-orange-600 group-hover/name:underline decoration-orange-300 underline-offset-4" : ""
            )}>
              {visita.cliente_nome}
            </h3>
          </button>
          <p className="text-xs font-bold text-neutral-500 mt-1 flex items-center gap-1">
            {visita.contato}
          </p>
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
