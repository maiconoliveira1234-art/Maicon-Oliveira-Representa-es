export type AgendaNoteAlertLevel = 'note' | 'attention' | 'pending';

const LEVEL_PREFIX: Record<AgendaNoteAlertLevel, string> = {
  note: 'Nota:',
  attention: 'Atenção:',
  pending: 'Pendência:'
};

const normalize = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

const stripLevelPrefix = (note: string) =>
  note.replace(/^\s*(nota|atencao|atenção|pendencia|pendência)\s*:\s*/i, '').trim();

export function getAgendaNoteAlert(note?: string | null) {
  const raw = (note || '').trim();
  if (!raw) return null;

  const normalized = normalize(raw);
  const level: AgendaNoteAlertLevel = normalized.startsWith('pendencia:')
    ? 'pending'
    : normalized.startsWith('atencao:')
      ? 'attention'
      : 'note';

  return {
    level,
    label: LEVEL_PREFIX[level].replace(':', ''),
    text: stripLevelPrefix(raw)
  };
}

export function applyAgendaNoteAlertLevel(note: string, level: AgendaNoteAlertLevel) {
  const text = stripLevelPrefix(note);
  return `${LEVEL_PREFIX[level]} ${text}`.trim();
}
