// Centralized diagnostics for critical application modules.
// Keep disabled by default to avoid noisy browser console output in normal use.

const diagnosticsEnabledByDefault =
  ((import.meta as any).env?.VITE_ENABLE_DIAGNOSTICS || '').toLowerCase() === 'true';

export const DIAGNOSTICS = {
  DEBUG_LAYOUT: diagnosticsEnabledByDefault,
  DEBUG_STOCK: diagnosticsEnabledByDefault,
  DEBUG_ORDER: diagnosticsEnabledByDefault,
  DEBUG_PRICE: diagnosticsEnabledByDefault,
  DEBUG_SYNC: diagnosticsEnabledByDefault,
  DEBUG_CLIENTS: diagnosticsEnabledByDefault,
  DEBUG_AGENDA: diagnosticsEnabledByDefault
};

export function logDiagnostic(module: keyof typeof DIAGNOSTICS, message: string, ...args: any[]) {
  if (DIAGNOSTICS[module]) {
    const timestamp = new Date().toISOString().split('T')[1].slice(0, -1);
    console.log(`%c[${timestamp}][${module}] %c${message}`, 'color: #3b82f6; font-weight: bold;', 'color: inherit;', ...args);
  }
}

// Global window access for temporary runtime toggling in browser console.
if (typeof window !== 'undefined') {
  (window as any).__DIAGNOSTICS = DIAGNOSTICS;
  (window as any).toggleDiagnostic = (module: keyof typeof DIAGNOSTICS, enabled: boolean) => {
    if (module in DIAGNOSTICS) {
      DIAGNOSTICS[module] = enabled;
      console.log(`Diagnostic [${module}] set to: ${enabled}`);
    } else {
      console.warn(`Unknown diagnostic module: ${module}`);
    }
  };
}
