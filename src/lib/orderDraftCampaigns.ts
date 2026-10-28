/** Campaign approval belongs to the order, even when another screen rebuilds its items. */
export function readDraftCampaigns(items: unknown): string[] {
  if (!Array.isArray(items)) return [];
  return [...new Set(items.flatMap(item =>
    Array.isArray(item?.campanhas_aplicadas)
      ? item.campanhas_aplicadas.filter((id: unknown): id is string => typeof id === 'string' && id.length > 0)
      : []
  ))] as string[];
}

export function withDraftCampaigns<T extends object>(items: T[], approved: string[]) {
  return items.map((item, index) => {
    const { campanhas_aplicadas: _old, ...rest } = item as T & { campanhas_aplicadas?: unknown };
    return { ...rest, ...(index === 0 ? { campanhas_aplicadas: [...approved] } : {}) };
  });
}

/** A delayed server response must not replace a newer local campaign selection. */
export function localDraftIsNewer(local: { updatedAt?: string } | null, serverUpdatedAt?: string): boolean {
  const localTime = Date.parse(local?.updatedAt || '');
  const serverTime = Date.parse(serverUpdatedAt || '');
  return Number.isFinite(localTime) && (!Number.isFinite(serverTime) || localTime >= serverTime);
}
