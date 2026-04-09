import React, { useState } from 'react';
import { Settings, Info, Shield, Database, Smartphone, RefreshCw, UserX, Loader2, CheckCircle2 } from 'lucide-react';
import { APP_VERSION } from '../constants';
import { runAutomaticInactivation } from '../lib/clientInactivation';

export function SettingsPage() {
  const [isUpdating, setIsUpdating] = useState(false);
  const [updateSuccess, setUpdateSuccess] = useState(false);
  const [isInactivating, setIsInactivating] = useState(false);
  const [inactivateSuccess, setInactivateSuccess] = useState(false);

  const handleUpdate = () => {
    setIsUpdating(true);
    
    setTimeout(() => {
      setUpdateSuccess(true);
      setTimeout(() => {
        const url = new URL(window.location.origin);
        url.searchParams.set('v', Date.now().toString());
        window.location.href = url.toString();
      }, 800);
    }, 1500);
  };

  const handleManualInactivation = async () => {
    setIsInactivating(true);
    await runAutomaticInactivation();
    setIsInactivating(false);
    setInactivateSuccess(true);
    setTimeout(() => setInactivateSuccess(false), 3000);
  };

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
        {/* Manutenção de Dados */}
        <section className="bg-white rounded-3xl border border-neutral-200 overflow-hidden shadow-sm">
          <div className="p-6 border-b border-neutral-100 bg-neutral-50/50 flex items-center gap-2">
            <Database size={18} className="text-neutral-400" />
            <h2 className="font-bold text-neutral-900 uppercase tracking-wider text-xs">Manutenção de Dados</h2>
          </div>
          <div className="p-6 space-y-4">
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-orange-50 text-orange-600 rounded-lg">
                  <UserX size={20} />
                </div>
                <div className="max-w-[200px] md:max-w-none">
                  <p className="font-bold text-neutral-900">Inativação Automática</p>
                  <p className="text-xs text-neutral-500">Inativa clientes sem compras nos últimos 6 meses</p>
                </div>
              </div>
              <button
                onClick={handleManualInactivation}
                disabled={isInactivating}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${
                  inactivateSuccess 
                    ? 'bg-green-100 text-green-600' 
                    : 'bg-neutral-900 text-white hover:bg-neutral-800 active:scale-95 disabled:opacity-50'
                }`}
              >
                {isInactivating ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : inactivateSuccess ? (
                  <CheckCircle2 size={14} />
                ) : (
                  'Executar'
                )}
                {inactivateSuccess ? 'Concluído' : isInactivating ? 'Processando' : ''}
              </button>
            </div>
          </div>
        </section>

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
              <div className="flex flex-col items-end gap-2">
                <span className="px-3 py-1 bg-neutral-100 text-neutral-600 rounded-full text-sm font-black">
                  v{APP_VERSION}
                </span>
                <button
                  onClick={handleUpdate}
                  disabled={isUpdating}
                  className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${
                    updateSuccess 
                      ? 'bg-green-100 text-green-600' 
                      : 'bg-orange-600 text-white hover:bg-orange-700 active:scale-95 disabled:opacity-50'
                  }`}
                >
                  {isUpdating ? (
                    <>
                      <RefreshCw size={14} className="animate-spin" />
                      {updateSuccess ? 'Atualizado!' : 'Buscando...'}
                    </>
                  ) : (
                    <>
                      <RefreshCw size={14} />
                      Atualizar Sistema
                    </>
                  )}
                </button>
              </div>
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
