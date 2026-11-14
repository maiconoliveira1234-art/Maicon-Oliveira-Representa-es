import React from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { LayoutDashboard, Users, PackageSearch, BarChart3, Settings, FileUp, Calendar, ArrowLeftRight, Home, RefreshCw, Cloud, CloudOff, List, Rows3, Megaphone, MessageCircle, MoreHorizontal, X } from 'lucide-react';
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

  const syncState: SyncState = !isOnline ? 'offline' : isSyncing ? 'syncing' : pendingQueueCount > 0 ? 'pending' : 'synced';
  const syncLabel = syncState === 'syncing'
    ? 'Sincronizando...'
    : syncState === 'offline'
    ? 'Offline — usando dados locais'
    : syncState === 'pending'
    ? `${pendingQueueCount} alteração(ões) pendente(s)`
    : 'Sincronizado';
  const syncDetail = syncState === 'synced' && lastSyncedTime
    ? `Última vez às ${new Date(lastSyncedTime).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
    : syncState === 'offline'
    ? 'As alterações serão enviadas ao reconectar'
    : '';

  return (
    <div data-mobile-density={mobileListMode} className={cn(
      "min-h-dvh bg-neutral-100 flex flex-col md:pl-[calc(5rem+env(safe-area-inset-left,0px))] lg:pl-[calc(15rem+env(safe-area-inset-left,0px))] pr-[env(safe-area-inset-right,0px)] pl-[env(safe-area-inset-left,0px)] w-full max-w-full overflow-x-hidden",
      hideBottomNav ? "pb-0 md:pb-0" : "pb-[calc(4.5rem+env(safe-area-inset-bottom,0px))] md:pb-0"
    )}>
      {/* Status de sincronização no celular: só aparece quando exige atenção */}
      {syncState !== 'synced' && (
        <div className={cn(
          "md:hidden w-full shrink-0 border-b px-4 py-1.5 text-[11px] font-semibold flex items-center justify-center gap-2",
          syncStateClasses[syncState].banner
        )}>
          <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", syncStateClasses[syncState].dot)} />
          <span className="truncate">{syncLabel}</span>
        </div>
      )}

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
        className="hidden md:flex flex-col w-[calc(5rem+env(safe-area-inset-left,0px))] lg:w-[calc(15rem+env(safe-area-inset-left,0px))] pl-[env(safe-area-inset-left,0px)] bg-neutral-900 text-neutral-300 fixed left-0 top-0 bottom-0 z-50"
      >
        <div className="flex h-16 shrink-0 items-center justify-center gap-2.5 px-4 lg:justify-start lg:px-5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-orange-500 text-sm font-bold text-white">P</span>
          <span className="hidden text-[15px] font-semibold tracking-tight text-white lg:block">ProMax <span className="font-normal text-neutral-400">CRM</span></span>
        </div>
        <nav className="flex-1 overflow-y-auto px-3 pb-4 pt-2 [scrollbar-width:none]">
          <NavSection label="Rotina" first>
            <NavItem to="/" icon={<Home />} label="Hoje" />
            <NavItem to="/agenda" icon={<Calendar />} label="Agenda" />
            <NavItem to="/clientes" icon={<Users />} label="Clientes" />
            <NavItem to="/whatsapp" icon={<MessageCircle />} label="WhatsApp" badge={whatsappUnseen} />
            <NavItem to="/consulta-preco" icon={<PackageSearch />} label="Produtos" />
          </NavSection>
          <NavSection label="Gestão">
            <NavItem to="/metas" icon={<BarChart3 />} label="Metas" />
            <NavItem to="/dashboard" icon={<LayoutDashboard />} label="Análise" />
            <NavItem to="/campanhas" icon={<Megaphone />} label="Campanhas" />
            <NavItem to="/emprestimos" icon={<ArrowLeftRight />} label="Trocas" />
            <NavItem to="/import" icon={<FileUp />} label="Importar" />
          </NavSection>
        </nav>
        <div className="space-y-1 border-t border-white/10 px-3 py-3">
          <NavItem to="/settings" icon={<Settings />} label="Configurações" />
          <button
            type="button"
            onClick={() => { if (isOnline && !isSyncing) void syncAllData(); }}
            title={`${syncLabel}${syncDetail ? ` · ${syncDetail}` : ''}`}
            className="flex w-full items-center justify-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-white/5 lg:justify-start"
          >
            <span className="relative flex h-5 w-5 shrink-0 items-center justify-center">
              {syncState === 'offline' ? <CloudOff size={18} className="text-neutral-400" /> : syncState === 'syncing' ? <RefreshCw size={18} className="animate-spin text-orange-400" /> : <Cloud size={18} className="text-neutral-400" />}
              <span className={cn("absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full ring-2 ring-neutral-900", syncStateClasses[syncState].dot)} />
            </span>
            <span className="hidden min-w-0 lg:block">
              <span className="block truncate text-xs font-semibold text-neutral-200">{syncLabel}</span>
              {syncDetail && <span className="block truncate text-[11px] text-neutral-500">{syncDetail}</span>}
            </span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="min-w-0 flex-1 px-4 py-5 sm:px-6 md:px-8 md:py-8 lg:px-10 max-w-[90rem] mx-auto w-full overflow-x-clip">
        {children}
        <footer className="mt-10 text-center text-xs text-neutral-400">
          <a href="/privacidade" className="hover:text-neutral-700 hover:underline underline-offset-4">Política de Privacidade</a>
        </footer>
      </main>

      {hasMobileList && (
        <button
          type="button"
          onClick={toggleMobileListMode}
          className={cn(
            'fixed right-3 z-[45] inline-flex h-10 items-center gap-2 rounded-full border border-neutral-200 bg-white px-4 text-xs font-semibold text-neutral-700 shadow-lg md:hidden',
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
          className="md:hidden fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur border-t border-neutral-200 flex justify-around items-center h-[calc(4rem+env(safe-area-inset-bottom,0px))] pb-[env(safe-area-inset-bottom,0px)] z-50 px-1 overflow-x-hidden"
        >
          <MobileNavItem to="/" icon={<Home size={22} />} label="Hoje" />
          <MobileNavItem to="/agenda" icon={<Calendar size={22} />} label="Agenda" />
          <MobileNavItem to="/clientes" icon={<Users size={22} />} label="Clientes" />
          <MobileNavItem to="/whatsapp" icon={<MessageCircle size={22} />} label="WhatsApp" badge={whatsappUnseen} />
          <MobileNavItem to="/consulta-preco" icon={<PackageSearch size={22} />} label="Produtos" />
          <button
            type="button"
            onClick={() => setMoreOpen(open => !open)}
            aria-expanded={moreOpen}
            className={cn('flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-1 transition-colors', moreOpen ? 'text-orange-600' : 'text-neutral-500')}
          >
            <span className={cn('flex h-7 w-12 items-center justify-center rounded-full transition-colors', moreOpen && 'bg-orange-50')}>
              <MoreHorizontal size={22} />
            </span>
            <span className="w-full truncate text-center text-[11px] font-medium">Mais</span>
          </button>
        </nav>
      )}

      {moreOpen && !hideBottomNav && (
        <div className="fixed inset-0 z-[60] md:hidden" onClick={() => setMoreOpen(false)}>
          <div className="absolute inset-0 bg-neutral-950/40" />
          <div
            className="absolute inset-x-0 bottom-0 rounded-t-2xl bg-white p-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))] shadow-2xl"
            onClick={event => event.stopPropagation()}
          >
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-neutral-200" />
            <div className="mb-2 flex items-center justify-between px-1">
              <p className="text-base font-semibold text-neutral-900">Mais opções</p>
              <button type="button" onClick={() => setMoreOpen(false)} aria-label="Fechar" className="flex h-10 w-10 items-center justify-center rounded-full text-neutral-500 hover:bg-neutral-100">
                <X size={20} />
              </button>
            </div>
            <div className="grid grid-cols-4 gap-2">
              {[
                { to: '/metas', icon: <BarChart3 size={22} />, label: 'Metas' },
                { to: '/dashboard', icon: <LayoutDashboard size={22} />, label: 'Análise' },
                { to: '/emprestimos', icon: <ArrowLeftRight size={22} />, label: 'Trocas' },
                { to: '/campanhas', icon: <Megaphone size={22} />, label: 'Campanhas' },
                { to: '/import', icon: <FileUp size={22} />, label: 'Importar' },
                { to: '/settings', icon: <Settings size={22} />, label: 'Config.' },
              ].map(item => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) => cn(
                    'flex min-h-[72px] flex-col items-center justify-center gap-1.5 rounded-xl border text-xs font-medium',
                    isActive ? 'border-orange-200 bg-orange-50 text-orange-700' : 'border-neutral-200 text-neutral-700'
                  )}
                >
                  {item.icon}
                  {item.label}
                </NavLink>
              ))}
            </div>
            <div className="mt-3 flex items-center gap-2 rounded-xl bg-neutral-50 px-3 py-2.5 text-xs text-neutral-600">
              <span className={cn("h-2 w-2 shrink-0 rounded-full", syncStateClasses[syncState].dot)} />
              <span className="font-semibold text-neutral-800">{syncLabel}</span>
              {syncDetail && <span className="truncate text-neutral-500">· {syncDetail}</span>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

type SyncState = 'synced' | 'syncing' | 'pending' | 'offline';

const syncStateClasses: Record<SyncState, { banner: string; dot: string }> = {
  synced: { banner: 'bg-emerald-50 text-emerald-700 border-emerald-100', dot: 'bg-emerald-500' },
  syncing: { banner: 'bg-orange-50 text-orange-700 border-orange-100', dot: 'bg-orange-500 animate-pulse' },
  pending: { banner: 'bg-amber-50 text-amber-800 border-amber-100', dot: 'bg-amber-500 animate-pulse' },
  offline: { banner: 'bg-neutral-800 text-white border-neutral-800', dot: 'bg-neutral-400' },
};

function NavSection({ label, first, children }: { label: string; first?: boolean; children: React.ReactNode }) {
  return (
    <div className={first ? '' : 'mt-5'}>
      <p className="mb-1.5 hidden px-3 text-[11px] font-semibold uppercase tracking-wider text-neutral-500 lg:block">{label}</p>
      {!first && <div className="mx-auto mb-3 h-px w-8 bg-white/10 lg:hidden" />}
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

function Badge({ count, className }: { count?: number; className?: string }) {
  if (!count) return null;
  return (
    <span className={cn("absolute -right-2 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-emerald-500 px-1 text-[10px] font-semibold leading-none text-white", className)}>
      {count > 99 ? '99+' : count}
    </span>
  );
}

function NavItem({ to, icon, label, badge }: { to: string, icon: React.ReactNode, label: string, badge?: number }) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      title={label}
      aria-label={label}
      className={({ isActive }) => cn(
        "group relative flex items-center justify-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors lg:justify-start [&_svg]:h-5 [&_svg]:w-5",
        isActive
          ? "bg-white/10 text-white"
          : "text-neutral-400 hover:bg-white/5 hover:text-neutral-100"
      )}
    >
      {({ isActive }) => (
        <>
          {isActive && <span className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-orange-500" />}
          <span className={cn("relative shrink-0", isActive && "text-orange-400")}>
            {icon}
            <Badge count={badge} className="ring-2 ring-neutral-900 lg:hidden" />
          </span>
          <span className="hidden flex-1 truncate lg:block">{label}</span>
          {!!badge && (
            <span className="hidden rounded-full bg-emerald-500 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white lg:block">
              {badge > 99 ? '99+' : badge}
            </span>
          )}
        </>
      )}
    </NavLink>
  );
}

function MobileNavItem({ to, icon, label, badge }: { to: string, icon: React.ReactNode, label: string, badge?: number }) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      className={({ isActive }) => cn(
        "flex flex-col items-center justify-center flex-1 min-w-0 gap-0.5 transition-colors px-1",
        isActive ? "text-orange-600" : "text-neutral-500"
      )}
    >
      {({ isActive }) => (
        <>
          <span className={cn("relative flex h-7 w-12 flex-shrink-0 items-center justify-center rounded-full transition-colors", isActive && "bg-orange-50")}>
            {icon}
            <Badge count={badge} className="right-1 ring-2 ring-white" />
          </span>
          <span className={cn("text-[11px] truncate w-full text-center", isActive ? "font-semibold" : "font-medium")}>{label}</span>
        </>
      )}
    </NavLink>
  );
}
