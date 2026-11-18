import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BookOpenCheck, Check, ChevronDown, Loader2, Plus, X } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { Panel } from '../ui/AppChrome';
import {
  ATRIBUTOS, DICIONARIO_BASE, NOME_ATRIBUTO, ROTULOS, descreverTermo, semAcento, type Atributo, type TipoTermo,
} from '../../lib/productMatch';

type TermRow = {
  id: string;
  termo: string;
  atributo: TipoTermo;
  valor: string;
  cliente_id: string | null;
  status: 'sugerido' | 'ativo' | 'recusado' | 'inativo';
  origem: 'aprendido' | 'manual';
  ocorrencias: number;
  clientes_distintos: string[];
  exemplos: Array<{ expressao?: string; produto?: string }>;
  atualizado_em: string;
  clientes?: { cliente: string } | null;
};

/** Sugestões só aparecem para aprovação depois de se repetirem. */
const MINIMO_OCORRENCIAS = 2;

// Combinações de porte usadas pelos fabricantes (MP, MG...).
const OPCOES_EXTRAS: Partial<Record<Atributo, Array<[string, string]>>> = {
  porte: [['MINI|PEQ', 'Mini e Pequeno'], ['MED|GR', 'Médio e Grande'], ['GR|GIG', 'Grande e Gigante']],
};

function TermCard({ row, children }: { row: TermRow; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-neutral-200 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-black text-neutral-900">{descreverTermo(row)}</p>
          <p className="mt-0.5 text-[11px] font-semibold text-neutral-500">
            {row.origem === 'manual' ? 'Cadastrado por você' : `Visto em ${row.ocorrencias} ${row.ocorrencias === 1 ? 'correção' : 'correções'}`}
            {row.clientes_distintos.length > 1 && ` · ${row.clientes_distintos.length} clientes`}
            {row.cliente_id && ` · só para ${row.clientes?.cliente || 'um cliente'}`}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">{children}</div>
      </div>
      {row.exemplos.length > 0 && (
        <ul className="mt-2 space-y-1">
          {row.exemplos.slice(0, 3).map((e, i) => (
            <li key={i} className="rounded-lg bg-neutral-50 px-2 py-1 text-[11px] text-neutral-600">
              “{e.expressao}” → <span className="font-semibold">{e.produto}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Dicionário que a IA usa para ler os produtos pedidos no WhatsApp: termos aprendidos e base. */
export function ProductTermsPanel() {
  const [rows, setRows] = useState<TermRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showWatching, setShowWatching] = useState(false);
  const [showBase, setShowBase] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [draft, setDraft] = useState<{ termo: string; atributo: TipoTermo; valor: string }>({ termo: '', atributo: 'especie', valor: '' });

  const load = useCallback(async () => {
    setError(null);
    const { data, error: loadError } = await supabase
      .from('whatsapp_dicionario_termos')
      .select('id,termo,atributo,valor,cliente_id,status,origem,ocorrencias,clientes_distintos,exemplos,atualizado_em,clientes(cliente)')
      .neq('status', 'recusado')
      .order('ocorrencias', { ascending: false })
      .order('atualizado_em', { ascending: false })
      .limit(300);
    if (loadError) setError('Não foi possível carregar os termos. Entre com sua conta autorizada do CRM.');
    else setRows((data || []) as unknown as TermRow[]);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const pending = rows.filter(r => r.status === 'sugerido' && r.ocorrencias >= MINIMO_OCORRENCIAS);
  const watching = rows.filter(r => r.status === 'sugerido' && r.ocorrencias < MINIMO_OCORRENCIAS);
  const learned = rows.filter(r => r.status === 'ativo' || r.status === 'inativo');

  const decide = async (row: TermRow, status: TermRow['status'], message: string) => {
    setBusy(row.id);
    setError(null);
    setNotice(null);
    const { data: auth } = await supabase.auth.getUser();
    const { error: updateError } = await supabase.from('whatsapp_dicionario_termos').update({
      status, decidido_em: new Date().toISOString(), decidido_por: auth.user?.id ?? null, atualizado_em: new Date().toISOString(),
    }).eq('id', row.id);
    if (updateError) setError('Não foi possível salvar a decisão.');
    else { setNotice(message); await load(); }
    setBusy(null);
  };

  const valueOptions = useMemo(() => {
    if (draft.atributo === 'sinonimo') return [];
    const a = draft.atributo as Atributo;
    return [...Object.entries(ROTULOS[a]), ...(OPCOES_EXTRAS[a] || [])];
  }, [draft.atributo]);

  const addTerm = async (event: React.FormEvent) => {
    event.preventDefault();
    const termo = semAcento(draft.termo).replace(/[^A-Z0-9]+/g, ' ').trim();
    const valor = draft.atributo === 'sinonimo' ? semAcento(draft.valor).replace(/[^A-Z0-9]+/g, ' ').trim() : draft.valor;
    if (!termo || !valor) { setError('Preencha o termo e o significado.'); return; }
    setBusy('add');
    setError(null);
    setNotice(null);
    const { data: auth } = await supabase.auth.getUser();
    const { error: insertError } = await supabase.from('whatsapp_dicionario_termos').insert({
      termo, atributo: draft.atributo, valor, status: 'ativo', origem: 'manual', ocorrencias: 0,
      decidido_em: new Date().toISOString(), decidido_por: auth.user?.id ?? null,
    });
    if (insertError) setError(insertError.code === '23505' ? 'Esse termo já está cadastrado.' : 'Não foi possível cadastrar o termo.');
    else {
      setNotice(`Termo cadastrado: ${descreverTermo({ termo, atributo: draft.atributo, valor })}. Vale a partir da próxima análise.`);
      setDraft({ termo: '', atributo: draft.atributo, valor: '' });
      setShowForm(false);
      await load();
    }
    setBusy(null);
  };

  const baseGroups = useMemo(() => ATRIBUTOS.map(a => {
    const byValue = new Map<string, string[]>();
    for (const t of DICIONARIO_BASE) if (t.atributo === a) byValue.set(t.valor, [...(byValue.get(t.valor) || []), t.termo]);
    return { a, values: [...byValue.entries()] };
  }), []);

  return (
    <Panel className="p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <BookOpenCheck className="mt-0.5 shrink-0 text-violet-600" size={20} />
          <div className="min-w-0">
            <p className="text-sm font-bold text-neutral-900">Termos aprendidos · reconhecimento de produtos</p>
            <p className="mt-0.5 text-xs text-neutral-500">
              Quando você corrige um produto, a IA anota as palavras do cliente que ela não conhecia. Quando a mesma ligação se repete, ela aparece aqui para você aprovar.
            </p>
          </div>
        </div>
        <button type="button" onClick={() => setShowForm(v => !v)}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-neutral-200 px-3 py-2 text-xs font-black text-neutral-700">
          <Plus size={14} /> Termo
        </button>
      </div>

      {error && <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">{error}</p>}
      {notice && <p className="mt-3 rounded-xl border border-green-200 bg-green-50 px-3 py-2 text-xs font-semibold text-green-700">{notice}</p>}

      {showForm && (
        <form onSubmit={addTerm} className="mt-4 grid gap-2 rounded-xl bg-neutral-50 p-3 sm:grid-cols-[1fr_1fr_1fr_auto]">
          <input aria-label="Termo que o cliente usa" value={draft.termo} onChange={e => setDraft(d => ({ ...d, termo: e.target.value }))}
            placeholder="Termo do cliente (ex.: felino)" className="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm" />
          <select aria-label="Tipo" value={draft.atributo} onChange={e => setDraft(d => ({ ...d, atributo: e.target.value as TipoTermo, valor: '' }))}
            className="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm">
            {[...ATRIBUTOS, 'sinonimo' as const].map(a => <option key={a} value={a}>{NOME_ATRIBUTO[a]}</option>)}
          </select>
          {draft.atributo === 'sinonimo' ? (
            <input aria-label="Palavra do catálogo" value={draft.valor} onChange={e => setDraft(d => ({ ...d, valor: e.target.value }))}
              placeholder="Palavra no catálogo (ex.: FEMUR)" className="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm" />
          ) : (
            <select aria-label="Significado" value={draft.valor} onChange={e => setDraft(d => ({ ...d, valor: e.target.value }))}
              className="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm">
              <option value="">Significa...</option>
              {valueOptions.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
            </select>
          )}
          <button type="submit" disabled={busy === 'add'} className="rounded-lg bg-violet-600 px-4 py-2 text-xs font-black text-white disabled:opacity-50">
            {busy === 'add' ? 'Salvando...' : 'Salvar'}
          </button>
        </form>
      )}

      {loading ? (
        <div className="mt-4 flex items-center text-sm font-semibold text-neutral-500"><Loader2 size={16} className="mr-2 animate-spin" /> Carregando...</div>
      ) : (
        <div className="mt-4 space-y-4">
          <section>
            <p className="mb-2 text-[11px] font-black uppercase tracking-wide text-violet-700">Para aprovar ({pending.length})</p>
            {pending.length === 0 ? (
              <p className="rounded-xl bg-neutral-50 px-3 py-2 text-xs text-neutral-500">Nenhum termo novo para aprovar.</p>
            ) : (
              <div className="space-y-2">
                {pending.map(row => (
                  <TermCard key={row.id} row={row}>
                    <button type="button" disabled={busy === row.id}
                      onClick={() => void decide(row, 'recusado', 'Sugestão recusada. Ela não será sugerida de novo.')}
                      className="inline-flex items-center gap-1 rounded-lg border border-neutral-200 px-2.5 py-1.5 text-xs font-bold text-neutral-600 disabled:opacity-50">
                      <X size={14} /> Recusar
                    </button>
                    <button type="button" disabled={busy === row.id}
                      onClick={() => void decide(row, 'ativo', 'Termo aprovado. Vale a partir da próxima análise.')}
                      className="inline-flex items-center gap-1 rounded-lg bg-violet-600 px-2.5 py-1.5 text-xs font-black text-white disabled:opacity-50">
                      <Check size={14} /> Aprovar
                    </button>
                  </TermCard>
                ))}
              </div>
            )}
          </section>

          {watching.length > 0 && (
            <section>
              <button type="button" onClick={() => setShowWatching(v => !v)}
                className="flex w-full items-center justify-between text-[11px] font-black uppercase tracking-wide text-neutral-500">
                Em observação ({watching.length}) · vistos uma vez
                <ChevronDown size={14} className={showWatching ? 'rotate-180' : ''} />
              </button>
              {showWatching && (
                <div className="mt-2 space-y-2">
                  {watching.map(row => (
                    <TermCard key={row.id} row={row}>
                      <button type="button" disabled={busy === row.id} onClick={() => void decide(row, 'recusado', 'Sugestão descartada.')}
                        className="rounded-lg border border-neutral-200 px-2.5 py-1.5 text-xs font-bold text-neutral-600 disabled:opacity-50">Descartar</button>
                      <button type="button" disabled={busy === row.id} onClick={() => void decide(row, 'ativo', 'Termo aprovado. Vale a partir da próxima análise.')}
                        className="rounded-lg border border-violet-200 px-2.5 py-1.5 text-xs font-bold text-violet-700 disabled:opacity-50">Aprovar já</button>
                    </TermCard>
                  ))}
                </div>
              )}
            </section>
          )}

          <section>
            <p className="mb-2 text-[11px] font-black uppercase tracking-wide text-neutral-500">Em uso ({learned.filter(r => r.status === 'ativo').length})</p>
            {learned.length === 0 ? (
              <p className="rounded-xl bg-neutral-50 px-3 py-2 text-xs text-neutral-500">Ainda não há termos aprendidos além do dicionário base.</p>
            ) : (
              <div className="space-y-2">
                {learned.map(row => (
                  <TermCard key={row.id} row={row}>
                    <button type="button" disabled={busy === row.id}
                      onClick={() => void decide(row, row.status === 'ativo' ? 'inativo' : 'ativo', row.status === 'ativo' ? 'Termo desativado.' : 'Termo reativado.')}
                      className={`rounded-full px-3 py-1.5 text-[11px] font-black disabled:opacity-50 ${row.status === 'ativo' ? 'bg-green-50 text-green-700' : 'bg-neutral-100 text-neutral-500'}`}>
                      {row.status === 'ativo' ? 'Usando' : 'Desligado'}
                    </button>
                  </TermCard>
                ))}
              </div>
            )}
          </section>

          <section>
            <button type="button" onClick={() => setShowBase(v => !v)}
              className="flex w-full items-center justify-between text-[11px] font-black uppercase tracking-wide text-neutral-500">
              Dicionário base ({DICIONARIO_BASE.length} termos)
              <ChevronDown size={14} className={showBase ? 'rotate-180' : ''} />
            </button>
            {showBase && (
              <div className="mt-2 space-y-3">
                {baseGroups.map(({ a, values }) => (
                  <div key={a}>
                    <p className="text-xs font-black text-neutral-800">{NOME_ATRIBUTO[a]}</p>
                    <ul className="mt-1 space-y-0.5">
                      {values.map(([valor, termos]) => (
                        <li key={valor} className="text-[11px] text-neutral-600">
                          <span className="font-semibold text-neutral-800">{valor.split('|').map(v => ROTULOS[a][v] || v).join(' e ')}:</span> {termos.join(', ')}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </Panel>
  );
}
