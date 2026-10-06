import React, { useEffect, useState } from 'react';
import { ArrowLeft, EyeOff, Loader2, Plus, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { PageHeader, Panel } from '../components/ui/AppChrome';

type BlockRule = {
  id: string;
  padrao: string;
  ativo: boolean;
  criado_em: string;
};

export function WhatsAppHiddenPage() {
  const navigate = useNavigate();
  const [rules, setRules] = useState<BlockRule[]>([]);
  const [value, setValue] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadRules = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: queryError } = await supabase
        .from('whatsapp_exibicao_bloqueios')
        .select('id, padrao, ativo, criado_em')
        .order('padrao', { ascending: true });
      if (queryError) throw queryError;
      setRules((data || []) as BlockRule[]);
    } catch (err: any) {
      setError(err?.message || 'Não foi possível carregar os remetentes ocultos.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadRules();
  }, []);

  const addRule = async () => {
    const padrao = value.trim();
    if (!padrao) return;

    setSaving(true);
    setError(null);
    try {
      const { error: insertError } = await supabase
        .from('whatsapp_exibicao_bloqueios')
        .insert({ padrao, ativo: true });
      if (insertError) {
        if (insertError.code === '23505') throw new Error('Esse início de nome já está na lista de ocultos.');
        throw insertError;
      }
      setValue('');
      await loadRules();
    } catch (err: any) {
      setError(err?.message || 'Não foi possível adicionar o remetente oculto.');
    } finally {
      setSaving(false);
    }
  };

  const removeRule = async (id: string) => {
    setDeletingId(id);
    setError(null);
    try {
      const { error: deleteError } = await supabase
        .from('whatsapp_exibicao_bloqueios')
        .delete()
        .eq('id', id);
      if (deleteError) throw deleteError;
      await loadRules();
    } catch (err: any) {
      setError(err?.message || 'Não foi possível remover o bloqueio de exibição.');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-5 py-2">
      <button
        type="button"
        onClick={() => navigate('/whatsapp')}
        className="inline-flex items-center gap-2 text-sm font-bold text-neutral-500 hover:text-neutral-900"
      >
        <ArrowLeft size={16} /> Voltar para o WhatsApp
      </button>

      <PageHeader
        title="Remetentes ocultos"
        subtitle="Oculta grupos ou remetentes da caixa do WhatsApp sem alterar o Tasker"
        icon={<EyeOff />}
      />

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
          {error}
        </div>
      )}

      <Panel className="p-4 sm:p-5">
        <p className="text-sm font-black text-neutral-900">Adicionar início do nome</p>
        <p className="mt-1 text-xs leading-relaxed text-neutral-500">
          Tudo que começar com o texto informado será ocultado. Exemplo: “Santa Catarina” oculta
          “Santa Catarina: Renata”, “Santa Catarina: ~ Daniel” e outras variações do mesmo grupo.
        </p>

        <div className="mt-4 flex gap-2">
          <input
            value={value}
            onChange={event => setValue(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter') void addRule();
            }}
            placeholder="Ex.: Santa Catarina"
            className="min-w-0 flex-1 rounded-xl border border-neutral-200 px-3 py-2.5 text-sm outline-none focus:border-orange-400"
          />
          <button
            type="button"
            onClick={() => void addRule()}
            disabled={saving || !value.trim()}
            className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-neutral-900 px-4 py-2.5 text-xs font-black text-white disabled:opacity-50"
          >
            {saving ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
            Adicionar
          </button>
        </div>
      </Panel>

      <Panel className="overflow-hidden">
        <div className="border-b border-neutral-100 px-4 py-3">
          <p className="text-sm font-black text-neutral-900">Lista de ocultos</p>
          <p className="mt-0.5 text-xs text-neutral-500">
            Esses contatos continuam sendo capturados no banco, mas não aparecem nas abas Pendentes, Vinculados ou Ignorados.
          </p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center p-8 text-sm text-neutral-500">
            <Loader2 size={18} className="mr-2 animate-spin" /> Carregando...
          </div>
        ) : rules.length === 0 ? (
          <div className="p-8 text-center text-sm text-neutral-500">Nenhum remetente oculto.</div>
        ) : (
          <div className="divide-y divide-neutral-100">
            {rules.map(rule => (
              <div key={rule.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-neutral-900">{rule.padrao}</p>
                  <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
                    Ocultar nomes que começam com este texto
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void removeRule(rule.id)}
                  disabled={deletingId === rule.id}
                  className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-black text-red-700 disabled:opacity-50"
                >
                  {deletingId === rule.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                  Remover
                </button>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
