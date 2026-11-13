// Pure helpers shared by the WhatsApp screens. No React or Supabase imports so
// they can be tested directly.

export const BURST_GAP_MS = 5 * 60 * 1000;
const SAO_PAULO = 'America/Sao_Paulo';

type Timed = { id: string; recebida_em: string };

/** Groups messages (any order) into bursts: a new burst starts after a gap longer than `gapMs`. */
export function groupIntoBursts<T extends Timed>(messages: T[], gapMs = BURST_GAP_MS): T[][] {
  const sorted = [...messages].sort((a, b) => new Date(a.recebida_em).getTime() - new Date(b.recebida_em).getTime());
  const bursts: T[][] = [];
  for (const message of sorted) {
    const current = bursts[bursts.length - 1];
    const previous = current?.[current.length - 1];
    const gap = previous ? new Date(message.recebida_em).getTime() - new Date(previous.recebida_em).getTime() : Infinity;
    if (current && gap <= gapMs) current.push(message);
    else bursts.push([message]);
  }
  return bursts;
}

function dayKey(iso: string) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: SAO_PAULO, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
}

export function dayLabel(iso: string, now: Date = new Date()): string {
  const key = dayKey(iso);
  if (key === dayKey(now.toISOString())) return 'Hoje';
  if (key === dayKey(new Date(now.getTime() - 86400000).toISOString())) return 'Ontem';
  return new Intl.DateTimeFormat('pt-BR', { timeZone: SAO_PAULO, day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(iso));
}

export function clockTime(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: SAO_PAULO, hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

export function relativeTime(iso: string, now: Date = new Date()): string {
  const diff = now.getTime() - new Date(iso).getTime();
  if (!Number.isFinite(diff)) return '';
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'agora';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} d`;
  return new Intl.DateTimeFormat('pt-BR', { timeZone: SAO_PAULO, day: '2-digit', month: '2-digit' }).format(new Date(iso));
}

export function normalizeSearch(value: string): string {
  return String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

export function matchesQuery(query: string, ...fields: Array<string | null | undefined>): boolean {
  const words = normalizeSearch(query).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const haystack = normalizeSearch(fields.filter(Boolean).join(' '));
  return words.every(word => haystack.includes(word));
}

/** Brazilian phone from the CRM registry: adds 55 to 10/11 digit numbers and validates the length. */
export function normalizeBrPhone(raw: string | number | null | undefined): string | null {
  let digits = String(raw ?? '').replace(/\D/g, '');
  if (!digits) return null;
  if ((digits.length === 10 || digits.length === 11) && !digits.startsWith('55')) digits = `55${digits}`;
  return digits.length >= 12 && digits.length <= 13 ? digits : null;
}

/** Cloud API contacts are stored as "WA <wa_id>", already international. */
export function phoneFromWhatsAppName(name: string | null | undefined): string | null {
  const match = /^WA\s+(\d{10,15})$/.exec(String(name || '').trim());
  return match ? match[1] : null;
}

export type ReplyPhone = { phone: string | null; source: 'conversa' | 'cadastro' | null };

/** Prefers the number the customer actually wrote from; falls back to the CRM registry. */
export function resolveReplyPhone(whatsappName: string | null | undefined, registeredPhone: string | number | null | undefined): ReplyPhone {
  const fromChat = phoneFromWhatsAppName(whatsappName);
  if (fromChat) return { phone: fromChat, source: 'conversa' };
  const fromRegistry = normalizeBrPhone(registeredPhone);
  return fromRegistry ? { phone: fromRegistry, source: 'cadastro' } : { phone: null, source: null };
}

export function whatsAppLink(phone: string, text: string): string {
  return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
}

const ERROR_MESSAGES: Record<string, string> = {
  contact_not_linked: 'Vincule este contato a um cliente do CRM antes de gerar a sugestão.',
  audio_not_transcribed: 'Este áudio ainda não tem texto. Ouça no WhatsApp ou escolha outra mensagem.',
  message_not_found: 'Mensagem não encontrada. Atualize a tela.',
  context_message_not_found: 'Alguma mensagem do contexto não foi encontrada. Atualize a tela.',
  invalid_context_contact: 'As mensagens escolhidas não são desta conversa. Atualize a tela.',
  client_not_found: 'O cliente vinculado não foi encontrado no CRM.',
  empty_model_response: 'A IA não devolveu texto. Gere novamente.',
  operation_failed: 'A IA está indisponível agora. Tente de novo em instantes.',
  unauthorized: 'Sessão sem permissão. Entre novamente.',
  forbidden: 'Esta conta não tem permissão para esta ação.',
};

export function messageForErrorCode(code: string | null | undefined, fallback?: string): string {
  if (code && ERROR_MESSAGES[code]) return ERROR_MESSAGES[code];
  const text = String(fallback || '');
  if (!text || /non-2xx/i.test(text)) return 'Não foi possível concluir agora. Tente de novo.';
  return text;
}

/** Reads the JSON error body that supabase-js hides behind its generic non-2xx message. */
export async function readFunctionError(error: any, data?: any): Promise<string> {
  let code = typeof data?.error === 'string' ? data.error : '';
  if (!code && error?.context && typeof error.context.json === 'function') {
    try {
      const body = await error.context.json();
      if (typeof body?.error === 'string') code = body.error;
    } catch {
      // The body was not JSON; fall through to the generic text.
    }
  }
  return messageForErrorCode(code, error?.message);
}

export type AudioState = { tone: 'wait' | 'error'; text: string } | null;

type AudioFields = {
  tipo_mensagem: string | null;
  transcricao_audio: string | null;
  audio_status: string | null;
  transcricao_erro: string | null;
  recebida_em: string;
};

export function audioState(message: AudioFields, now: Date = new Date()): AudioState {
  if (message.tipo_mensagem !== 'audio' || message.transcricao_audio) return null;
  const ageMs = now.getTime() - new Date(message.recebida_em).getTime();
  if (message.audio_status === 'erro' || message.transcricao_erro) {
    if (/credencial/i.test(message.transcricao_erro || '')) {
      return { tone: 'error', text: 'Áudio sem texto: a transcrição ainda não está configurada. Ouça no WhatsApp.' };
    }
    return { tone: 'error', text: 'Falha ao transcrever o áudio. Ouça no WhatsApp.' };
  }
  if (message.audio_status === 'transcrevendo') {
    if (ageMs > 10 * 60 * 1000) return { tone: 'error', text: 'Transcrição parada. Ouça o áudio no WhatsApp.' };
    return { tone: 'wait', text: 'Transcrevendo o áudio…' };
  }
  if (ageMs > 60 * 60 * 1000) return { tone: 'error', text: 'Este áudio não foi transcrito. Ouça no WhatsApp.' };
  return { tone: 'wait', text: 'Aguardando a transcrição…' };
}

/** A suggestion is stale when a newer message arrived after it was generated. */
export function isSuggestionStale(generatedAt: string | null | undefined, latestMessageAt: string | null | undefined): boolean {
  if (!generatedAt || !latestMessageAt) return false;
  return new Date(latestMessageAt).getTime() > new Date(generatedAt).getTime();
}

export function readSession<T>(key: string, fallback: T): T {
  try {
    const raw = sessionStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function writeSession(key: string, value: unknown): void {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Persisting view state is optional.
  }
}

export type SuggestionDraft = { text: string; targetId: string | null; contextIds: string[]; savedAt: number };

const DRAFT_PREFIX = 'whatsapp-draft:';
const DRAFT_MAX_AGE_MS = 7 * 86400000;

export function readDraft(contactId: string): SuggestionDraft | null {
  try {
    const raw = localStorage.getItem(DRAFT_PREFIX + contactId);
    if (!raw) return null;
    const draft = JSON.parse(raw) as SuggestionDraft;
    if (!draft || typeof draft.text !== 'string' || Date.now() - Number(draft.savedAt) > DRAFT_MAX_AGE_MS) return null;
    return { text: draft.text, targetId: draft.targetId ?? null, contextIds: Array.isArray(draft.contextIds) ? draft.contextIds : [], savedAt: Number(draft.savedAt) };
  } catch {
    return null;
  }
}

export function writeDraft(contactId: string, draft: Omit<SuggestionDraft, 'savedAt'>): void {
  try {
    if (!draft.text.trim()) localStorage.removeItem(DRAFT_PREFIX + contactId);
    else localStorage.setItem(DRAFT_PREFIX + contactId, JSON.stringify({ ...draft, savedAt: Date.now() }));
  } catch {
    // Drafts are a convenience; losing one must never block the screen.
  }
}
