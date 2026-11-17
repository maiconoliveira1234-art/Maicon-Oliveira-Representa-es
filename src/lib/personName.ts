const CONNECTORS = new Set(['da', 'de', 'di', 'do', 'das', 'dos', 'e']);

/** "MARIA DA SILVA" -> "Maria da Silva": so a inicial de cada nome em maiuscula. */
export function formatPersonName(raw?: string | null): string {
  const text = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (!text || /^(undefined|null)$/i.test(text)) return '';
  return text.toLocaleLowerCase('pt-BR').split(' ').map((word, index) => {
    if (index > 0 && CONNECTORS.has(word)) return word;
    // Inicial depois de hifen ou apostrofo tambem (ex.: "Ana-Clara", "D'Avila").
    return word.replace(/(^|[-'])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toLocaleUpperCase('pt-BR'));
  }).join(' ');
}
