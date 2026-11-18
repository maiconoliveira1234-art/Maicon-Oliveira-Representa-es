/**
 * Keep only the latest draft and allow navigation to flush it before the delay.
 * 3s de espera: o rascunho local e gravado na hora; o banco so recebe a versao
 * final depois que o usuario para de editar (reduz E/S de disco no Supabase).
 */
export const DRAFT_SAVE_DELAY_MS = 3000;

export function createDebouncedDraftSave<T>(save: (payload: T) => unknown, delay = DRAFT_SAVE_DELAY_MS) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: { payload: T } | undefined;
  const cancel = () => {
    clearTimeout(timer);
    timer = undefined;
    pending = undefined;
  };
  const flush = () => {
    const next = pending;
    cancel();
    if (next) return save(next.payload);
  };
  return {
    schedule(payload: T) {
      cancel();
      pending = { payload };
      timer = setTimeout(flush, delay);
    },
    flush,
    cancel,
  };
}
