import React, { useEffect, useMemo, useState } from 'react';
import { Megaphone, Plus, Trash2, Sparkles, ImageUp, CheckCircle2, AlertTriangle, Pencil, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useDataManager } from '../lib/dataManager';
import type { Campanha, RegraCampanha } from '../lib/campaignEngine';
import { campanhaAtiva, descontoValido, descricaoDesconto, modalidadeDesconto, type ModalidadeDesconto } from '../lib/campaignEngine';
import { CampaignSkuSearch } from '../components/campaigns/CampaignSkuSearch';
import { CampaignSkuMultiSearch } from '../components/campaigns/CampaignSkuMultiSearch';

const blankRule = (): RegraCampanha => ({
  id: crypto.randomUUID(), tipo: 'bonificacao', produto_ids: [],
  familia: '', minimo: 10, unidade: 'embalagens', repetivel: true, bonus_produto_id: '',
  bonus_quantidade: 1, desconto_percentual: 0,
  desconto_modalidade: 'adicional_percentual', desconto_valor: 0, preco_final: 0,
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
        const labels: string[] = Array.isArray(r.produtos_nomes) && r.produtos_nomes.length
          ? r.produtos_nomes.filter((n: unknown): n is string => typeof n === 'string' && !!n.trim()).slice(0, 80)
          : (String(r.produto_nome || '').trim() ? [String(r.produto_nome).trim()] : []);
        const selectedIds: string[] = [];
        const pendencias: string[] = [];
        for (const label of [...new Set(labels)]) {
          const normalized = normalize(label);
          const matching = produtos.filter(p => normalized && normalize(p.produto) === normalized);
          if (matching.length === 1) selectedIds.push(matching[0].id);
          else pendencias.push(label);
        }
        const bonusNameRaw = String(r.bonus_produto_nome || '').trim();
        const bonusName = normalize(bonusNameRaw);
        const bonus = produtos.filter(p => bonusName && normalize(p.produto) === bonusName);
        if (bonusNameRaw && bonus.length !== 1) pendencias.push('SKU bonificado: ' + bonusNameRaw);
        return {
          ...blankRule(), tipo: r.tipo === 'desconto' ? 'desconto' : 'bonificacao',
          produto_ids: [...new Set(selectedIds)],
          pendencias_importacao: pendencias,
          // Listas explícitas não significam autorização para incluir a família toda.
          familia: labels.length ? '' : (familias.find(f => normalize(f) === normalize(String(r.familia || ''))) || ''),
          minimo: Number(r.minimo) || 0,
          unidade: ['embalagens', 'unidades', 'kg'].includes(r.unidade) ? r.unidade : 'embalagens',
          repetivel: !!r.repetivel,
          bonus_produto_id: bonus.length === 1 ? bonus[0].id : '',
          bonus_quantidade: Math.max(1, Math.floor(Number(r.bonus_quantidade) || 1)),
          desconto_percentual: Number(r.desconto_percentual) || 0,
          desconto_modalidade: ['adicional_percentual','absoluto_percentual','valor','preco_final'].includes(r.desconto_modalidade)
            ? r.desconto_modalidade : 'adicional_percentual',
          desconto_valor: Number(r.desconto_valor) || 0,
          preco_final: Number(r.preco_final) || 0,
        };
      });
      setForm(current => current ? {
        ...current, status: 'rascunho',
        titulo: String(draft.titulo || current.titulo).slice(0, 150),
        descricao: String(draft.descricao || current.descricao).slice(0, 2000),
        inicio: /^\d{4}-\d{2}-\d{2}$/.test(String(draft.inicio)) ? draft.inicio : '',
        fim: /^\d{4}-\d{2}-\d{2}$/.test(String(draft.fim)) ? draft.fim : '',
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
      if (!r.produto_ids?.length && !r.familia) return 'Selecione um ou mais produtos ou uma família em cada regra.';
      if (activate && (r.pendencias_importacao?.length || 0) > 0)
        return 'Confira os SKUs não localizados no encarte e confirme a revisão antes de ativar.';
      if (!Number.isInteger(Number(r.minimo)) || Number(r.minimo) <= 0) return 'Quantidade mínima deve ser inteira e positiva.';
      if (r.tipo === 'bonificacao' && (!Number.isInteger(Number(r.bonus_quantidade)) || Number(r.bonus_quantidade) <= 0))
        return 'Informe uma quantidade bonificada válida.';
      if (r.tipo === 'bonificacao' && !r.bonus_produto_id && (r.familia || r.produto_ids.length !== 1))
        return 'Se vários SKUs participam da regra, selecione o SKU específico da bonificação.';
      if (r.tipo === 'desconto' && !descontoValido(r))
        return 'Informe desconto válido: percentual de 0 a 100% ou valor em reais maior que zero.';
    }
    if (activate && c.fim < today()) return 'Não é possível ativar campanha com validade encerrada.';
    return '';
  };

  const save = async (activate = false) => {
    if (!form || busy) return;
    const reason = validate(form, activate || form.status === 'ativa');
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
                    <option value="bonificacao">Bonificação via FX (sem consumir Flex)</option><option value="desconto">Desconto / preço promocional</option>
                  </select></label>
                  <label className={labelClass}>Quantidade mínima<input className={inputClass} type="number" min="1" step="1" value={r.minimo} onChange={e => changeRule(r.id, { minimo: Number(e.target.value) })}/></label>
                  <label className={labelClass}>Unidade do mínimo<select className={inputClass} value={r.unidade || 'embalagens'} onChange={e => changeRule(r.id, { unidade: e.target.value as RegraCampanha['unidade'] })}><option value="embalagens">Embalagens / caixas do pedido</option><option value="unidades">Unidades / sacos individuais</option><option value="kg">Peso líquido (kg)</option></select></label>
                  <label className={labelClass}>Família participante (opcional)<select className={inputClass} value={r.familia} onChange={e => changeRule(r.id, { familia: e.target.value, produto_ids: [] })}>
                    <option value="">Escolher um produto específico</option>{familias.map(f => <option key={f} value={f}>{f}</option>)}
                  </select></label>
                  <CampaignSkuMultiSearch
                    label="SKUs participantes (seleção múltipla)"
                    produtos={produtos}
                    disabled={!!r.familia}
                    values={r.produto_ids || []}
                    onChange={ids => changeRule(r.id, { produto_ids: ids })}
                  />
                  {!!r.pendencias_importacao?.length && (
                    <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 sm:col-span-2" role="alert">
                      <p className="font-bold">A IA não conseguiu associar automaticamente estes nomes do encarte:</p>
                      <ul className="list-inside list-disc space-y-1">
                        {r.pendencias_importacao.map((name, index) => <li key={index}>{name}</li>)}
                      </ul>
                      <p>Localize os SKUs corretos na pesquisa e confira que o grupo está completo. A campanha só pode ser ativada após a conferência.</p>
                      <button type="button" disabled={!r.produto_ids.length && !r.familia}
                        onClick={() => changeRule(r.id, { pendencias_importacao: [] })}
                        className="rounded-md border border-amber-500 bg-white px-3 py-2 font-bold text-amber-900 disabled:opacity-50">
                        Conferi os SKUs e a bonificação
                      </button>
                    </div>
                  )}
                  {r.tipo === 'bonificacao' ? (<>
                    <CampaignSkuSearch
                      label="SKU bonificado"
                      produtos={produtos}
                      value={r.bonus_produto_id}
                      onChange={id => changeRule(r.id, { bonus_produto_id: id })}
                      placeholder="Digite o nome do produto bonificado"
                      allowSameProduct
                    />
                    {(r.produto_ids.length > 1 || !!r.familia) && !r.bonus_produto_id && (
                      <p className="text-xs font-semibold text-orange-700 sm:col-span-2">
                        Para grupos com vários SKUs, escolha o SKU exato que será bonificado.
                      </p>
                    )}
                    <label className={labelClass}>Quantidade bonificada<input type="number" min="1" step="1" className={inputClass} value={r.bonus_quantidade} onChange={e => changeRule(r.id, { bonus_quantidade: Number(e.target.value) })}/></label>
                    <label className="flex items-center gap-2 text-xs font-bold"><input type="checkbox" checked={r.repetivel} onChange={e => changeRule(r.id, { repetivel: e.target.checked })}/> Repetir benefício a cada múltiplo do mínimo</label>
                  </>) : (
                    <div className="space-y-3 sm:col-span-2">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <label className={labelClass}>Modalidade de desconto
                          <select className={inputClass} value={modalidadeDesconto(r)}
                            onChange={e => changeRule(r.id, {
                              desconto_modalidade: e.target.value as ModalidadeDesconto,
                              desconto_percentual: 0, desconto_valor: 0, preco_final: 0,
                            })}>
                            <option value="adicional_percentual">Desconto adicional (%)</option>
                            <option value="absoluto_percentual">Desconto absoluto (%)</option>
                            <option value="valor">Desconto em valor (R$)</option>
                            <option value="preco_final">Valor final do item (R$)</option>
                          </select>
                        </label>
                        {['adicional_percentual', 'absoluto_percentual'].includes(modalidadeDesconto(r)) ? (
                          <label className={labelClass}>Percentual de desconto (%)
                            <input type="number" inputMode="decimal" className={inputClass} min="0.01" max="100" step="0.01"
                              value={r.desconto_percentual || ''} placeholder="Ex.: 5"
                              onChange={e => changeRule(r.id, { desconto_percentual: Number(e.target.value) })}/>
                          </label>
                        ) : (
                          <label className={labelClass}>{modalidadeDesconto(r) === 'valor' ? 'Desconto por embalagem (R$)' : 'Preço final por embalagem (R$)'}
                            <input type="number" inputMode="decimal" className={inputClass} min="0.01" step="0.01"
                              value={modalidadeDesconto(r) === 'valor' ? r.desconto_valor || '' : r.preco_final || ''}
                              placeholder="Ex.: 59,90"
                              onChange={e => changeRule(r.id, modalidadeDesconto(r) === 'valor'
                                ? { desconto_valor: Number(e.target.value) } : { preco_final: Number(e.target.value) })}/>
                          </label>
                        )}
                      </div>
                      <p className="text-[11px] text-neutral-500">
                        {modalidadeDesconto(r) === 'adicional_percentual'
                          ? 'Percentual aplicado sobre o preço já calculado pela tabela do cliente.'
                          : modalidadeDesconto(r) === 'absoluto_percentual'
                            ? 'Percentual total sobre o preço cheio, substituindo o desconto de tabela.'
                            : modalidadeDesconto(r) === 'valor'
                              ? 'Dedução em reais no valor da caixa ou saco, após aplicação da tabela.'
                              : 'Preço final fixo da caixa ou saco comercial, independentemente da tabela.'}
                        {' '}Se outras campanhas incidirem sobre o SKU, prevalece o menor preço, sem acumulação.
                      </p>
                      {descontoValido(r) && <p className="text-xs font-semibold text-orange-800">{descricaoDesconto(r)}</p>}
                    </div>
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
