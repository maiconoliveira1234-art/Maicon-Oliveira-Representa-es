import { supabase } from './supabase';
import { calculateDistance, solveGreedyTSP } from './locationUtils';
import { Visita, DiaSemana } from '../types/agenda';

const DIAS_UTEIS: DiaSemana[] = ['Segunda', 'Terça', 'Quarta', 'Quinta'];
const DAY_WEIGHTS: Record<DiaSemana, number> = {
  Segunda: 2,
  Terça: 2,
  Quarta: 2,
  Quinta: 1,
  Sexta: 0
};

const JOINVILLE_SUL_CENTER = { lat: -26.342, lng: -48.842 };

type Slot = {
  idx: number;
  weekNum: 1 | 2;
  dia: DiaSemana;
  target: number;
  visits: Visita[];
};

function getSlotWeekAndDay(s: number) {
  const weekNum: 1 | 2 = s >= 4 ? 2 : 1;
  return { weekNum, dia: DIAS_UTEIS[s % 4] };
}

function getSlotIndex(weekNum: 1 | 2, dia: DiaSemana) {
  const diaIdx = DIAS_UTEIS.indexOf(dia);
  if (diaIdx === -1) return -1;
  return (weekNum === 2 ? 4 : 0) + diaIdx;
}

function getTargets(total: number): number[] {
  const targets = Array.from({ length: 8 }, () => 0);

  for (const weekNum of [1, 2] as const) {
    const weekBase = weekNum === 2 ? 4 : 0;
    const weekTotal = weekNum === 1 ? Math.ceil(total / 2) : Math.floor(total / 2);
    const exact = DIAS_UTEIS.map(d => (weekTotal * DAY_WEIGHTS[d]) / 7);
    const floors = exact.map(Math.floor);
    let remaining = weekTotal - floors.reduce((sum, value) => sum + value, 0);
    const order = exact
      .map((value, idx) => ({ idx, rest: value - Math.floor(value) }))
      .sort((a, b) => b.rest - a.rest || a.idx - b.idx);

    for (const item of order) {
      if (remaining <= 0) break;
      floors[item.idx]++;
      remaining--;
    }

    floors.forEach((value, idx) => {
      targets[weekBase + idx] = value;
    });
  }

  return targets;
}

function getCentroid(visits: Visita[]) {
  const withCoords = visits.filter(v => v.latitude && v.longitude);
  if (withCoords.length === 0) return null;

  return {
    lat: withCoords.reduce((sum, v) => sum + v.latitude!, 0) / withCoords.length,
    lng: withCoords.reduce((sum, v) => sum + v.longitude!, 0) / withCoords.length
  };
}

function distanceToSlot(visita: Visita, slot: Slot) {
  if (!visita.latitude || !visita.longitude) return 8;

  const center = getCentroid(slot.visits) || JOINVILLE_SUL_CENTER;
  return calculateDistance(visita.latitude, visita.longitude, center.lat, center.lng);
}

function continuityCost(candidate: Visita, slots: Slot[], slotIdx: number) {
  if (!candidate.latitude || !candidate.longitude) return 0;

  let cost = 0;
  for (const neighbourIdx of [slotIdx - 1, slotIdx + 1]) {
    const neighbour = slots[neighbourIdx];
    if (!neighbour || neighbour.weekNum !== slots[slotIdx].weekNum) continue;

    const center = getCentroid(neighbour.visits);
    if (center) {
      cost += calculateDistance(candidate.latitude, candidate.longitude, center.lat, center.lng) * 0.35;
    }
  }

  return cost;
}

function overflowCost(slot: Slot) {
  const overTarget = Math.max(0, slot.visits.length + 1 - slot.target);
  return overTarget * overTarget * 5;
}

function normalizeVisit(v: any): Visita {
  const clientData = Array.isArray(v.clientes) ? v.clientes[0] : v.clientes;

  return {
    ...v,
    latitude: v.latitude || clientData?.latitude,
    longitude: v.longitude || clientData?.longitude,
    bairro: v.bairro || clientData?.bairro || '',
    agenda_fixa: clientData?.agenda_fixa ?? false
  } as Visita;
}

function assignFlexibleVisits(slots: Slot[], flexibleVisits: Visita[]) {
  const ordered = [...flexibleVisits].sort((a, b) => {
    const aHasCoords = a.latitude && a.longitude ? 0 : 1;
    const bHasCoords = b.latitude && b.longitude ? 0 : 1;
    if (aHasCoords !== bHasCoords) return aHasCoords - bHasCoords;

    const aNeighbours = flexibleVisits.filter(v =>
      v.id !== a.id &&
      a.latitude &&
      a.longitude &&
      v.latitude &&
      v.longitude &&
      calculateDistance(a.latitude, a.longitude, v.latitude, v.longitude) <= 2.5
    ).length;
    const bNeighbours = flexibleVisits.filter(v =>
      v.id !== b.id &&
      b.latitude &&
      b.longitude &&
      v.latitude &&
      v.longitude &&
      calculateDistance(b.latitude, b.longitude, v.latitude, v.longitude) <= 2.5
    ).length;

    return aNeighbours - bNeighbours;
  });

  for (const visita of ordered) {
    let bestSlot: Slot | null = null;
    let bestScore = Infinity;

    for (const slot of slots) {
      const dist = distanceToSlot(visita, slot);
      const continuity = continuityCost(visita, slots, slot.idx);
      const proportion = overflowCost(slot);
      const fixedAnchorBonus = slot.visits.some(v => v.agenda_fixa) ? -0.5 : 0;
      const score = dist + continuity + proportion + fixedAnchorBonus;

      if (score < bestScore) {
        bestScore = score;
        bestSlot = slot;
      }
    }

    (bestSlot || slots[0]).visits.push(visita);
  }
}

function improveAssignments(slots: Slot[]) {
  let improved = true;
  let loops = 0;

  while (improved && loops < 80) {
    improved = false;
    loops++;

    for (const source of slots) {
      if (source.visits.length <= source.target) continue;

      const movable = source.visits.filter(v => !v.agenda_fixa);
      for (const visita of movable) {
        const currentScore = distanceToSlot(visita, source) + overflowCost(source);
        let bestTarget: Slot | null = null;
        let bestScore = currentScore;

        for (const target of slots) {
          if (target.idx === source.idx) continue;
          if (target.visits.length >= target.target && source.visits.length <= source.target + 1) continue;

          const score = distanceToSlot(visita, target) + continuityCost(visita, slots, target.idx) + overflowCost(target);
          if (score < bestScore - 0.15) {
            bestScore = score;
            bestTarget = target;
          }
        }

        if (bestTarget) {
          source.visits = source.visits.filter(v => v.id !== visita.id);
          bestTarget.visits.push(visita);
          improved = true;
          break;
        }
      }

      if (improved) break;
    }
  }
}

async function saveSlot(slot: Slot) {
  const center = getCentroid(slot.visits) || JOINVILLE_SUL_CENTER;
  const optimizedRoute = solveGreedyTSP(slot.visits, center.lat, center.lng);

  console.log(`[GLOBAL_OPT] Atualizando ${slot.dia} Sem ${slot.weekNum} com ${optimizedRoute.length} visitas (meta ${slot.target}).`);

  for (let i = 0; i < optimizedRoute.length; i++) {
    const visita = optimizedRoute[i];
    const startHour = 8 + i;
    const hInicio = `${String(startHour).padStart(2, '0')}:00`;
    const hFim = `${String(startHour + 1).padStart(2, '0')}:00`;

    const updatePayload: any = {
      ordem_visita: i + 1,
      horario_inicio: hInicio,
      horario_fim: hFim,
      updated_at: new Date().toISOString()
    };

    if (!visita.agenda_fixa) {
      updatePayload.semana = slot.weekNum;
      updatePayload.dia_semana = slot.dia;
    }

    const { error: updateError } = await supabase
      .from('agenda_visitas')
      .update(updatePayload)
      .eq('id', visita.id);

    if (updateError) {
      console.error(`[GLOBAL_OPT] Erro ao atualizar visita ${visita.id}:`, updateError);
      throw new Error(`Erro ao atualizar visita ${visita.id}: ${updateError.message}`);
    }
  }
}

export async function optimizeAllTerritories() {
  console.log('[GLOBAL_OPT] Iniciando otimização global por proximidade, agenda fixa e proporção 2:2:2:1...');

  const { data: activeClients, error: clientError } = await supabase
    .from('clientes')
    .select('*')
    .eq('ativo', true);

  if (clientError) throw new Error(`Erro ao buscar clientes ativos: ${clientError.message}`);

  const { data: existingVisits, error: visitError } = await supabase
    .from('agenda_visitas')
    .select('cliente_id');

  if (visitError) throw new Error(`Erro ao buscar visitas existentes: ${visitError.message}`);

  const existingClientIds = new Set((existingVisits || []).map(v => v.cliente_id));
  const missingClients = (activeClients || []).filter(c => !existingClientIds.has(c.id));

  if (missingClients.length > 0) {
    console.log(`[GLOBAL_OPT] Adicionando ${missingClients.length} clientes ativos à agenda antes da distribuição...`);
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

    const { error: insertError } = await supabase.from('agenda_visitas').insert(newVisits);
    if (insertError) throw new Error(`Erro ao inserir novos clientes na agenda: ${insertError.message}`);
  }

  const { data: visitasRaw, error } = await supabase
    .from('agenda_visitas')
    .select('*, clientes(latitude, longitude, bairro, ativo, agenda_fixa)');

  if (error) {
    console.error('[GLOBAL_OPT] Erro na consulta Supabase:', error);
    throw new Error(`Erro ao buscar visitas: ${error.message}`);
  }

  if (!visitasRaw || visitasRaw.length === 0) {
    throw new Error('Nenhuma visita encontrada na agenda para otimizar.');
  }

  const visitas = visitasRaw
    .filter((v: any) => {
      const clientData = Array.isArray(v.clientes) ? v.clientes[0] : v.clientes;
      return clientData && clientData.ativo !== false;
    })
    .map(normalizeVisit);

  const countWithCoords = visitas.filter(v => v.latitude && v.longitude).length;
  console.log(`[GLOBAL_OPT] Total de visitas ativas: ${visitas.length}, com coordenadas: ${countWithCoords}.`);

  if (countWithCoords === 0) {
    throw new Error('Nenhuma visita possui coordenadas. Rode o botão "Iniciar" da Geocodificação primeiro.');
  }

  const targets = getTargets(visitas.length);
  const slots: Slot[] = Array.from({ length: 8 }, (_, idx) => {
    const { weekNum, dia } = getSlotWeekAndDay(idx);
    return { idx, weekNum, dia, target: targets[idx], visits: [] };
  });

  const fixedVisits = visitas.filter(v => v.agenda_fixa === true);
  const flexibleVisits = visitas.filter(v => v.agenda_fixa !== true);

  for (const fixed of fixedVisits) {
    const slotIdx = getSlotIndex(fixed.semana, fixed.dia_semana);
    if (slotIdx >= 0) {
      slots[slotIdx].visits.push(fixed);
    }
  }

  assignFlexibleVisits(slots, flexibleVisits);
  improveAssignments(slots);

  for (const slot of slots) {
    await saveSlot(slot);
  }

  console.log('[GLOBAL_OPT] Otimização global finalizada com sexta-feira preservada para prospecção e ajustes.');
}
