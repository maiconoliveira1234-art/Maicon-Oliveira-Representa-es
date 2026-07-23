export const OPEN_ORDER_IMPORT_CLEANUP_DAYS = 10;

const CLEANUP_WINDOW_MS = OPEN_ORDER_IMPORT_CLEANUP_DAYS * 24 * 60 * 60 * 1000;

export function getOpenOrderCleanupCutoff(now: Date = new Date()): string {
  return new Date(now.getTime() - CLEANUP_WINDOW_MS).toISOString();
}

export function shouldClearOpenOrderOnImport(startedAt: string, now: Date = new Date()): boolean {
  const startedAtTime = new Date(startedAt).getTime();
  if (!Number.isFinite(startedAtTime)) return false;

  const age = now.getTime() - startedAtTime;
  return age >= 0 && age <= CLEANUP_WINDOW_MS;
}
