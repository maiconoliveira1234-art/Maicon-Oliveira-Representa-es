import { supabase } from './supabase';

export type ContactStatus = 'pendente' | 'vinculado' | 'ignorado';

export type WhatsAppMap = {
  id: string;
  whatsapp_nome: string;
  whatsapp_perfil_nome: string | null;
  cliente_id: string | null;
  status: ContactStatus;
  total_mensagens: number;
  ultima_vez_em: string;
  oculto: boolean;
};

export type ClienteLite = {
  id: string;
  cliente: string;
  contato: string | null;
  cidade: string | null;
  telefone: string | number | null;
  ativo: boolean | null;
};

export const CLIENT_FIELDS = 'id, cliente, contato, cidade, telefone, ativo';

export async function fetchClientes(): Promise<ClienteLite[]> {
  const { data, error } = await supabase.from('clientes').select(CLIENT_FIELDS).order('cliente', { ascending: true });
  if (error) throw error;
  return (data || []) as ClienteLite[];
}

export async function linkContact(mapId: string, clienteId: string): Promise<void> {
  const { error: mapError } = await supabase
    .from('whatsapp_contatos_map')
    .update({ status: 'vinculado', cliente_id: clienteId, atualizado_em: new Date().toISOString() })
    .eq('id', mapId);
  if (mapError) throw mapError;

  const { error: messagesError } = await supabase.from('whatsapp_mensagens').update({ cliente_id: clienteId }).eq('contato_map_id', mapId);
  if (messagesError) throw messagesError;
}

/** Unlinks a contact: back to "pendente" (to identify) or to "ignorado". Messages lose their client link. */
export async function setContactStatus(mapId: string, status: 'pendente' | 'ignorado'): Promise<void> {
  const { error: mapError } = await supabase
    .from('whatsapp_contatos_map')
    .update({ status, cliente_id: null, atualizado_em: new Date().toISOString() })
    .eq('id', mapId);
  if (mapError) throw mapError;

  const { error: messagesError } = await supabase.from('whatsapp_mensagens').update({ cliente_id: null }).eq('contato_map_id', mapId);
  if (messagesError) throw messagesError;
}

/** Marks only this conversation's messages as seen (opening the inbox no longer marks everything). */
export async function markContactSeen(mapId: string): Promise<void> {
  const { error } = await supabase
    .from('whatsapp_mensagens')
    .update({ visualizada_em: new Date().toISOString() })
    .eq('contato_map_id', mapId)
    .is('visualizada_em', null);
  if (error) console.warn('Não foi possível marcar a conversa como vista:', error);
}
