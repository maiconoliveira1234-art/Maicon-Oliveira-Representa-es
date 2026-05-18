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
 * Agrupa itens em clusters baseados em proximidade geográfica
 * Útil para dividir clientes entre os dias da semana (K-Means simplificado)
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
    // Se nenhum tem coordenada, distribui rounds-robin
    const clusters: T[][] = Array.from({ length: k }, () => []);
    items.forEach((item, idx) => clusters[idx % k].push(item));
    return clusters;
  }

  // 1. Inicializar centroides de forma mais espalhada (K-Means++)
  let centroids = [];
  
  if (withCoords.length > 0) {
    // Primeiro centroide aleatório
    centroids.push({ lat: withCoords[0].latitude!, lng: withCoords[0].longitude! });

    // Encontrar os próximos centroides mais distantes dos já escolhidos
    while (centroids.length < k && centroids.length < withCoords.length) {
      let maxDist = -1;
      let nextCentroidIdx = 0;

      withCoords.forEach((item, idx) => {
        // Encontra a distância para o centroide mais próximo já escolhido
        let minDistToCentroids = Math.min(...centroids.map(c => 
          calculateDistance(item.latitude!, item.longitude!, c.lat, c.lng)
        ));

        if (minDistToCentroids > maxDist) {
          maxDist = minDistToCentroids;
          nextCentroidIdx = idx;
        }
      });

      centroids.push({ lat: withCoords[nextCentroidIdx].latitude!, lng: withCoords[nextCentroidIdx].longitude! });
    }
  }

  // Preencher se sobrar k vazio
  while (centroids.length < k) {
    centroids.push({ lat: -26.3045, lng: -48.8456 }); // Joinville default
  }

  let clusters: T[][] = Array.from({ length: k }, () => []);
  let prevAssignments: string = '';

  // 2. Iterar para refinar clusters (aumentado para 20 vezes)
  for (let iter = 0; iter < 20; iter++) {
    clusters = Array.from({ length: k }, () => []);
    const assignments: number[] = [];

    withCoords.forEach(item => {
      let minDist = Infinity;
      let clusterIdx = 0;

      centroids.forEach((c, idx) => {
        const d = calculateDistance(item.latitude!, item.longitude!, c.lat, c.lng);
        if (d < minDist) {
          minDist = d;
          clusterIdx = idx;
        }
      });

      clusters[clusterIdx].push(item);
      assignments.push(clusterIdx);
    });

    const currentAssignments = assignments.join(',');
    if (currentAssignments === prevAssignments) break;
    prevAssignments = currentAssignments;

    // 3. Atualizar centroides
    centroids = clusters.map((cluster, idx) => {
      if (cluster.length === 0) return centroids[idx]; // Mantém se vazio
      return {
        lat: cluster.reduce((sum, i) => sum + i.latitude!, 0) / cluster.length,
        lng: cluster.reduce((sum, i) => sum + i.longitude!, 0) / cluster.length
      };
    });
  }

  // Distribuir itens sem coordenadas proporcionalmente
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
