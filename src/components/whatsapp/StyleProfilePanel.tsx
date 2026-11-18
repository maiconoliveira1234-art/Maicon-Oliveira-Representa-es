import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, MessageSquareQuote, RefreshCw, Save } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { readFunctionError } from '../../lib/whatsappUi';
import { Panel } from '../ui/AppChrome';

type StyleRow = {
  perfil: string;
  ativo: boolean;
  editado_manual: boolean;
  amostras: number;
  gerado_em: string | null;
};

const formatDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : null;

/** Shows and edits the writing-style profile the AI uses to sound like Maicon. */
export function StyleProfilePanel() {
  const [row, setRow] = useState<StyleRow | null>(null);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<'save' | 'generate' | 'toggle' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const { data, error: loadError } = await supabase
      .from('whatsapp_ai_estilo')
      .select('perfil, ativo, editado_manual, amostras, gerado_em')
      .eq('id', 1)
      .maybeSingle();
    if (loadError) {
      setError('Não foi possível carregar o perfil de estilo.');
    } else {
      setRow((data as StyleRow | null) ?? null);
      setText(data?.perfil ?? '');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const active = row ? row.ativo : true;
  const dirty = text.trim() !== (row?.perfil ?? '').trim();

  const save = async () => {
    setBusy('save');
    setError(null);
    setNotice(null);
    const now = new Date().toISOString();
    const { error: saveError } = await supabase
      .from('whatsapp_ai_estilo')
      .upsert({ id: 1, perfil: text.trim(), editado_manual: true, atualizado_em: now }, { onConflict: 'id' });
    if (saveError) setError('Não foi possível salvar o perfil.');
    else {
      setNotice('Perfil salvo. Ele não será sobrescrito automaticamente.');
      await load();
    }
    setBusy(null);
  };

  const toggle = async () => {
    setBusy('toggle');
    setError(null);
    setNotice(null);
    const { error: toggleError } = await supabase
      .from('whatsapp_ai_estilo')
      .upsert({ id: 1, ativo: !active, atualizado_em: new Date().toISOString() }, { onConflict: 'id' });
    if (toggleError) setError('Não foi possível alterar o uso do estilo.');
    else await load();
    setBusy(null);
  };

  const generate = async () => {
    if (row?.editado_manual && dirty === false && !window.confirm('Isso substitui o perfil que você editou pelo gerado a partir das suas respostas. Continuar?')) return;
    if (dirty && !window.confirm('Há alterações não salvas e o perfil gerado vai substituí-las. Continuar?')) return;
    setBusy('generate');
    setError(null);
    setNotice(null);
    try {
      const { data, error: invokeError } = await supabase.functions.invoke('whatsapp-suggest', {
        body: { action: 'gerar_estilo' },
      });
      if (invokeError || data?.error) throw new Error(await readFunctionError(invokeError, data));
      setNotice(`Perfil atualizado com ${data?.amostras ?? 'suas'} respostas.`);
      await load();
    } catch (err: any) {
      setError(err?.message || 'Não foi possível atualizar o perfil.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Panel className="p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <MessageSquareQuote className="mt-0.5 shrink-0 text-violet-600" size={20} />
          <div className="min-w-0">
            <p className="text-sm font-bold text-neutral-900">Seu estilo de resposta</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void toggle()}
          disabled={busy !== null || loading}
          className={`shrink-0 rounded-full px-3 py-1.5 text-[11px] font-black ${active ? 'bg-green-50 text-green-700' : 'bg-neutral-100 text-neutral-500'} disabled:opacity-50`}
          aria-pressed={active}
        >
          {active ? 'Usando' : 'Desligado'}
        </button>
      </div>

      {loading ? (
        <div className="mt-4 flex items-center text-sm font-semibold text-neutral-500"><Loader2 size={16} className="mr-2 animate-spin" /> Carregando...</div>
      ) : (
        <>
          <textarea
            value={text}
            onChange={event => setText(event.target.value)}
            rows={7}
            placeholder="Ainda não há perfil. Toque em “Atualizar com minhas respostas” para gerar um a partir do que você já enviou."
            className="mt-4 w-full resize-y rounded-xl border border-neutral-200 px-3 py-2.5 text-sm leading-relaxed outline-none focus:border-violet-400"
          />
          <p className="mt-2 text-[11px] font-semibold text-neutral-400">
            {row?.gerado_em
              ? `Gerado em ${formatDate(row.gerado_em)} com ${row.amostras} respostas${row.editado_manual ? ' · editado por você' : ' · atualiza sozinho a cada 7 dias'}`
              : row?.editado_manual
                ? 'Escrito por você'
                : 'Sem perfil gerado ainda'}
          </p>

          {error && <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">{error}</p>}
          {notice && <p className="mt-3 rounded-xl border border-green-200 bg-green-50 px-3 py-2 text-xs font-semibold text-green-700">{notice}</p>}

          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={() => void generate()}
              disabled={busy !== null}
              className="inline-flex items-center gap-2 rounded-xl border border-neutral-200 bg-white px-4 py-2.5 text-xs font-black text-neutral-700 disabled:opacity-50"
            >
              {busy === 'generate' ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />} Atualizar com minhas respostas
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={busy !== null || !dirty}
              className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2.5 text-xs font-black text-white disabled:opacity-50"
            >
              {busy === 'save' ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Salvar
            </button>
          </div>
        </>
      )}
    </Panel>
  );
}
