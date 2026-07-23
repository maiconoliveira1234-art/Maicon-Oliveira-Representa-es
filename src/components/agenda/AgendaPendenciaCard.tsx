import { Check, ClipboardCheck, Clock, MapPin, Pencil } from 'lucide-react';
import { Cliente } from '../../types';
import { cn } from '../../lib/utils';
import { AgendaPendencia } from '../../types/agendaPendencia';

type Props = {
  item: AgendaPendencia;
  cliente?: Cliente;
  onEdit: () => void;
  onComplete: () => void;
};

export function AgendaPendenciaCard({ item, cliente, onEdit, onComplete }: Props) {
  const isVisit = item.tipo === 'VISITA_EXTRA';
  return (
    <div className={cn(
      'flex min-w-0 items-center gap-2 border bg-white px-2.5 py-2 shadow-sm rounded-lg',
      item.prioridade === 'URGENTE' ? 'border-rose-200' : item.prioridade === 'ALTA' ? 'border-amber-200' : 'border-neutral-200'
    )}>
      <div className={cn(
        'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
        isVisit ? 'bg-orange-50 text-orange-600' : 'bg-sky-50 text-sky-600'
      )}>
        {isVisit ? <MapPin size={16} /> : <ClipboardCheck size={16} />}
      </div>
      <button type="button" onClick={onEdit} className="min-w-0 flex-1 text-left">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-black text-neutral-950">{item.titulo}</span>
          {item.prioridade !== 'NORMAL' && (
            <span className={cn(
              'shrink-0 text-[8px] font-black uppercase',
              item.prioridade === 'URGENTE' ? 'text-rose-600' : 'text-amber-600'
            )}>{item.prioridade}</span>
          )}
        </div>
        <div className="flex min-w-0 items-center gap-2 text-[10px] font-bold text-neutral-500">
          {item.horario_inicio && <span className="flex shrink-0 items-center gap-1"><Clock size={10} />{item.horario_inicio.slice(0, 5)}</span>}
          <span className="truncate">{cliente?.cliente || (isVisit ? 'Cliente nao localizado' : 'Tarefa interna')}</span>
        </div>
      </button>
      <button type="button" onClick={onEdit} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-neutral-400 hover:bg-neutral-100 hover:text-neutral-800" title="Editar">
        <Pencil size={16} />
      </button>
      <button type="button" onClick={onComplete} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-600 hover:bg-emerald-100" title="Concluir">
        <Check size={17} />
      </button>
    </div>
  );
}
