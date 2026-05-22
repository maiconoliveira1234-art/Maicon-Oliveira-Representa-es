/**
 * Utilitários para Geolocalização e Otimização de Rotas
 */

/**
 * Calcula a distância entre dois pontos usando a fórmula de Haversine (em KM)
 */
export function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Raio da Terra em km
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) *
      Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Ordena uma lista de itens por proximidade a um ponto de referência
 */
export function sortByProximity<T extends { latitude?: number; longitude?: number }>(
  items: T[],
  refLat: number,
  refLon: number
): T[] {
  return [...items].sort((a, b) => {
    if (!a.latitude || !a.longitude) return 1;
    if (!b.latitude || !b.longitude) return -1;

    const distA = calculateDistance(refLat, refLon, a.latitude, a.longitude);
    const distB = calculateDistance(refLat, refLon, b.latitude, b.longitude);

    return distA - distB;
  });
}

/**
 * Agrupa itens em clusters equilibrados geograficamente (K-Means com restrição de tamanho)
 * Otimizado para agrupar bairros idênticos/adjacentes nos dias de Seg-Qua e alocar isolados na Quinta.
 */
export function clusterByLocation<T extends { id?: string; latitude?: number; longitude?: number; bairro?: string }>(
  items: T[],
  k: number 
): T[][] {
  if (items.length === 0) return Array.from({ length: k }, () => []);
  if (items.length <= k) return items.map(item => [item]);

  const withCoords = items.filter(i => i.latitude && i.longitude);
  const withoutCoords = items.filter(i => !i.latitude || !i.longitude);

  if (withCoords.length === 0) {
    const clusters: T[][] = Array.from({ length: k }, () => []);
    items.forEach((item, idx) => clusters[idx % k].push(item));
    return clusters;
  }

  // Tamanho ideal por dia
  const targetSize = Math.ceil(items.length / k);

  // --- FASE 1: Identificar Clientes Isolados ---
  // Calculamos um score de isolamento: distância média para os 2 vizinhos mais próximos.
  // Também consideramos o bairro: se o cliente for único no seu bairro, ganha um "bônus" de isolamento.
  const bairroCounts: { [key: string]: number } = {};
  withCoords.forEach(item => {
    const b = (item.bairro || '').trim().toLowerCase();
    if (b) {
      bairroCounts[b] = (bairroCounts[b] || 0) + 1;
    }
  });

  const clientsWithIsolation = withCoords.map(item => {
    const itemBairro = (item.bairro || '').trim().toLowerCase();
    
    // Distâncias para todos os outros
    const dists = withCoords
      .filter(other => (other as any).id !== (item as any).id)
      .map(other => calculateDistance(item.latitude!, item.longitude!, other.latitude!, other.longitude!))
      .sort((a, b) => a - b);

    // Média das duas menores distâncias (ou menor distância se só houver uma)
    let avgNearDist = dists.length > 0 ? dists[0] : Infinity;
    if (dists.length > 1) {
      avgNearDist = (dists[0] + dists[1]) / 2;
    }

    // Se o cliente for o único no bairro, adicionamos peso de isolamento
    const isOnlyClientInBairro = itemBairro ? (bairroCounts[itemBairro] || 1) === 1 : true;
    const isolationScore = avgNearDist + (isOnlyClientInBairro ? 1.5 : 0);

    return {
      item,
      avgNearDist,
      isOnlyClientInBairro,
      isolationScore
    };
  });

  // Ordenar decrescente pelo score de isolamento
  clientsWithIsolation.sort((a, b) => b.isolationScore - a.isolationScore);

  // Limite máximo de clientes isolados nas quintas (slots 3 e 7) para evitar superlotação
  const maxThursdayQty = Math.min(2 * targetSize, Math.floor(withCoords.length * 0.35));

  // Um cliente é elegível como isolado se a distância para os vizinhos for grande (> 2.0 km)
  // ou se for único no bairro e a distância for superior a 1.2 km
  const isolatedCandidates = clientsWithIsolation.filter(c => 
    c.avgNearDist > 2.0 || (c.isOnlyClientInBairro && c.avgNearDist > 1.2)
  );

  const isolatedItems = isolatedCandidates.slice(0, maxThursdayQty).map(c => c.item);
  const isolatedIds = new Set(isolatedItems.map(i => (i as any).id));
  const groupedItems = withCoords.filter(i => !isolatedIds.has((i as any).id));

  // Inicializar clusters (0 a 7)
  let clusters: T[][] = Array.from({ length: k }, () => []);

  // --- FASE 2: Distribuir Clientes Isolados Preferencialmente na Quinta-Feira (Slots 3 e 7) ---
  if (isolatedItems.length > 0) {
    if (isolatedItems.length === 1) {
      clusters[3].push(isolatedItems[0]);
    } else {
      // Para agrupar os isolados geograficamente na Quinta Sem 1 e Quinta Sem 2, rodamos um 2-Means simples
      const c1 = isolatedItems[0];
      const c2 = isolatedItems[isolatedItems.length - 1];
      let lat1 = c1.latitude!, lon1 = c1.longitude!;
      let lat2 = c2.latitude!, lon2 = c2.longitude!;

      const isolatedGroup1: T[] = [];
      const isolatedGroup2: T[] = [];

      isolatedItems.forEach(item => {
        const d1 = calculateDistance(item.latitude!, item.longitude!, lat1, lon1);
        const d2 = calculateDistance(item.latitude!, item.longitude!, lat2, lon2);
        if (d1 < d2) {
          isolatedGroup1.push(item);
        } else {
          isolatedGroup2.push(item);
        }
      });

      // Quinta-Feira Semana 1 (Slot 3) e Quinta-Feira Semana 2 (Slot 7)
      clusters[3] = isolatedGroup1;
      clusters[7] = isolatedGroup2;
    }
  }

  // --- FASE 3: Distribuir Clientes Agrupados no restante dos dias (0=Seg1, 1=Ter1, 2=Qua1, 4=Seg2, 5=Ter2, 6=Qua2) ---
  const remainingSlots = [0, 1, 2, 4, 5, 6];
  const kr = remainingSlots.length; // 6 slots

  if (groupedItems.length > 0) {
    // 1. Inicializar centroides para os 6 dias de início usando K-Means++
    let centroids: { lat: number; lng: number }[] = [];
    centroids.push({ lat: groupedItems[0].latitude!, lng: groupedItems[0].longitude! });

    while (centroids.length < kr && centroids.length < groupedItems.length) {
      let maxDist = -1;
      let nextIdx = 0;
      groupedItems.forEach((item, idx) => {
        const minDist = Math.min(...centroids.map(c => 
          calculateDistance(item.latitude!, item.longitude!, c.lat, c.lng)
        ));
        if (minDist > maxDist) {
          maxDist = minDist;
          nextIdx = idx;
        }
      });
      centroids.push({ lat: groupedItems[nextIdx].latitude!, lng: groupedItems[nextIdx].longitude! });
    }

    while (centroids.length < kr) {
      centroids.push({ lat: -26.3045, lng: -48.8456 });
    }

    // 2. Mapear bairro dominante para cada centroid (baseado no item mais próximo)
    const centroidBairros = centroids.map((c) => {
      let nearestItem: T | null = null;
      let minDist = Infinity;
      groupedItems.forEach(item => {
        const d = calculateDistance(item.latitude!, item.longitude!, c.lat, c.lng);
        if (d < minDist) {
          minDist = d;
          nearestItem = item;
        }
      });
      return nearestItem ? ((nearestItem as any).bairro || '').trim().toLowerCase() : '';
    });

    // 3. Atribuição com desconto de Bairro (para fundir bairros idênticos/próximos no mesmo dia)
    const preferences = groupedItems.map(item => {
      const itemBairro = (item.bairro || '').trim().toLowerCase();
      
      const dists = centroids.map((c, idx) => {
        const realDist = calculateDistance(item.latitude!, item.longitude!, c.lat, c.lng);
        const cBairro = centroidBairros[idx];
        const isSameBairro = itemBairro && cBairro && itemBairro === cBairro;
        // Aplica o desconto virtual de proximidade de 30% caso seja o mesmo bairro para favorecer o mesmo dia
        const virtualDist = isSameBairro ? realDist * 0.7 : realDist;

        return {
          idx: remainingSlots[idx],
          dist: virtualDist,
          realDist: realDist
        };
      }).sort((a, b) => a.dist - b.dist);

      return { item, dists };
    });

    // Ordenar preferências pelo Regret (Arrependimento) geográfico para decisões cruciais primeiro
    preferences.sort((a, b) => {
      const diffA = (a.dists[1]?.dist || 0) - a.dists[0].dist;
      const diffB = (b.dists[1]?.dist || 0) - b.dists[0].dist;
      return diffB - diffA;
    });

    // Atribuição equilibrada
    const maxGroupedSize = Math.ceil(groupedItems.length / kr);
    preferences.forEach(p => {
      let assigned = false;
      for (const d of p.dists) {
        if (clusters[d.idx].length < maxGroupedSize) {
          clusters[d.idx].push(p.item);
          assigned = true;
          break;
        }
      }
      
      if (!assigned) {
        const smallestSlot = remainingSlots.reduce((minSlot, currSlot) => 
          clusters[currSlot].length < clusters[minSlot].length ? currSlot : minSlot, remainingSlots[0]);
        clusters[smallestSlot].push(p.item);
      }
    });
  }

  // --- FASE 4: Backfill balanceador de capacidade para as Quintas-Feiras ---
  // Se houverem pouquíssimos ou nenhum cliente isolado original, as quintas ficam em branco.
  // Movemos os clientes mais afastados das terças/quartas para preencher as quintas de forma equilibrada.
  const minThursdaySize = Math.max(1, Math.floor(targetSize * 0.6));
  
  const balanceThursday = (slotIdx: number) => {
    while (clusters[slotIdx].length < minThursdaySize) {
      const busiestSlot = remainingSlots.reduce((maxSlot, currSlot) => 
        clusters[currSlot].length > clusters[maxSlot].length ? currSlot : maxSlot, remainingSlots[0]);
      
      if (clusters[busiestSlot].length <= minThursdaySize) {
        break;
      }

      const clusterData = clusters[busiestSlot];
      if (clusterData.length === 0) break;

      // Pegar o cliente mais periférico do cluster cheio
      const avgLat = clusterData.reduce((sum, v) => sum + (v.latitude || 0), 0) / clusterData.length;
      const avgLon = clusterData.reduce((sum, v) => sum + (v.longitude || 0), 0) / clusterData.length;

      let farthestIdx = 0;
      let maxDist = -1;
      clusterData.forEach((item, idx) => {
        if (item.latitude && item.longitude) {
          const d = calculateDistance(item.latitude, item.longitude, avgLat, avgLon);
          if (d > maxDist) {
            maxDist = d;
            farthestIdx = idx;
          }
        }
      });

      const movedItem = clusters[busiestSlot].splice(farthestIdx, 1)[0];
      clusters[slotIdx].push(movedItem);
    }
  };

  balanceThursday(3);
  balanceThursday(7);

  // --- FASE 5: Distribuir itens sem coordenadas (distribuição sequencial) ---
  withoutCoords.forEach((item, idx) => {
    clusters[idx % k].push(item);
  });

  return clusters;
}

/**
 * Resolve o Problema do Caixeiro Viajante (TSP) de forma gulosa (Vizinho Mais Próximo)
 */
export function solveGreedyTSP<T extends { latitude?: number; longitude?: number }>(
  items: T[],
  startLat: number,
  startLon: number
): T[] {
  const unvisited = [...items];
  const ordered: T[] = [];
  
  let currentLat = startLat;
  let currentLon = startLon;

  while (unvisited.length > 0) {
    let nearestIdx = -1;
    let minDistance = Infinity;

    for (let i = 0; i < unvisited.length; i++) {
      const item = unvisited[i];
      if (!item.latitude || !item.longitude) {
        // Se não tem coordenada, joga pro fim ou pula
        continue;
      }

      const dist = calculateDistance(currentLat, currentLon, item.latitude, item.longitude);
      if (dist < minDistance) {
        minDistance = dist;
        nearestIdx = i;
      }
    }

    if (nearestIdx === -1) {
      // Nenhum item restante tem coordenadas válidas
      ordered.push(...unvisited);
      break;
    }

    const nextItem = unvisited.splice(nearestIdx, 1)[0];
    ordered.push(nextItem);
    currentLat = nextItem.latitude!;
    currentLon = nextItem.longitude!;
  }

  return ordered;
}
