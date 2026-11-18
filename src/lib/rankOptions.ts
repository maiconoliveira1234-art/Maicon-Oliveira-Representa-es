const fold = (value: string) =>
  value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR').replace(/\s+/g, ' ').trim();

/** Busca enquanto digita: ignora acento e maiusculas, aceita as palavras em qualquer ordem e mostra
 *  primeiro o que comeca com o texto, depois palavras que comecam com ele, depois o que apenas contem.
 *  Sem nenhum resultado, tenta letras na sequencia (ex.: "rcfcl" encontra "Racao Facil"). */
export function rankOptions<T extends { label: string }>(options: T[], query: string): T[] {
  const q = fold(query);
  if (!q) return options;
  const tokens = q.split(' ');
  const scored: Array<{ option: T; score: number; index: number }> = [];
  options.forEach((option, index) => {
    const label = fold(option.label);
    const words = label.split(/[^a-z0-9]+/).filter(Boolean);
    if (!tokens.every(token => label.includes(token))) return;
    const score = label.startsWith(q) ? 0
      : tokens.every(token => words.some(word => word.startsWith(token))) ? 1 : 2;
    scored.push({ option, score, index });
  });
  if (scored.length) return scored.sort((a, b) => a.score - b.score || a.index - b.index).map(x => x.option);
  const compact = q.replace(/ /g, '');
  return options.filter(option => {
    let at = 0;
    for (const ch of fold(option.label)) if (ch === compact[at]) at += 1;
    return at === compact.length;
  });
}
