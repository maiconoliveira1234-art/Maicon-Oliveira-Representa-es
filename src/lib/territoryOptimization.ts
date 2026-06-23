import { supabase } from './supabase';
import { calculateDistance, solveGreedyTSP } from './locationUtils';
import { Visita, DiaSemana } from '../types/agenda';

const DIAS_UTEIS: DiaSemana[] = ['Segunda', 'Terça', 'Quarta', 'Quinta'];

export async function optimizeAllTerritories() {
  console.log('[GLOBAL_OPT] Iniciando otimização global de território respeitando Agenda Fixa e proporção 2:2:2:1...');

  // 1. Sincronizar Clientes Ativos com a Agenda
  console.log('[GLOBAL_OPT] Sincronizando clientes ativos...');
  const { data: activeClients, error: clientError } = await supabase
    .from('clientes')
    .select('*')
    .eq('ativo', true);

  if (clientError) throw new Error(`Erro ao buscar clientes ativos: ${clientError.message}`);

  const { data: existingVisits, error: visitError } = await supabase
    .from('agenda_visitas')
    .select('cliente_id');

  if (visitError) throw new Error(`Erro ao buscar visitas existentes: ${visitError.message}`);

  const existingClientIds = new Set(existingVisits.map(v => v.cliente_id));
  const missingClients = activeClients.filter(c => !existingClientIds.has(c.id));

  if (missingClients.length > 0) {
    console.log(`[GLOBAL_OPT] Adicionando ${missingClients.length} clientes ativos à agenda...`);
    const newVisits = missingClients.map(c => ({
      cliente_id: c.id,
      cliente_nome: c.cliente,
      contato: c.contato || '',
      telefone: c.telefone ? String(c.telefone) : '',
      endereco: c.endereco || '',
      bairro: c.bairro || '',
      cidade: c.cidade || '',
      latitude: c.latitude,
      longitude: c.longitude,
      semana: 1,
      dia_semana: 'Segunda',
      horario_inicio: '08:00',
      horario_fim: '09:00',
      ordem_visita: 1,
      status: 'pendente'
    }));

    const { error: insertError } = await supabase
      .from('agenda_visitas')
      .insert(newVisits);

    if (insertError) throw new Error(`Erro ao inserir novos clientes na agenda: ${insertError.message}`);
  }

  // 2. Buscar visitas atualizadas e garantir que temos as coordenadas
  const { data: visitasRaw, error } = await supabase
    .from('agenda_visitas')
    .select('*, clientes(latitude, longitude, ativo, agenda_fixa)');

  if (error) {
    console.error('[GLOBAL_OPT] Erro na consulta Supabase:', error);
    throw new Error(`Erro ao buscar visitas: ${error.message}`);
  }

  if (!visitasRaw || visitasRaw.length === 0) {
    throw new Error('Nenhuma visita encontrada na agenda para otimizar.');
  }

  // Filtrar apenas clientes ativos e normalizar coordenadas e flag agenda_fixa
  const visitas = visitasRaw
    .filter((v: any) => {
      const clientData = Array.isArray(v.clientes) ? v.clientes[0] : v.clientes;
      return clientData && clientData.ativo !== false;
    })
    .map((v: any) => {
      const clientData = Array.isArray(v.clientes) ? v.clientes[0] : v.clientes;
      
      return {
        ...v,
        latitude: v.latitude || clientData?.latitude,
        longitude: v.longitude || clientData?.longitude,
        agenda_fixa: clientData?.agenda_fixa ?? false
      };
    }) as Visita[];

  const countWithCoords = visitas.filter(v => v.latitude && v.longitude).length;
  console.log(`[GLOBAL_OPT] Total de visitas ativas: ${visitas.length}, Com Coordenadas: ${countWithCoords}`);

  if (countWithCoords === 0) {
    throw new Error('Nenhuma visita possui coordenadas. Rode o botão "Iniciar" da Geocodificação primeiro!');
  }

  // 3. Separar visitas em FIXAS e NÃO FIXAS
  const fixedVisits = visitas.filter(v => v.agenda_fixa === true);
  const nonFixedVisits = visitas.filter(v => v.agenda_fixa !== true);

  console.log(`[GLOBAL_OPT] Clientes com Agenda Fixa (Prioridade 1): ${fixedVisits.length}`);
  console.log(`[GLOBAL_OPT] Clientes para Otimização: ${nonFixedVisits.length}`);

  // Helpers para manipulação de slots (0 a 7)
  const getSlotWeekAndDay = (s: number) => {
    const isWeek2 = s >= 4;
    const weekNum: 1 | 2 = isWeek2 ? 2 : 1;
    const diaIdx = s % 4;
    return { weekNum, dia: DIAS_UTEIS[diaIdx] };
  };

  const getSlotIndex = (weekNum: 1 | 2, dia: DiaSemana) => {
    const weekBase = weekNum === 2 ? 4 : 0;
    const diaIdx = DIAS_UTEIS.indexOf(dia);
    return diaIdx !== -1 ? weekBase + diaIdx : -1;
  };

  // 4. Otimização Baseada em Local Search (Hill Climbing) com Função de Custo
  // Este algoritmo parte da agenda atual e faz swaps/movimentos incrementais de visitas não-fixas
  // para minimizar o custo que penaliza desvios de semanas, proporção 2:2:2:1 e dispersão geográfica (distância ao centroide).
  
  // Inicializa o mapa de designação de slots a partir dos valores do banco
  const assignment = new Map<string, number>();
  for (const v of visitas) {
    let slotIdx = getSlotIndex(v.semana, v.dia_semana);
    if (slotIdx === -1) slotIdx = 0; // fallback se nulo
    assignment.set(v.id, slotIdx);
  }

  // Função auxiliar para calcular o custo total de uma configuração
  const calculateTotalCost = (currAssignment: Map<string, number>) => {
    const slotVisits: Visita[][] = Array.from({ length: 8 }, () => []);
    
    for (const v of visitas) {
      const slotIdx = currAssignment.get(v.id)!;
      slotVisits[slotIdx].push(v);
    }

    // A. Custo de equilíbrio de semanas (Semana A vs Semana B)
    let w1Total = 0;
    let w2Total = 0;
    for (let s = 0; s < 8; s++) {
      const len = slotVisits[s].length;
      if (s < 4) w1Total += len;
      else w2Total += len;
    }
    const weekBalanceCost = Math.pow(w1Total - w2Total, 2);

    // B. Custo de proporção 2:2:2:1 por semana
    let proportionCost = 0;
    for (const weekIdx of [0, 1]) {
      const startSlot = weekIdx * 4;
      const m = slotVisits[startSlot].length;
      const t = slotVisits[startSlot + 1].length;
      const w = slotVisits[startSlot + 2].length;
      const q = slotVisits[startSlot + 3].length;
      const totalW = m + t + w + q;

      if (totalW > 0) {
        const target_m = (totalW * 2) / 7;
        const target_t = (totalW * 2) / 7;
        const target_w = (totalW * 2) / 7;
        const target_q = (totalW * 1) / 7;

        proportionCost +=
          Math.pow(m - target_m, 2) +
          Math.pow(t - target_t, 2) +
          Math.pow(w - target_w, 2) +
          Math.pow(q - target_q, 2);
      }
    }

    // C. Custo Geográfico (Soma dos quadrados das distâncias de cada visita até o baricentro do seu dia)
    let geoCost = 0;
    for (let s = 0; s < 8; s++) {
      const withCoords = slotVisits[s].filter(v => v.latitude && v.longitude);
      if (withCoords.length > 0) {
        const sumLat = withCoords.reduce((sum, v) => sum + v.latitude!, 0);
        const sumLng = withCoords.reduce((sum, v) => sum + v.longitude!, 0);
        const centroid = { lat: sumLat / withCoords.length, lng: sumLng / withCoords.length };

        for (const v of withCoords) {
          const dist = calculateDistance(v.latitude!, v.longitude!, centroid.lat, centroid.lng);
          geoCost += Math.pow(dist, 2); // Penaliza outliers severamente
        }
      }
    }

    // Pesos balanceados de forma inteligente:
    // O equilíbrio de semanas (semana 1 vs 2) é importante: peso 10000
    // A proporção operacional ideal de dias (2:2:2:1) é uma diretriz: peso 1500
    // O custo geográfico (consolidação territorial) é prioridade máxima para a eficiência de rota: peso 300.0
    return 10000 * weekBalanceCost + 1500 * proportionCost + 300.0 * geoCost;
  };

  let currentCost = calculateTotalCost(assignment);
  console.log(`[GLOBAL_OPT] Custo inicial do território: ${currentCost.toFixed(2)}`);

  let improved = true;
  let iteration = 0;
  const maxIterations = 500;

  while (improved && iteration < maxIterations) {
    improved = false;
    iteration++;

    // 1. Tentar movimentos simples de visitas flexíveis (mudar de um slot para outro se reduzir custo)
    for (const v of nonFixedVisits) {
      const oldSlot = assignment.get(v.id)!;

      for (let newSlot = 0; newSlot < 8; newSlot++) {
        if (newSlot === oldSlot) continue;

        // Simular movimento
        assignment.set(v.id, newSlot);
        const newCost = calculateTotalCost(assignment);

        if (newCost < currentCost - 0.001) {
          currentCost = newCost;
          improved = true;
          break;
        } else {
          // Desfazer
          assignment.set(v.id, oldSlot);
        }
      }
      if (improved) break;
    }

    if (improved) continue;

    // 2. Tentar permutações (swaps) entre dois clientes flexíveis de slots diferentes
    for (let i = 0; i < nonFixedVisits.length; i++) {
      const v1 = nonFixedVisits[i];
      const slot1 = assignment.get(v1.id)!;

      for (let j = i + 1; j < nonFixedVisits.length; j++) {
        const v2 = nonFixedVisits[j];
        const slot2 = assignment.get(v2.id)!;

        if (slot1 === slot2) continue;

        // Simular permuta
        assignment.set(v1.id, slot2);
        assignment.set(v2.id, slot1);
        const newCost = calculateTotalCost(assignment);

        if (newCost < currentCost - 0.001) {
          currentCost = newCost;
          improved = true;
          break;
        } else {
          // Desfazer
          assignment.set(v1.id, slot1);
          assignment.set(v2.id, slot2);
        }
      }
      if (improved) break;
    }
  }

  console.log(`[GLOBAL_OPT] Busca local finalizada em ${iteration} iterações. Custo final: ${currentCost.toFixed(2)}`);

  // Monta as listas finais otimizadas por slot
  const assignedNonFixedVisits: Visita[][] = Array.from({ length: 8 }, () => []);
  for (const v of nonFixedVisits) {
    const slotIdx = assignment.get(v.id)!;
    assignedNonFixedVisits[slotIdx].push(v);
  }

  // 7. Salvar no Supabase reordenado com TSP (Caixeiro Viajante) por slot
  for (let s = 0; s < 8; s++) {
    const { weekNum, dia } = getSlotWeekAndDay(s);
    const fixedInSlot = fixedVisits.filter(v => v.semana === weekNum && v.dia_semana === dia);
    const nonFixedInSlot = assignedNonFixedVisits[s];
    const totalSlotVisits = [...fixedInSlot, ...nonFixedInSlot];

    // Calcular o baricentro final das visitas desse slot
    const validCoords = totalSlotVisits.filter(v => v.latitude && v.longitude);
    const avgLat = validCoords.length > 0 ? (validCoords.reduce((sum, v) => sum + v.latitude!, 0) / validCoords.length) : -26.3045;
    const avgLng = validCoords.length > 0 ? (validCoords.reduce((sum, v) => sum + v.longitude!, 0) / validCoords.length) : -48.8456;

    // Rota ótima no slot
    const optimizedRoute = solveGreedyTSP(totalSlotVisits, avgLat, avgLng);

    console.log(`[GLOBAL_OPT] Atualizando Slot ${s} (${dia} Sem ${weekNum}) com ${optimizedRoute.length} visitas...`);

    for (let j = 0; j < optimizedRoute.length; j++) {
      const visita = optimizedRoute[j];
      const startHour = 8 + j;
      const hInicio = `${String(startHour).padStart(2, '0')}:00`;
      const hFim = `${String(startHour + 1).padStart(2, '0')}:00`;

      const { error: updateError } = await supabase
        .from('agenda_visitas')
        .update({
          semana: weekNum,
          dia_semana: dia,
          ordem_visita: j + 1,
          horario_inicio: hInicio,
          horario_fim: hFim,
          updated_at: new Date().toISOString()
        })
        .eq('id', visita.id);

      if (updateError) {
        console.error(`[GLOBAL_OPT] Erro ao atualizar visita ${visita.id}:`, updateError);
        throw new Error(`Erro ao atualizar visita ${visita.id}: ${updateError.message}`);
      }
    }
  }

  console.log('[GLOBAL_OPT] Otimização global finalizada com sucesso!');
}
