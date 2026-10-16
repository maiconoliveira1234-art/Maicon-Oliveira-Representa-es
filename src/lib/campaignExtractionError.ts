import { FunctionsFetchError, FunctionsHttpError, FunctionsRelayError } from '@supabase/supabase-js';

const fallback = 'Não foi possível ler a imagem com IA. Tente novamente.';

export async function campaignExtractionError(error: unknown): Promise<string> {
  if (error instanceof FunctionsHttpError || error instanceof FunctionsRelayError) {
    const response = error.context as Response;
    let payload: { error?: unknown; code?: unknown } | null = null;
    try {
      // Keep the original response available for diagnostics.
      payload = await response.clone().json();
    } catch { /* Gateways may return empty bodies or HTML. */ }

    if (response.status === 401 || response.status === 403) {
      return 'Não foi possível autorizar a leitura da imagem. Atualize a página e tente novamente; se persistir, avise o responsável pelo sistema.';
    }
    if (response.status === 404) return 'A leitura por IA não está disponível no momento. Avise o responsável pelo sistema.';
    if (payload?.code === 'BOOT_ERROR') return 'O serviço de leitura por IA não conseguiu iniciar. Avise o responsável pelo sistema.';
    if (typeof payload?.error === 'string' && payload.error.trim()) return payload.error;
    if (response.status === 413) return 'A imagem deve ter no máximo 1 MB. Reduza o tamanho antes de importar.';
    if (response.status === 429) return 'O limite de uso da IA foi atingido. Aguarde e tente novamente.';
    if (response.status === 504) return 'A IA demorou demais para responder. Tente novamente.';
    if (response.status >= 500) return 'O serviço de IA está temporariamente indisponível. Tente novamente em instantes.';
    return fallback;
  }
  if (error instanceof FunctionsFetchError) {
    return 'Não foi possível conectar ao serviço de IA. Verifique a conexão e tente novamente.';
  }
  return error instanceof Error && error.message ? error.message : fallback;
}
