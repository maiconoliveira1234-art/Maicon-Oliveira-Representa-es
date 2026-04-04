import React, { useState, useRef, useEffect } from 'react';
import { Search, ChevronDown, X } from 'lucide-react';
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
  placeholder = "Buscar...",
  icon
}: FilterDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedOption = options.find(o => o.id === selected);

  const filteredOptions = options.filter(o => 
    o.label.toLowerCase().includes(searchTerm.toLowerCase())
  );

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="relative" ref={containerRef}>
      <div 
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "w-full pl-12 pr-10 py-3 bg-white border border-neutral-200 rounded-2xl shadow-sm focus-within:ring-2 focus-within:ring-orange-500 outline-none transition-all cursor-pointer flex items-center justify-between",
          isOpen && "ring-2 ring-orange-500 border-orange-500"
        )}
      >
        <div className="absolute left-4 top-1/2 -translate-y-1/2 text-neutral-400">
          {icon}
        </div>
        
        <span className={cn(
          "text-sm truncate",
          !selectedOption ? "text-neutral-400" : "text-neutral-900 font-medium"
        )}>
          {selectedOption ? selectedOption.label : label}
        </span>

        <ChevronDown size={20} className={cn("text-neutral-400 transition-transform", isOpen && "rotate-180")} />
      </div>

      {isOpen && (
        <div className="absolute top-full left-0 right-0 mt-2 bg-white border border-neutral-200 rounded-2xl shadow-xl z-[100] overflow-hidden animate-in fade-in zoom-in duration-200">
          <div className="p-3 border-b border-neutral-100">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" size={16} />
              <input
                autoFocus
                type="text"
                placeholder={placeholder}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 bg-neutral-50 border border-neutral-100 rounded-xl text-sm outline-none focus:ring-2 focus:ring-orange-500 transition-all"
              />
            </div>
          </div>
          
          <div className="max-h-60 overflow-y-auto p-1">
            {filteredOptions.length > 0 ? (
              filteredOptions.map((option) => (
                <button
                  key={option.id}
                  onClick={() => {
                    onChange(option.id);
                    setIsOpen(false);
                    setSearchTerm('');
                  }}
                  className={cn(
                    "w-full text-left px-4 py-2.5 rounded-xl text-sm transition-colors flex items-center justify-between group",
                    selected === option.id 
                      ? "bg-orange-50 text-orange-600 font-bold" 
                      : "text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900"
                  )}
                >
                  <span className="truncate">{option.label}</span>
                  {selected === option.id && <div className="w-1.5 h-1.5 rounded-full bg-orange-600" />}
                </button>
              ))
            ) : (
              <div className="p-8 text-center text-neutral-400 text-xs italic">
                Nenhum resultado encontrado
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
