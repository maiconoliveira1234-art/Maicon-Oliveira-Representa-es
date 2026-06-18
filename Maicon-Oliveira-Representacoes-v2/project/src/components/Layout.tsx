import React, { useState } from 'react';
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard, Users, Search, BarChart3, Settings,
  FileUp, ShoppingCart, PieChart, Calendar, ArrowLeftRight
} from 'lucide-react';
import { cn } from '../lib/utils';

const NAV_ITEMS = [
  { to: '/',              icon: Calendar,       label: 'Agenda' },
  { to: '/clientes',      icon: Users,          label: 'Clientes' },
  { to: '/consulta-preco',icon: Search,         label: 'Preços' },
  { to: '/metas',         icon: BarChart3,      label: 'Metas' },
  { to: '/comissoes',     icon: PieChart,       label: 'Comissões' },
  { to: '/dashboard',     icon: LayoutDashboard,label: 'Dashboard' },
  { to: '/import',        icon: FileUp,         label: 'Importar' },
  { to: '/emprestimos',   icon: ArrowLeftRight, label: 'Trocas' },
];

const BOTTOM_ITEMS = [
  { to: '/settings', icon: Settings, label: 'Config.' },
];

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#f8f8f7] flex flex-col pb-16 md:pb-0 md:pl-[72px]">
      {/* ── Desktop Sidebar ── */}
      <aside className="hidden md:flex flex-col w-[72px] bg-white border-r border-neutral-200/80 fixed left-0 top-0 bottom-0 z-50 shadow-sm">
        {/* Logo mark */}
        <div className="h-[60px] flex items-center justify-center border-b border-neutral-100">
          <div className="w-9 h-9 rounded-xl bg-orange-600 flex items-center justify-center shadow-md shadow-orange-200">
            <ShoppingCart size={18} className="text-white" strokeWidth={2.5} />
          </div>
        </div>

        {/* Main nav */}
        <nav className="flex-1 py-3 flex flex-col gap-0.5 px-2 overflow-y-auto">
          {NAV_ITEMS.map(item => (
            <SidebarItem key={item.to} {...item} />
          ))}
        </nav>

        {/* Bottom nav */}
        <div className="pb-3 px-2 flex flex-col gap-0.5 border-t border-neutral-100 pt-3">
          {BOTTOM_ITEMS.map(item => (
            <SidebarItem key={item.to} {...item} />
          ))}
        </div>
      </aside>

      {/* ── Main Content ── */}
      <main className="flex-1 w-full">
        <div className="page-enter max-w-7xl mx-auto px-4 py-5 md:px-8 md:py-8">
          {children}
        </div>
      </main>

      {/* ── Mobile Bottom Nav ── */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur border-t border-neutral-200 flex justify-around items-center h-16 z-50 px-1">
        {[...NAV_ITEMS.slice(0, 5), ...BOTTOM_ITEMS].map(item => (
          <MobileNavItem key={item.to} {...item} />
        ))}
      </nav>
    </div>
  );
}

function SidebarItem({
  to, icon: Icon, label
}: { to: string; icon: React.ElementType; label: string }) {
  const [hovered, setHovered] = useState(false);

  return (
    <div className="relative" onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <NavLink
        to={to}
        end={to === '/'}
        className={({ isActive }) => cn(
          'flex items-center justify-center w-full h-11 rounded-xl transition-all duration-150',
          isActive
            ? 'bg-orange-600 text-white shadow-md shadow-orange-200'
            : 'text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800'
        )}
      >
        <Icon size={20} strokeWidth={2} />
      </NavLink>

      {/* Tooltip */}
      {hovered && (
        <div className="nav-tooltip absolute left-[calc(100%+10px)] top-1/2 -translate-y-1/2 bg-neutral-900 text-white text-xs font-semibold px-2.5 py-1.5 rounded-lg whitespace-nowrap z-[200] shadow-lg">
          {label}
          <div className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-1 w-2 h-2 bg-neutral-900 rotate-45" />
        </div>
      )}
    </div>
  );
}

function MobileNavItem({
  to, icon: Icon, label
}: { to: string; icon: React.ElementType; label: string }) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      className={({ isActive }) => cn(
        'flex flex-col items-center justify-center flex-1 gap-0.5 py-1 transition-colors',
        isActive ? 'text-orange-600' : 'text-neutral-400'
      )}
    >
      {({ isActive }) => (
        <>
          <div className={cn(
            'p-1.5 rounded-lg transition-colors',
            isActive ? 'bg-orange-50' : ''
          )}>
            <Icon size={20} strokeWidth={isActive ? 2.5 : 2} />
          </div>
          <span className="text-[10px] font-semibold leading-none">{label}</span>
        </>
      )}
    </NavLink>
  );
}
