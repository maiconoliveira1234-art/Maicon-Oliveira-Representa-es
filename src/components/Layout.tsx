import React from 'react';
import { NavLink } from 'react-router-dom';
import { LayoutDashboard, Users, Search, BarChart3, Settings, FileUp, ShoppingCart } from 'lucide-react';
import { cn } from '../lib/utils';

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-neutral-100 flex flex-col pb-20 md:pb-0 md:pl-20">
      {/* Sidebar Desktop */}
      <aside className="hidden md:flex flex-col w-20 bg-white border-r border-neutral-200 fixed left-0 top-0 bottom-0 z-50">
        <div className="p-4 flex justify-center">
          <ShoppingCart className="text-orange-600" size={28} />
        </div>
        <nav className="flex-1 px-2 space-y-4 mt-4">
          <NavItem to="/" icon={<LayoutDashboard size={24} />} label="" />
          <NavItem to="/clientes" icon={<Users size={24} />} label="" />
          <NavItem to="/consulta-preco" icon={<Search size={24} />} label="" />
          <NavItem to="/metas" icon={<BarChart3 size={24} />} label="" />
          <NavItem to="/import" icon={<FileUp size={24} />} label="" />
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
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-neutral-200 flex justify-around items-center h-16 z-50 px-2">
        <MobileNavItem to="/" icon={<LayoutDashboard size={24} />} label="Início" />
        <MobileNavItem to="/clientes" icon={<Users size={24} />} label="Clientes" />
        <MobileNavItem to="/consulta-preco" icon={<Search size={24} />} label="Preços" />
        <MobileNavItem to="/metas" icon={<BarChart3 size={24} />} label="Metas" />
        <MobileNavItem to="/import" icon={<FileUp size={24} />} label="Importar" />
      </nav>
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
        "flex flex-col items-center justify-center flex-1 gap-1 transition-colors",
        isActive ? "text-orange-600" : "text-neutral-400"
      )}
    >
      {icon}
      <span className="text-[10px] font-medium">{label}</span>
    </NavLink>
  );
}
