import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, Plus, X } from 'lucide-react';
import { format } from 'date-fns';
import { supabase } from '../lib/supabase';

export interface FinancialStoreSummary {
  id: string;
  razao_social: string;
  limite_total: number;
}

type Props = {
  clienteId: string;
  clienteNome: string;
  onClose: () => void;
  onCreated: (store: FinancialStoreSummary) => void;
};

function parseMoney(raw: string): number {
  const value = raw.trim().replace(/\\s/g, '').replace(/R\\$/gi, '');
  if (!value) return NaN;
  const normalized = value.includes(',') ? value.replace(/\\./g, '').replace(',', '.') : value;
  return Number(normalized);
}

export function AddFinancialStoreModal({ clienteId, clienteNome, onClose, onCreated }: Props) {
  const [razaoSocial, setRazaoSocial] = useState('');
  const [limite, setLimite] = useState('');
  const [disponivel, setDisponivel] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (saving) return;
    setError('');
    const name = razaoSocial.trim().replace(/\\s+/g, ' ').toUpperCase();
    const total = parseMoney(limite);
    const initialAvailable = disponivel.trim() ? parseMoney(disponivel) : total;

    if (name.length < 3 || name.length > 200) {
      setError('Informe a razão social (3 a 200 caracteres).');
      return;
    }
    if (!Number.isFinite(total) || total <= 0 || Math.round(total * 100) !== total * 100 && Math.abs(Math.round(total * 100) - total * 100) > 0.0001) {
      setError('Informe um limite positivo, com até duas casas decimais.');
      return;
    }
    if (!Number.isFinite(initialAvailable) || initialAvailable < 0 || initialAvailable > total ||
        Math.abs(Math.round(initialAvailable * 100) - initialAvailable * 100) > 0.0001) {
      setError('O disponível inicial deve estar entre zero e o limite total, com até duas casas decimais.');
      return;
    }

    setSaving(true);
    try {
      const { data: linked, error: lookupError } = await supabase.from('entidades_financeiras')
        .select('id, razao_social').eq('cliente_comercial_id', clienteId);
      if (lookupError) throw lookupError;
      if ((linked || []).some(store => store.razao_social.trim().toLocaleUpperCase('pt-BR') === name)) {
        setError('Esta razão social já está vinculada ao cliente.');
        return;
      }

      const { data, error: insertError } = await supabase.from('entidades_financeiras')
        .insert({
          cliente_comercial_id: clienteId,
          razao_social: name,
          limite_total: Math.round(total * 100) / 100,
          disponivel_oficial_snapshot: Math.round(initialAvailable * 100) / 100,
          data_snapshot: format(new Date(), 'yyyy-MM-dd'),
          situacao: 'ativo',
          titulos_conferidos: false
        })
        .select('id, razao_social, limite_total').single();
      if (insertError || !data) throw insertError || new Error('Cadastro não foi confirmado no servidor.');
      onCreated({
        id: data.id,
        razao_social: data.razao_social,
        limite_total: Number(data.limite_total)
      });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Falha ao cadastrar a loja financeira.');
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[400] flex items-center justify-center bg-black/70 p-4" role="presentation">
      <div role="dialog" aria-modal="true" aria-labelledby="nova-loja-titulo"
        className="w-full max-w-md rounded-xl bg-white p-5 shadow-2xl">
        <div className="mb-4 flex items-start justify-between gap-2">
          <div>
            <h3 id="nova-loja-titulo" className="text-lg font-extrabold text-neutral-900">Acrescentar loja</h3>
            <p className="text-xs text-neutral-600">Cadastro financeiro vinculado a {clienteNome}</p>
          </div>
          <button type="button" aria-label="Fechar" disabled={saving} onClick={onClose}
            className="rounded-lg p-2 text-neutral-600 hover:bg-neutral-100 disabled:opacity-50">
            <X size={20} />
          </button>
        </div>
        <form onSubmit={save} className="space-y-4">
          <label className="block space-y-1 text-xs font-bold text-neutral-700">
            Razão social
            <input required autoFocus maxLength={200} value={razaoSocial}
              onChange={event => setRazaoSocial(event.target.value.toUpperCase())}
              placeholder="RAZÃO SOCIAL DA LOJA"
              className="h-11 w-full rounded-lg border border-neutral-300 px-3 text-sm font-semibold text-neutral-900 focus:border-orange-500 focus:outline-none" />
          </label>
          <label className="block space-y-1 text-xs font-bold text-neutral-700">
            Limite total (R$)
            <input required inputMode="decimal" value={limite} onChange={event => setLimite(event.target.value)}
              placeholder="Ex.: 15.000,00"
              className="h-11 w-full rounded-lg border border-neutral-300 px-3 text-sm text-neutral-900 focus:border-orange-500 focus:outline-none" />
          </label>
          <label className="block space-y-1 text-xs font-bold text-neutral-700">
            Disponível inicial (R$) — opcional
            <input inputMode="decimal" value={disponivel} onChange={event => setDisponivel(event.target.value)}
              placeholder="Se vazio, igual ao limite total"
              className="h-11 w-full rounded-lg border border-neutral-300 px-3 text-sm text-neutral-900 focus:border-orange-500 focus:outline-none" />
          </label>
          <p className="text-xs leading-relaxed text-amber-800">
            Confira o saldo no ERP. Se não informar o disponível inicial, o CRM considerará o limite totalmente livre, sem boletos anteriores.
          </p>
          {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm font-medium text-red-700">{error}</p>}
          <div className="flex gap-2 pt-1">
            <button type="button" disabled={saving} onClick={onClose}
              className="flex-1 rounded-lg bg-neutral-100 py-3 text-xs font-bold text-neutral-700 disabled:opacity-50">
              Cancelar
            </button>
            <button type="submit" disabled={saving}
              className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-orange-600 py-3 text-xs font-bold text-white disabled:opacity-60">
              {saving ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
              Salvar loja
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}
