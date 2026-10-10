const RECOVERY_KEY = 'promax-module-recovery';
let recovery: Promise<boolean> | undefined;

export function isModuleLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /MIME type|Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Loading chunk .* failed|Unable to preload CSS/i.test(message);
}

// Recover an obsolete deployment once, keeping the current client/route and all
// business data in localStorage/IndexedDB. A persistent failure must not loop.
export function recoverModuleLoad(): Promise<boolean> {
  if (recovery) return recovery;
  recovery = (async () => {
    if (!navigator.onLine) return false;
    try {
      const previous = Number(sessionStorage.getItem(RECOVERY_KEY));
      if (previous && Date.now() - previous < 60_000) return false;
      sessionStorage.setItem(RECOVERY_KEY, String(Date.now()));
    } catch {
      // Without a persistent guard, leave recovery to the manual reload button.
      return false;
    }
    try {
      if ('serviceWorker' in navigator) {
        const registration = await navigator.serviceWorker.getRegistration();
        await registration?.update();
        const worker = registration?.installing || registration?.waiting;
        if (worker && worker.state !== 'activated' && worker.state !== 'redundant') {
          await new Promise<void>(resolve => {
            const finish = () => {
              clearTimeout(timeout);
              worker.removeEventListener('statechange', changed);
              resolve();
            };
            const changed = () => {
              if (worker.state === 'activated' || worker.state === 'redundant') finish();
            };
            const timeout = setTimeout(finish, 4000);
            worker.addEventListener('statechange', changed);
          });
        }
      }
    } catch (error) {
      console.warn('[PWA] Não foi possível atualizar o service worker:', error);
    }
    window.location.reload();
    return true;
  })();
  return recovery;
}
