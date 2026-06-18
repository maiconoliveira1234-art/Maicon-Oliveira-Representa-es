import { supabase } from './supabase';
import { geocodeAddress } from '../services/geocodingService';

export interface ValidationIssue {
  id: string;
  cliente: string;
  tipo: 'endereco_ausente' | 'cidade_ausente' | 'bairro_ausente' | 'fora_da_agenda';
  detalhe: string;
}

/**
 * Retorna as pendências de cadastro de clientes que podem impossibilitar ou complicar a geocodificação:
 * 1. Endereço ou Cidade ausentes
 * 2. Bairro ausente e sem sinal '-' no endereço para extração automática
 * 3. Clientes que não estão na tabela agenda_visitas
 */
export async function getGeocodeValidationReport(): Promise<ValidationIssue[]> {
  // 1. Busca todos os clientes ativos
  const { data: clients, error: clientError } = await supabase
    .from('clientes')
    .select('id, cliente, endereco, cidade, bairro, ativo')
    .eq('ativo', true);
    
  if (clientError) {
    console.error('Erro ao buscar clientes para validação:', clientError);
    return [];
  }
  
  // 2. Busca todas as visitas agendadas para verificar associação
  const { data: visits, error: visitError } = await supabase
    .from('agenda_visitas')
    .select('cliente_id');
    
  if (visitError) {
    console.error('Erro ao buscar agenda_visitas para validação:', visitError);
    return [];
  }
  
  const scheduledClientIds = new Set((visits || []).map(v => v.cliente_id));
  const issues: ValidationIssue[] = [];
  
  for (const client of (clients || [])) {
    // 1. Verifica se o cliente não está na tabela agenda_visitas
    const isScheduled = scheduledClientIds.has(client.id);
    if (!isScheduled) {
      issues.push({
        id: client.id,
        cliente: client.cliente,
        tipo: 'fora_da_agenda',
        detalhe: 'Cliente cadastrado que não está presente na Tabela de Agenda de Visitas (agenda_visitas).'
      });
    }
    
    // 2. Verifica se falta preencher o Endereço (logradouro)
    if (!client.endereco || !client.endereco.trim()) {
      issues.push({
        id: client.id,
        cliente: client.cliente,
        tipo: 'endereco_ausente',
        detalhe: 'Logradouro / Endereço pendente de preenchimento.'
      });
    }
    
    // 3. Verifica se falta preencher a Cidade
    if (!client.cidade || !client.cidade.trim()) {
      issues.push({
        id: client.id,
        cliente: client.cliente,
        tipo: 'cidade_ausente',
        detalhe: 'Cidade pendente de preenchimento.'
      });
    }
    
    // 4. Verifica se está sem Bairro e sem o caractere '-' no Endereço para extração automática
    const hasBairro = client.bairro && client.bairro.trim();
    const hasDash = client.endereco && client.endereco.includes('-');
    if (!hasBairro && !hasDash) {
      issues.push({
        id: client.id,
        cliente: client.cliente,
        tipo: 'bairro_ausente',
        detalhe: 'Bairro ausente e não possui o caractere "-" no endereço para permitir extração automática.'
      });
    }
  }
  
  return issues;
}

/**
 * Varre todos os clientes, extrai o bairro do endereço (parte após o sinal '-')
 * e sincroniza nas tabelas clientes e agenda_visitas.
 */
export async function extractAndSyncAllNeighborhoods() {
  console.log('Extraindo e sincronizando bairros a partir da coluna endereco...');
  const { data: clients, error } = await supabase
    .from('clientes')
    .select('id, cliente, endereco, bairro, ativo')
    .eq('ativo', true);

  if (error) {
    console.error('Erro ao buscar clientes para extrair bairros:', error);
    return;
  }

  for (const client of (clients || [])) {
    if (client.endereco && client.endereco.includes('-')) {
      const parts = client.endereco.split('-');
      const extractedBairro = parts[parts.length - 1].trim();

      // Atualiza apenas se o bairro for diferente do atual ou sem cadastro anterior
      if (!client.bairro || client.bairro.trim() !== extractedBairro) {
        console.log(`Bairro '${extractedBairro}' extraído do endereço de ${client.cliente}. Atualizando...`);
        
        // 1. Atualizar clientes
        await supabase
          .from('clientes')
          .update({ bairro: extractedBairro })
          .eq('id', client.id);

        // 2. Sincronizar na agenda de visitas correspondente
        await supabase
          .from('agenda_visitas')
          .update({ bairro: extractedBairro })
          .eq('cliente_id', client.id);
      }
    }
  }
}

export async function bulkGeocodeClients() {
  console.log('Iniciando geocodificação em massa...');
  
  // Extrai e sincroniza bairros automaticamente antes de geocodificar
  await extractAndSyncAllNeighborhoods();
  
  // 1. Busca clientes ativos sem coordenadas mas com endereço (com bairro atualizado)
  const { data: clients, error } = await supabase
    .from('clientes')
    .select('id, cliente, endereco, cidade, bairro, latitude, longitude, ativo')
    .eq('ativo', true)
    .is('latitude', null);

  if (error) {
    console.error('Erro ao buscar clientes:', error);
    return;
  }

  console.log(`${clients?.length} clientes encontrados para processar.`);

  for (const client of (clients || [])) {
    if (client.endereco && client.cidade) {
      const bairro = client.bairro || '';
      console.log(`Geocodificando: ${client.cliente} ${bairro ? `(${bairro})` : ''}...`);
      const coords = await geocodeAddress(client.endereco, client.cidade, bairro);
      
      if (coords) {
        const { error: updateError } = await supabase
          .from('clientes')
          .update({
            latitude: coords.lat,
            longitude: coords.lng
          })
          .eq('id', client.id);
          
        if (updateError) console.error(`Erro ao atualizar ${client.cliente}:`, updateError);
        
        // Respeitar o limite de taxa do Nominatim (max 1 por segundo)
        await new Promise(resolve => setTimeout(resolve, 1100));
      }
    }
  }

  // 2. Sincronizar com a Agenda
  console.log('Sincronizando coordenadas com a agenda...');
  const { error: syncError } = await supabase.rpc('sync_agenda_coordinates');
  if (syncError) {
    console.log('Nota: Função RPC sync_agenda_coordinates não encontrada. Sincronização manual necessária.');
    // Fallback manual se a função não existir no banco
    await manualSyncAgenda();
  } else {
    // Sincronização manual complementar para garantir que os bairros também estejam atualizados
    await manualSyncAgenda();
  }

  console.log('Processo concluído!');
}

async function manualSyncAgenda() {
  const { data: visitas } = await supabase
    .from('agenda_visitas')
    .select('id, cliente_id');

  for (const v of (visitas || [])) {
    const { data: client } = await supabase
      .from('clientes')
      .select('latitude, longitude, bairro')
      .eq('id', v.cliente_id)
      .single();

    if (client) {
      await supabase
        .from('agenda_visitas')
        .update({
          latitude: client.latitude || null,
          longitude: client.longitude || null,
          bairro: client.bairro || null
        })
        .eq('id', v.id);
    }
  }
}

