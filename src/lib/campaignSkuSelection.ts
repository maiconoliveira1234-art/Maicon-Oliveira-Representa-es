/** Mantém a seleção de SKUs ordenada e sem repetições. */
export function addCampaignSkuIds(current: string[], ids: string[]): string[] {
  return [...new Set([...current, ...ids].filter(Boolean))];
}

export function toggleCampaignSkuId(current: string[], id: string): string[] {
  return current.includes(id) ? current.filter(x => x !== id) : addCampaignSkuIds(current, [id]);
}
