import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, CheckSquare, Loader2, MessageCircle, RefreshCw, Send, Sparkles, Square } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { PageHeader, Panel } from '../components/ui/AppChrome';

type WhatsAppMap = {
  id: string;
  whatsapp_nome: string;
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
  sugestao_resposta: string | null;
  sugestao_gerada_em: string | null;
  sugestao_erro: string | null;
};

export function WhatsAppConversationPage() {
  const navigate = useNavigate();
  const { contatoId } = useParams<{ contatoId: string }>();
  const [mapping, setMapping] = useState<WhatsAppMap | null>(null);
  const [cliente, setCliente] = useState<Cliente | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [targetMessageId, setTargetMessageId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadData = async (silent = false) => {
    if (!contatoId) return;
    if (!silent) setLoading(true);
    setError(null);

    try {
      const { data: mapData, error: mapError } = await supabase
        .from('whatsapp_contatos_map')
        .select('id, whatsapp_nome, cliente_id, status')
        .eq('id', contatoId)
        .maybeSingle();
      if (mapError) throw mapError;
      if (!mapData) throw new Error('Conversa não encontrada.');

      const typedMap = mapData as WhatsAppMap;
      setMapping(typedMap);

      const messagesQuery = supabase
        .from('whatsapp_mensagens')
        .select('id, mensagem, recebida_em, tipo_mensagem, transcricao_audio, sugestao_resposta, sugestao_gerada_em, sugestao_erro')
        .eq('contato_map_id', contatoId)
        .order('recebida_em', { ascending: true })
        .limit(200);

      const clientQuery = typedMap.cliente_id
        ? supabase
            .from('clientes')
            .select('id, cliente, contato, cidade, telefone')
            .eq('id', typedMap.cliente_id)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null });

      const [{ data: messageData, error: messageError }, { data: clientData, error: clientError }] = await Promise.all([
        messagesQuery,
        clientQuery,
      ]);

      if (messageError) throw messageError;
      if (clientError) throw clientError;

      setMessages((messageData || []) as Message[]);
      setCliente((clientData || null) as Cliente | null);
    } catch (err: any) {
      console.error('Erro ao carregar histórico do WhatsApp:', err);
      setError(err?.message || 'Não foi possível carregar a conversa.');
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
  }, [contatoId]);

  const latestMessage = messages.length ? messages[messages.length - 1] : null;
  const targetMessage = useMemo(
    () => messages.find(message => message.id === targetMessageId) || null,
    [messages, targetMessageId]
  );
  const activeSuggestionMessage = targetMessage || latestMessage;

  const toggleSelection = (message: Message) => {
    setSelectedIds(current => {
      const next = new Set(current);
      if (next.has(message.id)) {
        next.delete(message.id);
        if (targetMessageId === message.id) setTargetMessageId(null);
      } else {
        next.add(message.id);
        setTargetMessageId(message.id);
      }
      return next;
    });
  };

  const markAsTarget = (message: Message) => {
    setSelectedIds(current => new Set([...current, message.id]));
    setTargetMessageId(message.id);
  };

  const generateSuggestion = async (messageId: string, contextIds?: string[]) => {
    setGenerating(true);
    setError(null);
    try {
      const { data, error: invokeError } = await supabase.functions.invoke('whatsapp-suggest', {
        body: {
          message_id: messageId,
          ...(contextIds && contextIds.length ? { context_message_ids: contextIds } : {}),
        },
      });
      if (invokeError) throw invokeError;
      if (data?.error) throw new Error(String(data.error));
      await loadData(true);
    } catch (err: any) {
      console.error('Erro ao gerar sugestão com contexto:', err);
      setError(err?.message || 'Não foi possível gerar a sugestão.');
    } finally {
      setGenerating(false);
    }
  };

  const generateQuickReply = async () => {
    if (!latestMessage) return;
    setSelectedIds(new Set());
    setTargetMessageId(latestMessage.id);
    await generateSuggestion(latestMessage.id);
  };

  const generateWithSelection = async () => {
    if (!selectedIds.size) {
      setError('Selecione pelo menos uma mensagem para usar como contexto.');
      return;
    }

    const selectedMessages = messages.filter(message => selectedIds.has(message.id));
    const target = targetMessage || selectedMessages[selectedMessages.length - 1];
    if (!target) return;

    setTargetMessageId(target.id);
    await generateSuggestion(target.id, selectedMessages.map(message => message.id));
  };

  const openWhatsAppReply = (message: Message) => {
    if (!message.sugestao_resposta) return;

    const rawPhone = String(cliente?.telefone ?? '').replace(/\D/g, '');
    if (!rawPhone) {
      setError('Este cliente não possui telefone cadastrado no CRM.');
      return;
    }

    let phone = rawPhone;
    if ((phone.length === 10 || phone.length === 11) && !phone.startsWith('55')) phone = `55${phone}`;
    if (phone.length < 12 || phone.length > 13) {
      setError('O telefone cadastrado para este cliente parece inválido. Revise o cadastro antes de enviar.');
      return;
    }

    window.location.href = `https://wa.me/${phone}?text=${encodeURIComponent(message.sugestao_resposta)}`;
  };

  const displayText = (message: Message) => {
    if (message.tipo_mensagem === 'audio') {
      return message.transcricao_audio ? `🎤 ${message.transcricao_audio}` : `🎤 ${message.mensagem || 'Áudio aguardando transcrição'}`;
    }
    return message.mensagem;
  };

  if (loading) {
    return (
      <div className="flex min-h-64 items-center justify-center text-neutral-500">
        <Loader2 className="mr-2 animate-spin" size={20} /> Carregando conversa...
      </div>
    );
  }

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
        title={mapping?.whatsapp_nome || 'Conversa do WhatsApp'}
        subtitle={cliente ? `${cliente.cliente}${cliente.cidade ? ` · ${cliente.cidade}` : ''}` : 'Histórico capturado pelo CRM'}
        icon={<MessageCircle />}
      />

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
          {error}
        </div>
      )}

      <Panel className="p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-black text-neutral-900">Contexto da resposta</p>
            <p className="mt-1 text-xs leading-relaxed text-neutral-500">
              A resposta rápida usa somente a última mensagem. Para um assunto com várias mensagens, marque apenas o que pertence ao mesmo contexto e escolha qual delas deve ser respondida.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={generateQuickReply}
              disabled={!latestMessage || generating}
              className="inline-flex items-center gap-2 rounded-lg border border-violet-200 bg-white px-3 py-2 text-xs font-black text-violet-700 disabled:opacity-50"
            >
              {generating ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
              Resposta rápida
            </button>
            <button
              type="button"
              onClick={generateWithSelection}
              disabled={!selectedIds.size || generating}
              className="inline-flex items-center gap-2 rounded-lg bg-violet-700 px-3 py-2 text-xs font-black text-white disabled:opacity-50"
            >
              {generating ? <Loader2 size={14} className="animate-spin" /> : <CheckSquare size={14} />}
              Gerar com selecionadas ({selectedIds.size})
            </button>
          </div>
        </div>

        {selectedIds.size > 0 && (
          <div className="mt-3 flex items-center justify-between rounded-lg bg-violet-50 px-3 py-2 text-xs font-semibold text-violet-700">
            <span>{selectedIds.size} {selectedIds.size === 1 ? 'mensagem selecionada' : 'mensagens selecionadas'} · “A responder” define a mensagem principal.</span>
            <button
              type="button"
              onClick={() => { setSelectedIds(new Set()); setTargetMessageId(null); }}
              className="ml-3 shrink-0 font-black"
            >
              Limpar
            </button>
          </div>
        )}
      </Panel>

      {activeSuggestionMessage?.sugestao_resposta && (
        <Panel className="border border-violet-100 bg-violet-50/60 p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Sparkles size={16} className="text-violet-600" />
              <p className="text-[10px] font-black uppercase tracking-wider text-violet-700">Sugestão da IA</p>
            </div>
            {activeSuggestionMessage.sugestao_gerada_em && (
              <span className="text-[10px] font-semibold text-violet-400">
                {new Date(activeSuggestionMessage.sugestao_gerada_em).toLocaleString('pt-BR')}
              </span>
            )}
          </div>
          <p className="mt-2 whitespace-pre-wrap text-sm font-medium leading-relaxed text-neutral-800">
            {activeSuggestionMessage.sugestao_resposta}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => openWhatsAppReply(activeSuggestionMessage)}
              className="inline-flex items-center gap-2 rounded-lg bg-green-600 px-3 py-2 text-xs font-black text-white"
            >
              <Send size={14} /> Enviar resposta
            </button>
            <button
              type="button"
              onClick={() => selectedIds.size ? void generateWithSelection() : void generateSuggestion(activeSuggestionMessage.id)}
              disabled={generating}
              className="inline-flex items-center gap-2 rounded-lg border border-violet-200 bg-white px-3 py-2 text-xs font-black text-violet-700 disabled:opacity-50"
            >
              {generating ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              Atualizar
            </button>
          </div>
        </Panel>
      )}

      <div className="space-y-2">
        {messages.length === 0 ? (
          <Panel className="p-8 text-center text-sm text-neutral-500">Nenhuma mensagem capturada nesta conversa.</Panel>
        ) : messages.map(message => {
          const selected = selectedIds.has(message.id);
          const isTarget = targetMessageId === message.id;
          const audioWaiting = message.tipo_mensagem === 'audio' && !message.transcricao_audio;

          return (
            <Panel
              key={message.id}
              className={`p-0 transition ${selected ? 'border-violet-300 ring-1 ring-violet-200' : ''}`}
            >
              <div className="flex gap-3 p-4">
                <button
                  type="button"
                  onClick={() => toggleSelection(message)}
                  className="mt-0.5 shrink-0 text-violet-600"
                  aria-label={selected ? 'Remover mensagem do contexto' : 'Adicionar mensagem ao contexto'}
                >
                  {selected ? <CheckSquare size={20} /> : <Square size={20} className="text-neutral-300" />}
                </button>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-black uppercase tracking-wider text-neutral-400">
                        {message.tipo_mensagem === 'audio' ? 'Áudio recebido' : 'Mensagem recebida'}
                      </span>
                      {isTarget && (
                        <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[9px] font-black uppercase text-violet-700">A responder</span>
                      )}
                    </div>
                    <span className="text-[10px] font-semibold text-neutral-400">
                      {new Date(message.recebida_em).toLocaleString('pt-BR')}
                    </span>
                  </div>

                  <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-neutral-800">{displayText(message)}</p>
                  {audioWaiting && (
                    <p className="mt-1 text-xs font-semibold text-amber-600">Aguardando transcrição do áudio.</p>
                  )}

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => markAsTarget(message)}
                      className={`rounded-lg px-2.5 py-1.5 text-[10px] font-black ${isTarget ? 'bg-violet-700 text-white' : 'border border-neutral-200 bg-white text-neutral-600'}`}
                    >
                      {isTarget ? 'Mensagem principal' : 'Responder esta'}
                    </button>
                    {message.sugestao_resposta && (
                      <span className="text-[10px] font-semibold text-violet-500">Possui sugestão gerada</span>
                    )}
                  </div>
                </div>
              </div>
            </Panel>
          );
        })}
      </div>
    </div>
  );
}
