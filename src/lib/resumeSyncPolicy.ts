export const RESUME_SYNC_INTERVAL_MS = 30 * 60 * 1000;

/** A return must follow a real break and a sufficiently old successful sync. */
export function shouldSyncAfterReturn(inactiveSince: number, lastSync: number, now: number): boolean {
  return inactiveSince > 0 && now - inactiveSince >= RESUME_SYNC_INTERVAL_MS &&
    (!lastSync || now - lastSync >= RESUME_SYNC_INTERVAL_MS);
}
