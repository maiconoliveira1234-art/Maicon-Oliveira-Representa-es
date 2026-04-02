import React from 'react';
import { LayoutDashboard } from 'lucide-react';

export function Dashboard() {
  return (
    <div className="flex flex-col items-center justify-center h-[calc(100vh-200px)] text-neutral-400 space-y-4">
      <div className="w-20 h-20 bg-neutral-100 rounded-full flex items-center justify-center">
        <LayoutDashboard size={40} className="opacity-20" />
      </div>
      <div className="text-center">
        <h2 className="text-xl font-black text-neutral-900">Dashboard</h2>
        <p className="text-sm">Relatórios e gráficos em desenvolvimento.</p>
      </div>
    </div>
  );
}
