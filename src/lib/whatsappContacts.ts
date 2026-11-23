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

/** Unlinks a contact: back to "pendente" (to identify) or to "ignorado". Messages lose their client link.
 *  Marking "ignorado" moves the conversation (and future messages) to a 48 h quarantine in the database;
 *  going back to "pendente" within 48 h brings it back, after that it is deleted. */
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

/** WhatsApp numbers of each contact record, and what is waiting in the 48 h quarantine. */
export type ContactInfo = { telefones: string[]; quarentena: number; quarentena_ate: string | null };

export async function fetchContactInfo(): Promise<Map<string, ContactInfo>> {
  const { data, error } = await supabase.rpc('whatsapp_contatos_info');
  if (error) throw error;
  const map = new Map<string, ContactInfo>();
  for (const row of (data || []) as Array<ContactInfo & { contato_map_id: string }>) {
    map.set(row.contato_map_id, { telefones: row.telefones || [], quarentena: row.quarentena || 0, quarentena_ate: row.quarentena_ate });
  }
  return map;
}

/** "554791535600" -> "(47) 9153-5600"; numbers outside Brazil are shown as received. */
export function formatWhatsAppPhone(phone: string): string {
  const d = String(phone || '').replace(/\D/g, '');
  const local = d.startsWith('55') && (d.length === 12 || d.length === 13) ? d.slice(2) : null;
  if (!local) return d ? `+${d}` : '';
  const ddd = local.slice(0, 2), rest = local.slice(2);
  return `(${ddd}) ${rest.slice(0, rest.length - 4)}-${rest.slice(-4)}`;
}

/** Old contact records (from the Android notification app) have no number: WhatsApp messages of that
 *  person arrive in the record that holds the number, so linking the old one does not route them. */
export const NO_NUMBER_WARNING =
  'Este cadastro não tem número de WhatsApp: ele veio do app antigo, que identificava o contato pelo nome salvo no celular. '
  + 'As mensagens do WhatsApp chegam pelo cadastro que tem o número da pessoa. Procure o número na busca (inclusive em Ignorados) e vincule também esse cadastro.';
