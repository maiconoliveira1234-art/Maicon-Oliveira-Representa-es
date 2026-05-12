export type VisitaStatus = 'pendente' | 'concluida' | 'reagendada' | 'cancelada';
export type DiaSemana = 'Segunda' | 'Terça' | 'Quarta' | 'Quinta' | 'Sexta';

export interface Visita {
  id: string;
  cliente_id?: string;
  cliente_nome: string;
  contato: string;
  telefone: string;
  endereco: string;
  bairro: string;
  cidade: string;
  semana: 1 | 2;
  dia_semana: DiaSemana;
  horario_inicio: string;
  horario_fim: string;
  ordem_visita: number;
  status: VisitaStatus;
  observacoes: string;
  created_at: string;
  updated_at: string;
}

export type NewVisita = Omit<Visita, 'id' | 'created_at' | 'updated_at'>;
