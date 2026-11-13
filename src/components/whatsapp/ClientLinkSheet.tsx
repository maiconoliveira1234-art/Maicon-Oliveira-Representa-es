import React, { useEffect, useMemo, useState } from 'react';
import { Check, Loader2, Search, X } from 'lucide-react';
import type { ClienteLite } from '../../lib/whatsappContacts';
import { matchesQuery, normalizeSearch } from '../../lib/whatsappUi';

type Props = {
  title: string;
  /** Profile name shown by WhatsApp; used only to rank likely clients first. */
  hintName?: string | null;
  clientes: ClienteLite[];
  loading?: boolean;
  busy: boolean;
  onPick: (clienteId: string) => void;
  onClose: () => void;
};

export function ClientLinkSheet({ title, hintName, clientes, loading = false, busy, onPick, onClose }: Props) {
  const [search, setSearch] = useState('');

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const hintWords = useMemo(
    () => normalizeSearch(hintName || '').split(/\s+/).filter(word => word.length >= 3),
    [hintName]
  );

  const rows = useMemo(() => {
    const query = search.trim();
    const scored = clientes.map(cliente => {
      const haystack = normalizeSearch([cliente.cliente, cliente.contato].filter(Boolean).join(' '));
      return { cliente, score: hintWords.filter(word => haystack.includes(word)).length };
    });
    const filtered = query ? scored.filter(row => matchesQuery(query, row.cliente.cliente, row.cliente.contato, row.cliente.cidade)) : scored;
    filtered.sort((a, b) =>
      b.score - a.score
      || Number(Boolean(b.cliente.ativo)) - Number(Boolean(a.cliente.ativo))
      || a.cliente.cliente.localeCompare(b.cliente.cliente));
    return filtered.slice(0, query ? 60 : 40);
  }, [clientes, search, hintWords]);

  // Autofocus opens the keyboard over the list on touch screens, so only do it with a mouse.
  const canAutoFocus = typeof window !== 'undefined' && Boolean(window.matchMedia?.('(pointer: fine)').matches);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center bg-black/40 sm:items-center sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Vincular ${title} a um cliente`}
    >
      <div
        className="flex max-h-[85dvh] w-full max-w-xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl"
        onClick={event => event.stopPropagation()}
      >
        <div className="border-b border-neutral-100 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-bold text-neutral-500">Vincular a um cliente do CRM</p>
              <h3 className="truncate text-base font-black text-neutral-900">{title}</h3>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Fechar"
              className="-mr-2 -mt-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-neutral-500 hover:bg-neutral-100"
            >
              <X size={20} />
            </button>
          </div>
          <div className="relative mt-3">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" size={17} />
            <input
              autoFocus={canAutoFocus}
              value={search}
              onChange={event => setSearch(event.target.value)}
              placeholder="Buscar cliente, contato ou cidade"
              className="h-11 w-full rounded-xl border border-neutral-200 pl-10 pr-3 text-base outline-none focus:border-orange-400"
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2 pb-[calc(0.5rem+env(safe-area-inset-bottom,0px))]">
          {loading ? (
            <div className="flex items-center justify-center p-8 text-sm text-neutral-500">
              <Loader2 size={18} className="mr-2 animate-spin" /> Carregando clientes...
            </div>
          ) : (
            <>
              {rows.map(({ cliente, score }) => (
                <button
                  key={cliente.id}
                  type="button"
                  onClick={() => onPick(cliente.id)}
                  disabled={busy}
                  className="flex min-h-[56px] w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left hover:bg-neutral-50 disabled:opacity-50"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-bold text-neutral-900">{cliente.cliente}</p>
                      {score > 0 && <span className="shrink-0 rounded bg-violet-50 px-1.5 py-0.5 text-[11px] font-black text-violet-700">Provável</span>}
                      {cliente.ativo && <span className="shrink-0 rounded bg-green-50 px-1.5 py-0.5 text-[11px] font-black text-green-700">Ativo</span>}
                    </div>
                    <p className="truncate text-xs text-neutral-500">
                      {[cliente.contato, cliente.cidade].filter(Boolean).join(' · ') || 'Sem contato ou cidade informados'}
                    </p>
                  </div>
                  {busy ? <Loader2 size={16} className="shrink-0 animate-spin text-orange-600" /> : <Check size={16} className="shrink-0 text-neutral-300" />}
                </button>
              ))}
              {rows.length === 0 && <div className="p-8 text-center text-sm text-neutral-500">Nenhum cliente encontrado.</div>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
