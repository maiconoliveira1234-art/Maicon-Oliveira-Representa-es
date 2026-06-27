// Centralized Diagnostics Suite for critical application modules
// Configured to be non-intrusive and easily toggleable.

export const DIAGNOSTICS = {
  DEBUG_LAYOUT: true,
  DEBUG_STOCK: true,
  DEBUG_ORDER: true,
  DEBUG_PRICE: true,
  DEBUG_SYNC: true,
  DEBUG_CLIENTS: true,
  DEBUG_AGENDA: true
};

export function logDiagnostic(module: keyof typeof DIAGNOSTICS, message: string, ...args: any[]) {
  if (DIAGNOSTICS[module]) {
    const timestamp = new Date().toISOString().split('T')[1].slice(0, -1);
    console.log(`%c[${timestamp}][${module}] %c${message}`, 'color: #3b82f6; font-weight: bold;', 'color: inherit;', ...args);
  }
}

// Global window access for easy runtime toggling in browser console
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
