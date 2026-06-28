import React from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { LayoutDashboard, Users, Search, BarChart3, Settings, FileUp, ShoppingCart, PieChart, Calendar, ArrowLeftRight, Home } from 'lucide-react';
import { cn } from '../lib/utils';

// Diagnostic mode toggle. Keep false in normal use.
const DEBUG_LAYOUT = false;

export function Layout({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const hideBottomNav = location.pathname.includes('/pedido/') || location.pathname.includes('/estoque/');

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
    <div className={cn(
      "min-h-screen bg-neutral-100 flex flex-col md:pl-[calc(5rem+env(safe-area-inset-left,0px))] pr-[env(safe-area-inset-right,0px)] pl-[env(safe-area-inset-left,0px)] w-full max-w-full overflow-x-hidden",
      hideBottomNav ? "pb-0 md:pb-0" : "pb-[calc(4.5rem+env(safe-area-inset-bottom,0px))] md:pb-0"
    )}>
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
          <NavItem to="/consulta-preco" icon={<Search size={24} />} label="" />
          <NavItem to="/metas" icon={<BarChart3 size={24} />} label="" />
          <NavItem to="/comissoes" icon={<PieChart size={24} />} label="" />
          <NavItem to="/dashboard" icon={<LayoutDashboard size={24} />} label="" />
          <NavItem to="/import" icon={<FileUp size={24} />} label="" />
          <NavItem to="/emprestimos" icon={<ArrowLeftRight size={24} />} label="" />
        </nav>
        <div className="p-2 border-t border-neutral-200">
          <NavItem to="/settings" icon={<Settings size={24} />} label="" />
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 p-4 md:p-8 max-w-7xl mx-auto w-full">
        {children}
      </main>

      {/* Bottom Nav Mobile */}
      {!hideBottomNav && (
        <nav
          ref={bottomNavRef}
          style={{
            transform: 'translate3d(0, 0, 0)',
            WebkitTransform: 'translate3d(0, 0, 0)',
            backfaceVisibility: 'hidden',
            WebkitBackfaceVisibility: 'hidden',
            willChange: 'transform'
          }}
          className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-neutral-200 flex justify-around items-center h-[calc(4rem+env(safe-area-inset-bottom,0px))] pb-[env(safe-area-inset-bottom,0px)] z-50 px-2 overflow-x-hidden"
        >
          <MobileNavItem to="/" icon={<Home size={24} />} label="Hoje" />
          <MobileNavItem to="/agenda" icon={<Calendar size={24} />} label="Agenda" />
          <MobileNavItem to="/clientes" icon={<Users size={24} />} label="Clientes" />
          <MobileNavItem to="/consulta-preco" icon={<Search size={24} />} label="Preços" />
          <MobileNavItem to="/metas" icon={<BarChart3 size={24} />} label="Metas" />
          <MobileNavItem to="/emprestimos" icon={<ArrowLeftRight size={24} />} label="Trocas" />
          <MobileNavItem to="/settings" icon={<Settings size={24} />} label="Config" />
        </nav>
      )}
    </div>
  );
}

function NavItem({ to, icon, label }: { to: string, icon: React.ReactNode, label: string }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) => cn(
        "flex items-center rounded-xl transition-colors font-medium",
        label ? "gap-3 px-4 py-3" : "justify-center p-3",
        isActive
          ? "bg-orange-50 text-orange-600"
          : "text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900"
      )}
    >
      {icon}
      {label}
    </NavLink>
  );
}

function MobileNavItem({ to, icon, label }: { to: string, icon: React.ReactNode, label: string }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) => cn(
        "flex flex-col items-center justify-center flex-1 min-w-0 gap-1 transition-colors px-1",
        isActive ? "text-orange-600" : "text-neutral-400"
      )}
    >
      <div className="flex-shrink-0">{icon}</div>
      <span className="text-[10px] font-medium truncate w-full text-center">{label}</span>
    </NavLink>
  );
}
