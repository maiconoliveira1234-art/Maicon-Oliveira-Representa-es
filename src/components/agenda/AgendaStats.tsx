import React from 'react';
import { Calendar, CheckCircle2, Clock, PieChart } from 'lucide-react';
import { motion } from 'motion/react';
import { Visita } from '../../types/agenda';
import { cn } from '../../lib/utils';

interface AgendaStatsProps {
  visitas: Visita[];
}

export const AgendaStats: React.FC<AgendaStatsProps> = ({ visitas }) => {
  const total = visitas.length;
  const concluidas = visitas.filter(v => v.status === 'concluida').length;
  const pendentes = visitas.filter(v => v.status === 'pendente').length;
  const percentual = total > 0 ? Math.round((concluidas / total) * 100) : 0;

  const stats = [
    {
      label: 'Visitas do dia',
      value: total,
      icon: Calendar,
      color: 'bg-[#f54900]',
      shadow: 'shadow-[#f54900]/20'
    },
    {
      label: 'Concluídas',
      value: concluidas,
      icon: CheckCircle2,
      color: 'bg-emerald-500',
      shadow: 'shadow-emerald-500/20'
    },
    {
      label: 'Pendentes',
      value: pendentes,
      icon: Clock,
      color: 'bg-amber-500',
      shadow: 'shadow-amber-500/20'
    },
    {
      label: 'Conclusão',
      value: `${percentual}%`,
      icon: PieChart,
      color: 'bg-slate-500',
      shadow: 'shadow-slate-500/20'
    }
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 lg:gap-3 mb-6">
      {stats.map((stat, i) => (
        <motion.div
          key={stat.label}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.1 }}
          className="bg-white border border-neutral-200 p-3 lg:p-4 rounded-[1.5rem] relative overflow-hidden group hover:border-neutral-300 transition-all shadow-sm"
        >
          <div className="relative z-10">
            <div className="flex items-center justify-between mb-1">
               <div className={cn("w-8 h-8 rounded-xl flex items-center justify-center text-white", stat.color, stat.shadow)}>
                 <stat.icon size={16} />
               </div>
               <div className="text-xl font-black text-neutral-900">
                 {stat.value}
               </div>
            </div>
            <p className="text-[9px] font-black text-neutral-400 uppercase tracking-[0.1em]">
              {stat.label}
            </p>
          </div>
          
          {/* Subtle background decoration */}
          <div className="absolute -right-1 -bottom-1 opacity-5 pointer-events-none group-hover:opacity-10 transition-opacity text-neutral-200">
            <stat.icon size={60} strokeWidth={1} />
          </div>
        </motion.div>
      ))}
    </div>
  );
};
