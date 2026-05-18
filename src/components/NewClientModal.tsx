import React, { useState, useEffect } from 'react';
import { X, Save, Loader2, UserPlus, Edit3, AlertCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { cn } from '../lib/utils';
import { Cliente } from '../types';
import { geocodeAddress } from '../services/geocodingService';

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
    dia_visita: 1,
    cidade: '',
    ativo: true,
    contato: '',
    telefone: '',
    endereco: '',
  });

  useEffect(() => {
    if (editingCliente) {
      setFormData({
        cliente: editingCliente.cliente || '',
        dia_visita: editingCliente.dia_visita || 1,
        cidade: editingCliente.cidade || '',
        ativo: editingCliente.ativo ?? true,
        contato: editingCliente.contato || '',
        telefone: editingCliente.telefone || '',
        endereco: editingCliente.endereco || '',
      });
    } else {
      setFormData({
        cliente: '',
        dia_visita: 1,
        cidade: '',
        ativo: true,
        contato: '',
        telefone: '',
        endereco: '',
      });
    }
  }, [editingCliente, isOpen]);

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
        dia_visita: formData.dia_visita,
        cidade: formData.cidade,
        ativo: formData.ativo,
        contato: formData.contato,
        telefone: formData.telefone || null,
        endereco: formData.endereco,
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

        if (updateError) throw updateError;
        onSuccess(true);
      } else {
        const { error: insertError } = await supabase
          .from('clientes')
          .insert([clientData]);

        if (insertError) throw insertError;
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
      <div className="bg-white w-full max-w-lg rounded-3xl shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200">
        <div className="flex items-center justify-between p-6 border-b border-neutral-100">
          <div className="flex items-center gap-3">
            <div className={cn(
              "p-2 rounded-xl",
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
            <div className="bg-red-50 border border-red-100 text-red-600 p-4 rounded-2xl text-sm font-medium flex items-start gap-2">
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
                  "w-full px-4 py-3 bg-neutral-50 border rounded-2xl focus:ring-2 outline-none transition-all font-bold text-neutral-900",
                  error?.field === 'cliente' ? "border-red-400 ring-red-100 bg-red-50" : "border-neutral-200 focus:ring-orange-500"
                )}
                placeholder="EX: SUPERMERCADO EXEMPLO"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-[10px] font-black text-neutral-400 uppercase tracking-widest ml-1">Dia de Visita</label>
              <input
                type="number"
                min="1"
                max="31"
                value={formData.dia_visita}
                onChange={(e) => setFormData({ ...formData, dia_visita: parseInt(e.target.value) || 1 })}
                className="w-full px-4 py-3 bg-neutral-50 border border-neutral-200 rounded-2xl focus:ring-2 focus:ring-orange-500 outline-none transition-all font-bold text-neutral-900"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-[10px] font-black text-neutral-400 uppercase tracking-widest ml-1">Contato</label>
              <input
                type="text"
                value={formData.contato}
                onChange={(e) => setFormData({ ...formData, contato: e.target.value.toUpperCase() })}
                className="w-full px-4 py-3 bg-neutral-50 border border-neutral-200 rounded-2xl focus:ring-2 focus:ring-orange-500 outline-none transition-all font-bold text-neutral-900"
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
                  "w-full px-4 py-3 bg-neutral-50 border rounded-2xl focus:ring-2 outline-none transition-all font-bold text-neutral-900",
                  error?.field === 'telefone' ? "border-red-400 ring-red-100 bg-red-50" : "border-neutral-200 focus:ring-orange-500"
                )}
                placeholder="EX: 47999999999"
              />
            </div>

            <div className="space-y-1.5 md:col-span-2">
              <label className="text-[10px] font-black text-neutral-400 uppercase tracking-widest ml-1">Endereço</label>
              <input
                type="text"
                value={formData.endereco}
                onChange={(e) => setFormData({ ...formData, endereco: e.target.value.toUpperCase() })}
                className="w-full px-4 py-3 bg-neutral-50 border border-neutral-200 rounded-2xl focus:ring-2 focus:ring-orange-500 outline-none transition-all font-bold text-neutral-900"
                placeholder="RUA, NÚMERO, BAIRRO..."
              />
            </div>

            <div className="space-y-1.5 md:col-span-2">
              <label className="text-[10px] font-black text-neutral-400 uppercase tracking-widest ml-1">Cidade</label>
              <input
                type="text"
                value={formData.cidade}
                onChange={(e) => setFormData({ ...formData, cidade: e.target.value.toUpperCase() })}
                className={cn(
                  "w-full px-4 py-3 bg-neutral-50 border rounded-2xl focus:ring-2 outline-none transition-all font-bold text-neutral-900",
                  error?.field === 'cidade' ? "border-red-400 ring-red-100 bg-red-50" : "border-neutral-200 focus:ring-orange-500"
                )}
                placeholder="EX: SÃO PAULO"
              />
            </div>
          </div>

          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-4 bg-neutral-100 text-neutral-700 rounded-2xl font-black uppercase tracking-widest text-xs hover:bg-neutral-200 transition-all"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 py-4 bg-orange-600 text-white rounded-2xl font-black uppercase tracking-widest text-xs hover:bg-orange-700 transition-all shadow-lg shadow-orange-200 flex items-center justify-center gap-2 disabled:opacity-50"
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

