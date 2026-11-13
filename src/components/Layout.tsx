import React from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { LayoutDashboard, Users, Search, PackageSearch, BarChart3, Settings, FileUp, ShoppingCart, Calendar, ArrowLeftRight, Home, RefreshCw, Cloud, CloudOff, List, Rows3, Megaphone, MessageCircle, MoreHorizontal, X } from 'lucide-react';
import { cn } from '../lib/utils';
import { useDataManager } from '../lib/dataManager';
import { useWhatsAppSummary } from '../hooks/useWhatsAppSummary';

// Diagnostic mode toggle. Keep false in normal use.
const DEBUG_LAYOUT = false;

export function Layout({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const hideBottomNav = location.pathname.includes('/pedido/') || location.pathname.includes('/estoque/') || location.pathname.includes('/whatsapp/conversa/');
  const { unseen: whatsappUnseen } = useWhatsAppSummary();
  const [moreOpen, setMoreOpen] = React.useState(false);
  React.useEffect(() => setMoreOpen(false), [location.pathname]);
  const { isSyncing, pendingQueueCount, syncAllData, lastSyncedTime } = useDataManager();
  const [isOnline, setIsOnline] = React.useState(navigator.onLine);
  const [mobileListMode, setMobileListMode] = React.useState<'compact' | 'complete'>(() => {
    try {
      return localStorage.getItem('mobile-list-mode') === 'complete' ? 'complete' : 'compact';
    } catch {
      return 'compact';
    }
  });
  const hasMobileList = ['/consulta-preco', '/metas', '/emprestimos', '/import'].includes(location.pathname) || location.pathname.includes('/estoque/');

  const toggleMobileListMode = () => {
    setMobileListMode(current => {
      const next = current === 'compact' ? 'complete' : 'compact';
      try {
        localStorage.setItem('mobile-list-mode', next);
      } catch {
        // The preference is optional when browser storage is unavailable.
      }
      return next;
    });
  };

  React.useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // O menu inferior fica sempre fixo no rodapé da tela. Quando o teclado
  // aparece, ele é apenas coberto pelo teclado (não sobe junto com ele).

  // Diagnostic Refs
  const sidebarRef = React.useRef<HTMLElement | null>(null);
  const bottomNavRef = React.useRef<HTMLElement | null>(null);
  const renderCount = React.useRef(0);
  const mountCount = React.useRef(0);

  // Increment render counter
  renderCount.current += 1;

  React.useEffect(() => {
    if (!DEBUG_LAYOUT) return;

    mountCount.current += 1;

    const logDiagnostic = (eventSource: string) => {
      const width = window.innerWidth;
      const height = window.innerHeight;
      const vvWidth = window.visualViewport ? window.visualViewport.width : null;
      const vvHeight = window.visualViewport ? window.visualViewport.height : null;

      // Measure Safe Area Insets in JS using a temporary offscreen element
      let insets = { top: '0px', bottom: '0px', left: '0px', right: '0px' };
      try {
        const el = document.createElement('div');
        el.style.position = 'fixed';
        el.style.top = 'env(safe-area-inset-top, 0px)';
        el.style.bottom = 'env(safe-area-inset-bottom, 0px)';
        el.style.left = 'env(safe-area-inset-left, 0px)';
        el.style.right = 'env(safe-area-inset-right, 0px)';
        el.style.visibility = 'hidden';
        el.style.pointerEvents = 'none';
        document.body.appendChild(el);
        const styles = window.getComputedStyle(el);
        insets = {
          top: styles.top,
          bottom: styles.bottom,
          left: styles.left,
          right: styles.right
        };
        document.body.removeChild(el);
      } catch (e) {
        console.error('[Diagnostic] Failed to measure safe area insets', e);
      }

      const sidebarRect = sidebarRef.current ? sidebarRef.current.getBoundingClientRect() : null;
      const bottomNavRect = bottomNavRef.current ? bottomNavRef.current.getBoundingClientRect() : null;
      const isMd = window.matchMedia('(min-width: 768px)').matches;

      console.log(
        `%c[LAYOUT-DIAGNOSTIC] %cEvent: ${eventSource}`,
        'color: #ea580c; font-weight: bold;',
        'color: #3b82f6; font-weight: bold;'
      );
      console.table({
        'Viewport Size': `${width}x${height}`,
        'Visual Viewport': vvWidth && vvHeight ? `${Math.round(vvWidth)}x${Math.round(vvHeight)}` : 'N/A',
        'Safe Area Top': insets.top,
        'Safe Area Bottom': insets.bottom,
        'Safe Area Left': insets.left,
        'Safe Area Right': insets.right,
        'Is Desktop (md)': isMd ? 'YES (>=768px)' : 'NO (<768px)',
        'Sidebar Visible': sidebarRect ? 'YES' : 'NO',
        'Sidebar Position': sidebarRect
          ? `L: ${Math.round(sidebarRect.left)} | T: ${Math.round(sidebarRect.top)} | W: ${Math.round(sidebarRect.width)} | H: ${Math.round(sidebarRect.height)}`
          : 'N/A',
        'Bottom Nav Visible': bottomNavRect ? 'YES' : 'NO',
        'Bottom Nav Position': bottomNavRect
          ? `L: ${Math.round(bottomNavRect.left)} | T: ${Math.round(bottomNavRect.top)} | W: ${Math.round(bottomNavRect.width)} | H: ${Math.round(bottomNavRect.height)}`
          : 'N/A',
        'Render Count': renderCount.current,
        'Mount Count': mountCount.current,
        'Document Visibility': document.visibilityState
      });
    };

    // Log initial mount status
    logDiagnostic('Initial Mount / Navigation Route Changed');

    const handleResize = () => logDiagnostic('Resize');
    const handleOrientation = () => logDiagnostic('OrientationChange');
    const handleVisibility = () => logDiagnostic('VisibilityChange');
    const handleVisualViewport = () => logDiagnostic('VisualViewportResizeOrScroll');

    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleOrientation);
    document.addEventListener('visibilitychange', handleVisibility);

    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', handleVisualViewport);
      window.visualViewport.addEventListener('scroll', handleVisualViewport);
    }

    // Capture post-resize layout update to catch transition finish states
    let resizeTimeout: NodeJS.Timeout;
    const debouncedLog = () => {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => {
        logDiagnostic('Viewport Settled (Debounced)');
      }, 300);
    };
    window.addEventListener('resize', debouncedLog);

    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('resize', debouncedLog);
      window.removeEventListener('orientationchange', handleOrientation);
      document.removeEventListener('visibilitychange', handleVisibility);
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', handleVisualViewport);
        window.visualViewport.removeEventListener('scroll', handleVisualViewport);
      }
      clearTimeout(resizeTimeout);
    };
  }, [location.pathname]); // Run diagnostic whenever the route path changes to trace navigator mounts

  return (
    <div data-mobile-density={mobileListMode} className={cn(
      "min-h-dvh bg-neutral-100 flex flex-col md:pl-[calc(5rem+env(safe-area-inset-left,0px))] pr-[env(safe-area-inset-right,0px)] pl-[env(safe-area-inset-left,0px)] w-full max-w-full overflow-x-hidden",
      hideBottomNav ? "pb-0 md:pb-0" : "pb-[calc(4.5rem+env(safe-area-inset-bottom,0px))] md:pb-0"
    )}>
      {/* Indicador de Conexão Inline (Não sobrepõe botões, flui no layout) */}
      <div className={cn(
        "w-full text-[11px] font-semibold py-1.5 px-4 border-b flex items-center justify-center gap-2 transition-all duration-300 shrink-0",
        isOnline 
          ? pendingQueueCount > 0 
            ? "bg-amber-50 text-amber-700 border-amber-200" 
            : isSyncing
            ? "bg-orange-50 text-orange-700 border-orange-200 animate-pulse"
            : "bg-green-50/60 text-green-700 border-green-200/50"
          : "bg-neutral-100 text-neutral-600 border-neutral-200"
      )}>
        <span className={cn(
          "w-2 h-2 rounded-full shrink-0",
          isOnline 
            ? pendingQueueCount > 0 
              ? "bg-amber-500 animate-pulse" 
              : isSyncing
              ? "bg-orange-500 animate-pulse"
              : "bg-green-500"
            : "bg-neutral-400"
        )} />
        <span className="truncate">
          {isSyncing 
            ? "Sincronizando dados com o servidor..." 
            : !isOnline 
            ? "Você está offline — Usando banco de dados local" 
            : pendingQueueCount > 0 
            ? `Conectado — ${pendingQueueCount} alteração(ões) pendente(s) localmente` 
            : `Conectado & Sincronizado — Último sincronismo: ${lastSyncedTime ? new Date(lastSyncedTime).toLocaleTimeString() : 'N/A'}`}
        </span>
      </div>

      {/* Sidebar Desktop */}
      <aside
        ref={sidebarRef}
        style={{
          transform: 'translate3d(0, 0, 0)',
          WebkitTransform: 'translate3d(0, 0, 0)',
          backfaceVisibility: 'hidden',
          WebkitBackfaceVisibility: 'hidden',
          willChange: 'transform'
        }}
        className="hidden md:flex flex-col w-[calc(5rem+env(safe-area-inset-left,0px))] pl-[env(safe-area-inset-left,0px)] bg-white border-r border-neutral-200 fixed left-0 top-0 bottom-0 z-50"
      >
        <div className="p-4 flex justify-center">
          <ShoppingCart className="text-orange-600" size={28} />
        </div>
        <nav className="flex-1 px-2 space-y-4 mt-4">
          <NavItem to="/" icon={<Home size={24} />} label="" />
          <NavItem to="/agenda" icon={<Calendar size={24} />} label="" />
          <NavItem to="/clientes" icon={<Users size={24} />} label="" />
          <NavItem to="/whatsapp" icon={<MessageCircle size={24} />} label="" badge={whatsappUnseen} />
          <NavItem to="/consulta-preco" icon={<PackageSearch size={24} />} label="" />
          <NavItem to="/metas" icon={<BarChart3 size={24} />} label="" />
           <NavItem to="/campanhas" icon={<Megaphone size={24} />} label="" />
          <NavItem to="/dashboard" icon={<LayoutDashboard size={24} />} label="" />
          <NavItem to="/import" icon={<FileUp size={24} />} label="" />
          <NavItem to="/emprestimos" icon={<ArrowLeftRight size={24} />} label="" />
        </nav>
        <div className="p-2 border-t border-neutral-200">
          <NavItem to="/settings" icon={<Settings size={24} />} label="" />
        </div>
      </aside>

      {/* Main Content */}
      <main className="min-w-0 flex-1 px-3 py-4 sm:px-4 md:p-8 max-w-7xl mx-auto w-full overflow-x-clip">
        {children}
        <footer className="mt-8 text-center text-xs text-neutral-500">
          <a href="/privacidade" className="underline underline-offset-4 hover:text-neutral-800">Política de Privacidade</a>
        </footer>
      </main>

      {hasMobileList && (
        <button
          type="button"
          onClick={toggleMobileListMode}
          className={cn(
            'fixed right-3 z-[45] inline-flex h-10 items-center gap-2 rounded-lg border border-neutral-200 bg-white px-3 text-xs font-black text-neutral-700 shadow-lg md:hidden',
            hideBottomNav ? 'bottom-4' : 'bottom-[calc(4.75rem+env(safe-area-inset-bottom,0px))]'
          )}
          aria-label={mobileListMode === 'compact' ? 'Exibir informações completas' : 'Exibir lista resumida'}
        >
          {mobileListMode === 'compact' ? <Rows3 size={16} /> : <List size={16} />}
          {mobileListMode === 'compact' ? 'Exibir completo' : 'Exibir resumido'}
        </button>
      )}

      {/* Bottom Nav Mobile */}
      {!hideBottomNav && (
        <nav
          ref={bottomNavRef}
          className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-neutral-200 flex justify-around items-center h-[calc(4rem+env(safe-area-inset-bottom,0px))] pb-[env(safe-area-inset-bottom,0px)] z-50 px-2 overflow-x-hidden"
        >
          <MobileNavItem to="/" icon={<Home size={24} />} label="Hoje" />
          <MobileNavItem to="/agenda" icon={<Calendar size={24} />} label="Agenda" />
          <MobileNavItem to="/clientes" icon={<Users size={24} />} label="Clientes" />
          <MobileNavItem to="/whatsapp" icon={<MessageCircle size={24} />} label="WhatsApp" badge={whatsappUnseen} />
          <MobileNavItem to="/consulta-preco" icon={<Search size={24} />} label="Preços" />
          <button
            type="button"
            onClick={() => setMoreOpen(open => !open)}
            aria-expanded={moreOpen}
            className={cn('flex min-w-0 flex-1 flex-col items-center justify-center gap-1 px-1 transition-colors', moreOpen ? 'text-orange-600' : 'text-neutral-400')}
          >
            <MoreHorizontal size={24} />
            <span className="w-full truncate text-center text-[10px] font-medium">Mais</span>
          </button>
        </nav>
      )}

      {moreOpen && !hideBottomNav && (
        <div className="fixed inset-0 z-[60] md:hidden" onClick={() => setMoreOpen(false)}>
          <div className="absolute inset-0 bg-black/30" />
          <div
            className="absolute inset-x-0 bottom-0 rounded-t-2xl bg-white p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] shadow-2xl"
            onClick={event => event.stopPropagation()}
          >
            <div className="mb-1 flex items-center justify-between px-2">
              <p className="text-sm font-black text-neutral-900">Mais</p>
              <button type="button" onClick={() => setMoreOpen(false)} aria-label="Fechar" className="flex h-11 w-11 items-center justify-center rounded-lg text-neutral-500">
                <X size={20} />
              </button>
            </div>
            <div className="grid grid-cols-4 gap-2">
              {[
                { to: '/metas', icon: <BarChart3 size={24} />, label: 'Metas' },
                { to: '/emprestimos', icon: <ArrowLeftRight size={24} />, label: 'Trocas' },
                { to: '/campanhas', icon: <Megaphone size={24} />, label: 'Campanhas' },
                { to: '/settings', icon: <Settings size={24} />, label: 'Config' },
              ].map(item => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) => cn(
                    'flex min-h-[64px] flex-col items-center justify-center gap-1 rounded-xl text-xs font-bold',
                    isActive ? 'bg-orange-50 text-orange-600' : 'text-neutral-600'
                  )}
                >
                  {item.icon}
                  {item.label}
                </NavLink>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Badge({ count }: { count?: number }) {
  if (!count) return null;
  return (
    <span className="absolute -right-2 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-green-600 px-1 text-[10px] font-black leading-none text-white">
      {count > 99 ? '99+' : count}
    </span>
  );
}

function NavItem({ to, icon, label, badge }: { to: string, icon: React.ReactNode, label: string, badge?: number }) {
  const accessibleLabel = to === '/consulta-preco' ? 'Produto' : to === '/whatsapp' ? 'WhatsApp' : label;
  return (
    <NavLink
      to={to}
      title={accessibleLabel || undefined}
      aria-label={accessibleLabel || undefined}
      className={({ isActive }) => cn(
        "flex items-center rounded-lg transition-colors font-medium",
        label ? "gap-3 px-4 py-3" : "justify-center p-3",
        isActive
          ? "bg-orange-50 text-orange-600"
          : "text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900"
      )}
    >
      <span className="relative">
        {icon}
        <Badge count={badge} />
      </span>
      {label}
    </NavLink>
  );
}

function MobileNavItem({ to, icon, label, badge }: { to: string, icon: React.ReactNode, label: string, badge?: number }) {
  const productItem = to === '/consulta-preco';
  return (
    <NavLink
      to={to}
      className={({ isActive }) => cn(
        "flex flex-col items-center justify-center flex-1 min-w-0 gap-1 transition-colors px-1",
        isActive ? "text-orange-600" : "text-neutral-400"
      )}
    >
      <div className="relative flex-shrink-0">{productItem ? <PackageSearch size={24} /> : icon}<Badge count={badge} /></div>
      <span className="text-[10px] font-medium truncate w-full text-center">{productItem ? 'Produto' : label}</span>
    </NavLink>
  );
}
