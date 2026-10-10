import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { recoverModuleLoad } from './lib/moduleRecovery';

window.addEventListener('vite:preloadError', event => {
  // Vite emits this before a stale chunk import rejects. Recovery is guarded
  // against repeat reloads; allow rejection to reach ErrorBoundary if it fails.
  void recoverModuleLoad();
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

if ('serviceWorker' in navigator && window.location.protocol === 'https:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).catch(error => {
      console.error('[PWA] Falha ao registrar service worker:', error);
    });
  });
}
