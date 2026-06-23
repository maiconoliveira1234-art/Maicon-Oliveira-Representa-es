import React, { useState } from 'react';
import { Settings, Info, Shield, Database, Smartphone, RefreshCw, UserX, Loader2, CheckCircle2, Route, AlertTriangle, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { APP_VERSION } from '../constants';
import { runAutomaticInactivation } from '../lib/clientInactivation';
import { optimizeAllTerritories } from '../lib/territoryOptimization';

export function SettingsPage() {
  const [isUpdating, setIsUpdating] = useState(false);
  const [updateSuccess, setUpdateSuccess] = useState(false);
  const [isInactivating, setIsInactivating] = useState(false);
  const [inactivateSuccess, setInactivateSuccess] = useState(false);
  const [isGeocoding, setIsGeocoding] = useState(false);
  const [geocodeSuccess, setGeocodeSuccess] = useState(false);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [optSuccess, setOptSuccess] = useState(false);

  // States for verification
  const [isValidating, setIsValidating] = useState(false);
  const [validationIssues, setValidationIssues] = useState<any[]>([]);
  const [showValidationModal, setShowValidationModal] = useState(false);

  const runGeocodingProcess = async () => {
    setIsGeocoding(true);
    const { bulkGeocodeClients } = await import('../lib/bulkGeocode');
    console.log('Iniciando o bulk geocode de clientes...');
    await bulkGeocodeClients();
    setIsGeocoding(false);
    setGeocodeSuccess(true);
    setTimeout(() => setGeocodeSuccess(false), 3000);
  };

  const handleStartGeocoding = async () => {
    setIsValidating(true);
    try {
      const { getGeocodeValidationReport } = await import('../lib/bulkGeocode');
      const issues = await getGeocodeValidationReport();
      setValidationIssues(issues);
      
      if (issues.length > 0) {
        setShowValidationModal(true);
      } else {
        // No issues, proceed directly
        await runGeocodingProcess();
      }
    } catch (err) {
      console.error('Erro ao validar geocodificação:', err);
      alert('Erro ao realizar a verificação prévia de endereços.');
    } finally {
      setIsValidating(false);
    }
  };

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

            <div className="flex justify-between items-center pt-4 border-t border-neutral-100">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-50 text-blue-600 rounded-lg">
                  <RefreshCw size={20} />
                </div>
                <div className="max-w-[200px] md:max-w-none">
                  <p className="font-bold text-neutral-900">Geocodificação Inicial</p>
                  <p className="text-xs text-neutral-500">Gera coordenadas para endereços existentes</p>
                </div>
              </div>
              <button
                onClick={handleStartGeocoding}
                disabled={isGeocoding || isValidating}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${
                  geocodeSuccess 
                    ? 'bg-green-100 text-green-600' 
                    : 'bg-blue-600 text-white hover:bg-blue-700 active:scale-95 disabled:opacity-50'
                }`}
              >
                {isGeocoding || isValidating ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : geocodeSuccess ? (
                  <CheckCircle2 size={14} />
                ) : (
                  'Iniciar'
                )}
                {geocodeSuccess ? 'Concluído' : isValidating ? 'Verificando' : isGeocoding ? 'Processando' : ''}
              </button>
            </div>

            <div className="flex justify-between items-center pt-4 border-t border-neutral-100">
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
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${
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

            <div className="flex justify-between items-center pt-4 border-t border-neutral-100">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-orange-50 text-orange-600 rounded-lg">
                  <Route size={20} />
                </div>
                <div>
                  <p className="font-bold text-neutral-900">Google Maps Platform</p>
                  <p className="text-xs text-neutral-500">
                    {(() => {
                      const key = (process.env.GOOGLE_MAPS_PLATFORM_KEY || (import.meta as any).env?.VITE_GOOGLE_MAPS_PLATFORM_KEY || (globalThis as any).GOOGLE_MAPS_PLATFORM_KEY || '').trim();
                      const hasKeyCheck = Boolean(key) && key !== 'YOUR_API_KEY' && key !== 'undefined' && key !== 'null' && key.startsWith('AIzaSy') && key.length >= 20;
                      if (!hasKeyCheck) {
                        return 'Nenhuma chave de API detectada';
                      }
                      const masked = key.length > 8 ? `${key.substring(0, 6)}...${key.substring(key.length - 4)}` : 'Chave configurada';
                      return `Chave detectada: ${masked} (${key.length} caract.)`;
                    })()}
                  </p>
                </div>
              </div>
              {(() => {
                const key = (process.env.GOOGLE_MAPS_PLATFORM_KEY || (import.meta as any).env?.VITE_GOOGLE_MAPS_PLATFORM_KEY || (globalThis as any).GOOGLE_MAPS_PLATFORM_KEY || '').trim();
                const hasKey = Boolean(key) && key !== 'YOUR_API_KEY' && key !== 'undefined' && key !== 'null' && key.startsWith('AIzaSy') && key.length >= 20;
                if (hasKey) {
                  return (
                    <span className="flex items-center gap-1.5 text-green-600 font-bold text-sm">
                      <div className="w-2 h-2 bg-green-500 rounded-full animate-ping" />
                      Configurado
                    </span>
                  );
                } else {
                  return (
                    <span className="flex items-center gap-1.5 text-amber-500 font-bold text-sm animate-pulse">
                      <div className="w-2 h-2 bg-amber-500 rounded-full" />
                      Não Configurado
                    </span>
                  );
                }
              })()}
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

      {/* Modal de Validação de Geocodificação */}
      <AnimatePresence>
        {showValidationModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowValidationModal(false)}
              className="fixed inset-0 bg-neutral-900/60 backdrop-blur-sm"
            />
            
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              className="bg-white w-full max-w-xl rounded-[2rem] border border-neutral-200 shadow-2xl p-6 relative z-10 overflow-hidden flex flex-col max-h-[85vh]"
            >
              <div className="flex justify-between items-start mb-4">
                <div className="flex items-center gap-3">
                  <div className="p-3 bg-amber-50 text-amber-600 rounded-2xl">
                    <AlertTriangle size={24} />
                  </div>
                  <div>
                    <h2 className="text-xl font-black text-neutral-900 leading-tight">Pendências de Endereço</h2>
                    <p className="text-xs text-neutral-500 font-medium">Verificação prévia concluída com alertas</p>
                  </div>
                </div>
                <button
                  onClick={() => setShowValidationModal(false)}
                  className="w-8 h-8 rounded-full bg-neutral-50 border border-neutral-200 flex items-center justify-center text-neutral-400 hover:text-neutral-900 transition-colors"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto space-y-4 pr-1 my-2">
                <p className="text-xs text-neutral-600 leading-relaxed">
                  Identificamos inconsistências em alguns clientes cadastrados no sistema. Os bairros dos clientes agendados serão extraídos do endereço (após o sinal <strong>"-"</strong>) e sincronizados automaticamente na tabela de agenda de visitas antes da geração das coordenadas.
                </p>

                <div className="space-y-2">
                  <h3 className="text-[10px] font-black text-neutral-400 uppercase tracking-wider mb-2">Relatório de Inconsistências:</h3>
                  <div className="divide-y divide-neutral-100 max-h-[250px] overflow-y-auto border border-neutral-200 rounded-2xl bg-neutral-50/50">
                    {validationIssues.map((issue, idx) => (
                      <div key={issue.id + '-' + idx} className="p-3 flex items-start gap-2.5 text-xs">
                        <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase shrink-0 mt-0.5 ${
                          issue.tipo === 'fora_da_agenda' 
                            ? 'bg-neutral-100 text-neutral-700 border border-neutral-200' 
                            : 'bg-red-50 text-red-600 border border-red-100'
                        }`}>
                          {issue.tipo === 'fora_da_agenda' ? 'Sem Agenda' : 'Erro Endereço'}
                        </span>
                        <div>
                          <p className="font-bold text-neutral-900">{issue.cliente}</p>
                          <p className="text-[11px] text-neutral-500 mt-0.5">{issue.detalhe}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="mt-6 pt-4 border-t border-neutral-100 flex flex-col sm:flex-row items-center gap-2">
                <button
                  onClick={() => setShowValidationModal(false)}
                  className="w-full sm:flex-1 py-2.5 px-4 bg-neutral-100 hover:bg-neutral-200 text-neutral-700 font-bold text-xs rounded-xl transition-all uppercase tracking-wider active:scale-95"
                >
                  Corrigir Cadastro
                </button>
                <button
                  onClick={async () => {
                    setShowValidationModal(false);
                    await runGeocodingProcess();
                  }}
                  className="w-full sm:flex-1 py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white font-black text-xs rounded-xl transition-all uppercase tracking-wider active:scale-95 shadow-md shadow-blue-500/10"
                >
                  Prosseguir de Qualquer Forma
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <div className="mt-12 text-center">
        <p className="text-[10px] font-black text-neutral-300 uppercase tracking-[0.3em]">
          MAICON OLIVEIRA REPRESENTAÇÕES COMERCIAIS
        </p>
      </div>
    </div>
  );
}
