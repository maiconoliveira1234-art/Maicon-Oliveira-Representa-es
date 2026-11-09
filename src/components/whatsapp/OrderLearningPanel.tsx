import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ChevronDown, Loader2, LockKeyhole, RefreshCcw, Sparkles } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useNavigate } from 'react-router-dom';

type Candidate = { id: string; produto: string; score: number };
type Item = {
  descricao: string;
  quantidade: number;
  unidade: string;
  embalagem: string | null;
  candidatos?: Candidate[];
  produto_id?: string | null;
  sugestao_produto_id?: string | null;
  origem_sugestao?: string | null;
  resolvido?: boolean;
};
type Analysis = {
  id: string;
  mensagem_id: string;
  cliente_id: string | null;
  status: string;
  itens: Item[];
  mensagem: string;
  atualizado_em: string;
};
type Product = { id: string; produto: string };
type ApiResult = { ok?: boolean; error?: string; analises?: Analysis[]; acao?: string };

const getKey = (analysisId: string, index: number) => `${analysisId}:${index}`;

export function OrderLearningPanel({ contatoId }: { contatoId: string }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [authorized, setAuthorized] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [analyses, setAnalyses] = useState<Analysis[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [productSearch, setProductSearch] = useState<Record<string, string>>({});
  const [scopes, setScopes] = useState<Record<string, 'global' | 'cliente'>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data, error: requestError } = await supabase.functions.invoke<ApiResult>('whatsapp-learning-review', {
        body: { action: 'list', contato_map_id: contatoId },
      });
      if (requestError) throw requestError;
      if (data?.error) throw new Error(data.error);
      setAnalyses(data?.analises || []);
      setAuthorized(true);
      const { data: catalog, error: catalogError } = await supabase.from('produtos')
        .select('id,produto').eq('ativo', true).order('produto').limit(1000);
      if (catalogError) throw catalogError;
      setProducts((catalog || []) as Product[]);
    } catch (err: any) {
      setAuthorized(false);
      setError(err?.message || 'Não foi possível consultar análises. Entre com sua conta autorizada.');
    } finally {
      setLoading(false);
    }
  }, [contatoId]);

  useEffect(() => {
    if (!open) return;
    void load();
  }, [open, load]);

  const signIn = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(), password,
      });
      if (signInError) throw signInError;
      setPassword('');
      await load();
    } catch (err: any) {
      setError(err?.message || 'Não foi possível autenticar.');
      setLoading(false);
    }
  };

  const confirm = async (analysis: Analysis, item: Item, index: number) => {
    const key = getKey(analysis.id, index);
    const selected = choices[key] || item.produto_id || item.sugestao_produto_id || item.candidatos?.[0]?.id || '';
    if (!selected) {
      setError('Selecione um produto do catálogo.');
      return;
    }
    setSaving(key);
    setError('');
    setSuccess('');
    try {
      const { data, error: invokeError } = await supabase.functions.invoke<ApiResult>('whatsapp-learning-review', {
        body: {
          action: 'confirm',
          analise_id: analysis.id,
          item_index: index,
          produto_id: selected,
          escopo: scopes[key] || 'global',
        },
      });
      if (invokeError) throw invokeError;
      if (data?.error) throw new Error(data.error);
      setSuccess('Correspondência registrada. O próximo pedido poderá reutilizar esta correção.');
      await load();
    } catch (err: any) {
      setError(err?.message || 'Não foi possível salvar o aprendizado.');
    } finally {
      setSaving(null);
    }
  };

  const approve = async (analysis: Analysis) => {
    if (!analysis.cliente_id || analysis.itens.some(item => !item.resolvido || !item.produto_id)) {
      setError('Vincule o cliente e confirme todos os produtos antes de criar o rascunho.');
      return;
    }
    setSaving(analysis.id);
    setError('');
    try {
      const { data, error: invokeError } = await supabase.functions.invoke<ApiResult & { cliente_id?: string }>('whatsapp-learning-review', {
        body: { action: 'approve', analise_id: analysis.id },
      });
      if (invokeError) throw invokeError;
      if (data?.error) throw new Error(data.error === 'existing_draft_must_be_reviewed_first'
        ? 'Já existe um pedido em aberto para este cliente. Abra-o e confira antes de criar outro.'
        : data.error);
      setSuccess('Rascunho criado. Confira valores, campanhas e condições na tela Pedidos.');
      if (data?.cliente_id) navigate(`/pedido/novo/${data.cliente_id}`);
      else await load();
    } catch (err: any) {
      setError(err?.message || 'Não foi possível criar o rascunho.');
    } finally {
      setSaving(null);
    }
  };

  const candidateNames = useMemo(() => new Map(products.map(p => [p.id, p.produto])), [products]);
  const normalizeSearch = (value: string) => value.normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').toLowerCase().trim();

  return (
    <section className="rounded-2xl border border-violet-200 bg-white p-4">
      <button type="button" onClick={() => setOpen(v => !v)}
        className="flex w-full items-center justify-between gap-2 text-left text-sm font-black text-neutral-900">
        <span className="inline-flex items-center gap-2"><Sparkles size={16} className="text-violet-700" /> Propostas de pedidos · reconhecimento de produtos</span>
        <ChevronDown size={17} className={open ? 'rotate-180' : ''} />
      </button>
      {!open ? (
        <p className="mt-1 text-xs text-neutral-500">Revise os itens, confirme os produtos e envie o rascunho para a tela de Pedidos.</p>
      ) : (
        <div className="mt-4 space-y-4">
          {loading && <p className="flex items-center gap-2 text-sm text-neutral-500"><Loader2 size={15} className="animate-spin" /> Carregando análises...</p>}
          {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-xs font-semibold text-red-700">{error}</p>}
          {success && <p role="status" className="rounded-lg bg-green-50 p-3 text-xs font-semibold text-green-700">{success}</p>}
          {!authorized && !loading && (
            <form onSubmit={signIn} className="space-y-3 rounded-xl bg-neutral-50 p-3">
              <p className="flex items-center gap-2 text-xs text-neutral-700"><LockKeyhole size={14} /> Para ensinar produtos, entre com uma conta autorizada do CRM.</p>
              <input aria-label="E-mail" type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)}
                placeholder="E-mail" className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm" />
              <input aria-label="Senha" type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)}
                placeholder="Senha" className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm" />
              <button type="submit" className="rounded-lg bg-violet-700 px-4 py-2 text-xs font-black text-white">Entrar para revisar</button>
            </form>
          )}
          {authorized && (
            <>
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-neutral-500">As propostas ficam aqui para aprovação. Um rascunho só é criado após sua confirmação explícita.</p>
                <button type="button" aria-label="Atualizar análises" onClick={() => void load()}
                  className="rounded-lg border border-neutral-200 p-2 text-neutral-600"><RefreshCcw size={15} /></button>
              </div>
              {analyses.filter(a => a.status === 'revisar').length === 0 && (
                <p className="rounded-lg bg-neutral-50 p-4 text-sm text-neutral-500">Nenhum pedido aguardando revisão nesta conversa.</p>
              )}
              {analyses.filter(a => a.status === 'revisar').map(analysis => (
                <div key={analysis.id} className="space-y-3 rounded-xl border border-neutral-200 p-3">
                  <p className="text-xs font-bold text-neutral-500">Pedido identificado · {new Date(analysis.atualizado_em).toLocaleString('pt-BR')}</p>
                  <div className="rounded-lg border border-violet-100 bg-violet-50 p-3">
                    <p className="text-xs font-black uppercase text-violet-700">Proposta recebida do WhatsApp</p>
                    <p className="mt-1 whitespace-pre-wrap text-xs text-neutral-700">{analysis.mensagem}</p>
                    <p className="mt-2 text-xs font-semibold text-neutral-700">
                      {analysis.itens.length} itens · {analysis.itens.reduce((sum, item) => sum + Number(item.quantidade || 0), 0)} embalagens solicitadas
                    </p>
                    <p className="mt-1 text-xs text-amber-700">Prévia sem precificação: valores e condições comerciais serão calculados na tela Pedidos.</p>
                  </div>
                  {analysis.itens.map((item, index) => {
                    const key = getKey(analysis.id, index);
                    const selected = choices[key] || item.produto_id || item.sugestao_produto_id || item.candidatos?.[0]?.id || '';
                    const allOptions = new Map<string, string>();
                    (item.candidatos || []).forEach(c => allOptions.set(c.id, c.produto));
                    products.forEach(p => allOptions.set(p.id, p.produto));
                    const term = normalizeSearch(productSearch[key] || '');
                    const filteredOptions = [...allOptions.entries()]
                      .filter(([id, name]) => id === selected || !term || normalizeSearch(name).includes(term))
                      .sort((a,b) => Number(b[0] === selected) - Number(a[0] === selected) || a[1].localeCompare(b[1]))
                      .slice(0, 50);
                    return (
                      <div key={key} className="rounded-lg bg-neutral-50 p-3">
                        <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <p className="text-sm font-bold text-neutral-900">{item.descricao}</p>
                            <p className="text-xs text-neutral-500">{item.quantidade} {item.unidade} · {item.embalagem || 'Embalagem não informada'}</p>
                          </div>
                          {item.resolvido ? (
                            <span className="flex items-center gap-1 text-xs font-bold text-green-700"><CheckCircle2 size={14} /> Confirmado</span>
                          ) : item.origem_sugestao === 'aprendizado_confirmado' ? (
                            <span className="text-xs font-semibold text-violet-700">Aprendido anteriormente</span>
                          ) : (
                            <span className="text-xs font-semibold text-amber-700">Revisão necessária</span>
                          )}
                        </div>
                        <label htmlFor={key} className="mb-1 block text-xs font-bold text-neutral-600">Produto correto no CRM</label>
                        <input
                          id={key}
                          type="search"
                          autoComplete="off"
                          value={productSearch[key] || ''}
                          onChange={e => setProductSearch(s => ({ ...s, [key]: e.target.value }))}
                          placeholder="Digite parte do nome, linha ou peso do produto..."
                          className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900"
                        />
                        <div role="listbox" aria-label="Produtos encontrados" className="mt-2 max-h-52 overflow-y-auto rounded-lg border border-neutral-200 bg-white">
                          {filteredOptions.map(([id, name]) => (
                            <button type="button" role="option" aria-selected={id === selected} key={id}
                              onClick={() => {
                                setChoices(s => ({ ...s, [key]: id }));
                                setProductSearch(s => ({ ...s, [key]: name }));
                              }}
                              className={`block w-full border-b border-neutral-100 px-3 py-2 text-left text-xs last:border-b-0 hover:bg-violet-50 ${id === selected ? 'bg-violet-50 font-bold text-violet-800' : 'text-neutral-700'}`}>
                              {name}
                            </button>
                          ))}
                          {filteredOptions.length === 0 && <p className="p-3 text-xs text-neutral-500">Nenhum produto encontrado.</p>}
                        </div>
                        <p className="mt-1 text-[11px] text-neutral-400">Mostrando até 50 resultados. Refine a busca digitando mais caracteres.</p>
                        {selected && <p className="mt-1 text-[11px] text-neutral-500">{candidateNames.get(selected) || ''}</p>}
                        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                          <label className="flex items-center gap-2 text-xs text-neutral-600">
                            Aplicar a
                            <select value={scopes[key] || 'global'} onChange={e => setScopes(s => ({...s,[key]: e.target.value as 'global' | 'cliente'}))}
                              className="rounded-md border border-neutral-300 bg-white p-1.5 text-xs">
                              <option value="global">Todos os clientes</option>
                              {analysis.cliente_id && <option value="cliente">Apenas este cliente</option>}
                            </select>
                          </label>
                          <button type="button" onClick={() => void confirm(analysis, item, index)}
                            disabled={!selected || saving === key || loading}
                            className="rounded-lg bg-violet-700 px-3 py-2 text-xs font-black text-white disabled:opacity-40">
                            {saving === key ? 'Salvando...' : item.resolvido ? 'Corrigir associação' : 'Confirmar produto'}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                  <div className="rounded-lg border-t border-neutral-200 pt-3">
                    {!analysis.cliente_id && <p className="mb-2 text-xs font-semibold text-amber-700">Vincule esta conversa a um cliente do CRM para habilitar a criação do rascunho.</p>}
                    <button type="button" onClick={() => void approve(analysis)}
                      disabled={saving === analysis.id || !analysis.cliente_id || !analysis.itens.length || analysis.itens.some(item => !item.resolvido || !item.produto_id)}
                      className="w-full rounded-lg bg-green-700 px-3 py-3 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-40">
                      {saving === analysis.id ? 'Criando rascunho...' : 'Aprovar itens e abrir rascunho em Pedidos'}
                    </button>
                    <p className="mt-2 text-[11px] text-neutral-500">Esta aprovação apenas cria um pedido em aberto para conferência. Não envia pedidos à empresa.</p>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </section>
  );
}
