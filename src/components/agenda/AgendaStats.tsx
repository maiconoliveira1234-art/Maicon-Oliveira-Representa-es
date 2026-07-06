import React from 'react';
import { Calendar, Target, ShoppingBag } from 'lucide-react';
import { motion } from 'motion/react';
import { cn, formatWeight } from '../../lib/utils';

interface AgendaStatsProps {
  visitasTotal: number;
  metaDia: number;
  realizadoTotal: number;
}

export const AgendaStats: React.FC<AgendaStatsProps> = ({ 
  visitasTotal, 
  metaDia, 
  realizadoTotal 
}) => {
  const stats = [
    {
      label: 'Visitas do dia',
      value: visitasTotal,
      icon: Calendar,
      color: 'bg-[#f54900]',
      shadow: 'shadow-[#f54900]/20',
      isWeight: false
    },
    {
      label: 'Meta do dia',
      value: metaDia,
      icon: Target,
      color: 'bg-emerald-500',
      shadow: 'shadow-emerald-500/20',
      isWeight: true
    },
    {
      label: 'Realizado (Mês)',
      value: realizadoTotal,
      icon: ShoppingBag,
      color: 'bg-amber-500',
      shadow: 'shadow-amber-500/20',
      isWeight: true
    }
  ];

  return (
    <div className="grid grid-cols-3 gap-2 lg:gap-3 mb-6">
      {stats.map((stat, i) => (
        <motion.div
          key={stat.label}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.1 }}
          className="bg-white border border-neutral-200 p-2.5 lg:p-4 rounded-lg lg:rounded-lg relative overflow-hidden group hover:border-neutral-300 transition-all shadow-sm"
        >
          <div className="relative z-10">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between mb-1 gap-1">
               <div className={cn("w-7 h-7 lg:w-8 lg:h-8 rounded-lg lg:rounded-lg flex items-center justify-center text-white shrink-0", stat.color, stat.shadow)}>
                 <stat.icon size={14} className="lg:w-[16px]" />
               </div>
               <div className="text-sm lg:text-xl font-black text-neutral-900 truncate">
                 {stat.isWeight ? formatWeight(stat.value) : stat.value}
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
