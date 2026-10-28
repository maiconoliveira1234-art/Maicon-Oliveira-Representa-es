import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';

export function ClientDetailModal({ title, onClose, children }: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previous?.focus();
    };
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/65 p-3" onMouseDown={event => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section role="dialog" aria-modal="true" aria-label={title}
        className="w-full max-w-xl max-h-[90dvh] overflow-y-auto rounded-xl bg-white p-4 shadow-2xl sm:p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-lg font-bold text-neutral-900">{title}</h2>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Fechar"
            className="rounded-lg p-2 text-neutral-600 hover:bg-neutral-100"><X size={20} /></button>
        </div>
        {children}
      </section>
    </div>, document.body
  );
}
