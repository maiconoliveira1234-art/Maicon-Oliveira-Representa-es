import { supabase } from './supabase';
import { geocodeAddress } from '../services/geocodingService';
import { calculateDistance, solveGreedyTSP } from './locationUtils';
import { Visita, DiaSemana, VisitaStatus } from '../types/agenda';
import { differenceInWeeks, startOfYear } from 'date-fns';

const DIAS_UTEIS: DiaSemana[] = ['Segunda', 'Terça', 'Quarta', 'Quinta'];
const MAX_DAY_LIMIT = 8; // Limite de visitas por dia para otimização saudável

/**
 * Retorna qual a semana do ciclo de 2 semanas baseada na data
 */
export function getCycleWeek(date: Date): 1 | 2 {
  const anchor = startOfYear(date);
  const weeksSinceAnchor = differenceInWeeks(date, anchor);
  return (weeksSinceAnchor % 2 === 0) ? 1 : 2;
}

/**
 * Função principal que verifica e sincroniza novos clientes de forma inteligente.
 * @param forceOverride Se verdadeiro, ignora as restrições de final de semana / sábado e executa imediatamente (útil para acionamento manual)
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

    // 1. Verificar se estamos após o final do ciclo de semana 2 (preferencialmente Sábado [6] ou Domingo [0])
    // Se não for o final do ciclo e não houver forceOverride, apenas sai em silêncio.
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

    // 2. Buscar todos os clientes ativos do Supabase
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

    // 3. Buscar todas as visitas na agenda
    const { data: existingVisitsRaw, error: visitsError } = await supabase
      .from('agenda_visitas')
      .select('*, clientes(ativo)');

    if (visitsError) {
      throw new Error(`Erro ao buscar visitas na agenda: ${visitsError.message}`);
    }

    const existingVisits = (existingVisitsRaw || []) as any[];

    // 4. Identificar quais clientes ativos NÃO estão na agenda (clientes novos)
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

      // A. Garantir Geocodificação do novo cliente se estiver vazia
      if (!lat || !lng) {
        console.log(`[AutoSync] Geocodificando cliente novo: ${client.cliente}...`);
        
        // Se estiver sem bairro mas possuir "-" no endereço, extrai automaticamente
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

      // B. Inteligência Geográfica: Encontrar melhor dia/semana pelos seus vizinhos mais próximos
      let idealWeek: 1 | 2 = 1;
      let idealDay: DiaSemana = 'Segunda';

      const validVisits = existingVisits.filter(v => 
        v.latitude && 
        v.longitude && 
        v.clientes && 
        (Array.isArray(v.clientes) ? v.clientes[0]?.ativo !== false : v.clientes?.ativo !== false)
      );

      if (lat && lng && validVisits.length > 0) {
        // Encontra o vizinho geograficamente mais próximo atualmente na agenda
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
          console.log(`[AutoSync] Vizinho mais próximo para ${client.cliente} é ${bestNeighbour.cliente_nome} (${shortestDist.toFixed(2)} km) que é visitado na ${idealDay} da Semana ${idealWeek}.`);
        }
      } else {
        // Fallback por bairro ou cidade se não tiver coordenadas
        const sameBairroVisit = existingVisits.find(v => v.bairro && v.bairro.toLowerCase() === bairro.toLowerCase());
        const sameCityVisit = existingVisits.find(v => v.cidade && v.cidade.toLowerCase() === (client.cidade || '').toLowerCase());
        
        if (sameBairroVisit) {
          idealWeek = sameBairroVisit.semana as 1 | 2;
          idealDay = sameBairroVisit.dia_semana as DiaSemana;
          console.log(`[AutoSync] Fallback de bairro para ${client.cliente}: alocado com visitas de ${sameBairroVisit.bairro}.`);
        } else if (sameCityVisit) {
          idealWeek = sameCityVisit.semana as 1 | 2;
          idealDay = sameCityVisit.dia_semana as DiaSemana;
          console.log(`[AutoSync] Fallback de cidade para ${client.cliente}: alocado com visitas de ${sameCityVisit.cidade}.`);
        }
      }

      // C. Verificação de Capacidade e Reorganização de Dia Cheio se Necessário
      // Conta quantos clientes estão no dia ideal
      const countOnIdealDay = existingVisits.filter(v => 
        v.semana === idealWeek && 
        v.dia_semana === idealDay &&
        (Array.isArray(v.clientes) ? v.clientes[0]?.ativo !== false : v.clientes?.ativo !== false)
      ).length;

      let finalWeek = idealWeek;
      let finalDay = idealDay;

      // Se o dia estiver sobrecarregado, vamos transferir o cliente mais isolado/periférico para outro dia que tenha espaço
      if (countOnIdealDay >= MAX_DAY_LIMIT && lat && lng) {
        console.log(`[AutoSync] Dia ideal (${idealDay} Sem ${idealWeek}) está com capacidade cheia (${countOnIdealDay} visitas). Iniciando reorganização do dia...`);
        
        // Unimos todas as visitas candidatas incluindo o novo elemento para avaliação
        const candidates = existingVisits
          .filter(v => v.semana === idealWeek && v.dia_semana === idealDay)
          .map(v => ({
            id: v.id,
            cliente_id: v.cliente_id,
            cliente_nome: v.cliente_nome,
            latitude: v.latitude,
            longitude: v.longitude,
            isNew: false
          }));
        
        candidates.push({
          id: 'new_temp',
          cliente_id: client.id,
          cliente_nome: client.cliente,
          latitude: lat,
          longitude: lng,
          isNew: true
        });

        // Procurar todos os outros 7 dias elegíveis para realocação (com espaço livre)
        const availableDaysList: { semana: 1 | 2, dia: DiaSemana, count: number }[] = [];
        for (const sem of [1, 2] as const) {
          for (const d of DIAS_UTEIS) {
            if (sem === idealWeek && d === idealDay) continue;
            const cnt = existingVisits.filter(v => v.semana === sem && v.dia_semana === d).length;
            if (cnt < MAX_DAY_LIMIT) {
              availableDaysList.push({ semana: sem, dia: d, count: cnt });
            }
          }
        }

        let bestMove: {
          candidateId: string;
          targetWeek: 1 | 2;
          targetDay: DiaSemana;
          score: number;
        } | null = null;

        // Para cada candidato desse dia cheio, buscamos qual outro dia com vaga oferece o vizinho mais próximo
        for (const cand of candidates) {
          if (!cand.latitude || !cand.longitude) continue;

          for (const target of availableDaysList) {
            // Acha o vizinho mais próximo neste dia alvo
            const targetVisits = existingVisits.filter(v => 
              v.semana === target.semana && 
              v.dia_semana === target.dia && 
              v.latitude && 
              v.longitude
            );

            if (targetVisits.length === 0) continue;

            let minDistanceVal = Infinity;
            for (const tv of targetVisits) {
              const d = calculateDistance(cand.latitude, cand.longitude, tv.latitude, tv.longitude);
              if (d < minDistanceVal) {
                minDistanceVal = d;
              }
            }

            // Aplicar desconto cronológico/proximidade de dias distintos para prezar bairros adjacentes
            // ("Dias de visitas distintos devem ter sempre bairros próximos para atendimento no dia seguinte se faltar")
            let chronologicalFactor = 1.0;
            if (target.semana === idealWeek) {
              const d1Idx = DIAS_UTEIS.indexOf(idealDay);
              const d2Idx = DIAS_UTEIS.indexOf(target.dia);
              const dayDiff = Math.abs(d1Idx - d2Idx);
              if (dayDiff === 1) {
                chronologicalFactor = 0.8; // Alta prioridade para dias consecutivos consecutivos!
              } else {
                chronologicalFactor = 1.0;
              }
            } else {
              chronologicalFactor = 1.25; // Penaliza mudar de semana
            }

            const adjustedScore = minDistanceVal * chronologicalFactor;

            if (!bestMove || adjustedScore < bestMove.score) {
              bestMove = {
                candidateId: cand.id,
                targetWeek: target.semana,
                targetDay: target.dia,
                score: adjustedScore
              };
            }
          }
        }

        if (bestMove) {
          console.log(`[AutoSync] Reorganização decidida: Mover '${candidates.find(c => c.id === bestMove!.candidateId)?.cliente_nome}' para ${bestMove.targetDay} Sem ${bestMove.targetWeek} (Score: ${bestMove.score.toFixed(2)}).`);
          
          if (bestMove.candidateId === 'new_temp') {
            // Se o melhor movimento for o próprio cliente novo, apenas mude seu destino
            finalWeek = bestMove.targetWeek;
            finalDay = bestMove.targetDay;
          } else {
            // Caso contrário, transfere o cliente antigo selecionado para o novo dia
            const { error: moveError } = await supabase
              .from('agenda_visitas')
              .update({
                semana: bestMove.targetWeek,
                dia_semana: bestMove.targetDay,
                updated_at: new Date().toISOString()
              })
              .eq('id', bestMove.candidateId);

            if (moveError) {
              console.error(`[AutoSync] Erro ao mover cliente ${bestMove.candidateId}:`, moveError);
            } else {
              // Atualiza localmente nossa lista de visitas existentes
              const movedVisit = existingVisits.find(v => v.id === bestMove!.candidateId);
              if (movedVisit) {
                movedVisit.semana = bestMove.targetWeek;
                movedVisit.dia_semana = bestMove.targetDay;
              }

              // Re-roteia os horários do dia alvo que recebeu a visita
              await optimizeAndSaveRouteForDay(bestMove.targetWeek, bestMove.targetDay);
            }
          }
        }
      }

      // D. Salvar o novo cliente na agenda_visitas no dia acordado
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
        horario_inicio: '08:00', // Padrão, será recalculado pelo roteador
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
        // Adiciona à lista local para manter consistência nos cálculos subsequentes
        if (inserted) {
          existingVisits.push(inserted);
        }
        
        // E. Otimiza a rota interna (TSP) e os horários do dia afetado
        await optimizeAndSaveRouteForDay(finalWeek, finalDay);
      }
    }

    // F. Otimização de Continuidade Geográfica (bairros adjacentes para dias distintos)
    // Garantir que a ordem dos dias Segunda, Terça, Quarta, Quinta preza a proximidade geográfica de seus baricentros.
    await optimizeWeekDaysSequence();

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
      // 1. Calcular o baricentro de cada um dos 4 dias úteis
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

      // Se temos baricentros suficientes para otimizar a rota entre os dias (pelo menos 3)
      const activeDays = DIAS_UTEIS.filter(d => dayCenters[d] !== null);
      if (activeDays.length < 3) continue;

      // 2. Encontrar a permutação de dias úteis que minimiza a distância total consecutiva
      // (Algoritmo simples de permutação para 4 dias)
      let minSequenceScore = Infinity;
      let optimalSequence: DiaSemana[] = [...DIAS_UTEIS];

      // Gerador simples de permutações de array de strings
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
        let valid = true;

        for (let i = 0; i < perm.length - 1; i++) {
          const d1 = perm[i];
          const d2 = perm[i+1];
          const c1 = dayCenters[d1];
          const c2 = dayCenters[d2];

          if (c1 && c2) {
            currentCost += calculateDistance(c1.lat, c1.lng, c2.lat, c2.lng);
          } else {
            // Se algum dia está vazio, dá um peso nulo/pequeno para não quebrar
            currentCost += 0.5;
          }
        }

        if (currentCost < minSequenceScore) {
          minSequenceScore = currentCost;
          optimalSequence = perm;
        }
      }

      // 3. Se a sequência ótima for diferente da original (Seg, Ter, Qua, Qui), remapela nos registros
      const currentSequence = [...DIAS_UTEIS];
      const needsSwap = optimalSequence.some((d, idx) => d !== currentSequence[idx]);

      if (needsSwap) {
        console.log(`[AutoSync] Sequência territorial otimizada para Semana ${sem}: ${optimalSequence.join(' -> ')} (Distância Total: ${minSequenceScore.toFixed(2)} km)`);
        
        // Criar mapeamento temporário para evitar sobreposição ao salvar no banco
        // Ex: Segunda -> Temp1, Terça -> Temp2, etc.
        const tempMap: Record<DiaSemana, string> = {
          'Segunda': 'TEMP_SEG',
          'Terça': 'TEMP_TER',
          'Quarta': 'TEMP_QUA',
          'Quinta': 'TEMP_QUI',
          'Sexta': 'TEMP_SEX'
        };

        // Passo 1: Atualizar para nomes temporários
        for (const d of DIAS_UTEIS) {
          await supabase
            .from('agenda_visitas')
            .update({ dia_semana: tempMap[d] as any })
            .eq('semana', sem)
            .eq('dia_semana', d);
        }

        // Passo 2: Mapear temporários para a sua nova posição correspondente no ciclo
        for (let i = 0; i < optimalSequence.length; i++) {
          const originalDay = optimalSequence[i];
          const targetDay = currentSequence[i]; // Segunda é a primeira, Terça a segunda, etc.
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
