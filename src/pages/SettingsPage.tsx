import React from 'react';
import { Settings, Info, Shield, Database, Smartphone } from 'lucide-react';
import { APP_VERSION } from '../constants';

export function SettingsPage() {
  return (
    <div className="max-w-2xl mx-auto py-8 px-4">
      <div className="flex items-center gap-3 mb-8">
        <div className="p-3 bg-orange-100 text-orange-600 rounded-2xl">
          <Settings size={32} />
        </div>
        <div>
          <h1 className="text-3xl font-black text-neutral-900 tracking-tight">Configurações</h1>
          <p className="text-neutral-500 font-medium">Gerencie as preferências do aplicativo</p>
        </div>
      </div>

      <div className="space-y-6">
        {/* Informações do App */}
        <section className="bg-white rounded-3xl border border-neutral-200 overflow-hidden shadow-sm">
          <div className="p-6 border-b border-neutral-100 bg-neutral-50/50 flex items-center gap-2">
            <Info size={18} className="text-neutral-400" />
            <h2 className="font-bold text-neutral-900 uppercase tracking-wider text-xs">Sobre o Aplicativo</h2>
          </div>
          <div className="p-6 space-y-4">
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-50 text-blue-600 rounded-lg">
                  <Smartphone size={20} />
                </div>
                <div>
                  <p className="font-bold text-neutral-900">Versão do Sistema</p>
                  <p className="text-xs text-neutral-500">Versão atual instalada</p>
                </div>
              </div>
              <span className="px-3 py-1 bg-neutral-100 text-neutral-600 rounded-full text-sm font-black">
                v{APP_VERSION}
              </span>
            </div>

            <div className="flex justify-between items-center pt-4 border-t border-neutral-100">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-green-50 text-green-600 rounded-lg">
                  <Database size={20} />
                </div>
                <div>
                  <p className="font-bold text-neutral-900">Banco de Dados</p>
                  <p className="text-xs text-neutral-500">Status da conexão local</p>
                </div>
              </div>
              <span className="flex items-center gap-1.5 text-green-600 font-bold text-sm">
                <div className="w-2 h-2 bg-green-600 rounded-full animate-pulse" />
                Conectado
              </span>
            </div>
          </div>
        </section>

        {/* Segurança */}
        <section className="bg-white rounded-3xl border border-neutral-200 overflow-hidden shadow-sm opacity-50 grayscale pointer-events-none">
          <div className="p-6 border-b border-neutral-100 bg-neutral-50/50 flex items-center gap-2">
            <Shield size={18} className="text-neutral-400" />
            <h2 className="font-bold text-neutral-900 uppercase tracking-wider text-xs">Segurança & Privacidade</h2>
          </div>
          <div className="p-6">
            <p className="text-sm text-neutral-500 italic">Opções de segurança em desenvolvimento...</p>
          </div>
        </section>
      </div>

      <div className="mt-12 text-center">
        <p className="text-[10px] font-black text-neutral-300 uppercase tracking-[0.3em]">
          MAICON OLIVEIRA REPRESENTAÇÕES COMERCIAIS
        </p>
      </div>
    </div>
  );
}
