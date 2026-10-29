export function paginateQuoteItems<T extends { tipo_operacao?: string }>(
  items: T[], observations = ''
): T[][] {
  const hasObs = observations.trim().length > 0;
  const isLongObs = observations.trim().length > 80;
  const bonusSpace = items.some(item => item.tipo_operacao === 'BONIFICACAO_COMERCIAL') ? 2 : 0;
  const singleLimit = 20 - (hasObs ? 1 : 0) - (isLongObs ? 2 : 0) - bonusSpace;
  const firstLimit = 26 - bonusSpace;
  const middleLimit = 30 - bonusSpace;
  const lastLimit = 20 - (hasObs ? 2 : 0) - (isLongObs ? 2 : 0) - bonusSpace;

  if (items.length <= singleLimit) return [items];

  const chunks: T[][] = [];
  let remaining = [...items];
  if (remaining.length <= firstLimit + lastLimit) {
    const firstCount = Math.min(firstLimit, Math.max(1, remaining.length - Math.min(8, lastLimit)));
    chunks.push(remaining.slice(0, firstCount));
    chunks.push(remaining.slice(firstCount));
    return chunks;
  }

  chunks.push(remaining.slice(0, firstLimit));
  remaining = remaining.slice(firstLimit);
  while (remaining.length > middleLimit + lastLimit) {
    chunks.push(remaining.slice(0, middleLimit));
    remaining = remaining.slice(middleLimit);
  }
  if (remaining.length > lastLimit) {
    const middleCount = Math.min(middleLimit, remaining.length - Math.min(8, lastLimit));
    chunks.push(remaining.slice(0, middleCount));
    remaining = remaining.slice(middleCount);
  }
  chunks.push(remaining);
  return chunks;
}
