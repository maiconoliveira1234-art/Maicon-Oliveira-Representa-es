import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Check, Edit3, Loader2, Plus, Save, ShieldCheck, Trash2, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { PageHeader, Panel } from '../components/ui/AppChrome';

type Scope = 'todos' | 'cliente' | 'linha' | 'familia';

type AiRule = {
  id: string;
  titulo: string;
  categoria: string;
  regra: string;
  prioridade: number;
  escopo_tipo: Scope;
  escopo_valor: string | null;
  cliente_id: string | null;
  ativo: boolean;
  valido_de: string | null;
  valido_ate: string | null;
  atualizado_em: string;
};

type Cliente = {
  id: string;
  cliente: string;
  cidade: string | null;
  ativo: boolean | null;
};

type RuleDraft = {
  titulo: string;
  categoria: string;
  regra: string;
  prioridade: number;
  escopo_tipo: Scope;
  escopo_valor: string;
  cliente_id: string;
  ativo: boolean;
  valido_de: string;
  valido_ate: string;
};

const emptyDraft: RuleDraft = {
  titulo: '',
  categoria: 'Geral',
  regra: '',
  prioridade: 2,
  escopo_tipo: 'todos',
  escopo_valor: '',
  cliente_id: '',
  ativo: true,
  valido_de: '',
  valido_ate: '',
};

const priorityLabel: Record<number, string> = { 1: 'Alta', 2: 'Média', 3: 'Baixa' };

export function WhatsAppRulesPage() {
  const navigate = useNavigate();
  const [rules, setRules] = useState<AiRule[]>([]);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<RuleDraft>(emptyDraft);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [{ data: ruleData, error: ruleError }, { data: clientData, error: clientError }] = await Promise.all([
        supabase
          .from('whatsapp_ai_regras')
          .select('id, titulo, categoria, regra, prioridade, escopo_tipo, escopo_valor, cliente_id, ativo, valido_de, valido_ate, atualizado_em')
          .order('ativo', { ascending: false })
          .order('prioridade', { ascending: true })
          .order('atualizado_em', { ascending: false }),
        supabase
          .from('clientes')
          .select('id, cliente, cidade, ativo')
          .order('cliente', { ascending: true }),
      ]);
      if (ruleError) throw ruleError;
      if (clientError) throw clientError;
      setRules((ruleData || []) as AiRule[]);
      setClientes((clientData || []) as Cliente[]);
    } catch (err: any) {
      setError(err?.message || 'Não foi possível carregar as regras da IA.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  const orderedClients = useMemo(
    () => [...clientes].sort((a, b) => Number(Boolean(b.ativo)) - Number(Boolean(a.ativo)) || a.cliente.localeCompare(b.cliente)),
    [clientes]
  );

  const openNew = () => {
    setEditingId(null);
    setDraft(emptyDraft);
    setShowForm(true);
    setError(null);
  };

  const openEdit = (rule: AiRule) => {
    setEditingId(rule.id);
    setDraft({
      titulo: rule.titulo,
      categoria: rule.categoria,
      regra: rule.regra,
      prioridade: rule.prioridade,
      escopo_tipo: rule.escopo_tipo,
      escopo_valor: rule.escopo_valor || '',
      cliente_id: rule.cliente_id || '',
      ativo: rule.ativo,
      valido_de: rule.valido_de || '',
      valido_ate: rule.valido_ate || '',
    });
    setShowForm(true);
    setError(null);
  };

  const saveRule = async () => {
    const titulo = draft.titulo.trim();
    const regra = draft.regra.trim();
    const categoria = draft.categoria.trim() || 'Geral';
    if (!titulo || !regra) {
      setError('Preencha o título e a regra.');
      return;
    }
    if (draft.escopo_tipo === 'cliente' && !draft.cliente_id) {
      setError('Selecione o cliente desta regra.');
      return;
    }
    if ((draft.escopo_tipo === 'linha' || draft.escopo_tipo === 'familia') && !draft.escopo_valor.trim()) {
      setError('Informe a linha ou família à qual a regra se aplica.');
      return;
    }
    if (draft.valido_de && draft.valido_ate && draft.valido_de > draft.valido_ate) {
      setError('A data inicial não pode ser posterior à data final.');
      return;
    }

    setSaving(true);
    setError(null);
    const payload = {
      titulo,
      categoria,
      regra,
      prioridade: draft.prioridade,
      escopo_tipo: draft.escopo_tipo,
      escopo_valor: draft.escopo_tipo === 'linha' || draft.escopo_tipo === 'familia' ? draft.escopo_valor.trim() : null,
      cliente_id: draft.escopo_tipo === 'cliente' ? draft.cliente_id : null,
      ativo: draft.ativo,
      valido_de: draft.valido_de || null,
      valido_ate: draft.valido_ate || null,
    };

    try {
      const result = editingId
        ? await supabase.from('whatsapp_ai_regras').update(payload).eq('id', editingId)
        : await supabase.from('whatsapp_ai_regras').insert(payload);
      if (result.error) throw result.error;
      setShowForm(false);
      setEditingId(null);
      setDraft(emptyDraft);
      await loadData();
    } catch (err: any) {
      setError(err?.message || 'Não foi possível salvar a regra.');
    } finally {
      setSaving(false);
    }
  };

  const toggleRule = async (rule: AiRule) => {
    setError(null);
    const { error: updateError } = await supabase
      .from('whatsapp_ai_regras')
      .update({ ativo: !rule.ativo })
      .eq('id', rule.id);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    await loadData();
  };

  const deleteRule = async (rule: AiRule) => {
    if (!window.confirm(`Excluir a regra “${rule.titulo}”?`)) return;
    setError(null);
    const { error: deleteError } = await supabase.from('whatsapp_ai_regras').delete().eq('id', rule.id);
    if (deleteError) {
      setError(deleteError.message);
      return;
    }
    await loadData();
  };

  const clientName = (id: string | null) => clientes.find(c => c.id === id)?.cliente || 'Cliente não encontrado';
  const scopeLabel = (rule: AiRule) => {
    if (rule.escopo_tipo === 'todos') return 'Todos os clientes';
    if (rule.escopo_tipo === 'cliente') return clientName(rule.cliente_id);
    if (rule.escopo_tipo === 'linha') return `Linha: ${rule.escopo_valor}`;
    return `Família: ${rule.escopo_valor}`;
  };

  return (
    <div className="mx-auto max-w-3xl space-y-5 py-2">
      <button type="button" onClick={() => navigate('/whatsapp')} className="inline-flex items-center gap-2 text-sm font-bold text-neutral-500 hover:text-neutral-900">
        <ArrowLeft size={16} /> Voltar ao WhatsApp
      </button>

      <PageHeader title="Regras da IA" subtitle="Regras comerciais editáveis usadas nas sugestões do WhatsApp" icon={<ShieldCheck />} />

      <Panel className="p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-bold text-neutral-900">Base comercial da IA</p>
            <p className="mt-1 text-xs leading-relaxed text-neutral-500">Somente regras ativas e dentro da validade entram nas novas sugestões. As proteções contra inventar preços, descontos e condições continuam fixas no sistema.</p>
          </div>
          <button type="button" onClick={openNew} className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-neutral-900 px-4 py-2.5 text-xs font-black text-white">
            <Plus size={15} /> Nova regra
          </button>
        </div>
      </Panel>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</div>}

      {showForm && (
        <Panel className="p-4 sm:p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-black text-neutral-900">{editingId ? 'Editar regra' : 'Nova regra'}</h2>
            <button type="button" onClick={() => setShowForm(false)} className="rounded-lg p-2 text-neutral-400 hover:bg-neutral-100"><X size={18} /></button>
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="sm:col-span-2">
              <span className="text-xs font-black uppercase tracking-wide text-neutral-500">Título</span>
              <input value={draft.titulo} onChange={e => setDraft(v => ({ ...v, titulo: e.target.value }))} placeholder="Ex.: Recompra garantida" className="mt-1.5 w-full rounded-xl border border-neutral-200 px-3 py-2.5 text-sm outline-none focus:border-orange-400" />
            </label>
            <label>
              <span className="text-xs font-black uppercase tracking-wide text-neutral-500">Categoria</span>
              <input value={draft.categoria} onChange={e => setDraft(v => ({ ...v, categoria: e.target.value }))} placeholder="Ex.: Condição comercial" className="mt-1.5 w-full rounded-xl border border-neutral-200 px-3 py-2.5 text-sm outline-none focus:border-orange-400" />
            </label>
            <label>
              <span className="text-xs font-black uppercase tracking-wide text-neutral-500">Prioridade</span>
              <select value={draft.prioridade} onChange={e => setDraft(v => ({ ...v, prioridade: Number(e.target.value) }))} className="mt-1.5 w-full rounded-xl border border-neutral-200 px-3 py-2.5 text-sm outline-none focus:border-orange-400">
                <option value={1}>Alta</option><option value={2}>Média</option><option value={3}>Baixa</option>
              </select>
            </label>
            <label className="sm:col-span-2">
              <span className="text-xs font-black uppercase tracking-wide text-neutral-500">Regra</span>
              <textarea value={draft.regra} onChange={e => setDraft(v => ({ ...v, regra: e.target.value }))} rows={4} placeholder="Descreva a regra de forma objetiva, com os limites e condições que a IA deve respeitar." className="mt-1.5 w-full resize-y rounded-xl border border-neutral-200 px-3 py-2.5 text-sm outline-none focus:border-orange-400" />
            </label>
            <label>
              <span className="text-xs font-black uppercase tracking-wide text-neutral-500">Aplicação</span>
              <select value={draft.escopo_tipo} onChange={e => setDraft(v => ({ ...v, escopo_tipo: e.target.value as Scope, cliente_id: '', escopo_valor: '' }))} className="mt-1.5 w-full rounded-xl border border-neutral-200 px-3 py-2.5 text-sm outline-none focus:border-orange-400">
                <option value="todos">Todos os clientes</option><option value="cliente">Cliente específico</option><option value="linha">Linha</option><option value="familia">Família</option>
              </select>
            </label>
            {draft.escopo_tipo === 'cliente' ? (
              <label>
                <span className="text-xs font-black uppercase tracking-wide text-neutral-500">Cliente</span>
                <select value={draft.cliente_id} onChange={e => setDraft(v => ({ ...v, cliente_id: e.target.value }))} className="mt-1.5 w-full rounded-xl border border-neutral-200 px-3 py-2.5 text-sm outline-none focus:border-orange-400">
                  <option value="">Selecione...</option>
                  {orderedClients.map(c => <option key={c.id} value={c.id}>{c.cliente}{c.cidade ? ` · ${c.cidade}` : ''}</option>)}
                </select>
              </label>
            ) : (draft.escopo_tipo === 'linha' || draft.escopo_tipo === 'familia') ? (
              <label>
                <span className="text-xs font-black uppercase tracking-wide text-neutral-500">{draft.escopo_tipo === 'linha' ? 'Linha' : 'Família'}</span>
                <input value={draft.escopo_valor} onChange={e => setDraft(v => ({ ...v, escopo_valor: e.target.value }))} placeholder={draft.escopo_tipo === 'linha' ? 'Ex.: Origens' : 'Ex.: FN Fresh'} className="mt-1.5 w-full rounded-xl border border-neutral-200 px-3 py-2.5 text-sm outline-none focus:border-orange-400" />
              </label>
            ) : <div />}
            <label>
              <span className="text-xs font-black uppercase tracking-wide text-neutral-500">Válida de</span>
              <input type="date" value={draft.valido_de} onChange={e => setDraft(v => ({ ...v, valido_de: e.target.value }))} className="mt-1.5 w-full rounded-xl border border-neutral-200 px-3 py-2.5 text-sm outline-none focus:border-orange-400" />
            </label>
            <label>
              <span className="text-xs font-black uppercase tracking-wide text-neutral-500">Válida até</span>
              <input type="date" value={draft.valido_ate} onChange={e => setDraft(v => ({ ...v, valido_ate: e.target.value }))} className="mt-1.5 w-full rounded-xl border border-neutral-200 px-3 py-2.5 text-sm outline-none focus:border-orange-400" />
            </label>
          </div>

          <label className="mt-4 flex items-center gap-3 rounded-xl bg-neutral-50 px-3 py-3">
            <input type="checkbox" checked={draft.ativo} onChange={e => setDraft(v => ({ ...v, ativo: e.target.checked }))} className="h-4 w-4" />
            <span className="text-sm font-bold text-neutral-700">Regra ativa</span>
          </label>

          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={() => setShowForm(false)} className="rounded-lg border border-neutral-200 bg-white px-4 py-2.5 text-xs font-black text-neutral-600">Cancelar</button>
            <button type="button" onClick={() => void saveRule()} disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-orange-600 px-4 py-2.5 text-xs font-black text-white disabled:opacity-50">
              {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Salvar regra
            </button>
          </div>
        </Panel>
      )}

      {loading ? (
        <div className="flex min-h-40 items-center justify-center text-sm font-semibold text-neutral-500"><Loader2 size={18} className="mr-2 animate-spin" /> Carregando regras...</div>
      ) : rules.length === 0 ? (
        <Panel className="p-8 text-center">
          <ShieldCheck className="mx-auto text-neutral-300" size={30} />
          <p className="mt-3 text-sm font-bold text-neutral-700">Nenhuma regra comercial cadastrada</p>
          <p className="mt-1 text-xs text-neutral-400">A IA continuará usando apenas as proteções fixas e os dados do CRM até você cadastrar regras.</p>
        </Panel>
      ) : (
        <div className="space-y-3">
          {rules.map(rule => (
            <Panel key={rule.id} className={`p-4 sm:p-5 ${rule.ativo ? '' : 'opacity-60'}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-black text-neutral-900">{rule.titulo}</h2>
                    <span className={`rounded-full px-2 py-0.5 text-[9px] font-black uppercase ${rule.ativo ? 'bg-green-50 text-green-700' : 'bg-neutral-100 text-neutral-500'}`}>{rule.ativo ? 'Ativa' : 'Inativa'}</span>
                    <span className="rounded-full bg-violet-50 px-2 py-0.5 text-[9px] font-black uppercase text-violet-700">{priorityLabel[rule.prioridade] || 'Média'}</span>
                  </div>
                  <p className="mt-1 text-[10px] font-black uppercase tracking-wide text-neutral-400">{rule.categoria} · {scopeLabel(rule)}</p>
                </div>
              </div>
              <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-neutral-700">{rule.regra}</p>
              {(rule.valido_de || rule.valido_ate) && <p className="mt-2 text-[10px] font-semibold text-neutral-400">Validade: {rule.valido_de || 'sem início'} até {rule.valido_ate || 'sem término'}</p>}
              <div className="mt-4 flex flex-wrap gap-2 border-t border-neutral-100 pt-3">
                <button type="button" onClick={() => openEdit(rule)} className="inline-flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-xs font-black text-neutral-700"><Edit3 size={14} /> Editar</button>
                <button type="button" onClick={() => void toggleRule(rule)} className="inline-flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-xs font-black text-neutral-700"><Check size={14} /> {rule.ativo ? 'Desativar' : 'Ativar'}</button>
                <button type="button" onClick={() => void deleteRule(rule)} className="inline-flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-black text-red-700"><Trash2 size={14} /> Excluir</button>
              </div>
            </Panel>
          ))}
        </div>
      )}
    </div>
  );
}
