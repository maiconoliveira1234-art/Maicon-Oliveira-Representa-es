import { AgendaPendencia } from '../types/agendaPendencia';

export function isAgendaPendenciaAtiva(item: AgendaPendencia) {
  return item.status !== 'CONCLUIDA' && item.status !== 'CANCELADA';
}

export function sortAgendaPendencias(items: AgendaPendencia[]) {
  const priority = { URGENTE: 0, ALTA: 1, NORMAL: 2 };
  return [...items].sort((a, b) =>
    priority[a.prioridade] - priority[b.prioridade]
    || (a.data_prevista || '9999-12-31').localeCompare(b.data_prevista || '9999-12-31')
    || (a.horario_inicio || '99:99').localeCompare(b.horario_inicio || '99:99')
    || a.ordem_dia - b.ordem_dia
  );
}
