import React, { useState, useRef, useEffect } from 'react';
import { Search, ChevronDown, X, Check } from 'lucide-react';
import { cn } from '../lib/utils';

interface Option {
  id: string;
  label: string;
}

interface FilterDropdownProps {
  label: string;
  options: Option[];
  selected: string;
  onChange: (value: string) => void;
  placeholder?: string;
  icon?: React.ReactNode;
}

export function FilterDropdown({
  label,
  options,
  selected,
  onChange,
  placeholder = 'Buscar...',
  icon,
}: FilterDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selectedOption = options.find(o => o.id === selected);

  const filteredOptions = options.filter(o =>
    o.label.toLowerCase().includes(searchTerm.toLowerCase())
  );

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setSearchTerm('');
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          'w-full flex items-center gap-2 px-4 py-2.5 bg-white border rounded-xl text-sm transition-all shadow-sm',
          isOpen
            ? 'border-orange-500 ring-2 ring-orange-100'
            : 'border-neutral-200 hover:border-neutral-300'
        )}
      >
        {icon && <span className="text-neutral-400 shrink-0">{icon}</span>}
        <span className={cn(
          'flex-1 text-left truncate',
          selectedOption ? 'text-neutral-900 font-medium' : 'text-neutral-400'
        )}>
          {selectedOption ? selectedOption.label : label}
        </span>

        <div className="flex items-center gap-1 shrink-0">
          {selectedOption && (
            <span
              role="button"
              tabIndex={0}
              onClick={e => { e.stopPropagation(); onChange(''); }}
              onKeyDown={e => e.key === 'Enter' && onChange('')}
              className="p-0.5 rounded hover:bg-neutral-100 text-neutral-400"
            >
              <X size={13} />
            </span>
          )}
          <ChevronDown
            size={16}
            className={cn('text-neutral-400 transition-transform duration-150', isOpen && 'rotate-180')}
          />
        </div>
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 right-0 mt-1.5 bg-white border border-neutral-200 rounded-xl shadow-xl z-[100] overflow-hidden">
          {/* Search input */}
          <div className="p-2 border-b border-neutral-100">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400" size={14} />
              <input
                ref={inputRef}
                type="text"
                placeholder={placeholder}
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 bg-neutral-50 border border-neutral-100 rounded-lg text-sm outline-none focus:ring-2 focus:ring-orange-400 transition-all"
              />
            </div>
          </div>

          {/* Options list */}
          <div className="max-h-56 overflow-y-auto p-1">
            {filteredOptions.length > 0 ? (
              filteredOptions.map(option => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => {
                    onChange(option.id);
                    setIsOpen(false);
                    setSearchTerm('');
                  }}
                  className={cn(
                    'w-full text-left px-3 py-2 rounded-lg text-sm transition-colors flex items-center justify-between gap-2',
                    selected === option.id
                      ? 'bg-orange-50 text-orange-700 font-semibold'
                      : 'text-neutral-700 hover:bg-neutral-50'
                  )}
                >
                  <span className="truncate">{option.label}</span>
                  {selected === option.id && (
                    <Check size={14} className="text-orange-600 shrink-0" />
                  )}
                </button>
              ))
            ) : (
              <div className="py-8 text-center text-neutral-400 text-xs">
                Nenhum resultado encontrado
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
