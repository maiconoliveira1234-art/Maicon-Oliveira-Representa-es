import React from 'react';
import { CheckCircle2, Clock, Calendar, TrendingUp } from 'lucide-react';
import { cn } from '../../lib/utils';

interface AgendaDashboardProps {
  visitas: any[];
  currentWeek: number;
}

export function AgendaDashboard({ visitas, currentWeek }: AgendaDashboardProps) {
  const total = visitas.length;
  const concluidas = visitas.filter(v => v.status === 'concluida').length;
  const pendentes = visitas.filter(v => v.status === 'pendente').length;
  const percentual = total > 0 ? Math.round((concluidas / total) * 100) : 0;

  const stats = [
    {
      label: 'Visitas Ciclo',
      value: total,
      icon: Calendar,
      color: 'bg-neutral-100 text-neutral-600',
      description: `Ciclo Semana ${currentWeek}`
    },
    {
      label: 'Concluídas',
      value: concluidas,
      icon: CheckCircle2,
      color: 'bg-green-100 text-green-600',
      description: 'Visitas finalizadas'
    },
    {
      label: 'Pendentes',
      value: pendentes,
      icon: Clock,
      color: 'bg-orange-100 text-orange-600',
      description: 'Aguardando visita'
    },
    {
      label: 'Eficiência',
      value: `${percentual}%`,
      icon: TrendingUp,
      color: 'bg-sky-100 text-sky-600',
      description: 'Taxa de conclusão'
    }
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
      {stats.map((stat, i) => (
        <div key={i} className="bg-white p-5 rounded-3xl border border-neutral-100 shadow-sm transition-all hover:shadow-md">
          <div className="flex justify-between items-start mb-3">
            <div className={cn("w-10 h-10 rounded-2xl flex items-center justify-center", stat.color)}>
              <stat.icon size={20} />
            </div>
            <span className="text-[10px] font-black text-neutral-400 uppercase tracking-widest">Dash</span>
          </div>
          <p className="text-2xl font-black text-neutral-900">{stat.value}</p>
          <p className="text-[10px] font-bold text-neutral-500 uppercase tracking-wider">{stat.label}</p>
          <p className="text-[9px] text-neutral-400 mt-1">{stat.description}</p>
        </div>
      ))}
    </div>
  );
}
