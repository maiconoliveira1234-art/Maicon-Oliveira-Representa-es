import { supabase } from '../lib/supabase';

/**
 * Geocodifica um endereço usando a API Nominatim (OpenStreetMap)
 */
export async function geocodeAddress(address: string, city: string, neighborhood?: string): Promise<{ lat: number; lng: number } | null> {
  // Joinville específica: Adiciona o bairro e estado para maior precisão
  const fullAddress = `${address}, ${neighborhood ? neighborhood + ', ' : ''}${city}, SC, Brasil`;
  
  const params = new URLSearchParams({
    format: 'json',
    q: fullAddress,
    limit: '1',
    addressdetails: '1'
  });
  
  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/search?${params.toString()}`,
      {
        headers: {
          'Accept-Language': 'pt-BR',
          'User-Agent': 'SalesApp/1.0'
        }
      }
    );
    const data = await response.json();
    
    if (data && data.length > 0) {
      // Se o nível do resultado (place_rank) for muito baixo (ex: < 20), 
      // provavelmente é apenas a cidade ou o bairro todo, não a casa.
      if (data[0].place_rank < 16) {
        console.warn(`Resultado muito genérico para ${fullAddress}:`, data[0].display_name);
        return null;
      }

      console.log(`Geocodificado: ${address} (${neighborhood}) -> ${data[0].lat}, ${data[0].lon}`);
      return {
        lat: parseFloat(data[0].lat),
        lng: parseFloat(data[0].lon)
      };
    }
    
    return null;
  } catch (error) {
    console.error('Geocoding failed:', error);
    return null;
  }
}

/**
 * Atualiza as coordenadas de um cliente no Supabase se ele tiver endereço mas não tiver coordenadas
 */
export async function ensureClientCoordinates(clientId: string) {
  const { data: client, error } = await supabase
    .from('clientes')
    .select('id, endereco, cidade, latitude, longitude')
    .eq('id', clientId)
    .single();

  if (error || !client) return;

  if (client.endereco && client.cidade && (!client.latitude || !client.longitude)) {
    const coords = await geocodeAddress(client.endereco, client.cidade);
    if (coords) {
      await supabase
        .from('clientes')
        .update({
          latitude: coords.lat,
          longitude: coords.lng
        })
        .eq('id', clientId);
    }
  }
}
