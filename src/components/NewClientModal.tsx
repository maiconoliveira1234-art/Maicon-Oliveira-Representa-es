import React, { useState, useEffect } from 'react';
import { X, Save, Loader2, UserPlus, Edit3, AlertCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { cn } from '../lib/utils';
import { Cliente } from '../types';
import { geocodeAddress, getAddressSuggestions, PlaceSuggestion } from '../services/geocodingService';
import { runAutoAgendaSyncIfEligible } from '../lib/autoAgendaSync';

interface NewClientModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (isEdit?: boolean) => void;
  editingCliente?: Cliente | null;
}

export function NewClientModal({ isOpen, onClose, onSuccess, editingCliente }: NewClientModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ message: string; field?: string } | null>(null);
  const [formData, setFormData] = useState({
    cliente: '',
    cidade: '',
    ativo: true,
    contato: '',
    telefone: '',
    endereco: '',
    agenda_fixa: false,
  });

  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);

  useEffect(() => {
    if (editingCliente) {
      setFormData({
        cliente: editingCliente.cliente || '',
        cidade: editingCliente.cidade || '',
        ativo: editingCliente.ativo ?? true,
        contato: editingCliente.contato || '',
        telefone: editingCliente.telefone || '',
        endereco: editingCliente.endereco || '',
        agenda_fixa: editingCliente.agenda_fixa ?? false,
      });
    } else {
      setFormData({
        cliente: '',
        cidade: '',
        ativo: true,
        contato: '',
        telefone: '',
        endereco: '',
        agenda_fixa: false,
      });
    }
    setSuggestions([]);
    setShowSuggestions(false);
  }, [editingCliente, isOpen]);

  // Debounced Address Suggestion Lookup (500ms)
  useEffect(() => {
    const term = formData.endereco;
    if (!term || term.trim().length < 3) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    const handler = setTimeout(async () => {
      const results = await getAddressSuggestions(term);
      setSuggestions(results);
      setShowSuggestions(results.length > 0);
    }, 500); // 500ms DEBOUNCE

    return () => {
      clearTimeout(handler);
    };
  }, [formData.endereco]);

  const handleSelectSuggestion = (suggestion: PlaceSuggestion) => {
    const parts = suggestion.description.split(',');
    
    setFormData((prev) => {
      const updated = { ...prev };
      // Save full address for accurate geocoding
      updated.endereco = suggestion.description.toUpperCase();
      
      // Auto-extract city if SC cities are found in the suggested address components
      const scCities = ['JOINVILLE', 'SÃO FRANCISCO DO SUL', 'ARAQUARI', 'GARUVA', 'ITAJAÍ', 'BALNEÁRIO CAMBORIÚ', 'SÃO BENTO DO SUL', 'FLORIANÓPOLIS', 'BLUMENAU', 'JARAGUÁ DO SUL', 'TIMBÓ', 'POMERODE', 'BARRA VELHA', 'PENHA', 'PIÇARRAS', 'BALNEÁRIO PIÇARRAS'];
      for (const p of parts) {
        const cleanPart = p.trim().toUpperCase();
        if (scCities.includes(cleanPart)) {
          updated.cidade = cleanPart;
          break;
        }
      }
      return updated;
    });

    setShowSuggestions(false);
  };

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      // Validation
      if (!formData.cliente.trim()) {
        setError({ message: 'O nome do cliente é obrigatório.', field: 'cliente' });
        setLoading(false);
        return;
      }
      if (!formData.cidade.trim()) {
        setError({ message: 'A cidade é obrigatória.', field: 'cidade' });
        setLoading(false);
        return;
      }

      const clientData: any = {
        cliente: formData.cliente,
        cidade: formData.cidade,
        ativo: formData.ativo,
        contato: formData.contato,
        telefone: formData.telefone || null,
        endereco: formData.endereco,
        agenda_fixa: formData.agenda_fixa,
      };

      // Automatic Geocoding if address is provided
      if (formData.endereco && formData.cidade) {
        const needsGeocode = !editingCliente || 
                           editingCliente.endereco !== formData.endereco || 
                           editingCliente.cidade !== formData.cidade ||
                           !editingCliente.latitude;
        
        if (needsGeocode) {
          const coords = await geocodeAddress(formData.endereco, formData.cidade);
          if (coords) {
            clientData.latitude = coords.lat;
            clientData.longitude = coords.lng;
          }
        } else if (editingCliente) {
          clientData.latitude = editingCliente.latitude;
          clientData.longitude = editingCliente.longitude;
        }
      }

      if (editingCliente) {
        const { error: updateError } = await supabase
          .from('clientes')
          .update(clientData)
          .eq('id', editingCliente.id);

        if (updateError) {
          if (updateError.code === '42703' || updateError.message?.includes('agenda_fixa')) {
            console.warn('[DB] Coluna agenda_fixa nao existe. Salvando sem ela.');
            const { agenda_fixa, ...fallbackData } = clientData;
            const { error: retryError } = await supabase
              .from('clientes')
              .update(fallbackData)
              .eq('id', editingCliente.id);
            if (retryError) throw retryError;
          } else {
            throw updateError;
          }
        }

        // Lidar com alteração de status ativo/inativo
        const statusChangedToInactive = (editingCliente.ativo !== false) && (formData.ativo === false);
        const statusChangedToActive = (editingCliente.ativo === false) && (formData.ativo === true);

        if (statusChangedToInactive || statusChangedToActive) {
          await supabase
            .from('agenda_visitas')
            .delete()
            .eq('cliente_id', editingCliente.id);
        }

        if (statusChangedToActive) {
          try {
            await runAutoAgendaSyncIfEligible(true);
          } catch (err) {
            console.error('[Modal] Erro ao sincronizar agenda pós-reativação:', err);
          }
        }

        onSuccess(true);
      } else {
        const { error: insertError } = await supabase
          .from('clientes')
          .insert([clientData]);

        if (insertError) {
          if (insertError.code === '42703' || insertError.message?.includes('agenda_fixa')) {
            console.warn('[DB] Coluna agenda_fixa nao existe. Salvando sem ela.');
            const { agenda_fixa, ...fallbackData } = clientData;
            const { error: retryError } = await supabase
              .from('clientes')
              .insert([fallbackData]);
            if (retryError) throw retryError;
          } else {
            throw insertError;
          }
        }

        // Se criou um novo cliente ativo, sincroniza para agendá-lo no melhor lugar
        if (formData.ativo) {
          try {
            await runAutoAgendaSyncIfEligible(true);
          } catch (err) {
            console.error('[Modal] Erro ao sincronizar agenda pós-criação:', err);
          }
        }

        onSuccess(false);
      }

      onClose();
    } catch (err: any) {
      console.error('Erro ao salvar cliente:', err);
      
      let message = 'Ocorreu um erro ao salvar o cliente.';
      let field: string | undefined = undefined;

      // Handle specific database errors
      if (err.message?.includes('numeric') || err.code === '22P02') {
        message = 'O campo Fone deve conter apenas números.';
        field = 'telefone';
      }

      setError({ message: err.message || message, field });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-white w-full max-w-lg rounded-lg shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200">
        <div className="flex items-center justify-between p-6 border-b border-neutral-100">
          <div className="flex items-center gap-3">
            <div className={cn(
              "p-2 rounded-lg",
              editingCliente ? "bg-purple-100 text-purple-600" : "bg-orange-100 text-orange-600"
            )}>
              {editingCliente ? <Edit3 size={24} /> : <UserPlus size={24} />}
            </div>
            <h2 className="text-xl font-black text-neutral-900 tracking-tight">
              {editingCliente ? 'Editar Cliente' : 'Novo Cliente'}
            </h2>
          </div>
          <button 
            onClick={onClose}
            className="p-2 hover:bg-neutral-100 rounded-full transition-colors text-neutral-400 hover:text-neutral-600"
          >
            <X size={24} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4 max-h-[80vh] overflow-y-auto">
          {error && (
            <div className="bg-red-50 border border-red-100 text-red-600 p-4 rounded-lg text-sm font-medium flex items-start gap-2">
              <AlertCircle size={18} className="shrink-0 mt-0.5" />
              <div>
                <p className="font-bold">Atenção</p>
                <p className="opacity-90">{error.message}</p>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5 md:col-span-2">
              <label className="text-[10px] font-black text-neutral-400 uppercase tracking-widest ml-1">Nome do Cliente</label>
              <input
                type="text"
                value={formData.cliente}
                onChange={(e) => setFormData({ ...formData, cliente: e.target.value.toUpperCase() })}
                className={cn(
                  "w-full px-4 py-3 bg-neutral-50 border rounded-lg focus:ring-2 outline-none transition-all font-bold text-neutral-900",
                  error?.field === 'cliente' ? "border-red-400 ring-red-100 bg-red-50" : "border-neutral-200 focus:ring-orange-500"
                )}
                placeholder="EX: SUPERMERCADO EXEMPLO"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-[10px] font-black text-neutral-400 uppercase tracking-widest ml-1">Contato</label>
              <input
                type="text"
                value={formData.contato}
                onChange={(e) => setFormData({ ...formData, contato: e.target.value.toUpperCase() })}
                className="w-full px-4 py-3 bg-neutral-50 border border-neutral-200 rounded-lg focus:ring-2 focus:ring-orange-500 outline-none transition-all font-bold text-neutral-900"
                placeholder="NOME DO CONTATO PRINCIPAL"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-[10px] font-black text-neutral-400 uppercase tracking-widest ml-1">Fone</label>
              <input
                type="number"
                value={formData.telefone}
                onChange={(e) => setFormData({ ...formData, telefone: e.target.value })}
                className={cn(
                  "w-full px-4 py-3 bg-neutral-50 border rounded-lg focus:ring-2 outline-none transition-all font-bold text-neutral-900",
                  error?.field === 'telefone' ? "border-red-400 ring-red-100 bg-red-50" : "border-neutral-200 focus:ring-orange-500"
                )}
                placeholder="EX: 47999999999"
              />
            </div>

            <div className="space-y-1.5 md:col-span-2 relative">
              <label className="text-[10px] font-black text-neutral-400 uppercase tracking-widest ml-1">Endereço</label>
              <input
                type="text"
                value={formData.endereco}
                onChange={(e) => setFormData({ ...formData, endereco: e.target.value.toUpperCase() })}
                onFocus={() => {
                  if (suggestions.length > 0) setShowSuggestions(true);
                }}
                onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                className="w-full px-4 py-3 bg-neutral-50 border border-neutral-200 rounded-lg focus:ring-2 focus:ring-orange-500 outline-none transition-all font-bold text-neutral-900"
                placeholder="REGISTRE A RUA E NÚMERO..."
                autoComplete="off"
              />
              {showSuggestions && suggestions.length > 0 && (
                <div className="absolute left-0 right-0 top-full mt-1 max-h-[220px] overflow-y-auto bg-white border border-neutral-200 rounded-lg shadow-xl z-[400] divide-y divide-neutral-100 animate-in fade-in duration-100">
                  {suggestions.map((suggestion) => (
                    <button
                      key={suggestion.placeId}
                      type="button"
                      onMouseDown={(e) => {
                        // Prevent prompt blur from hiding the popup before click completes
                        e.preventDefault();
                      }}
                      onClick={() => handleSelectSuggestion(suggestion)}
                      className="w-full text-left px-4 py-3 hover:bg-neutral-50 text-xs font-semibold text-neutral-800 transition-colors block"
                    >
                      {suggestion.description}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-1.5 md:col-span-2">
              <label className="text-[10px] font-black text-neutral-400 uppercase tracking-widest ml-1">Cidade</label>
              <input
                type="text"
                value={formData.cidade}
                onChange={(e) => setFormData({ ...formData, cidade: e.target.value.toUpperCase() })}
                className={cn(
                  "w-full px-4 py-3 bg-neutral-50 border rounded-lg focus:ring-2 outline-none transition-all font-bold text-neutral-900",
                  error?.field === 'cidade' ? "border-red-400 ring-red-100 bg-red-50" : "border-neutral-200 focus:ring-orange-500"
                )}
                placeholder="EX: SÃO PAULO"
              />
            </div>

            <div className="md:col-span-2 bg-neutral-50 border border-neutral-200 p-4 rounded-lg flex items-center justify-between gap-4">
              <div className="space-y-0.5">
                <label className="text-xs font-black text-neutral-900 uppercase tracking-wider block">Agenda Fixa</label>
                <span className="text-[10px] text-neutral-500 block font-semibold leading-tight">Se ativado, o cliente nunca será movido automaticamente por otimizações, rebalanceamento ou novas inclusões.</span>
              </div>
              <label className="relative inline-flex items-center cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={formData.agenda_fixa}
                  onChange={(e) => setFormData({ ...formData, agenda_fixa: e.target.checked })}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-neutral-200 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:border-neutral-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-orange-600"></div>
              </label>
            </div>
          </div>

          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-4 bg-neutral-100 text-neutral-700 rounded-lg font-black uppercase tracking-widest text-xs hover:bg-neutral-200 transition-all"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 py-4 bg-orange-600 text-white rounded-lg font-black uppercase tracking-widest text-xs hover:bg-orange-700 transition-all shadow-lg shadow-orange-200 flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {loading ? <Loader2 className="animate-spin" size={18} /> : <Save size={18} />}
              Salvar
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

