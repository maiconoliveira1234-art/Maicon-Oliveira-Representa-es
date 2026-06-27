import { supabase } from './supabase';
import { geocodeAddress } from '../services/geocodingService';
import { calculateDistance, solveGreedyTSP } from './locationUtils';
import { Visita, DiaSemana, VisitaStatus } from '../types/agenda';
import { differenceInWeeks, startOfYear } from 'date-fns';

const DIAS_UTEIS: DiaSemana[] = ['Segunda', 'Terça', 'Quarta', 'Quinta'];
const MAX_DAY_LIMIT = 8; // Limite de visitas por dia para otimização saudável

const DAY_WEIGHTS: Record<DiaSemana, number> = {
  Segunda: 2,
  Terça: 2,
  Quarta: 2,
  Quinta: 1,
  Sexta: 0
};

function getDayTarget(totalWeekVisits: number, dia: DiaSemana): number {
  return (totalWeekVisits * DAY_WEIGHTS[dia]) / 7;
}

function getDayCenter(visits: any[], semana: 1 | 2, dia: DiaSemana): { lat: number; lng: number } | null {
  const withCoords = visits.filter(v => v.semana === semana && v.dia_semana === dia && v.latitude && v.longitude);
  if (withCoords.length === 0) return null;

  return {
    lat: withCoords.reduce((sum, v) => sum + v.latitude, 0) / withCoords.length,
    lng: withCoords.reduce((sum, v) => sum + v.longitude, 0) / withCoords.length
  };
}

function chooseBestSlotForNewClient(
  existingVisits: any[],
  preferredWeek: 1 | 2,
  preferredDay: DiaSemana,
  lat?: number,
  lng?: number
): { week: 1 | 2; day: DiaSemana } {
  let bestChoice = { week: preferredWeek, day: preferredDay };
  let bestScore = Infinity;
  const preferredDayIdx = DIAS_UTEIS.indexOf(preferredDay);

  for (const week of [preferredWeek, preferredWeek === 1 ? 2 : 1] as (1 | 2)[]) {
    const weekVisits = existingVisits.filter(v => v.semana === week && DIAS_UTEIS.includes(v.dia_semana));
    const totalAfterInsert = weekVisits.length + 1;

    for (const day of DIAS_UTEIS) {
      const dayVisits = weekVisits.filter(v => v.dia_semana === day);
      const target = getDayTarget(totalAfterInsert, day);
      const countAfterInsert = dayVisits.length + 1;
      const loadPenalty = Math.pow(Math.max(0, countAfterInsert - target), 2) * 5 + Math.pow(countAfterInsert - target, 2) * 0.8;

      let distancePenalty = 3;
      const center = getDayCenter(existingVisits, week, day);
      if (lat && lng && center) {
        distancePenalty = calculateDistance(lat, lng, center.lat, center.lng);
      } else if (day === preferredDay && week === preferredWeek) {
        distancePenalty = 0;
      }

      const dayIdx = DIAS_UTEIS.indexOf(day);
      const sameRegionBonus = week === preferredWeek && day === preferredDay ? -2.5 : 0;
      const neighbourDayBonus = week === preferredWeek && Math.abs(dayIdx - preferredDayIdx) === 1 ? -0.8 : 0;
      const otherWeekPenalty = week === preferredWeek ? 0 : 2.5;
      const fixedAnchorBonus = dayVisits.some(v => v.agenda_fixa) ? -0.4 : 0;
      const score = distancePenalty + loadPenalty + otherWeekPenalty + sameRegionBonus + neighbourDayBonus + fixedAnchorBonus;

      if (score < bestScore) {
        bestScore = score;
        bestChoice = { week, day };
      }
    }
  }

  return bestChoice;
}

/**
 * Retorna qual a semana do ciclo de 2 semanas baseada na data
 */
export function getCycleWeek(date: Date): 1 | 2 {
  const anchor = startOfYear(date);
  const weeksSinceAnchor = differenceInWeeks(date, anchor);
  return (weeksSinceAnchor % 2 === 0) ? 1 : 2;
}

/**
 * Calcula o baricentro (centro geográfico) de uma lista de visitas/clientes
 */
function getCentroid(visits: any[]): { lat: number; lng: number } {
  let sumLat = 0;
  let sumLng = 0;
  let count = 0;
  for (const v of visits) {
    if (v.latitude && v.longitude) {
      sumLat += v.latitude;
      sumLng += v.longitude;
      count++;
    }
  }
  if (count === 0) return { lat: -26.3045, lng: -48.8456 };
  return { lat: sumLat / count, lng: sumLng / count };
}

/**
 * Agrupa visitas em clusters geográficos usando agrupamento hierárquico
 */
function getGeographicClusters(items: any[], maxDistanceKm: number = 3.0): any[][] {
  const withCoords = items.filter(i => i.latitude && i.longitude);
  const withoutCoords = items.filter(i => !i.latitude || !i.longitude);

  if (withCoords.length === 0) {
    return [items];
  }

  // Inicializa cada item como seu próprio cluster
  let clusters: any[][] = withCoords.map(item => [item]);

  while (clusters.length > 1) {
    let minDistance = Infinity;
    let mergeIdxA = -1;
    let mergeIdxB = -1;

    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        const centroidA = getCentroid(clusters[i]);
        const centroidB = getCentroid(clusters[j]);
        const dist = calculateDistance(centroidA.lat, centroidA.lng, centroidB.lat, centroidB.lng);

        if (dist < minDistance) {
          minDistance = dist;
          mergeIdxA = i;
          mergeIdxB = j;
        }
      }
    }

    if (minDistance < maxDistanceKm) {
      clusters[mergeIdxA] = [...clusters[mergeIdxA], ...clusters[mergeIdxB]];
      clusters.splice(mergeIdxB, 1);
    } else {
      break;
    }
  }

  if (withoutCoords.length > 0) {
    clusters.push(withoutCoords);
  }

  return clusters;
}

/**
 * Função principal que verifica e sincroniza novos clientes de forma inteligente.
 * @param forceOverride Se verdadeiro, ignora as restrições de final de semana e executa imediatamente.
 */
export async function runAutoAgendaSyncIfEligible(forceOverride: boolean = false): Promise<{
  executed: boolean;
  message: string;
  processedCount: number;
}> {
  try {
    const today = new Date();
    const cycleWeek = getCycleWeek(today);
    const dayOfWeek = today.getDay(); // 0 = Domingo, 6 = Sábado

    // Verificar se estamos no final do ciclo de semana 2
    const isWeekend = dayOfWeek === 6 || dayOfWeek === 0;
    const isEndOfWeek2 = cycleWeek === 2 && isWeekend;

    if (!isEndOfWeek2 && !forceOverride) {
      return {
        executed: false,
        message: `Agendado para o final do ciclo da Semana 2 (Sábado ou Domingo). Semana atual: ${cycleWeek}, Dia da semana: ${dayOfWeek}.`,
        processedCount: 0
      };
    }

    console.log('[AutoSync] Iniciando verificação de novos clientes para incluir na agenda...');

    // 1. Buscar todos os clientes ativos do Supabase
    const { data: activeClients, error: clientError } = await supabase
      .from('clientes')
      .select('*')
      .eq('ativo', true);

    if (clientError) {
      throw new Error(`Erro ao buscar clientes: ${clientError.message}`);
    }

    if (!activeClients || activeClients.length === 0) {
      return { executed: true, message: 'Nenhum cliente ativo encontrado.', processedCount: 0 };
    }

    // 2. Buscar todas as visitas na agenda com informações completas dos clientes
    const { data: existingVisitsRaw, error: visitsError } = await supabase
      .from('agenda_visitas')
      .select('*, clientes(*)');

    if (visitsError) {
      throw new Error(`Erro ao buscar visitas na agenda: ${visitsError.message}`);
    }

    const rawVisits = existingVisitsRaw || [];

    // Limpar visitas órfãs ou de clientes inativos do banco de dados para evitar poluição
    const visitsToDelete = rawVisits.filter(v => {
      const clientData = Array.isArray(v.clientes) ? v.clientes[0] : v.clientes;
      return !clientData || clientData.ativo !== true;
    });

    if (visitsToDelete.length > 0) {
      console.log(`[AutoSync] Removendo ${visitsToDelete.length} visitas órfãs ou de clientes inativos da agenda...`);
      const deleteIds = visitsToDelete.map(v => v.id);
      await supabase
        .from('agenda_visitas')
        .delete()
        .in('id', deleteIds);
    }

    // Filtrar existingVisits para conter APENAS visitas válidas de clientes ativos e normalizar coordenadas de fallback
    const existingVisits = rawVisits.filter(v => {
      const clientData = Array.isArray(v.clientes) ? v.clientes[0] : v.clientes;
      return clientData && clientData.ativo === true;
    }).map(v => {
      const clientData = Array.isArray(v.clientes) ? v.clientes[0] : v.clientes;
      return {
        ...v,
        latitude: v.latitude || clientData?.latitude,
        longitude: v.longitude || clientData?.longitude,
        bairro: v.bairro || clientData?.bairro || '',
        agenda_fixa: clientData?.agenda_fixa ?? false
      };
    }) as any[];

    // 3. Identificar quais clientes ativos NÃO estão na agenda (clientes novos ou reativados)
    const scheduledClientIds = new Set(existingVisits.map(v => v.cliente_id).filter(Boolean));
    const newClients = activeClients.filter(c => !scheduledClientIds.has(c.id));

    if (newClients.length === 0) {
      console.log('[AutoSync] Nenhum novo cliente para incluir na agenda.');
      return { executed: true, message: 'Nenhum novo cliente pendente de agendamento.', processedCount: 0 };
    }

    console.log(`[AutoSync] Detectados ${newClients.length} novos clientes pendentes de agendamento.`);

    let processedCount = 0;

    for (const client of newClients) {
      let lat = client.latitude;
      let lng = client.longitude;
      let bairro = client.bairro || '';

      // Deletar qualquer visita antiga deste cliente para evitar duplicações absolutas antes do novo agendamento
      await supabase
        .from('agenda_visitas')
        .delete()
        .eq('cliente_id', client.id);

      // A. Garantir Geocodificação do novo cliente se estiver vazia
      if (!lat || !lng) {
        console.log(`[AutoSync] Geocodificando cliente novo: ${client.cliente}...`);
        
        if (!bairro && client.endereco && client.endereco.includes('-')) {
          const parts = client.endereco.split('-');
          bairro = parts[parts.length - 1].trim();
          
          await supabase
            .from('clientes')
            .update({ bairro })
            .eq('id', client.id);
        }

        const coords = await geocodeAddress(client.endereco || '', client.cidade || '', bairro);
        if (coords) {
          lat = coords.lat;
          lng = coords.lng;
          
          await supabase
            .from('clientes')
            .update({ latitude: lat, longitude: lng })
            .eq('id', client.id);
          
          console.log(`[AutoSync] Coordenadas salvas para ${client.cliente}: ${lat}, ${lng}`);
        } else {
          console.warn(`[AutoSync] Não foi possível geocodificar ${client.cliente}.`);
        }

        // Aguardar limitador de taxa (delay de 1.1 segundos)
        await new Promise(resolve => setTimeout(resolve, 1100));
      }

      // B. Inteligência de agrupamento por proximidade e encaixe operacional
      let idealWeek: 1 | 2 = 1;
      let idealDay: DiaSemana = 'Segunda';

      const validVisits = existingVisits.filter(v => v.latitude && v.longitude);

      if (lat && lng) {
        console.log(`[AutoSync] [NOVO CLIENTE] ${client.cliente} - Identificando região mais próxima...`);

        const allVisitsAndNew = validVisits.map(v => ({
          id: v.id,
          latitude: v.latitude,
          longitude: v.longitude,
          semana: v.semana,
          dia_semana: v.dia_semana,
          cliente_nome: v.cliente_nome,
          agenda_fixa: v.agenda_fixa
        }));
        allVisitsAndNew.push({
          id: 'new_temp',
          latitude: lat,
          longitude: lng,
          semana: 1,
          dia_semana: 'Segunda',
          cliente_nome: client.cliente,
          agenda_fixa: false
        });

        const clusters = getGeographicClusters(allVisitsAndNew, 3.0);
        const clientCluster = clusters.find(c => c.some(v => v.id === 'new_temp')) || [];
        const otherClusterVisits = clientCluster.filter(v => v.id !== 'new_temp');

        if (otherClusterVisits.length > 0) {
          const w1Count = otherClusterVisits.filter(v => v.semana === 1).length;
          const w2Count = otherClusterVisits.filter(v => v.semana === 2).length;
          idealWeek = (w1Count >= w2Count) ? 1 : 2;

          const dayCounts = DIAS_UTEIS.map(d => ({
            dia: d,
            count: otherClusterVisits.filter(v => v.semana === idealWeek && v.dia_semana === d).length
          })).sort((a, b) => b.count - a.count || DIAS_UTEIS.indexOf(a.dia) - DIAS_UTEIS.indexOf(b.dia));

          idealDay = dayCounts[0].dia;
          console.log(`[AutoSync] Região de ${client.cliente}: Semana ${idealWeek}, referência ${idealDay}, ${otherClusterVisits.length} vizinhos próximos.`);
        } else if (validVisits.length > 0) {
          let shortestDist = Infinity;
          let bestNeighbour: any = null;

          for (const visit of validVisits) {
            const dist = calculateDistance(lat, lng, visit.latitude, visit.longitude);
            if (dist < shortestDist) {
              shortestDist = dist;
              bestNeighbour = visit;
            }
          }

          if (bestNeighbour) {
            idealWeek = bestNeighbour.semana as 1 | 2;
            idealDay = bestNeighbour.dia_semana as DiaSemana;
            console.log(`[AutoSync] Vizinho mais próximo de ${client.cliente}: ${bestNeighbour.cliente_nome} (${shortestDist.toFixed(2)} km), ${idealDay} Semana ${idealWeek}.`);
          }
        }
      } else {
        const sameBairroVisit = existingVisits.find(v => v.bairro && v.bairro.toLowerCase() === bairro.toLowerCase());
        const sameCityVisit = existingVisits.find(v => v.cidade && v.cidade.toLowerCase() === (client.cidade || '').toLowerCase());

        if (sameBairroVisit) {
          idealWeek = sameBairroVisit.semana as 1 | 2;
          idealDay = sameBairroVisit.dia_semana as DiaSemana;
          console.log(`[AutoSync] Fallback de bairro para ${client.cliente}: ${sameBairroVisit.bairro}.`);
        } else if (sameCityVisit) {
          idealWeek = sameCityVisit.semana as 1 | 2;
          idealDay = sameCityVisit.dia_semana as DiaSemana;
          console.log(`[AutoSync] Fallback de cidade para ${client.cliente}: ${sameCityVisit.cidade}.`);
        }
      }

      const bestSlot = chooseBestSlotForNewClient(existingVisits, idealWeek, idealDay, lat, lng);
      const finalWeek = bestSlot.week;
      const finalDay = bestSlot.day;

      console.log(`[AutoSync] Encaixe final para ${client.cliente}: ${finalDay} Semana ${finalWeek}, preservando proporção 2:2:2:1 e sexta livre.`);

      // D. PASSO 5: Salvar o novo cliente na agenda
      const newVisitObj = {
        cliente_id: client.id,
        cliente_nome: client.cliente,
        contato: client.contato || '',
        telefone: client.telefone ? String(client.telefone) : '',
        endereco: client.endereco || '',
        bairro: bairro,
        cidade: client.cidade || '',
        latitude: lat,
        longitude: lng,
        semana: finalWeek,
        dia_semana: finalDay,
        horario_inicio: '08:00', // Será recalculado
        horario_fim: '09:00',
        ordem_visita: 1,
        status: 'pendente' as VisitaStatus,
        observacoes: ''
      };

      console.log(`[AutoSync] Gravando agendamento final para ${client.cliente} na ${finalDay} Semana ${finalWeek}...`);
      const { data: inserted, error: insertError } = await supabase
        .from('agenda_visitas')
        .insert([newVisitObj])
        .select()
        .single();

      if (insertError) {
        console.error(`[AutoSync] Erro ao cadastrar visita do novo cliente:`, insertError);
      } else {
        processedCount++;
        if (inserted) {
          existingVisits.push(inserted);
        }
        
        // Re-roteia os horários do dia afetado
        await optimizeAndSaveRouteForDay(finalWeek, finalDay);
      }
    }

    // A sequência dos dias permanece estável; a proximidade é considerada antes de salvar o cliente.
    // Isso preserva clientes de agenda fixa e mantém sexta-feira livre.

    return {
      executed: true,
      message: `Sincronização realizada com sucesso! ${processedCount} novos clientes inseridos de forma geolocalizada e inteligente.`,
      processedCount
    };
  } catch (error: any) {
    console.error('[AutoSync] Erro crítico no processo de sincronização da agenda:', error);
    return {
      executed: false,
      message: `Erro na sincronização automática: ${error.message}`,
      processedCount: 0
    };
  }
}

/**
 * Reordena o roteiro interno de um dia específico usando o TSP guloso
 * e salva no banco novos horários a partir das 08:00
 */
async function optimizeAndSaveRouteForDay(semana: 1 | 2, dia: DiaSemana) {
  try {
    const { data: visits } = await supabase
      .from('agenda_visitas')
      .select('*')
      .eq('semana', semana)
      .eq('dia_semana', dia);

    if (!visits || visits.length === 0) return;

    // Baricentro das visitas do dia
    const avgLat = visits.reduce((sum, v) => sum + (v.latitude || 0), 0) / visits.length;
    const avgLng = visits.reduce((sum, v) => sum + (v.longitude || 0), 0) / visits.length;

    // Rota ótima
    const optimized = solveGreedyTSP(visits, avgLat, avgLng);

    // Salva a nova ordem e horários
    for (let i = 0; i < optimized.length; i++) {
      const v = optimized[i];
      const startHour = 8 + i;
      const hInicio = `${String(startHour).padStart(2, '0')}:00`;
      const hFim = `${String(startHour + 1).padStart(2, '0')}:00`;

      await supabase
        .from('agenda_visitas')
        .update({
          ordem_visita: i + 1,
          horario_inicio: hInicio,
          horario_fim: hFim,
          updated_at: new Date().toISOString()
        })
        .eq('id', v.id);
    }
    console.log(`[RouteOptimizer] Rota para ${dia} Sem ${semana} reordenada e otimizada (${optimized.length} visitas).`);
  } catch (error) {
    console.error(`[RouteOptimizer] Erro ao reordenar rota para ${dia} Sem ${semana}:`, error);
  }
}

/**
 * Organiza a sequência cronológica dos dias (Segunda, Terça, Quarta, Quinta)
 * em cada semana para garantir que dias vizinhos tenham bairros / baricentros próximos.
 */
async function optimizeWeekDaysSequence() {
  try {
    console.log('[AutoSync] Analisando sequência dos dias para continuidade territorial...');
    const { data: visits } = await supabase
      .from('agenda_visitas')
      .select('*');

    if (!visits || visits.length === 0) return;

    for (const sem of [1, 2] as const) {
      const dayCenters: Record<DiaSemana, { lat: number; lng: number, count: number } | null> = {
        'Segunda': null,
        'Terça': null,
        'Quarta': null,
        'Quinta': null,
        'Sexta': null
      };

      for (const d of DIAS_UTEIS) {
        const dVisits = visits.filter(v => v.semana === sem && v.dia_semana === d && v.latitude && v.longitude);
        if (dVisits.length > 0) {
          const lat = dVisits.reduce((sum, v) => sum + v.latitude, 0) / dVisits.length;
          const lng = dVisits.reduce((sum, v) => sum + v.longitude, 0) / dVisits.length;
          dayCenters[d] = { lat, lng, count: dVisits.length };
        }
      }

      const activeDays = DIAS_UTEIS.filter(d => dayCenters[d] !== null);
      if (activeDays.length < 3) continue;

      let minSequenceScore = Infinity;
      let optimalSequence: DiaSemana[] = [...DIAS_UTEIS];

      const permutations = (arr: any[]): any[][] => {
        if (arr.length <= 1) return [arr];
        const res = [];
        for (let i = 0; i < arr.length; i++) {
          const current = arr[i];
          const rest = [...arr.slice(0, i), ...arr.slice(i + 1)];
          const restPerms = permutations(rest);
          for (const rp of restPerms) {
            res.push([current, ...rp]);
          }
        }
        return res;
      };

      const allPerms = permutations(DIAS_UTEIS);

      for (const perm of allPerms) {
        let currentCost = 0;

        for (let i = 0; i < perm.length - 1; i++) {
          const d1 = perm[i];
          const d2 = perm[i+1];
          const c1 = dayCenters[d1];
          const c2 = dayCenters[d2];

          if (c1 && c2) {
            currentCost += calculateDistance(c1.lat, c1.lng, c2.lat, c2.lng);
          } else {
            currentCost += 0.5;
          }
        }

        if (currentCost < minSequenceScore) {
          minSequenceScore = currentCost;
          optimalSequence = perm;
        }
      }

      const currentSequence = [...DIAS_UTEIS];
      const needsSwap = optimalSequence.some((d, idx) => d !== currentSequence[idx]);

      if (needsSwap) {
        console.log(`[AutoSync] Sequência territorial otimizada para Semana ${sem}: ${optimalSequence.join(' -> ')} (Distância Total: ${minSequenceScore.toFixed(2)} km)`);
        
        const tempMap: Record<DiaSemana, string> = {
          'Segunda': 'TEMP_SEG',
          'Terça': 'TEMP_TER',
          'Quarta': 'TEMP_QUA',
          'Quinta': 'TEMP_QUI',
          'Sexta': 'TEMP_SEX'
        };

        for (const d of DIAS_UTEIS) {
          await supabase
            .from('agenda_visitas')
            .update({ dia_semana: tempMap[d] as any })
            .eq('semana', sem)
            .eq('dia_semana', d);
        }

        for (let i = 0; i < optimalSequence.length; i++) {
          const originalDay = optimalSequence[i];
          const targetDay = currentSequence[i];
          const tempName = tempMap[originalDay];

          await supabase
            .from('agenda_visitas')
            .update({ dia_semana: targetDay })
            .eq('semana', sem)
            .eq('dia_semana', tempName as any);
        }

        console.log(`[AutoSync] Ajuste de sequência territorial salvo para Semana ${sem}!`);
      }
    }
  } catch (error) {
    console.error('[AutoSync] Erro ao ordenar sequência de dias da semana:', error);
  }
}
