import React from 'react';
import { APP_VERSION } from '../constants';

// Diagnóstico TEMPORÁRIO do iPad: mostra as medidas da tela para descobrir por que
// os menus fixos (position: fixed) se soltam. Remover depois do diagnóstico.
export function ViewportDiag() {
  const fixedBottomRef = React.useRef<HTMLDivElement>(null);
  const dvhRef = React.useRef<HTMLDivElement>(null);
  const svhRef = React.useRef<HTMLDivElement>(null);
  const lvhRef = React.useRef<HTMLDivElement>(null);
  const [text, setText] = React.useState('');
  const [nudges, setNudges] = React.useState(0);

  React.useEffect(() => {
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const vv = window.visualViewport;
        const r = (el: HTMLDivElement | null) => (el ? Math.round(el.getBoundingClientRect().height) : -1);
        const fb = fixedBottomRef.current ? Math.round(fixedBottomRef.current.getBoundingClientRect().bottom) : -1;
        setText([
          `v${APP_VERSION}`,
          `inner ${window.innerWidth}x${window.innerHeight}`,
          `client ${document.documentElement.clientWidth}x${document.documentElement.clientHeight}`,
          `vv ${vv ? `${Math.round(vv.width)}x${Math.round(vv.height)} top${Math.round(vv.offsetTop)} s${vv.scale.toFixed(2)}` : '-'}`,
          `dvh ${r(dvhRef.current)} svh ${r(svhRef.current)} lvh ${r(lvhRef.current)}`,
          `screen ${window.screen.width}x${window.screen.height}`,
          `fixed-bottom ${fb}`,
          `scrollY ${Math.round(window.scrollY)}`,
        ].join(' · '));
      });
    };
    measure();
    const vv = window.visualViewport;
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, { passive: true });
    vv?.addEventListener('resize', measure);
    vv?.addEventListener('scroll', measure);
    const interval = window.setInterval(measure, 1000);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure);
      vv?.removeEventListener('resize', measure);
      vv?.removeEventListener('scroll', measure);
      window.clearInterval(interval);
    };
  }, []);

  // Tentativa de correção: depois que o teclado fecha, força o Safari a recalcular
  // a área visível (ele às vezes fica com a altura de quando o teclado estava aberto).
  React.useEffect(() => {
    let timer = 0;
    const nudge = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        window.scrollTo(window.scrollX, window.scrollY);
        setNudges(n => n + 1);
      }, 350);
    };
    const onFocusOut = (event: FocusEvent) => {
      const el = event.target as HTMLElement | null;
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) nudge();
    };
    document.addEventListener('focusout', onFocusOut);
    return () => {
      document.removeEventListener('focusout', onFocusOut);
      window.clearTimeout(timer);
    };
  }, []);

  return (
    <>
      <div ref={fixedBottomRef} aria-hidden className="pointer-events-none invisible fixed bottom-0 left-0 h-px w-px" />
      <div ref={dvhRef} aria-hidden className="pointer-events-none invisible fixed left-0 top-0 h-dvh w-px" />
      <div ref={svhRef} aria-hidden className="pointer-events-none invisible fixed left-0 top-0 h-svh w-px" />
      <div ref={lvhRef} aria-hidden className="pointer-events-none invisible fixed left-0 top-0 h-lvh w-px" />
      <div className="pointer-events-none fixed left-1/2 top-[env(safe-area-inset-top,0px)] z-[9999] max-w-[95vw] -translate-x-1/2 rounded-b-md bg-black/75 px-2 py-0.5 text-center font-mono text-[10px] leading-tight text-lime-300">
        {text} · n{nudges}
      </div>
    </>
  );
}
