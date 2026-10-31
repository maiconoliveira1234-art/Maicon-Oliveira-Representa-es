import React, { useState } from 'react';
import { Settings, Info, Shield, Database, Smartphone, RefreshCw, Loader2, CheckCircle2, Route } from 'lucide-react';
import { APP_VERSION } from '../constants';
import { optimizeAllTerritories } from '../lib/territoryOptimization';
import { PageHeader, Panel } from '../components/ui/AppChrome';
import { useDataManager } from '../lib/dataManager';

export function SettingsPage() {
  const { isSyncing, pendingQueueCount, syncAllData, lastSyncedTime } = useDataManager();
  const [isUpdating, setIsUpdating] = useState(false);
  const [updateSuccess, setUpdateSuccess] = useState(false);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [optSuccess, setOptSuccess] = useState(false);

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

  return (
    <div className="max-w-2xl mx-auto py-8 px-4">
      <PageHeader
        title="Configurações"
        subtitle="Gerencie as preferências do aplicativo"
        icon={<Settings />}
        className="mb-6"
      />

      <div className="space-y-6">
        {/* Manutenção de Dados */}
        <Panel className="overflow-hidden">
          <div className="p-6 border-b border-neutral-100 bg-neutral-50/50 flex items-center gap-2">
            <Database size={18} className="text-neutral-400" />
            <h2 className="font-bold text-neutral-900 uppercase tracking-wider text-xs">Manutenção de Dados</h2>
          </div>
          <div className="p-6 space-y-4">
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-emerald-50 text-emerald-600 rounded-lg">
                  <Route size={20} />
                </div>
                <div className="max-w-[200px] md:max-w-none">
                  <p className="font-bold text-neutral-900">Otimização de Território</p>
                  <p className="text-xs text-neutral-500">Redistribui visitas entre os dias por proximidade</p>
                </div>
              </div>
              <button
                onClick={async () => {
                  if (!confirm('Esta ação irá redistribuir TODOS os clientes entre as 2 semanas (Segunda a Quinta) para agrupar por proximidade geográfica. Deseja continuar?')) return;
                  
                  setIsOptimizing(true);
                  try {
                    await optimizeAllTerritories();
                    setOptSuccess(true);
                    setTimeout(() => setOptSuccess(false), 3000);
                    alert('Otimização concluída!');
                  } catch (err) {
                    console.error('Erro na otimização:', err);
                    alert('Erro: ' + (err instanceof Error ? err.message : 'Erro desconhecido'));
                  } finally {
                    setIsOptimizing(false);
                  }
                }}
                disabled={isOptimizing}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-black uppercase tracking-widest transition-all ${
                  optSuccess 
                    ? 'bg-green-100 text-green-600' 
                    : 'bg-emerald-600 text-white hover:bg-emerald-700 active:scale-95 disabled:opacity-50'
                }`}
              >
                {isOptimizing ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : optSuccess ? (
                  <CheckCircle2 size={14} />
                ) : (
                  'Otimizar 8 Dias'
                )}
                {optSuccess ? 'Concluído' : isOptimizing ? 'Processando' : ''}
              </button>
            </div>

            <div className="flex justify-between items-center pt-4 border-t border-neutral-100">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-amber-50 text-amber-600 rounded-lg">
                  <RefreshCw size={20} className={isSyncing ? "animate-spin" : ""} />
                </div>
                <div className="max-w-[200px] md:max-w-none">
                  <p className="font-bold text-neutral-900">Atualizar Dados Offline</p>
                  <p className="text-xs text-neutral-500">
                    {pendingQueueCount > 0 
                      ? `Sincronizar imediatamente (${pendingQueueCount} alteração(ões) pendente(s))` 
                      : `Sincronizar dados locais com o servidor`}
                  </p>
                </div>
              </div>
              <button
                onClick={async () => {
                  try {
                    await syncAllData();
                    alert('Sincronização concluída com sucesso!');
                  } catch (err: any) {
                    alert('Erro ao sincronizar: ' + (err?.message || err));
                  }
                }}
                disabled={isSyncing}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-black uppercase tracking-widest transition-all ${
                  isSyncing 
                    ? 'bg-amber-100 text-amber-600' 
                    : 'bg-amber-600 text-white hover:bg-amber-700 active:scale-95 disabled:opacity-50'
                }`}
              >
                {isSyncing ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <RefreshCw size={14} />
                )}
                {isSyncing ? 'Sincronizando' : 'Atualizar Dados'}
              </button>
            </div>
          </div>
        </Panel>


        {/* Informações do App */}
        <Panel className="overflow-hidden">
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
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-black uppercase tracking-widest transition-all ${
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

          </div>
        </Panel>

        {/* Segurança */}
        <Panel className="overflow-hidden opacity-50 grayscale pointer-events-none">
          <div className="p-6 border-b border-neutral-100 bg-neutral-50/50 flex items-center gap-2">
            <Shield size={18} className="text-neutral-400" />
            <h2 className="font-bold text-neutral-900 uppercase tracking-wider text-xs">Segurança & Privacidade</h2>
          </div>
          <div className="p-6">
            <p className="text-sm text-neutral-500 italic">Opções de segurança em desenvolvimento...</p>
          </div>
        </Panel>
      </div>

    </div>
  );
}
