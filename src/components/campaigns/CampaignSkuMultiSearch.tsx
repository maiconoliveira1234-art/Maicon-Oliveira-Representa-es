import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search, X } from 'lucide-react';
import type { Produto } from '../../types';
import { filterCampaignSkus } from '../../lib/campaignSkuSearch';
import { addCampaignSkuIds, toggleCampaignSkuId } from '../../lib/campaignSkuSelection';

type Props = {
  label: string;
  produtos: Produto[];
  values: string[];
  onChange: (produtoIds: string[]) => void;
  disabled?: boolean;
};

/** Search & multi-selection; selected SKU IDs remain independent from typed text. */
export function CampaignSkuMultiSearch({
  label, produtos, values, onChange, disabled = false,
}: Props) {
  const inputId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);

  const selectedIds = [...new Set(values || [])];
  const selected = useMemo(() => {
    const byId = new Map(produtos.map(p => [p.id, p]));
    return selectedIds.map(id => ({ id, produto: byId.get(id) }));
  }, [produtos, values]);
  const { results, total } = useMemo(
    () => filterCampaignSkus(produtos, query, 30),
    [produtos, query],
  );
  // Bulk actions consider all matching SKUs, not merely the first 30 displayed.
  const allMatchingIds = useMemo(
    () => query.trim() ? filterCampaignSkus(produtos, query, Math.max(1, produtos.length)).results.map(p => p.id) : [],
    [produtos, query],
  );
  const canBulkSelect = allMatchingIds.some(id => !selectedIds.includes(id));

  useEffect(() => {
    if (!open) return;
    const handlePointerOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', handlePointerOutside);
    return () => document.removeEventListener('pointerdown', handlePointerOutside);
  }, [open]);

  const toggle = (id: string) => {
    onChange(toggleCampaignSkuId(values, id));
    // Keep search and list open for selecting a second, third, etc. SKU.
    setOpen(true);
    inputRef.current?.focus();
  };

  const selectAllMatches = () => {
    onChange(addCampaignSkuIds(values, allMatchingIds));
    setOpen(true);
    inputRef.current?.focus();
  };

  return (
    <div ref={rootRef} className="relative z-20 min-w-0 space-y-2 sm:col-span-2">
      <label htmlFor={inputId} className="block text-xs font-semibold text-neutral-700">{label}</label>
      <div className="relative">
        <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
        <input
          id={inputId}
          ref={inputRef}
          type="search"
          role="combobox"
          aria-expanded={open && !disabled}
          aria-autocomplete="list"
          aria-controls={inputId + '-options'}
          disabled={disabled}
          placeholder={disabled ? 'Família selecionada: todos os SKUs da família' : 'Busque por nome, linha, peso ou espécie...'}
          value={query}
          onChange={e => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={e => {
            if (e.key === 'Escape') { setOpen(false); inputRef.current?.blur(); }
            if (e.key === 'Enter' && open) { e.preventDefault(); }
          }}
          className="w-full min-w-0 rounded-lg border border-neutral-200 bg-white py-2.5 pl-9 pr-9 text-sm text-neutral-900 outline-none placeholder:text-neutral-400 focus:border-orange-500 disabled:bg-neutral-100 disabled:text-neutral-400"
        />
        <ChevronDown size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400" />
      </div>

      {!disabled && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[11px] font-semibold text-neutral-600">
              {selectedIds.length} {selectedIds.length === 1 ? 'produto selecionado' : 'produtos selecionados'}
            </p>
            {selectedIds.length > 0 && (
              <button type="button" onClick={() => onChange([])} className="text-[11px] font-bold text-orange-700 hover:underline">
                Limpar seleção
              </button>
            )}
          </div>
          {selected.length > 0 && (
            <div className="flex flex-wrap gap-1.5" aria-label="SKUs participantes selecionados">
              {selected.map(({ id, produto }) => (
                <span key={id} className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-orange-200 bg-orange-50 px-2.5 py-1.5 text-xs font-medium text-orange-900">
                  <span className="min-w-0 break-words">{produto?.produto || 'Produto não localizado (' + id + ')'}</span>
                  <button type="button" aria-label={'Remover ' + (produto?.produto || id)}
                    onClick={() => onChange(selectedIds.filter(x => x !== id))}
                    className="shrink-0 rounded p-0.5 hover:bg-orange-200">
                    <X size={14}/>
                  </button>
                </span>
              ))}
            </div>
          )}
          <p className="text-[11px] text-neutral-500">Selecione vários SKUs. As quantidades dos produtos participantes serão somadas para atingir o mínimo da campanha.</p>
        </div>
      )}
      {disabled && <p className="text-[11px] text-neutral-500">A regra considera todos os SKUs da família selecionada.</p>}

      {open && !disabled && (
        <div id={inputId + '-options'} role="listbox" aria-multiselectable="true"
          aria-label={'Produtos encontrados para ' + label}
          className="absolute left-0 right-0 z-50 overflow-hidden rounded-lg border border-orange-200 bg-white shadow-xl">
          {query.trim() && allMatchingIds.length > 0 && (
            <div className="flex items-center justify-between gap-2 border-b border-neutral-100 p-2">
              <span className="text-[11px] text-neutral-500">{total} {total === 1 ? 'resultado' : 'resultados'}</span>
              <button type="button" disabled={!canBulkSelect} onClick={selectAllMatches}
                className="rounded-md border border-orange-300 bg-orange-50 px-2.5 py-1.5 text-[11px] font-bold text-orange-800 disabled:cursor-not-allowed disabled:opacity-50">
                {canBulkSelect ? 'Selecionar todos os resultados' : 'Todos já selecionados'}
              </button>
            </div>
          )}
          <div className="max-h-60 overflow-y-auto overscroll-contain py-1">
            {results.map(product => {
              const chosen = selectedIds.includes(product.id);
              return (
                <button type="button" role="option" key={product.id}
                  aria-selected={chosen} onClick={() => toggle(product.id)}
                  className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-xs text-neutral-800 hover:bg-orange-50">
                  <span aria-hidden="true" className={'flex h-4 w-4 shrink-0 items-center justify-center rounded border ' +
                    (chosen ? 'border-orange-600 bg-orange-600 text-white' : 'border-neutral-300 bg-white')}>
                    {chosen && <Check size={12}/>}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={'block break-words ' + (chosen ? 'font-bold text-orange-800' : 'font-medium')}>{product.produto}</span>
                    {product.familia && <span className="block text-[10px] text-neutral-500">{product.familia}</span>}
                  </span>
                </button>
              );
            })}
            {results.length === 0 && <p className="px-3 py-3 text-xs text-neutral-500" role="status">Nenhum produto encontrado. Tente outra palavra.</p>}
          </div>
          {total > results.length && (
            <p className="border-t border-neutral-100 px-3 py-2 text-[11px] text-neutral-500">
              Mostrando {results.length} de {total}. Refine a busca ou selecione todos os resultados.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
