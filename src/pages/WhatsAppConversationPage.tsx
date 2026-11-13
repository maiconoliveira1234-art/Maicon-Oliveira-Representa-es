import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowLeft, Check, Copy, ExternalLink, Link2, Loader2, MoreVertical, Mic, RefreshCw, Sparkles, Unlink, X } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { OrderLearningPanel } from '../components/whatsapp/OrderLearningPanel';
import { ClientLinkSheet } from '../components/whatsapp/ClientLinkSheet';
import { fetchClientes, linkContact, markContactSeen, setContactStatus, type ClienteLite } from '../lib/whatsappContacts';
import { refreshWhatsAppSummary } from '../hooks/useWhatsAppSummary';
import {
  audioState,
  clockTime,
  dayLabel,
  groupIntoBursts,
  isSuggestionStale,
  readDraft,
  readFunctionError,
  relativeTime,
  resolveReplyPhone,
  whatsAppLink,
  writeDraft,
} from '../lib/whatsappUi';

type Atendimento = 'resolvido' | 'em_negociacao' | 'aguardando_retorno';

type MapRow = {
  id: string;
  whatsapp_nome: string;
  whatsapp_perfil_nome: string | null;
  cliente_id: string | null;
  status: 'pendente' | 'vinculado' | 'ignorado';
};

type Cliente = {
  id: string;
  cliente: string;
  contato: string | null;
  cidade: string | null;
  telefone: string | number | null;
};

type Message = {
  id: string;
  mensagem: string;
  recebida_em: string;
  tipo_mensagem: string | null;
  transcricao_audio: string | null;
  audio_status: string | null;
  transcricao_erro: string | null;
  sugestao_resposta: string | null;
  sugestao_gerada_em: string | null;
  sugestao_erro: string | null;
  visualizada_em: string | null;
};

const MESSAGE_FIELDS =
  'id, mensagem, recebida_em, tipo_mensagem, transcricao_audio, audio_status, transcricao_erro, sugestao_resposta, sugestao_gerada_em, sugestao_erro, visualizada_em';
const POLL_MS = 15000;

export function WhatsAppConversationPage() {
  const navigate = useNavigate();
  const { contatoId } = useParams<{ contatoId: string }>();
  const [mapping, setMapping] = useState<MapRow | null>(null);
  const [cliente, setCliente] = useState<Cliente | null>(null);
  const [messages, setMessages] = useState<Message[]>([]); // chronological
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [manualIds, setManualIds] = useState<Set<string> | null>(null); // null = automatic (last burst)
  const [draft, setDraft] = useState('');
  const [suggestionAt, setSuggestionAt] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied] = useState(false);
  const draftReady = useRef(false);

  const [atendimento, setAtendimento] = useState<Atendimento>('resolvido');
  const [atendimentoState, setAtendimentoState] = useState<'loading' | 'ok' | 'unavailable'>('loading');
  const [savingAtendimento, setSavingAtendimento] = useState(false);

  const [menuOpen, setMenuOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [clientes, setClientes] = useState<ClienteLite[]>([]);
  const [clientesLoading, setClientesLoading] = useState(false);
  const [linkBusy, setLinkBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const scrolled = useRef(false);

  const loadData = useCallback(
    async (silent: boolean) => {
      if (!contatoId) return;
      if (!silent) setLoading(true);
      try {
        const { data: mapData, error: mapError } = await supabase
          .from('whatsapp_contatos_map')
          .select('id, whatsapp_nome, whatsapp_perfil_nome, cliente_id, status')
          .eq('id', contatoId)
          .maybeSingle();
        if (mapError) throw mapError;
        if (!mapData) throw new Error('Conversa não encontrada.');
        const typedMap = mapData as MapRow;
        setMapping(typedMap);

        const clientQuery = typedMap.cliente_id
          ? supabase.from('clientes').select('id, cliente, contato, cidade, telefone').eq('id', typedMap.cliente_id).maybeSingle()
          : Promise.resolve({ data: null, error: null });

        const [messageResult, clientResult] = await Promise.all([
          supabase
            .from('whatsapp_mensagens')
            .select(MESSAGE_FIELDS)
            .eq('contato_map_id', contatoId)
            .order('recebida_em', { ascending: false })
            .limit(200),
          clientQuery,
        ]);
        if (messageResult.error) throw messageResult.error;
        if (clientResult.error) throw clientResult.error;

        const chronological = ([...(messageResult.data || [])] as Message[]).reverse();
        setMessages(chronological);
        setCliente((clientResult.data || null) as Cliente | null);
        setError(null);

        if (!document.hidden && chronological.some(item => !item.visualizada_em)) {
          void markContactSeen(contatoId).then(() => refreshWhatsAppSummary());
        }
      } catch (err: any) {
        console.error('Erro ao carregar histórico do WhatsApp:', err);
        setError(err?.message || 'Não foi possível carregar a conversa.');
      } finally {
        setLoading(false);
      }
    },
    [contatoId]
  );

  useEffect(() => {
    scrolled.current = false;
    draftReady.current = false;
    setManualIds(null);
    setDraft('');
    setSuggestionAt(null);
    void loadData(false);
    const tick = () => {
      if (!document.hidden) void loadData(true);
    };
    const id = window.setInterval(tick, POLL_MS);
    window.addEventListener('focus', tick);
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('focus', tick);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [contatoId, loadData]);

  // The "situação do atendimento" is read once; a failure no longer blocks the whole conversation.
  useEffect(() => {
    if (!contatoId) return;
    let cancelled = false;
    setAtendimentoState('loading');
    void (async () => {
      const { data, error: invokeError } = await supabase.functions.invoke('whatsapp-retencao-atendimento', {
        body: { action: 'get', contato_map_id: contatoId },
      });
      if (cancelled) return;
      if (invokeError || data?.error) {
        setAtendimentoState('unavailable');
        return;
      }
      setAtendimento((data?.status || 'resolvido') as Atendimento);
      setAtendimentoState('ok');
    })();
    return () => {
      cancelled = true;
    };
  }, [contatoId]);

  const bursts = useMemo(() => groupIntoBursts(messages), [messages]);
  const lastBurst = bursts.length ? bursts[bursts.length - 1] : [];
  const latest = messages.length ? messages[messages.length - 1] : null;

  const contextMessages = useMemo(() => {
    if (manualIds) return messages.filter(item => manualIds.has(item.id));
    return lastBurst;
  }, [manualIds, messages, lastBurst]);
  const target = contextMessages.length ? contextMessages[contextMessages.length - 1] : null;

  // Restore the saved draft once (or fall back to the suggestion already stored on the newest message).
  useEffect(() => {
    if (draftReady.current || loading || !contatoId) return;
    draftReady.current = true;
    const saved = readDraft(contatoId);
    if (saved) {
      setDraft(saved.text);
      const sameMessages = saved.contextIds.filter(id => messages.some(item => item.id === id));
      if (sameMessages.length > 0 && sameMessages.length === saved.contextIds.length) {
        const auto = new Set(lastBurst.map(item => item.id));
        const isAuto = sameMessages.length === auto.size && sameMessages.every(id => auto.has(id));
        if (!isAuto) setManualIds(new Set(sameMessages));
      }
      setSuggestionAt(new Date(saved.savedAt).toISOString());
    } else {
      const withSuggestion = [...messages].reverse().find(item => item.sugestao_resposta);
      if (withSuggestion && latest && withSuggestion.id === latest.id) {
        setDraft(withSuggestion.sugestao_resposta || '');
        setSuggestionAt(withSuggestion.sugestao_gerada_em);
      }
    }
  }, [loading, contatoId, messages, lastBurst, latest]);

  useEffect(() => {
    if (!contatoId || !draftReady.current) return;
    writeDraft(contatoId, { text: draft, targetId: target?.id ?? null, contextIds: contextMessages.map(item => item.id) });
  }, [draft, contatoId, target, contextMessages]);

  useEffect(() => {
    if (loading || scrolled.current || messages.length === 0) return;
    scrolled.current = true;
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [loading, messages.length]);

  const stale = Boolean(draft.trim()) && isSuggestionStale(suggestionAt, latest?.recebida_em);

  const generate = async () => {
    if (!target) return;
    setGenerating(true);
    setError(null);
    try {
      const contextIds = contextMessages.map(item => item.id);
      const { data, error: invokeError } = await supabase.functions.invoke('whatsapp-suggest', {
        body: { message_id: target.id, ...(contextIds.length > 1 ? { context_message_ids: contextIds } : {}) },
      });
      if (invokeError || data?.error) throw new Error(await readFunctionError(invokeError, data));
      const { data: fresh, error: freshError } = await supabase
        .from('whatsapp_mensagens')
        .select('sugestao_resposta, sugestao_gerada_em')
        .eq('id', target.id)
        .maybeSingle();
      if (freshError) throw freshError;
      if (!fresh?.sugestao_resposta) throw new Error('A IA não devolveu texto. Gere novamente.');
      setDraft(fresh.sugestao_resposta);
      setSuggestionAt(fresh.sugestao_gerada_em || new Date().toISOString());
      await loadData(true);
    } catch (err: any) {
      setError(err?.message || 'Não foi possível gerar a sugestão.');
    } finally {
      setGenerating(false);
    }
  };

  const copyDraft = async () => {
    if (!draft.trim()) return;
    try {
      await navigator.clipboard.writeText(draft);
    } catch {
      const area = document.createElement('textarea');
      area.value = draft;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      try {
        document.execCommand('copy');
      } finally {
        document.body.removeChild(area);
      }
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  const replyPhone = resolveReplyPhone(mapping?.whatsapp_nome, cliente?.telefone);
  const openWhatsApp = () => {
    if (!replyPhone.phone || !draft.trim()) return;
    window.location.href = whatsAppLink(replyPhone.phone, draft);
  };

  const toggleManual = (message: Message) => {
    setManualIds(current => {
      if (!current) return current;
      const next = new Set(current);
      if (next.has(message.id)) next.delete(message.id);
      else next.add(message.id);
      return next;
    });
  };

  const updateAtendimento = async (next: Atendimento) => {
    if (!contatoId || savingAtendimento) return;
    const previous = atendimento;
    setAtendimento(next);
    setSavingAtendimento(true);
    try {
      const { data, error: invokeError } = await supabase.functions.invoke('whatsapp-retencao-atendimento', {
        body: { action: 'set', contato_map_id: contatoId, status: next },
      });
      if (invokeError || data?.error) throw new Error('Não foi possível atualizar o atendimento.');
    } catch (err: any) {
      setAtendimento(previous);
      setError(err?.message || 'Falha ao atualizar o atendimento.');
    } finally {
      setSavingAtendimento(false);
    }
  };

  const openSheet = async () => {
    setMenuOpen(false);
    setSheetOpen(true);
    if (clientes.length > 0) return;
    setClientesLoading(true);
    try {
      setClientes(await fetchClientes());
    } catch (err: any) {
      setError(err?.message || 'Não foi possível carregar os clientes do CRM.');
    } finally {
      setClientesLoading(false);
    }
  };

  const pickClient = async (clienteId: string) => {
    if (!contatoId) return;
    setLinkBusy(true);
    try {
      await linkContact(contatoId, clienteId);
      setSheetOpen(false);
      await loadData(true);
      void refreshWhatsAppSummary();
    } catch (err: any) {
      setError(err?.message || 'Não foi possível alterar o cliente.');
    } finally {
      setLinkBusy(false);
    }
  };

  const unlink = async () => {
    if (!contatoId) return;
    setMenuOpen(false);
    try {
      await setContactStatus(contatoId, 'pendente');
      void refreshWhatsAppSummary();
      navigate('/whatsapp');
    } catch (err: any) {
      setError(err?.message || 'Não foi possível desvincular o contato.');
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-64 items-center justify-center text-neutral-500">
        <Loader2 className="mr-2 animate-spin" size={20} /> Carregando conversa...
      </div>
    );
  }

  const title = mapping?.whatsapp_perfil_nome || mapping?.whatsapp_nome || 'Conversa do WhatsApp';
  const subtitle = cliente ? `${cliente.cliente}${cliente.cidade ? ` · ${cliente.cidade}` : ''}` : 'Contato não vinculado';
  const selecting = manualIds !== null;
  const contextIdSet = new Set(contextMessages.map(item => item.id));
  const now = new Date();

  return (
    <div className="mx-auto flex max-w-3xl flex-col pb-[calc(1rem+env(safe-area-inset-bottom,0px))]">
      <header className="mb-2 flex items-center gap-1">
        <button
          type="button"
          onClick={() => navigate('/whatsapp')}
          aria-label="Voltar para as conversas"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-neutral-600 hover:bg-neutral-100"
        >
          <ArrowLeft size={20} />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-black text-neutral-900">{title}</h1>
          <p className="truncate text-xs font-semibold text-neutral-500">{subtitle}</p>
        </div>
        <div className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen(open => !open)}
            aria-label="Mais opções"
            aria-expanded={menuOpen}
            className="flex h-11 w-11 items-center justify-center rounded-xl text-neutral-600 hover:bg-neutral-100"
          >
            <MoreVertical size={20} />
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 top-12 z-40 w-52 overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-xl">
                <button
                  type="button"
                  onClick={() => void openSheet()}
                  className="flex min-h-[48px] w-full items-center gap-3 px-4 text-left text-sm font-bold text-neutral-700 hover:bg-neutral-50"
                >
                  <Link2 size={16} /> Alterar cliente
                </button>
                <button
                  type="button"
                  onClick={() => void unlink()}
                  className="flex min-h-[48px] w-full items-center gap-3 border-t border-neutral-100 px-4 text-left text-sm font-bold text-red-700 hover:bg-neutral-50"
                >
                  <Unlink size={16} /> Desvincular
                </button>
              </div>
            </>
          )}
        </div>
      </header>

      {error && (
        <div className="mb-2 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
          <span className="flex-1">{error}</span>
          <button type="button" onClick={() => setError(null)} aria-label="Fechar aviso" className="-m-2 flex h-11 w-11 items-center justify-center">
            <X size={16} />
          </button>
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-neutral-200 bg-white px-3 py-2">
        <label htmlFor="atendimento-retencao" className="text-sm font-black text-neutral-800">Atendimento</label>
        {atendimentoState === 'unavailable' ? (
          <span className="text-xs font-semibold text-amber-700">Situação indisponível agora. A conversa segue funcionando.</span>
        ) : (
          <select
            id="atendimento-retencao"
            value={atendimento}
            onChange={event => void updateAtendimento(event.target.value as Atendimento)}
            disabled={savingAtendimento || atendimentoState === 'loading'}
            className="h-11 rounded-lg border border-neutral-300 bg-white px-3 text-base font-semibold text-neutral-800 disabled:opacity-50"
          >
            <option value="resolvido">Resolvido</option>
            <option value="em_negociacao">Em negociação</option>
            <option value="aguardando_retorno">Aguardando retorno</option>
          </select>
        )}
        <p className="basis-full text-xs text-neutral-500">Em negociação e Aguardando retorno protegem o histórico da limpeza automática.</p>
      </div>

      <section aria-label="Mensagens" className="space-y-1 rounded-2xl bg-neutral-100/70 p-3">
        {messages.length === 0 ? (
          <p className="p-8 text-center text-sm text-neutral-500">Nenhuma mensagem capturada nesta conversa.</p>
        ) : (
          bursts.map((burst, burstIndex) => {
            const first = burst[0];
            const previousBurst = bursts[burstIndex - 1];
            const showDay = !previousBurst || dayLabel(previousBurst[0].recebida_em, now) !== dayLabel(first.recebida_em, now);
            return (
              <div key={first.id} className={burstIndex > 0 ? 'pt-2' : ''}>
                {showDay && (
                  <div className="my-2 flex justify-center">
                    <span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-neutral-500 shadow-sm">{dayLabel(first.recebida_em, now)}</span>
                  </div>
                )}
                {burst.map((message, index) => {
                  const state = audioState(message, now);
                  const isAudio = message.tipo_mensagem === 'audio';
                  const inContext = contextIdSet.has(message.id);
                  const isTarget = target?.id === message.id;
                  const text = isAudio ? message.transcricao_audio : message.mensagem;
                  const lastInBurst = index === burst.length - 1;
                  return (
                    <div key={message.id} className="mb-0.5 flex">
                      <button
                        type="button"
                        disabled={!selecting}
                        onClick={() => toggleManual(message)}
                        aria-pressed={selecting ? inContext : undefined}
                        className={`max-w-[88%] rounded-2xl rounded-tl-md px-3 py-2 text-left shadow-sm transition ${
                          selecting ? 'min-h-[44px] cursor-pointer' : 'cursor-default'
                        } ${inContext ? 'bg-violet-100 ring-2 ring-violet-400' : 'bg-white'}`}
                      >
                        {isAudio && (
                          <span className="mb-0.5 flex items-center gap-1 text-xs font-bold text-neutral-500">
                            <Mic size={13} /> Áudio
                          </span>
                        )}
                        {text ? (
                          <span className="block whitespace-pre-wrap break-words text-[15px] leading-snug text-neutral-900">{text}</span>
                        ) : null}
                        {state && (
                          <span className={`mt-0.5 block text-xs font-semibold ${state.tone === 'error' ? 'text-red-700' : 'text-amber-700'}`}>{state.text}</span>
                        )}
                        {lastInBurst && (
                          <span className="mt-0.5 flex items-center justify-end gap-2 text-[11px] font-semibold text-neutral-400">
                            {isTarget && inContext && <span className="font-black text-violet-700">A responder</span>}
                            {clockTime(message.recebida_em)}
                          </span>
                        )}
                      </button>
                    </div>
                  );
                })}
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </section>

      <section aria-label="Resposta" className="mt-3 rounded-2xl border border-violet-100 bg-violet-50/60 p-3">
        <div className="flex items-center gap-2">
          <Sparkles size={16} className="text-violet-600" />
          <h2 className="flex-1 text-sm font-black text-violet-800">Resposta</h2>
          {latest && <span className="text-xs font-semibold text-violet-500">última mensagem há {relativeTime(latest.recebida_em, now)}</span>}
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs font-semibold text-violet-700">
          <span>
            {contextMessages.length === 0
              ? 'Sem mensagens para responder.'
              : selecting
                ? `${contextMessages.length} ${contextMessages.length === 1 ? 'mensagem escolhida' : 'mensagens escolhidas'}. Toque nas mensagens para ajustar.`
                : `Respondendo ${contextMessages.length === 1 ? 'à última mensagem' : `às últimas ${contextMessages.length} mensagens`}.`}
          </span>
          {messages.length > 0 &&
            (selecting ? (
              <button type="button" onClick={() => setManualIds(null)} className="inline-flex min-h-[44px] items-center px-2 font-black underline">
                Voltar ao automático
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setManualIds(new Set(lastBurst.map(item => item.id)))}
                className="inline-flex min-h-[44px] items-center px-2 font-black underline"
              >
                Escolher mensagens
              </button>
            ))}
        </div>

        <textarea
          value={draft}
          onChange={event => setDraft(event.target.value)}
          rows={5}
          placeholder="Gere uma sugestão ou escreva a resposta aqui. Nada é enviado sem você."
          className="mt-1 w-full resize-y rounded-xl border border-violet-200 bg-white p-3 text-base leading-relaxed text-neutral-900 outline-none focus:border-violet-400"
        />

        {stale && (
          <div className="mt-2 flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
            <AlertTriangle size={15} className="mt-0.5 shrink-0" />
            Chegou mensagem nova depois desta sugestão. Gere de novo antes de enviar.
          </div>
        )}

        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
          <button
            type="button"
            onClick={() => void copyDraft()}
            disabled={!draft.trim()}
            className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-green-600 px-4 text-sm font-black text-white disabled:opacity-40"
          >
            {copied ? <Check size={17} /> : <Copy size={17} />} {copied ? 'Copiado' : 'Copiar'}
          </button>
          <button
            type="button"
            onClick={openWhatsApp}
            disabled={!draft.trim() || !replyPhone.phone}
            className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl border border-green-200 bg-white px-4 text-sm font-black text-green-700 disabled:opacity-40"
          >
            <ExternalLink size={17} /> Abrir no WhatsApp
          </button>
          <button
            type="button"
            onClick={() => void generate()}
            disabled={!target || generating || !mapping?.cliente_id}
            className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl border border-violet-200 bg-white px-4 text-sm font-black text-violet-700 disabled:opacity-40"
          >
            {generating ? <Loader2 size={17} className="animate-spin" /> : draft.trim() ? <RefreshCw size={17} /> : <Sparkles size={17} />}
            {draft.trim() ? 'Gerar de novo' : 'Gerar sugestão'}
          </button>
        </div>

        <p className="mt-2 text-xs text-violet-700/80">
          {replyPhone.source === 'conversa'
            ? 'O WhatsApp abre com o número que escreveu e o texto pronto; você confere e envia.'
            : replyPhone.source === 'cadastro'
              ? 'O WhatsApp abre com o telefone do cadastro do CRM (este contato não tem número na conversa). Confira antes de enviar.'
              : 'Sem telefone para abrir o WhatsApp: copie o texto e cole na conversa.'}
        </p>
      </section>

      {contatoId && (
        <div className="mt-3">
          <OrderLearningPanel contatoId={contatoId} />
        </div>
      )}

      {sheetOpen && (
        <ClientLinkSheet
          title={title}
          hintName={mapping?.whatsapp_perfil_nome || mapping?.whatsapp_nome}
          clientes={clientes}
          loading={clientesLoading}
          busy={linkBusy}
          onPick={id => void pickClient(id)}
          onClose={() => setSheetOpen(false)}
        />
      )}
    </div>
  );
}
