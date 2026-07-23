import { supabase } from '../lib/supabase';
import { AgendaPendencia, AgendaPendenciaInput, AgendaPendenciaStatus } from '../types/agendaPendencia';

export const agendaPendenciaService = {
  async list() {
    const { data, error } = await supabase
      .from('agenda_pendencias')
      .select('*')
      .order('data_prevista', { ascending: true, nullsFirst: false })
      .order('horario_inicio', { ascending: true, nullsFirst: false })
      .order('ordem_dia', { ascending: true });

    if (error) throw error;
    return (data || []) as AgendaPendencia[];
  },

  async create(input: AgendaPendenciaInput) {
    const { data, error } = await supabase
      .from('agenda_pendencias')
      .insert(input)
      .select()
      .single();

    if (error) throw error;
    return data as AgendaPendencia;
  },

  async update(id: string, input: Partial<AgendaPendenciaInput>) {
    const { data, error } = await supabase
      .from('agenda_pendencias')
      .update(input)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return data as AgendaPendencia;
  },

  async updateStatus(id: string, status: AgendaPendenciaStatus) {
    const { data, error } = await supabase
      .from('agenda_pendencias')
      .update({ status })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return data as AgendaPendencia;
  }
};
