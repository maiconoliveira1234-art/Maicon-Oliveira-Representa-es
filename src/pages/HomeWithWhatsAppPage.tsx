import React, { useCallback, useEffect, useState } from 'react';
import { ArrowRight, MessageCircle, UserRoundSearch } from 'lucide-react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { HomePage } from './HomePage';

type WhatsAppSummary = {
  newMessages: number;
  pendingContacts: number;
  loading: boolean;
};

export function HomeWithWhatsAppPage() {
  const [summary, setSummary] = useState<WhatsAppSummary>({
    newMessages: 0,
    pendingContacts: 0,
    loading: true,
  });

  const refreshWhatsAppSummary = useCallback(async () => {
    const [messagesResult, contactsResult] = await Promise.all([
      supabase
        .from('whatsapp_mensagens')
        .select('id', { count: 'exact', head: true })
        .is('visualizada_em', null),
      supabase
        .from('whatsapp_contatos_map')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pendente'),
    ]);

    if (messagesResult.error) {
      console.warn('Não foi possível contar novas mensagens do WhatsApp:', messagesResult.error);
    }
    if (contactsResult.error) {
      console.warn('Não foi possível contar contatos pendentes do WhatsApp:', contactsResult.error);
    }

    setSummary({
      newMessages: messagesResult.count ?? 0,
      pendingContacts: contactsResult.count ?? 0,
      loading: false,
    });
  }, []);

  useEffect(() => {
    void refreshWhatsAppSummary();

    const onFocus = () => void refreshWhatsAppSummary();
    window.addEventListener('focus', onFocus);
    const intervalId = window.setInterval(() => void refreshWhatsAppSummary(), 30000);

    return () => {
      window.removeEventListener('focus', onFocus);
      window.clearInterval(intervalId);
    };
  }, [refreshWhatsAppSummary]);

  const hasNewMessages = summary.newMessages > 0;
  const hasPendingContacts = summary.pendingContacts > 0;

  const whatsAppCard = (
    <Link
      to="/whatsapp"
      className={[
        'group flex min-w-0 items-center gap-3 rounded-lg border bg-white px-4 py-3 shadow-sm transition-colors',
        hasNewMessages || hasPendingContacts
          ? 'border-emerald-200 hover:bg-emerald-50/40'
          : 'border-neutral-200 hover:bg-neutral-50',
      ].join(' ')}
      aria-label="Abrir mensagens capturadas do WhatsApp Business"
    >
      <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700">
        <MessageCircle size={21} />
        {hasNewMessages && (
          <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-black leading-none text-white">
            {summary.newMessages > 99 ? '99+' : summary.newMessages}
          </span>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <p className="truncate text-sm font-black text-neutral-950">WhatsApp Business</p>
          {hasNewMessages && (
            <span className="shrink-0 rounded-full bg-rose-50 px-2 py-0.5 text-[9px] font-black uppercase tracking-wide text-rose-700">
              Nova
            </span>
          )}
        </div>
        <p className="mt-0.5 truncate text-xs font-semibold text-neutral-500">
          {summary.loading
            ? 'Verificando mensagens capturadas...'
            : hasNewMessages
              ? `${summary.newMessages} ${summary.newMessages === 1 ? 'nova mensagem capturada' : 'novas mensagens capturadas'}`
              : 'Nenhuma nova mensagem capturada'}
        </p>
        {hasPendingContacts && (
          <p className="mt-1 flex items-center gap-1 text-[10px] font-black text-amber-700">
            <UserRoundSearch size={12} />
            {summary.pendingContacts} {summary.pendingContacts === 1 ? 'contato precisa ser identificado' : 'contatos precisam ser identificados'}
          </p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1 text-xs font-black text-emerald-700">
        <span className="hidden sm:inline">Abrir</span>
        <ArrowRight size={17} className="transition-transform group-hover:translate-x-0.5" />
      </div>
    </Link>
  );

  return <HomePage afterHeader={whatsAppCard} />;
}
