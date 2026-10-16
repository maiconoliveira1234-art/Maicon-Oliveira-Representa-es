import React, { useEffect, useMemo, useState } from 'react';
import { Megaphone, Plus, Trash2, Sparkles, ImageUp, CheckCircle2, AlertTriangle, Pencil, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useDataManager } from '../lib/dataManager';
import type { Campanha, RegraCampanha } from '../lib/campaignEngine';
import { campanhaAtiva } from '../lib/campaignEngine';

const blankRule = (): RegraCampanha => ({
  id: crypto.randomUUID(), tipo: 'bonificacao', produto_ids: [],
  familia: '', minimo: 10, repetivel: true, bonus_produto_id: '',
  bonus_quantidade: 1, desconto_percentual: 0,
});
const today = () => {
  const d = new Date();
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
};
const blankCampaign = (): Campanha => ({
  id: crypto.randomUUID(), titulo: '', descricao: '', status: 'rascunho',
  inicio: today(), fim: today(), imagem_data: null, regras: [blankRule()],
});
const normalize = (v: string) => (v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const inputClass = 'w-full rounded-lg border border-neutral-200 bg-white p-2.5 text-sm outline-none focus:border-orange-500';
const labelClass = 'block space-y-1 text-xs font-semibold text-neutral-700';

export function CampaignPage() {
  const { produtos } = useDataManager();
  const [campanhas, setCampanhas] = useState<Campanha[]>([]);
  const [form, setForm] = useState<Campanha | null>(null);
  const [busy, setBusy] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [filter, setFilter] = useState('');
  const familias = useMemo(() => [...new Set(produtos.map(p => p.familia).filter(Boolean))].sort(), [produtos]);
  const visible = useMemo(() => campanhas.filter(c => normalize(c.titulo).includes(normalize(filter))), [campanhas, filter]);

  const load = async () => {
    const { data, error } = await supabase.from('campanhas_comerciais').select('*').order('created_at', { ascending: false });
    if (error) { setError('Não foi possível consultar campanhas: ' + error.message); return; }
    setCampanhas((data || []) as Campanha[]);
  };
  useEffect(() => { void load(); }, []);

  const changeRule = (id: string, patch: Partial<RegraCampanha>) => {
    setForm(current => current ? { ...current, regras: current.regras.map(r => r.id === id ? { ...r, ...patch } : r) } : current);
  };
  const removeRule = (id: string) => setForm(current => current ? { ...current, regras: current.regras.filter(r => r.id !== id) } : current);

  const readImage = async (file?: File) => {
    if (!file) return;
    setError('');
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setError('Utilize imagem JPG, PNG ou WebP. PDF ainda não é suportado neste importador.');
      return;
    }
    if (file.size > 1_000_000) {
      setError('A imagem deve ter no máximo 1 MB. Reduza o tamanho antes de importar.');
      return;
    }
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('Não foi possível abrir a imagem.'));
      reader.readAsDataURL(file);
    });
    setForm(current => current ? { ...current, imagem_data: dataUrl } : { ...blankCampaign(), imagem_data: dataUrl });
    setNotice('Imagem anexada. Use “Ler com IA” para criar um rascunho.');
  };

  const extract = async () => {
    if (!form?.imagem_data || extracting) return;
    setExtracting(true); setError(''); setNotice('');
    try {
      const { data, error } = await supabase.functions.invoke('campaign-extract', { body: { image: form.imagem_data } });
      if (error) throw error;
      if (data?.error) throw new Error(String(data.error));
      const draft = data?.campanha;
      if (!draft || !Array.isArray(draft.regras)) throw new Error('A IA não retornou regras válidas.');
      const rules: RegraCampanha[] = draft.regras.slice(0, 20).map((r: any) => {
        // Associação exata: jamais vincular uma promoção ao SKU errado por similaridade.
        const name = normalize(String(r.produto_nome || ''));
        const bonusName = normalize(String(r.bonus_produto_nome || ''));
        const matching = produtos.filter(p => name && normalize(p.produto) === name);
        const bonus = produtos.filter(p => bonusName && normalize(p.produto) === bonusName);
        return {
          ...blankRule(), tipo: r.tipo === 'desconto' ? 'desconto' : 'bonificacao',
          produto_ids: matching.length === 1 ? [matching[0].id] : [],
          familia: familias.find(f => normalize(f) === normalize(String(r.familia || ''))) || '',
          minimo: Math.max(1, Math.floor(Number(r.minimo) || 1)),
          repetivel: !!r.repetivel,
          bonus_produto_id: bonus.length === 1 ? bonus[0].id : '',
          bonus_quantidade: Math.max(1, Math.floor(Number(r.bonus_quantidade) || 1)),
          desconto_percentual: Math.max(0, Math.min(100, Number(r.desconto_percentual) || 0)),
        };
      });
      setForm(current => current ? {
        ...current, status: 'rascunho',
        titulo: String(draft.titulo || current.titulo).slice(0, 150),
        descricao: String(draft.descricao || current.descricao).slice(0, 2000),
        inicio: /^\d{4}-\d{2}-\d{2}$/.test(String(draft.inicio)) ? draft.inicio : current.inicio,
        fim: /^\d{4}-\d{2}-\d{2}$/.test(String(draft.fim)) ? draft.fim : current.fim,
        regras: rules.length ? rules : current.regras,
      } : current);
      setNotice('Rascunho criado. Confira datas, produtos, unidades e condições antes de ativar. Produtos não correspondidos precisam de seleção manual.');
    } catch (e: any) { setError(e?.message || 'Falha na leitura da imagem.'); }
    finally { setExtracting(false); }
  };

  const validate = (c: Campanha, activate: boolean): string => {
    if (!c.titulo.trim()) return 'Informe o nome da campanha.';
    if (!c.inicio || !c.fim || c.inicio > c.fim) return 'Verifique o período da campanha.';
    if (!c.regras.length) return 'Adicione pelo menos uma regra.';
    for (const r of c.regras) {
      if (!r.produto_ids?.length && !r.familia) return 'Selecione o produto ou família de cada regra.';
      if (!Number.isInteger(Number(r.minimo)) || Number(r.minimo) <= 0) return 'Quantidade mínima deve ser inteira e positiva.';
      if (r.tipo === 'bonificacao' && (!Number.isInteger(Number(r.bonus_quantidade)) || Number(r.bonus_quantidade) <= 0))
        return 'Informe uma quantidade bonificada válida.';
      if (r.tipo === 'bonificacao' && !r.bonus_produto_id && !r.produto_ids?.length) return 'Informe um SKU bonificado para campanhas por família.';
      if (r.tipo === 'desconto' && (Number(r.desconto_percentual) <= 0 || Number(r.desconto_percentual) > 100))
        return 'O desconto deve ser maior que 0% e até 100%.';
    }
    if (activate && c.fim < today()) return 'Não é possível ativar campanha com validade encerrada.';
    return '';
  };

  const save = async (activate = false) => {
    if (!form || busy) return;
    const reason = validate(form, activate);
    if (reason) { setError(reason); return; }
    setBusy(true); setError(''); setNotice('');
    const payload = {
      id: form.id, titulo: form.titulo.trim(), descricao: form.descricao,
      status: activate ? 'ativa' : form.status,
      inicio: form.inicio, fim: form.fim, imagem_data: form.imagem_data, regras: form.regras,
    };
    const { error } = await supabase.from('campanhas_comerciais').upsert(payload, { onConflict: 'id' });
    setBusy(false);
    if (error) { setError('Erro ao salvar: ' + error.message); return; }
    setForm(null); setNotice(activate ? 'Campanha ativada.' : 'Campanha salva.');
    await load();
  };

  const changeStatus = async (c: Campanha, status: Campanha['status']) => {
    setError('');
    const { error } = await supabase.from('campanhas_comerciais').update({ status }).eq('id', c.id);
    if (error) setError(error.message);
    else await load();
  };
  return (
    <div className="mx-auto max-w-5xl space-y-5 pb-24">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="flex items-center gap-2 text-2xl font-black text-neutral-900"><Megaphone className="text-orange-600" /> Campanhas Comerciais</h1>
          <p className="mt-1 text-sm text-neutral-500">Cadastre ofertas, importe encartes com IA e aplique regras nos orçamentos.</p></div>
        <button onClick={() => { setForm(blankCampaign()); setError(''); setNotice(''); }} className="flex items-center gap-2 rounded-lg bg-orange-600 px-4 py-2.5 text-sm font-bold text-white"><Plus size={16}/> Nova campanha</button>
      </header>
      {error && <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"><AlertTriangle size={18}/>{error}</div>}
      {notice && <div role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-800">{notice}</div>}
      {form ? (
        <section className="space-y-4 rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
          <header className="flex items-center justify-between"><h2 className="font-black">Editor de campanha</h2>
            <button aria-label="Fechar editor" onClick={() => setForm(null)}><X size={20}/></button></header>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={labelClass}>Nome<input className={inputClass} value={form.titulo} maxLength={150} onChange={e => setForm({ ...form, titulo: e.target.value })}/></label>
            <label className={labelClass}>Situação<select className={inputClass} value={form.status} onChange={e => setForm({ ...form, status: e.target.value as Campanha['status'] })}>
              <option value="rascunho">Rascunho</option><option value="ativa">Ativa</option><option value="pausada">Pausada</option><option value="encerrada">Encerrada</option>
            </select></label>
            <label className={labelClass}>Início<input type="date" className={inputClass} value={form.inicio} onChange={e => setForm({ ...form, inicio: e.target.value })}/></label>
            <label className={labelClass}>Fim<input type="date" className={inputClass} value={form.fim} onChange={e => setForm({ ...form, fim: e.target.value })}/></label>
          </div>
          <label className={labelClass}>Observações e restrições<textarea className={inputClass} rows={3} value={form.descricao} onChange={e => setForm({ ...form, descricao: e.target.value })}/></label>
          <div className="space-y-2 rounded-xl border border-dashed border-neutral-300 bg-neutral-50 p-3">
            <label className="flex cursor-pointer items-center gap-2 text-sm font-bold text-neutral-800"><ImageUp size={20}/> Anexar imagem original (JPG, PNG, WebP até 1 MB)
              <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={e => { void readImage(e.target.files?.[0]); e.target.value = ''; }}/></label>
            {form.imagem_data && <img className="max-h-52 rounded-lg border border-neutral-200 object-contain" src={form.imagem_data} alt="Encarte original da empresa"/>}
            <button disabled={!form.imagem_data || extracting} onClick={() => void extract()} className="flex items-center gap-2 rounded-lg bg-violet-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">
              <Sparkles size={15}/>{extracting ? 'Interpretando imagem...' : 'Ler imagem com IA'}</button>
            <p className="text-xs text-neutral-500">A IA sugere as condições. O reconhecimento do produto só é automático quando o nome coincide exatamente com o cadastro.</p>
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-between"><h3 className="font-black">Regras comerciais</h3>
              <button onClick={() => setForm({ ...form, regras: [...form.regras, blankRule()] })} className="text-xs font-black text-orange-700">+ Nova regra</button></div>
            {form.regras.map((r, i) => (
              <div key={r.id} className="space-y-3 rounded-xl border border-neutral-200 bg-neutral-50 p-3">
                <div className="flex items-center justify-between"><span className="text-xs font-black">Regra {i + 1}</span>
                  <button aria-label="Excluir regra" onClick={() => removeRule(r.id)} className="text-red-600"><Trash2 size={16}/></button></div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className={labelClass}>Benefício<select className={inputClass} value={r.tipo} onChange={e => changeRule(r.id, { tipo: e.target.value as RegraCampanha['tipo'] })}>
                    <option value="bonificacao">Bonificação via FX (sem consumir Flex)</option><option value="desconto">Desconto extra</option>
                  </select></label>
                  <label className={labelClass}>Mínimo de embalagens/caixas<input className={inputClass} type="number" min="1" step="1" value={r.minimo} onChange={e => changeRule(r.id, { minimo: Number(e.target.value) })}/></label>
                  <label className={labelClass}>Família participante (opcional)<select className={inputClass} value={r.familia} onChange={e => changeRule(r.id, { familia: e.target.value, produto_ids: [] })}>
                    <option value="">Escolher um produto específico</option>{familias.map(f => <option key={f} value={f}>{f}</option>)}
                  </select></label>
                  <label className={labelClass}>SKU participante (ou toda a família)<select disabled={!!r.familia} className={inputClass} value={r.produto_ids[0] || ''} onChange={e => changeRule(r.id, { produto_ids: e.target.value ? [e.target.value] : [] })}>
                    <option value="">Selecione</option>{produtos.filter(p => p.ativo).map(p => <option key={p.id} value={p.id}>{p.produto}</option>)}
                  </select></label>
                  {r.tipo === 'bonificacao' ? (<>
                    <label className={labelClass}>Produto bonificado<select className={inputClass} value={r.bonus_produto_id} onChange={e => changeRule(r.id, { bonus_produto_id: e.target.value })}>
                      <option value="">Mesmo produto (somente SKU único)</option>{produtos.filter(p => p.ativo).map(p => <option key={p.id} value={p.id}>{p.produto}</option>)}
                    </select></label>
                    <label className={labelClass}>Quantidade bonificada<input type="number" min="1" step="1" className={inputClass} value={r.bonus_quantidade} onChange={e => changeRule(r.id, { bonus_quantidade: Number(e.target.value) })}/></label>
                    <label className="flex items-center gap-2 text-xs font-bold"><input type="checkbox" checked={r.repetivel} onChange={e => changeRule(r.id, { repetivel: e.target.checked })}/> Repetir benefício a cada múltiplo do mínimo</label>
                  </>) : (
                    <label className={labelClass}>Desconto adicional (%)<input type="number" className={inputClass} min="0.01" max="100" step="0.01" value={r.desconto_percentual} onChange={e => changeRule(r.id, { desconto_percentual: Number(e.target.value) })}/></label>
                  )}
                </div>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap justify-end gap-2 border-t border-neutral-100 pt-4">
            <button disabled={busy} onClick={() => void save(false)} className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-bold">Salvar</button>
            <button disabled={busy} onClick={() => void save(true)} className="rounded-lg bg-green-600 px-4 py-2 text-sm font-bold text-white">Salvar e ativar</button>
          </div>
        </section>
      ) : (
        <section className="space-y-3">
          <input className={inputClass} placeholder="Buscar campanhas..." value={filter} onChange={e => setFilter(e.target.value)}/>
          {visible.length === 0 && <div className="rounded-xl border border-neutral-200 bg-white p-8 text-center text-sm text-neutral-500">Nenhuma campanha cadastrada.</div>}
          {visible.map(c => <article key={c.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-neutral-200 bg-white p-4">
            {c.imagem_data ? <img className="h-16 w-16 rounded-lg border object-cover" alt="Encarte" src={c.imagem_data}/> : <Megaphone className="text-orange-500"/>}
            <div className="min-w-0 flex-1"><h2 className="font-black">{c.titulo}</h2>
              <p className="text-xs text-neutral-500">{c.inicio} até {c.fim} · {c.regras?.length || 0} regras · {campanhaAtiva(c) ? 'Vigente' : c.status}</p></div>
            <button onClick={() => { setForm(c); setError(''); }} className="flex items-center gap-1 rounded-lg border px-3 py-2 text-xs font-bold"><Pencil size={14}/> Editar</button>
            {c.status === 'ativa'
              ? <button onClick={() => void changeStatus(c, 'pausada')} className="rounded-lg border px-3 py-2 text-xs font-bold">Pausar</button>
              : <button onClick={() => void changeStatus(c, 'ativa')} disabled={!!validate(c, true)} className="flex items-center gap-1 rounded-lg border border-green-200 px-3 py-2 text-xs font-bold text-green-700 disabled:opacity-40"><CheckCircle2 size={14}/> Ativar</button>}
          </article>)}
        </section>
      )}
    </div>
  );
}
