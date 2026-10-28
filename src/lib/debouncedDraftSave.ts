/** Keep only the latest draft and allow navigation to flush it before the delay. */
export function createDebouncedDraftSave<T>(save: (payload: T) => unknown, delay = 800) {
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
