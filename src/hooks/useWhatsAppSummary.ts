import { useSyncExternalStore } from 'react';
import { supabase } from '../lib/supabase';

export type WhatsAppSummary = {
  /** Unseen messages from linked, visible conversations. */
  unseen: number;
  /** Linked conversations that have at least one unseen message. */
  conversationsWithNews: number;
  /** Visible contacts still waiting to be linked to a CRM client. */
  pendingContacts: number;
  loading: boolean;
};

const POLL_MS = 30000;
let state: WhatsAppSummary = { unseen: 0, conversationsWithNews: 0, pendingContacts: 0, loading: true };
const listeners = new Set<() => void>();
let timer: number | undefined;
let running = false;

function publish(next: WhatsAppSummary) {
  state = next;
  listeners.forEach(listener => listener());
}

export async function refreshWhatsAppSummary(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const { data: contacts, error } = await supabase
      .from('whatsapp_contatos_map')
      .select('id, status')
      .eq('oculto', false)
      .in('status', ['pendente', 'vinculado']);
    if (error) throw error;

    const linkedIds = (contacts || []).filter(item => item.status === 'vinculado').map(item => item.id as string);
    const pendingContacts = (contacts || []).filter(item => item.status === 'pendente').length;

    let unseen = 0;
    let conversationsWithNews = 0;
    if (linkedIds.length > 0) {
      const { data: rows, error: messagesError } = await supabase
        .from('whatsapp_mensagens')
        .select('contato_map_id')
        .is('visualizada_em', null)
        .in('contato_map_id', linkedIds)
        .limit(1000);
      if (messagesError) throw messagesError;
      unseen = (rows || []).length;
      conversationsWithNews = new Set((rows || []).map(row => row.contato_map_id)).size;
    }
    publish({ unseen, conversationsWithNews, pendingContacts, loading: false });
  } catch (err) {
    console.warn('Não foi possível atualizar o resumo do WhatsApp:', err);
    publish({ ...state, loading: false });
  } finally {
    running = false;
  }
}

function tick() {
  if (typeof document !== 'undefined' && document.hidden) return;
  void refreshWhatsAppSummary();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    void refreshWhatsAppSummary();
    timer = window.setInterval(tick, POLL_MS);
    window.addEventListener('focus', tick);
    document.addEventListener('visibilitychange', tick);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      window.clearInterval(timer);
      window.removeEventListener('focus', tick);
      document.removeEventListener('visibilitychange', tick);
    }
  };
}

const getSnapshot = () => state;

/** One shared poll for every component that shows WhatsApp counters (Home card, navigation badge). */
export function useWhatsAppSummary(): WhatsAppSummary {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
