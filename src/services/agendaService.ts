import { supabase } from '../lib/supabase';
import { Visita, VisitaStatus } from '../types/agenda';

export const agendaService = {
  async getVisitas() {
    const { data, error } = await supabase
      .from('agenda_visitas')
      .select('*')
      .order('semana', { ascending: true })
      .order('dia_semana', { ascending: true })
      .order('horario_inicio', { ascending: true })
      .order('ordem_visita', { ascending: true });

    if (error) throw error;
    return data as Visita[];
  },

  async updateStatus(id: string, status: VisitaStatus) {
    const { data, error } = await supabase
      .from('agenda_visitas')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return data as Visita;
  },

  async updateObservacoes(id: string, observacoes: string) {
    const { data, error } = await supabase
      .from('agenda_visitas')
      .update({ observacoes, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return data as Visita;
  },

  async deleteVisita(id: string) {
    const { error } = await supabase
      .from('agenda_visitas')
      .delete()
      .eq('id', id);

    if (error) throw error;
  }
};
