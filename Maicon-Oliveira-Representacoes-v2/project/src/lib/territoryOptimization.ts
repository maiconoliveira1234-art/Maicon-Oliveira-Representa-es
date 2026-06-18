import { supabase } from './supabase';
import { clusterByLocation, solveGreedyTSP } from './locationUtils';
import { Visita, DiaSemana } from '../types/agenda';

const DIAS_UTEIS: DiaSemana[] = ['Segunda', 'Terça', 'Quarta', 'Quinta'];

export async function optimizeAllTerritories() {
  console.log('Iniciando otimização global de território (8 Grupos: Seg-Qui em 2 Semanas)...');

  // 1. Sincronizar Clientes Ativos com a Agenda
  console.log('Sincronizando clientes ativos...');
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
    console.log(`Adicionando ${missingClients.length} clientes ativos à agenda...`);
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

  // Opcional: Remover inativos da agenda (pode ser perigoso se o usuário não quiser)
  // Para ser fiel ao "OS CLIENTES QUE DEVEM ESTAR NA AGENDA SÃO OS ATIVOS", vamos considerar desativar ou remover?
  // Vou apenas focar em ADICIONAR os que faltam por enquanto, pois é o problema mais comum.

  // 2. Buscar visitas atualizadas e garantir que temos as coordenadas
  const { data: visitasRaw, error } = await supabase
    .from('agenda_visitas')
    .select('*, clientes(latitude, longitude, ativo)');

  if (error) {
    console.error('Erro na consulta Supabase:', error);
    throw new Error(`Erro ao buscar visitas: ${error.message}`);
  }

  if (!visitasRaw || visitasRaw.length === 0) {
    throw new Error('Nenhuma visita encontrada na agenda para otimizar.');
  }

  // Os clientes inativos são mantidos na agenda (agenda_visitas.ativo = false) para preservar
  // o seu posicionamento do roteiro/dia caso sejam reativadosfuturamente (regra de negócio via triggers do BD).
  // Portanto, a remoção física da agenda foi removida para garantir a estabilidade operacional.

  // Normalizar visitas (usar coordenada da visita ou do cliente como fallback)
  // E filtrando apenas os que restaram (ativos)
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
