import React, { useState } from 'react';
import { X, Save, Loader2, UserPlus } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { cn } from '../lib/utils';

interface NewClientModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function NewClientModal({ isOpen, onClose, onSuccess }: NewClientModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    cliente: '',
    dia_visita: 1,
    cidade: '',
    ativo: true
  });

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      // Validation
      if (!formData.cliente.trim()) throw new Error('O nome do cliente é obrigatório.');
      if (!formData.cidade.trim()) throw new Error('A cidade é obrigatória.');

      const { error: insertError } = await supabase
        .from('clientes')
        .insert([{
          cliente: formData.cliente,
          dia_visita: formData.dia_visita,
          cidade: formData.cidade,
          ativo: formData.ativo
        }]);

      if (insertError) throw insertError;

      onSuccess();
      onClose();
      // Reset form
      setFormData({
        cliente: '',
        dia_visita: 1,
        cidade: '',
        ativo: true
      });
    } catch (err: any) {
      console.error('Erro ao cadastrar cliente:', err);
      setError(err.message || 'Ocorreu um erro ao cadastrar o cliente.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-white w-full max-w-lg rounded-3xl shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200">
        <div className="flex items-center justify-between p-6 border-b border-neutral-100">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-orange-100 text-orange-600 rounded-xl">
              <UserPlus size={24} />
            </div>
            <h2 className="text-xl font-black text-neutral-900 tracking-tight">Novo Cliente</h2>
          </div>
          <button 
            onClick={onClose}
            className="p-2 hover:bg-neutral-100 rounded-full transition-colors text-neutral-400 hover:text-neutral-600"
          >
            <X size={24} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-100 text-red-600 p-4 rounded-2xl text-sm font-medium flex items-center gap-2">
              <div className="w-1.5 h-1.5 bg-red-600 rounded-full" />
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5 md:col-span-2">
              <label className="text-[10px] font-black text-neutral-400 uppercase tracking-widest ml-1">Nome do Cliente</label>
              <input
                required
                type="text"
                value={formData.cliente}
                onChange={(e) => setFormData({ ...formData, cliente: e.target.value })}
                className="w-full px-4 py-3 bg-neutral-50 border border-neutral-200 rounded-2xl focus:ring-2 focus:ring-orange-500 outline-none transition-all font-bold text-neutral-900"
                placeholder="Ex: Supermercado Exemplo"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-[10px] font-black text-neutral-400 uppercase tracking-widest ml-1">Cidade</label>
              <input
                required
                type="text"
                value={formData.cidade}
                onChange={(e) => setFormData({ ...formData, cidade: e.target.value })}
                className="w-full px-4 py-3 bg-neutral-50 border border-neutral-200 rounded-2xl focus:ring-2 focus:ring-orange-500 outline-none transition-all font-bold text-neutral-900"
                placeholder="Ex: São Paulo"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-[10px] font-black text-neutral-400 uppercase tracking-widest ml-1">Dia de Visita</label>
              <input
                required
                type="number"
                min="1"
                max="31"
                value={formData.dia_visita}
                onChange={(e) => setFormData({ ...formData, dia_visita: parseInt(e.target.value) })}
                className="w-full px-4 py-3 bg-neutral-50 border border-neutral-200 rounded-2xl focus:ring-2 focus:ring-orange-500 outline-none transition-all font-bold text-neutral-900"
              />
            </div>

            <div className="md:col-span-2 flex items-center justify-between p-4 bg-neutral-50 rounded-2xl border border-neutral-200">
              <div className="space-y-0.5">
                <p className="text-sm font-bold text-neutral-900">Cliente Ativo</p>
                <p className="text-[10px] text-neutral-500 font-medium">Define se o cliente aparecerá nas listas principais</p>
              </div>
              <button
                type="button"
                onClick={() => setFormData({ ...formData, ativo: !formData.ativo })}
                className={cn(
                  "w-12 h-6 rounded-full transition-all relative",
                  formData.ativo ? "bg-orange-500" : "bg-neutral-300"
                )}
              >
                <div className={cn(
                  "absolute top-1 w-4 h-4 bg-white rounded-full transition-all",
                  formData.ativo ? "left-7" : "left-1"
                )} />
              </button>
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
              Salvar Cliente
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
