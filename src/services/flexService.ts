import { supabase } from '../lib/supabase';

function isMissingResetFunction(error: any) {
  const message = `${error?.message || ''} ${error?.details || ''}`.toLowerCase();
  return error?.code === 'PGRST202'
    || message.includes('garantir_reset_flex_trimestral')
    || message.includes('schema cache');
}

export async function ensureQuarterlyFlexReset(strict = false): Promise<number> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 0;

  const { data, error } = await supabase.rpc('garantir_reset_flex_trimestral');
  if (!error) return Number(data) || 0;

  if (isMissingResetFunction(error) && !strict) {
    console.warn('Reset trimestral do Flex ainda nao esta disponivel no banco.');
    return 0;
  }

  if (isMissingResetFunction(error)) {
    throw new Error('A migracao do reset trimestral do Flex precisa ser aplicada no Supabase antes de importar faturamentos.');
  }

  throw error;
}
