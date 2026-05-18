import { supabase } from './supabase';
import { clusterByLocation, solveGreedyTSP } from './locationUtils';
import { Visita, DiaSemana } from '../types/agenda';

const DIAS_UTEIS: DiaSemana[] = ['Segunda', 'Terça', 'Quarta', 'Quinta'];

export async function optimizeAllTerritories() {
  console.log('Iniciando otimização global de território (8 Grupos: Seg-Qui em 2 Semanas)...');

  // 1. Buscar visitas e garantir que temos as coordenadas (fazendo join com clientes se necessário)
  const { data: visitasRaw, error } = await supabase
    .from('agenda_visitas')
    .select('*, clientes(latitude, longitude)');

  if (error) {
    console.error('Erro na consulta Supabase:', error);
    throw new Error(`Erro ao buscar visitas: ${error.message}`);
  }

  if (!visitasRaw || visitasRaw.length === 0) {
    throw new Error('Nenhuma visita encontrada na agenda para otimizar.');
  }

  // Normalizar visitas (usar coordenada da visita ou do cliente como fallback)
  const visitas = visitasRaw.map((v: any) => {
    // Busca dados do cliente no objeto retornado pelo join. 
    // Garante que pegamos latitude/longitude mesmo que venha como array
    const clientData = Array.isArray(v.clientes) ? v.clientes[0] : v.clientes;
    
    return {
      ...v,
      latitude: v.latitude || clientData?.latitude,
      longitude: v.longitude || clientData?.longitude
    };
  }) as Visita[];

  const countWithCoords = visitas.filter(v => v.latitude && v.longitude).length;
  console.log(`Log de Otimização: Total=${visitas.length}, Com Coordenadas=${countWithCoords}`);

  if (countWithCoords === 0) {
    throw new Error('Nenhuma visita possui coordenadas. Rode o botão "Iniciar" da Geocodificação primeiro!');
  }

  // 2. Agrupar em 8 clusters (4 dias x 2 semanas)
  const clusters = clusterByLocation(visitas, 8);

  // 3. Mapear clusters para os respectivos dias
  // Índices 0-3: Semana 1 (Seg-Qui)
  // Índices 4-7: Semana 2 (Seg-Qui)
  for (let i = 0; i < clusters.length; i++) {
    const isWeek2 = i >= 4;
    const weekNum = isWeek2 ? 2 : 1;
    const diaIdx = i % 4;
    const dia = DIAS_UTEIS[diaIdx];
    const cluster = clusters[i];

    // Dentro de cada cluster, otimizar a rota interna (TSP)
    // Usamos o baricentro (média) das coordenadas do cluster como ponto de partida
    const avgLat = cluster.reduce((sum, v) => sum + (v.latitude || 0), 0) / (cluster.length || 1);
    const avgLon = cluster.reduce((sum, v) => sum + (v.longitude || 0), 0) / (cluster.length || 1);
    
    console.log(`Cluster ${i} (${dia} Sem ${weekNum}): Baricentro em ${avgLat.toFixed(4)}, ${avgLon.toFixed(4)}`);
    
    // Inicia a rota pelo ponto mais próximo do baricentro
    const optimizedRoute = solveGreedyTSP(cluster, avgLat, avgLon);

    console.log(`Processando ${dia}: ${optimizedRoute.length} visitas otimizadas.`);

    // 4. Salvar no banco com horários calculados
    for (let j = 0; j < optimizedRoute.length; j++) {
      const visita = optimizedRoute[j];
      
      // Cálculo de horários (Iniciando às 08:00, incrementando 1h por visita)
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
          horario_fim: hFim
        })
        .eq('id', visita.id);

      if (updateError) {
        console.error(`Erro ao atualizar visita ${visita.id}:`, updateError);
        throw new Error(`Erro ao atualizar visita ${visita.id}: ${updateError.message}`);
      }
    }
  }

  console.log('Otimização global concluída!');
}
