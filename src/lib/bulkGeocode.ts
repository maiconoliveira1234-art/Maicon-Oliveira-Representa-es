import { supabase } from './supabase';
import { geocodeAddress } from '../services/geocodingService';

export async function bulkGeocodeClients() {
  console.log('Iniciando geocodificação em massa...');
  
  // 1. Busca clientes sem coordenadas mas com endereço
  // Tentamos pegar o bairro, se falhar (coluna inexistente), pegamos sem ele
  const { data: clients, error } = await supabase
    .from('clientes')
    .select('id, cliente, endereco, cidade, latitude, longitude')
    .is('latitude', null);

  if (error) {
    console.error('Erro ao buscar clientes:', error);
    return;
  }

  console.log(`${clients?.length} clientes encontrados para processar.`);

  for (const client of (clients || [])) {
    if (client.endereco && client.cidade) {
      // Tenta recuperar o bairro se a propriedade existir (caso a coluna tenha sido criada)
      const bairro = (client as any).bairro || '';
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
  }

  console.log('Processo concluído!');
}

async function manualSyncAgenda() {
  const { data: visitas } = await supabase
    .from('agenda_visitas')
    .select('id, cliente_id')
    .is('latitude', null);

  for (const v of (visitas || [])) {
    const { data: client } = await supabase
      .from('clientes')
      .select('latitude, longitude')
      .eq('id', v.cliente_id)
      .single();

    if (client?.latitude) {
      await supabase
        .from('agenda_visitas')
        .update({
          latitude: client.latitude,
          longitude: client.longitude
        })
        .eq('id', v.id);
    }
  }
}
