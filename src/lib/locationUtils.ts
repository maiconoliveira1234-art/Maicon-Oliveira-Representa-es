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
 */
export function clusterByLocation<T extends { latitude?: number; longitude?: number }>(
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

  // 1. Inicializar centroides espalhados (K-Means++)
  let centroids: { lat: number; lng: number }[] = [];
  centroids.push({ lat: withCoords[0].latitude!, lng: withCoords[0].longitude! });

  while (centroids.length < k && centroids.length < withCoords.length) {
    let maxDist = -1;
    let nextIdx = 0;
    withCoords.forEach((item, idx) => {
      const minDist = Math.min(...centroids.map(c => 
        calculateDistance(item.latitude!, item.longitude!, c.lat, c.lng)
      ));
      if (minDist > maxDist) {
        maxDist = minDist;
        nextIdx = idx;
      }
    });
    centroids.push({ lat: withCoords[nextIdx].latitude!, lng: withCoords[nextIdx].longitude! });
  }

  while (centroids.length < k) {
    centroids.push({ lat: -26.3045, lng: -48.8456 });
  }

  // 2. Atribuição Equilibrada (Balanced Assignment)
  const targetSize = Math.ceil(withCoords.length / k);
  let clusters: T[][] = Array.from({ length: k }, () => []);

  // Calcular preferências de cada ponto
  const preferences = withCoords.map(item => {
    const dists = centroids.map((c, idx) => ({
      idx,
      dist: calculateDistance(item.latitude!, item.longitude!, c.lat, c.lng)
    })).sort((a, b) => a.dist - b.dist);
    return { item, dists };
  });

  // Ordenar por "Arrependimento" (Regret): diferença entre a 1ª e 2ª melhor opção
  // Quem tem maior diferença é priorizado (pois mudar de grupo custa mais geográficamente)
  preferences.sort((a, b) => {
    const diffA = (a.dists[1]?.dist || 0) - a.dists[0].dist;
    const diffB = (b.dists[1]?.dist || 0) - b.dists[0].dist;
    return diffB - diffA;
  });

  // Atribuição com limites de tamanho
  preferences.forEach(p => {
    let assigned = false;
    for (const d of p.dists) {
      if (clusters[d.idx].length < targetSize) {
        clusters[d.idx].push(p.item);
        assigned = true;
        break;
      }
    }
    
    // Fallback caso todos estejam cheios (devido ao arredondamento do targetSize)
    if (!assigned) {
      const smallestClusterIdx = clusters.reduce((minIdx, curr, idx, arr) => 
        curr.length < arr[minIdx].length ? idx : minIdx, 0);
      clusters[smallestClusterIdx].push(p.item);
    }
  });

  // 3. Distribuir itens sem coordenadas
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
