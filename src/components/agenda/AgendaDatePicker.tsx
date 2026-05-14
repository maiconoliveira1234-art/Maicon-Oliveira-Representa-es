import React, { useState, useMemo } from 'react';
import { 
  ChevronLeft, 
  ChevronRight, 
  X,
  ChevronDown
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  format, 
  addMonths, 
  subMonths, 
  startOfMonth, 
  endOfMonth, 
  startOfWeek, 
  endOfWeek, 
  eachDayOfInterval, 
  isSameMonth, 
  isSameDay, 
  startOfToday,
  setYear,
  getYear,
  addYears,
  subYears,
  startOfYear,
  differenceInWeeks
} from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { cn } from '../../lib/utils';
import { Visita, DiaSemana } from '../../types/agenda';

interface AgendaDatePickerProps {
  isOpen: boolean;
  onClose: () => void;
  selectedDate: Date;
  onSelect: (date: Date) => void;
  visitas: Visita[];
}

const DIAS_SEMANA_MAP: Record<number, DiaSemana> = {
  1: 'Segunda',
  2: 'Terça',
  3: 'Quarta',
  4: 'Quinta',
  5: 'Sexta'
};

export const AgendaDatePicker: React.FC<AgendaDatePickerProps> = ({
  isOpen,
  onClose,
  selectedDate,
  onSelect,
  visitas
}) => {
  const [currentMonth, setCurrentMonth] = useState(selectedDate);
  const [showYearPicker, setShowYearPicker] = useState(false);

  const getCycleWeek = (date: Date): 1 | 2 => {
    const anchor = startOfYear(date);
    const weeksSinceAnchor = differenceInWeeks(date, anchor);
    return (weeksSinceAnchor % 2 === 0) ? 1 : 2;
  };

  const getDayName = (date: Date): DiaSemana | null => {
    const dayIdx = date.getDay();
    return DIAS_SEMANA_MAP[dayIdx as keyof typeof DIAS_SEMANA_MAP] || null;
  };

  const hasVisits = (date: Date) => {
    const week = getCycleWeek(date);
    const day = getDayName(date);
    if (!day) return false;
    return visitas.some(v => v.semana === week && v.dia_semana === day);
  };

  const days = useMemo(() => {
    const start = startOfWeek(startOfMonth(currentMonth), { weekStartsOn: 0 });
    const end = endOfWeek(endOfMonth(currentMonth), { weekStartsOn: 0 });
    return eachDayOfInterval({ start, end });
  }, [currentMonth]);

  const weekDays = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];

  const years = useMemo(() => {
    const current = getYear(new Date());
    const range = [];
    for (let i = current - 5; i <= current + 5; i++) {
      range.push(i);
    }
    return range;
  }, []);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Overlay for mobile/desktop click outside */}
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-50 bg-black/20 backdrop-blur-sm md:bg-transparent"
          />

          {/* Picker Container */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            className={cn(
              "fixed z-[60] bg-white rounded-[2.5rem] shadow-2xl shadow-neutral-900/10 border border-neutral-100 overflow-hidden",
              "bottom-4 left-4 right-4 md:absolute md:bottom-auto md:left-auto md:right-0 md:top-full md:mt-4 md:w-80"
            )}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="p-6 pb-4 flex items-center justify-between border-b border-neutral-50">
              <div className="flex flex-col">
                <button 
                  onClick={() => setShowYearPicker(!showYearPicker)}
                  className="flex items-center gap-1 group text-left"
                >
                  <span className="text-lg font-black text-neutral-900 capitalize leading-none">
                    {format(currentMonth, 'MMMM', { locale: ptBR })}
                  </span>
                  <ChevronDown className={cn(
                    "text-neutral-400 group-hover:text-orange-500 transition-all",
                    showYearPicker && "rotate-180"
                  )} size={16} />
                </button>
                <span className="text-[10px] font-black text-neutral-400 uppercase tracking-widest mt-1">
                  {format(currentMonth, 'yyyy')}
                </span>
              </div>

              <div className="flex items-center gap-1">
                <button 
                  onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
                  className="w-8 h-8 rounded-full flex items-center justify-center text-neutral-400 hover:bg-neutral-100 hover:text-neutral-900 transition-all"
                >
                  <ChevronLeft size={18} />
                </button>
                <button 
                  onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
                  className="w-8 h-8 rounded-full flex items-center justify-center text-neutral-400 hover:bg-neutral-100 hover:text-neutral-900 transition-all"
                >
                  <ChevronRight size={18} />
                </button>
              </div>
            </div>

            <div className="relative">
              {/* Year Picker Overlay */}
              <AnimatePresence>
                {showYearPicker && (
                  <motion.div
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    className="absolute inset-0 z-10 bg-white p-4 grid grid-cols-3 gap-2 overflow-y-auto max-h-[320px]"
                  >
                    {years.map((year) => (
                      <button
                        key={year}
                        onClick={() => {
                          setCurrentMonth(setYear(currentMonth, year));
                          setShowYearPicker(false);
                        }}
                        className={cn(
                          "py-3 rounded-2xl text-xs font-black transition-all",
                          year === getYear(currentMonth)
                            ? "bg-orange-500 text-white shadow-lg shadow-orange-500/20"
                            : "text-neutral-500 hover:bg-neutral-50"
                        )}
                      >
                        {year}
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Main Calendar Grid */}
              <div className="p-6 pt-4">
                <div className="grid grid-cols-7 mb-2">
                  {weekDays.map((day, idx) => (
                    <div 
                      key={idx} 
                      className="text-[9px] font-black text-neutral-300 text-center uppercase tracking-widest"
                    >
                      {day}
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-7 gap-1">
                  {days.map((day, idx) => {
                    const isSelected = isSameDay(day, selectedDate);
                    const isToday = isSameDay(day, startOfToday());
                    const isCurrentMonth = isSameMonth(day, currentMonth);
                    const hasPlannedVisits = hasVisits(day);

                    return (
                      <button
                        key={idx}
                        onClick={() => {
                          onSelect(day);
                          onClose();
                        }}
                        className={cn(
                          "relative aspect-square rounded-full flex flex-col items-center justify-center text-xs transition-all",
                          !isCurrentMonth && "opacity-20",
                          isSelected 
                            ? "bg-orange-600 text-white font-black shadow-lg shadow-orange-600/30 scale-110 z-10" 
                            : isToday 
                              ? "bg-orange-50 text-orange-600 font-bold border border-orange-100" 
                              : "text-neutral-900 font-medium hover:bg-neutral-50 active:scale-90"
                        )}
                      >
                        {format(day, 'd')}
                        
                        {hasPlannedVisits && (
                          <div className={cn(
                            "absolute bottom-1 w-1 h-1 rounded-full",
                            isSelected ? "bg-white/60" : "bg-orange-400"
                          )} />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="p-4 bg-neutral-50 flex items-center justify-center">
              <button 
                onClick={() => {
                  onSelect(startOfToday());
                  onClose();
                }}
                className="text-[10px] font-black text-neutral-400 hover:text-orange-600 uppercase tracking-widest transition-colors"
              >
                Voltar para Hoje
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};
