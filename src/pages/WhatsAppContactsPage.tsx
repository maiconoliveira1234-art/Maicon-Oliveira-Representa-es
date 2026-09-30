import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Check, Link2, Loader2, MessageCircle, RefreshCw, Search, Send, Sparkles, Unlink, XCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { PageHeader, Panel } from '../components/ui/AppChrome';

type Status = 'pendente' | 'vinculado' | 'ignorado';

type WhatsAppMap = {
  id: string;
  whatsapp_nome: string;
  cliente_id: string | null;
  status: Status;
  total_mensagens: number;
  ultima_vez_em: string;
};

type Cliente = {
  id: string;
  cliente: string;
  contato: string | null;
  cidade: string | null;
  telefone: string | number | null;
  ativo: boolean | null;
};

type UltimaMensagem = {
  id: string;
  contato_map_id: string | null;
  mensagem: string;
  recebida_em: string;
  sugestao_resposta: string | null;
  sugestao_gerada_em: string | null;
  sugestao_modelo: string | null;
  sugestao_erro: string | null;
};

export function WhatsAppContactsPage() {
  const navigate = useNavigate();
  const [maps, setMaps] = useState<WhatsAppMap[]>([]);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [ultimas, setUltimas] = useState<Record<string, UltimaMensagem>>({});
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const [selectedMap, setSelectedMap] = useState<WhatsAppMap | null>(null);
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<Status>('pendente');
  const [error, setError] = useState<string | null>(null);

  const loadData = async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const [{ data: mapData, error: mapError }, { data: clientData, error: clientError }, { data: messageData, error: messageError }] = await Promise.all([
        supabase
          .from('whatsapp_contatos_map')
          .select('id, whatsapp_nome, cliente_id, status, total_mensagens, ultima_vez_em')
          .order('ultima_vez_em', { ascending: false }),
        supabase
          .from('clientes')
          .select('id, cliente, contato, cidade, telefone, ativo')
          .order('cliente', { ascending: true }),
        supabase
          .from('whatsapp_mensagens')
          .select('id, contato_map_id, mensagem, recebida_em, sugestao_resposta, sugestao_gerada_em, sugestao_modelo, sugestao_erro')
          .order('recebida_em', { ascending: false })
          .limit(500),
      ]);

      if (mapError) throw mapError;
      if (clientError) throw clientError;
      if (messageError) throw messageError;

      setMaps((mapData || []) as WhatsAppMap[]);
      setClientes((clientData || []) as Cliente[]);

      const byMap: Record<string, UltimaMensagem> = {};
      for (const msg of (messageData || []) as UltimaMensagem[]) {
        if (msg.contato_map_id && !byMap[msg.contato_map_id]) byMap[msg.contato_map_id] = msg;
      }
      setUltimas(byMap);
    } catch (err: any) {
      console.error('Erro ao carregar vínculos WhatsApp:', err);
      setError(err?.message || 'Não foi possível carregar os vínculos do WhatsApp.');
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();

    const refresh = () => void loadData(true);
    const intervalId = window.setInterval(refresh, 15000);
    window.addEventListener('focus', refresh);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('focus', refresh);
    };
  }, []);

  const visibleMaps = useMemo(
    () => maps.filter(item => item.status === tab),
    [maps, tab]
  );

  const filteredClients = useMemo(() => {
    const q = search.trim().toLocaleLowerCase('pt-BR');
    const base = [...clientes].sort((a, b) => Number(Boolean(b.ativo)) - Number(Boolean(a.ativo)) || a.cliente.localeCompare(b.cliente));
    if (!q) return base.slice(0, 40);
    return base
      .filter(c => [c.cliente, c.contato, c.cidade].some(value => value?.toLocaleLowerCase('pt-BR').includes(q)))
      .slice(0, 60);
  }, [clientes, search]);

  const bindClient = async (map: WhatsAppMap, clienteId: string) => {
    setSavingId(map.id);
    setError(null);
    try {
      const { error: mapError } = await supabase
        .from('whatsapp_contatos_map')
        .update({ status: 'vinculado', cliente_id: clienteId, atualizado_em: new Date().toISOString() })
        .eq('id', map.id);
      if (mapError) throw mapError;

      const { error: messagesError } = await supabase
        .from('whatsapp_mensagens')
        .update({ cliente_id: clienteId })
        .eq('contato_map_id', map.id);
      if (messagesError) throw messagesError;

      setSelectedMap(null);
      setSearch('');
      await loadData();
    } catch (err: any) {
      console.error('Erro ao vincular contato:', err);
      setError(err?.message || 'Não foi possível vincular o contato.');
    } finally {
      setSavingId(null);
    }
  };

  const setIgnored = async (map: WhatsAppMap) => {
    setSavingId(map.id);
    setError(null);
    try {
      const { error: mapError } = await supabase
        .from('whatsapp_contatos_map')
        .update({ status: 'ignorado', cliente_id: null, atualizado_em: new Date().toISOString() })
        .eq('id', map.id);
      if (mapError) throw mapError;

      const { error: messagesError } = await supabase
        .from('whatsapp_mensagens')
        .update({ cliente_id: null })
        .eq('contato_map_id', map.id);
      if (messagesError) throw messagesError;

      await loadData();
    } catch (err: any) {
      setError(err?.message || 'Não foi possível ignorar o contato.');
    } finally {
      setSavingId(null);
    }
  };

  const setPending = async (map: WhatsAppMap) => {
    setSavingId(map.id);
    setError(null);
    try {
      const { error: mapError } = await supabase
        .from('whatsapp_contatos_map')
        .update({ status: 'pendente', cliente_id: null, atualizado_em: new Date().toISOString() })
        .eq('id', map.id);
      if (mapError) throw mapError;

      const { error: messagesError } = await supabase
        .from('whatsapp_mensagens')
        .update({ cliente_id: null })
        .eq('contato_map_id', map.id);
      if (messagesError) throw messagesError;

      await loadData();
    } catch (err: any) {
      setError(err?.message || 'Não foi possível remover o vínculo.');
    } finally {
      setSavingId(null);
    }
  };

  const openWhatsAppReply = (map: WhatsAppMap, message: UltimaMensagem) => {
    if (!message.sugestao_resposta) return;

    const cliente = clientes.find(item => item.id === map.cliente_id);
    const rawPhone = String(cliente?.telefone ?? '').replace(/\D/g, '');
    if (!rawPhone) {
      setError('Este cliente não possui telefone cadastrado no CRM.');
      return;
    }

    let phone = rawPhone;
    if ((phone.length === 10 || phone.length === 11) && !phone.startsWith('55')) {
      phone = `55${phone}`;
    }

    if (phone.length < 12 || phone.length > 13) {
      setError('O telefone cadastrado para este cliente parece inválido. Revise o cadastro antes de enviar.');
      return;
    }

    const url = `https://wa.me/${phone}?text=${encodeURIComponent(message.sugestao_resposta)}`;
    window.location.href = url;
  };

  const generateSuggestion = async (message: UltimaMensagem) => {
    setGeneratingId(message.id);
    setError(null);
    try {
      const { error: invokeError } = await supabase.functions.invoke('whatsapp-suggest', {
        body: { message_id: message.id },
      });
      if (invokeError) throw invokeError;
      await loadData(true);
    } catch (err: any) {
      console.error('Erro ao gerar sugestão:', err);
      setError(err?.message || 'Não foi possível gerar a sugestão de resposta.');
    } finally {
      setGeneratingId(null);
    }
  };

  const clientName = (clienteId: string | null) => clientes.find(c => c.id === clienteId)?.cliente || 'Cliente não encontrado';

  return (
    <div className="mx-auto max-w-3xl space-y-5 py-2">
      <button
        type="button"
        onClick={() => navigate('/')}
        className="inline-flex items-center gap-2 text-sm font-bold text-neutral-500 hover:text-neutral-900"
      >
        <ArrowLeft size={16} /> Voltar para a Home
      </button>

      <PageHeader
        title="WhatsApp Business"
        subtitle="Mensagens capturadas, vínculos com clientes e sugestões de resposta"
        icon={<MessageCircle />}
      />

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
          {error}
        </div>
      )}

      <div className="grid grid-cols-3 gap-2">
        {(['pendente', 'vinculado', 'ignorado'] as Status[]).map(status => {
          const labels: Record<Status, string> = { pendente: 'Pendentes', vinculado: 'Vinculados', ignorado: 'Ignorados' };
          const count = maps.filter(m => m.status === status).length;
          return (
            <button
              key={status}
              type="button"
              onClick={() => setTab(status)}
              className={`rounded-xl border px-3 py-3 text-sm font-black transition ${tab === status ? 'border-orange-300 bg-orange-50 text-orange-700' : 'border-neutral-200 bg-white text-neutral-600'}`}
            >
              {labels[status]} <span className="ml-1 text-xs">({count})</span>
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="flex min-h-48 items-center justify-center text-neutral-500">
          <Loader2 className="mr-2 animate-spin" size={20} /> Carregando...
        </div>
      ) : visibleMaps.length === 0 ? (
        <Panel className="p-8 text-center text-sm text-neutral-500">
          Nenhum contato nesta categoria.
        </Panel>
      ) : (
        <div className="space-y-3">
          {visibleMaps.map(map => {
            const last = ultimas[map.id];
            const busy = savingId === map.id;
            const generating = Boolean(last && generatingId === last.id);
            return (
              <Panel key={map.id} className="overflow-hidden">
                <div className="p-4 sm:p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <MessageCircle size={17} className="shrink-0 text-green-600" />
                        <h2 className="truncate font-black text-neutral-900">{map.whatsapp_nome}</h2>
                      </div>
                      <p className="mt-1 text-xs font-semibold text-neutral-400">
                        {map.total_mensagens} {map.total_mensagens === 1 ? 'mensagem capturada' : 'mensagens capturadas'}
                      </p>
                    </div>
                    {map.status === 'vinculado' && (
                      <span className="rounded-full bg-green-50 px-2.5 py-1 text-[10px] font-black uppercase text-green-700">Vinculado</span>
                    )}
                  </div>

                  {last && (
                    <div className="mt-4 rounded-xl bg-neutral-50 px-3 py-3">
                      <p className="line-clamp-3 text-sm text-neutral-700">{last.mensagem}</p>
                      <p className="mt-1 text-[10px] font-semibold text-neutral-400">
                        {new Date(last.recebida_em).toLocaleString('pt-BR')}
                      </p>
                    </div>
                  )}

                  {map.status === 'vinculado' && last && (
                    <div className="mt-3 rounded-xl border border-violet-100 bg-violet-50/60 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <Sparkles size={15} className="text-violet-600" />
                          <p className="text-[10px] font-black uppercase tracking-wider text-violet-700">Sugestão da IA</p>
                        </div>
                        {last.sugestao_gerada_em && (
                          <span className="text-[9px] font-semibold text-violet-400">
                            {new Date(last.sugestao_gerada_em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        )}
                      </div>

                      {last.sugestao_resposta ? (
                        <>
                          <p className="mt-2 whitespace-pre-wrap text-sm font-medium leading-relaxed text-neutral-800">
                            {last.sugestao_resposta}
                          </p>
                          <div className="mt-3 flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={() => openWhatsAppReply(map, last)}
                              className="inline-flex items-center gap-2 rounded-lg bg-green-600 px-3 py-2 text-xs font-black text-white"
                            >
                              <Send size={14} /> Enviar resposta
                            </button>
                            <button
                              type="button"
                              onClick={() => generateSuggestion(last)}
                              disabled={generating}
                              className="inline-flex items-center gap-2 rounded-lg border border-violet-200 bg-white px-3 py-2 text-xs font-black text-violet-700 disabled:opacity-50"
                            >
                              {generating ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                              Atualizar
                            </button>
                          </div>
                        </>
                      ) : last.sugestao_erro ? (
                        <div className="mt-2">
                          <p className="text-xs font-semibold text-rose-700">Não foi possível gerar a sugestão automaticamente.</p>
                          <button
                            type="button"
                            onClick={() => generateSuggestion(last)}
                            disabled={generating}
                            className="mt-2 inline-flex items-center gap-2 rounded-lg border border-violet-200 bg-white px-3 py-2 text-xs font-black text-violet-700 disabled:opacity-50"
                          >
                            {generating ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                            Tentar novamente
                          </button>
                        </div>
                      ) : (
                        <div className="mt-2 flex items-center justify-between gap-3">
                          <p className="text-xs font-semibold text-neutral-500">Ainda não há sugestão para esta mensagem.</p>
                          <button
                            type="button"
                            onClick={() => generateSuggestion(last)}
                            disabled={generating}
                            className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-violet-200 bg-white px-3 py-2 text-xs font-black text-violet-700 disabled:opacity-50"
                          >
                            {generating ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                            Gerar
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {map.status === 'vinculado' ? (
                    <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <p className="text-[10px] font-black uppercase tracking-wider text-neutral-400">Cliente CRM</p>
                        <p className="truncate text-sm font-bold text-neutral-800">{clientName(map.cliente_id)}</p>
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => { setSelectedMap(map); setSearch(''); }}
                          disabled={busy}
                          className="inline-flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-xs font-black text-neutral-700"
                        >
                          <Link2 size={14} /> Alterar
                        </button>
                        <button
                          type="button"
                          onClick={() => setPending(map)}
                          disabled={busy}
                          className="inline-flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-black text-red-700"
                        >
                          {busy ? <Loader2 size={14} className="animate-spin" /> : <Unlink size={14} />} Desvincular
                        </button>
                      </div>
                    </div>
                  ) : map.status === 'ignorado' ? (
                    <div className="mt-4 flex justify-end">
                      <button
                        type="button"
                        onClick={() => setPending(map)}
                        disabled={busy}
                        className="inline-flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-xs font-black text-neutral-700"
                      >
                        {busy ? <Loader2 size={14} className="animate-spin" /> : <Link2 size={14} />} Reavaliar
                      </button>
                    </div>
                  ) : (
                    <div className="mt-4 grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => { setSelectedMap(map); setSearch(''); }}
                        className="inline-flex items-center justify-center gap-2 rounded-lg bg-neutral-900 px-3 py-2.5 text-xs font-black text-white"
                      >
                        <Link2 size={15} /> Vincular cliente
                      </button>
                      <button
                        type="button"
                        onClick={() => setIgnored(map)}
                        disabled={busy}
                        className="inline-flex items-center justify-center gap-2 rounded-lg border border-neutral-200 bg-white px-3 py-2.5 text-xs font-black text-neutral-600"
                      >
                        {busy ? <Loader2 size={15} className="animate-spin" /> : <XCircle size={15} />} Não vincular
                      </button>
                    </div>
                  )}
                </div>
              </Panel>
            );
          })}
        </div>
      )}

      {selectedMap && (
        <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={() => setSelectedMap(null)}>
          <div className="max-h-[85vh] w-full max-w-xl overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl" onClick={e => e.stopPropagation()}>
            <div className="border-b border-neutral-100 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-wider text-neutral-400">WhatsApp</p>
                  <h3 className="font-black text-neutral-900">{selectedMap.whatsapp_nome}</h3>
                </div>
                <button type="button" onClick={() => setSelectedMap(null)} className="rounded-lg p-2 text-neutral-400 hover:bg-neutral-100">×</button>
              </div>
              <div className="relative mt-4">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" size={17} />
                <input
                  autoFocus
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Buscar cliente, contato ou cidade..."
                  className="w-full rounded-xl border border-neutral-200 py-3 pl-10 pr-3 text-sm outline-none focus:border-orange-400"
                />
              </div>
            </div>
            <div className="max-h-[58vh] overflow-y-auto p-2">
              {filteredClients.map(cliente => (
                <button
                  key={cliente.id}
                  type="button"
                  onClick={() => bindClient(selectedMap, cliente.id)}
                  disabled={savingId === selectedMap.id}
                  className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-3 text-left hover:bg-neutral-50 disabled:opacity-50"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-bold text-neutral-900">{cliente.cliente}</p>
                      {cliente.ativo && <span className="rounded bg-green-50 px-1.5 py-0.5 text-[9px] font-black text-green-700">ATIVO</span>}
                    </div>
                    <p className="truncate text-xs text-neutral-400">
                      {[cliente.contato, cliente.cidade].filter(Boolean).join(' · ') || 'Sem contato/cidade informado'}
                    </p>
                  </div>
                  {savingId === selectedMap.id ? <Loader2 size={16} className="animate-spin text-orange-600" /> : <Check size={16} className="shrink-0 text-neutral-300" />}
                </button>
              ))}
              {filteredClients.length === 0 && (
                <div className="p-8 text-center text-sm text-neutral-500">Nenhum cliente encontrado.</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
