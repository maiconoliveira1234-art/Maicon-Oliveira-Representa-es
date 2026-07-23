export type AgendaPendenciaTipo = 'VISITA_EXTRA' | 'TAREFA';
export type AgendaPendenciaPrioridade = 'NORMAL' | 'ALTA' | 'URGENTE';
export type AgendaPendenciaStatus = 'PENDENTE' | 'EM_ANDAMENTO' | 'CONCLUIDA' | 'CANCELADA';

export interface AgendaPendencia {
  id: string;
  tipo: AgendaPendenciaTipo;
  titulo: string;
  descricao: string | null;
  cliente_id: string | null;
  data_prevista: string | null;
  horario_inicio: string | null;
  horario_fim: string | null;
  dia_inteiro: boolean;
  prioridade: AgendaPendenciaPrioridade;
  status: AgendaPendenciaStatus;
  ordem_dia: number;
  lembrete_em: string | null;
  concluida_em: string | null;
  cancelada_em: string | null;
  created_at: string;
  updated_at: string;
}

export type AgendaPendenciaInput = Pick<
  AgendaPendencia,
  'tipo' | 'titulo' | 'descricao' | 'cliente_id' | 'data_prevista' | 'horario_inicio' | 'horario_fim' | 'dia_inteiro' | 'prioridade'
>;
