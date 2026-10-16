import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search, X } from 'lucide-react';
import type { Produto } from '../../types';
import { filterCampaignSkus } from '../../lib/campaignSkuSearch';

type Props = {
  label: string;
  produtos: Produto[];
  value: string;
  onChange: (produtoId: string) => void;
  disabled?: boolean;
  placeholder?: string;
  allowSameProduct?: boolean;
};

export function CampaignSkuSearch({
  label, produtos, value, onChange, disabled = false,
  placeholder = 'Digite para pesquisar produtos',
  allowSameProduct = false,
}: Props) {
  const inputId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);

  const selected = produtos.find(p => p.id === value);
  const { results, total } = useMemo(
    () => filterCampaignSkus(produtos, query),
    [produtos, query],
  );
  // A escolha "mesmo SKU" é permitida somente para o produto bonificado.
  const options: Array<Produto | null> = allowSameProduct && !query.trim()
    ? [null, ...results] : results;

  useEffect(() => {
    if (!open) return;
    const dismissOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('pointerdown', dismissOutside);
    return () => document.removeEventListener('pointerdown', dismissOutside);
  }, [open]);

  const choose = (product: Produto | null) => {
    onChange(product?.id || '');
    setQuery('');
    setActiveIndex(0);
    setOpen(false);
    inputRef.current?.blur();
  };

  const inputValue = open ? query : (selected?.produto || '');
  const activeOption = options.length ? Math.min(activeIndex, options.length - 1) : -1;

  return (
    <div ref={rootRef} className="relative z-20 min-w-0 space-y-1">
      <label htmlFor={inputId} className="block text-xs font-semibold text-neutral-700">
        {label}
      </label>
      <div className="relative">
        <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
        <input
          id={inputId}
          ref={inputRef}
          type="text"
          role="combobox"
          autoComplete="off"
          aria-autocomplete="list"
          aria-expanded={open && !disabled}
          aria-controls={inputId + '-options'}
          aria-activedescendant={open && activeOption >= 0 ? inputId + '-option-' + activeOption : undefined}
          disabled={disabled}
          placeholder={disabled ? 'Seleção por família ativa' : placeholder}
          value={inputValue}
          onFocus={() => {
            setQuery('');
            setActiveIndex(0);
            setOpen(true);
          }}
          onChange={event => {
            const next = event.target.value;
            setQuery(next);
            setActiveIndex(0);
            setOpen(true);
            // Texto digitado não pode continuar associado ao SKU anterior.
            if (value) onChange('');
          }}
          onKeyDown={event => {
            if (event.key === 'Escape') {
              setOpen(false);
              setQuery('');
              inputRef.current?.blur();
            } else if (event.key === 'ArrowDown') {
              event.preventDefault();
              setOpen(true);
              setActiveIndex(i => Math.min(i + 1, Math.max(0, options.length - 1)));
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              setOpen(true);
              setActiveIndex(i => Math.max(0, i - 1));
            } else if (event.key === 'Enter' && open) {
              event.preventDefault();
              if (activeOption >= 0) choose(options[activeOption]);
            }
          }}
          className="w-full min-w-0 rounded-lg border border-neutral-200 bg-white py-2.5 pl-9 pr-9 text-sm text-neutral-900 outline-none placeholder:text-neutral-400 focus:border-orange-500 disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:text-neutral-400"
        />
        {selected && !disabled ? (
          <button
            type="button"
            title="Limpar produto selecionado"
            aria-label={'Remover SKU selecionado de ' + label}
            onMouseDown={e => e.preventDefault()}
            onClick={() => {
              onChange('');
              setQuery('');
              setOpen(false);
            }}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-neutral-500 hover:bg-neutral-100"
          >
            <X size={16} />
          </button>
        ) : (
          <ChevronDown size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400" />
        )}
      </div>
      {allowSameProduct && !value && !open && !disabled && (
        <p className="text-[11px] text-neutral-500">
          Sem SKU selecionado: bonifica o mesmo produto, quando houver apenas um SKU participante.
        </p>
      )}
      {disabled && (
        <p className="text-[11px] text-neutral-500">A regra considera todos os SKUs da família selecionada.</p>
      )}
      {open && !disabled && (
        <div
          id={inputId + '-options'}
          role="listbox"
          aria-label={'Produtos encontrados para ' + label}
          className="absolute left-0 right-0 z-50 max-h-60 overflow-y-auto overscroll-contain rounded-lg border border-orange-200 bg-white py-1 shadow-xl"
        >
          {options.map((product, index) => (
            <button
              type="button"
              role="option"
              id={inputId + '-option-' + index}
              key={product?.id || 'same-product'}
              aria-selected={(product?.id || '') === value}
              onMouseDown={event => event.preventDefault()}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => choose(product)}
              className={
                'flex w-full min-w-0 items-center gap-2 px-3 py-2.5 text-left text-xs hover:bg-orange-50 ' +
                (activeOption === index ? 'bg-orange-50 ' : '') +
                ((product?.id || '') === value ? 'font-bold text-orange-800' : 'text-neutral-800')
              }
            >
              <span className="min-w-0 flex-1">
                <span className="block break-words">{product?.produto || 'Mesmo produto comprado (SKU único)'}</span>
                {product?.familia && <span className="block text-[10px] font-normal text-neutral-500">{product.familia}</span>}
              </span>
              {(product?.id || '') === value && <Check size={14} className="shrink-0 text-orange-600" />}
            </button>
          ))}
          {options.length === 0 && (
            <div role="status" className="px-3 py-3 text-xs text-neutral-500">
              Nenhum produto encontrado. Tente outra palavra.
            </div>
          )}
          {total > results.length && (
            <p className="border-t border-neutral-100 px-3 py-2 text-[11px] text-neutral-500">
              Exibindo {results.length} de {total} produtos. Digite mais para refinar.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
