import React, { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, type LucideIcon } from 'lucide-react';
import { cn } from '../lib/utils';

export type ReportOption<T extends string> = { id: T; label: string; icon: LucideIcon };

/** Menu suspenso para escolher o relatório da Análise Comercial. */
export function ReportPicker<T extends string>({ options, value, onChange }: {
  options: ReportOption<T>[];
  value: T;
  onChange: (id: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const current = options.find(o => o.id === value) || options[0];
  const CurrentIcon = current.icon;

  useEffect(() => {
    if (!open) return;
    const closeOnOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative w-full sm:w-80">
      <button
        type="button"
        id="report-picker"
        onClick={() => setOpen(o => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Relatório: ${current.label}`}
        className={cn(
          'flex h-12 w-full items-center gap-3 rounded-xl border bg-white px-3 text-left shadow-sm transition-colors',
          open ? 'border-orange-500 ring-2 ring-orange-100' : 'border-neutral-200 hover:bg-neutral-50'
        )}
      >
        <span className="rounded-lg bg-orange-50 p-1.5 text-orange-600"><CurrentIcon size={18} /></span>
        <span className="min-w-0 flex-1 truncate text-base font-extrabold text-neutral-900">{current.label}</span>
        <ChevronDown size={18} className={cn('shrink-0 text-neutral-400 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div role="menu" aria-labelledby="report-picker" className="absolute left-0 right-0 top-full z-50 mt-2 overflow-hidden rounded-xl border border-neutral-200 bg-white py-1 shadow-xl">
          {options.map(option => {
            const Icon = option.icon;
            const active = option.id === value;
            return (
              <button
                key={option.id}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                onClick={() => { onChange(option.id); setOpen(false); }}
                className={cn(
                  'flex h-12 w-full items-center gap-3 px-3 text-left text-sm font-bold transition-colors',
                  active ? 'bg-orange-50 text-orange-700' : 'text-neutral-800 hover:bg-neutral-50'
                )}
              >
                <Icon size={18} className={active ? 'text-orange-600' : 'text-neutral-400'} />
                <span className="flex-1">{option.label}</span>
                {active && <Check size={18} className="text-orange-600" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
