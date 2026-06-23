import { supabase } from '../lib/supabase';

const API_KEY = (
  process.env.GOOGLE_MAPS_PLATFORM_KEY ||
  (import.meta as any).env?.VITE_GOOGLE_MAPS_PLATFORM_KEY ||
  (globalThis as any).GOOGLE_MAPS_PLATFORM_KEY ||
  ''
).trim();

const hasValidKey =
  Boolean(API_KEY) &&
  API_KEY !== 'YOUR_API_KEY' &&
  API_KEY !== 'undefined' &&
  API_KEY !== 'null' &&
  API_KEY.startsWith('AIzaSy') &&
  API_KEY.length >= 20;

// Local in-memory cache to avoid reading localStorage repeatedly
const memoryGeocodeCache: Record<string, { lat: number; lng: number }> = {};

function getNormalizedKey(address: string, city: string, neighborhood?: string): string {
  const addr = address.trim().toLowerCase();
  const neigh = (neighborhood || '').trim().toLowerCase();
  const cty = city.trim().toLowerCase();
  return `${addr}|${neigh}|${cty}`;
}

/**
 * Recovers coordinates from the local Cache (localStorage & In-Memory)
 */
function getCachedCoords(key: string): { lat: number; lng: number } | null {
  try {
    if (memoryGeocodeCache[key]) {
      return memoryGeocodeCache[key];
    }
    const cached = localStorage.getItem(`gmaps_geocode_cache_${key}`);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (parsed && typeof parsed.lat === 'number' && typeof parsed.lng === 'number') {
        memoryGeocodeCache[key] = parsed;
        return parsed;
      }
    }
  } catch (e) {
    console.error('[Geocode Cache] Failed to read from local storage:', e);
  }
  return null;
}

/**
 * Saves coordinates to the local Cache
 */
function setCachedCoords(key: string, coords: { lat: number; lng: number }) {
  try {
    memoryGeocodeCache[key] = coords;
    localStorage.setItem(`gmaps_geocode_cache_${key}`, JSON.stringify(coords));
  } catch (e) {
    console.error('[Geocode Cache] Failed to save to local storage:', e);
  }
}

/**
 * Query the Supabase database for coordinates of matching addresses
 * to completely avoid calling Google Geocoding API repeatedly
 */
async function searchDatabaseCoords(address: string, city: string): Promise<{ lat: number; lng: number } | null> {
  try {
    const { data, error } = await supabase
      .from('clientes')
      .select('latitude, longitude')
      .eq('endereco', address)
      .eq('cidade', city)
      .not('latitude', 'is', null)
      .limit(1);

    if (!error && data && data.length > 0) {
      const { latitude, longitude } = data[0];
      if (latitude && longitude) {
        return { lat: Number(latitude), lng: Number(longitude) };
      }
    }
  } catch (e) {
    console.error('[Geocode DB Cache] Error searching coordinates in Supabase client data:', e);
  }
  return null;
}

/**
 * Safe helper to retrieve the global window.google.maps instance when fully loaded
 */
async function getGoogleMapsNamespace(): Promise<any> {
  if (typeof window !== 'undefined' && (window as any).google?.maps) {
    return (window as any).google.maps;
  }
  return null;
}

/**
 * Dynamic Geocoding via loaded window.google.maps
 */
async function geocodeWithGoogle(fullAddress: string): Promise<{ lat: number; lng: number } | null> {
  if (!hasValidKey) return null;
  const gmaps = await getGoogleMapsNamespace();
  if (!gmaps) return null;

  try {
    // Dynamically import or reference the geocoding library using google.maps.importLibrary
    const geocodingLib = gmaps.importLibrary 
      ? await gmaps.importLibrary('geocoding') 
      : (gmaps as any).geocoding;

    if (!geocodingLib) return null;
    const geocoder = new geocodingLib.Geocoder();
    
    return new Promise((resolve) => {
      geocoder.geocode({ address: fullAddress }, (results: any, status: string) => {
        if (status === 'OK' && results && results[0]?.geometry?.location) {
          const loc = results[0].geometry.location;
          resolve({
            lat: typeof loc.lat === 'function' ? loc.lat() : loc.lat,
            lng: typeof loc.lng === 'function' ? loc.lng() : loc.lng
          });
        } else {
          console.warn(`[Google Geocode] Failed with status: ${status}`);
          resolve(null);
        }
      });
    });
  } catch (error) {
    console.error('[Google Geocode] Error in Geocoding request:', error);
    return null;
  }
}

/**
 * Nominatim (OSM) Geocoding as a highly reliable fallback
 */
async function geocodeWithNominatim(fullAddress: string): Promise<{ lat: number; lng: number } | null> {
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
      if (data[0].place_rank < 16) {
        console.warn(`[Nominatim Geocode] Result too generic for ${fullAddress}:`, data[0].display_name);
        return null;
      }
      return {
        lat: parseFloat(data[0].lat),
        lng: parseFloat(data[0].lon)
      };
    }
  } catch (error) {
    console.error('[Nominatim Geocode] Geocoding request failed:', error);
  }
  return null;
}

/**
 * Geocodifica um endereço usando Cache Local -> Cache Supabase -> Google Maps Geocoding API -> Nominatim Fallback
 */
export async function geocodeAddress(address: string, city: string, neighborhood?: string): Promise<{ lat: number; lng: number } | null> {
  if (!address || !city) return null;

  const normalizedKey = getNormalizedKey(address, city, neighborhood);

  // 1. Check local memory/localStorage cache
  const cached = getCachedCoords(normalizedKey);
  if (cached) {
    console.log(`[Cache Local] Coordenadas recuperadas para: ${address}, ${city}`);
    return cached;
  }

  // 2. Check Supabase DB cache for this exact address to save Google Maps API costs
  const dbCoords = await searchDatabaseCoords(address, city);
  if (dbCoords) {
    console.log(`[Cache Supabase] Coordenadas reutilizadas do banco de dados para: ${address}, ${city}`);
    setCachedCoords(normalizedKey, dbCoords);
    return dbCoords;
  }

  // 3. Fallback to Geocoding APIs
  const fullAddress = `${address}, ${neighborhood ? neighborhood + ', ' : ''}${city}, SC, Brasil`;
  
  let coords = null;
  if (hasValidKey) {
    console.log(`[Google Maps API] Buscando coordenadas online para: ${fullAddress}`);
    coords = await geocodeWithGoogle(fullAddress);
  }

  if (!coords) {
    console.log(`[Nominatim API Fallback] Buscando coordenadas online para: ${fullAddress}`);
    coords = await geocodeWithNominatim(fullAddress);
  }

  if (coords) {
    setCachedCoords(normalizedKey, coords);
  }

  return coords;
}

export interface PlaceSuggestion {
  description: string;
  placeId: string;
}

// Simple memory cache for autocomplete input results to avoid repeated query calls on keystrokes
const autocompleteCache: Record<string, PlaceSuggestion[]> = {};

/**
 * Programmatic Autocomplete Suggestions using google.maps.places.AutocompleteService
 * Implements caching and Brazil filtering to minimize Places API overhead.
 */
export async function getAddressSuggestions(input: string): Promise<PlaceSuggestion[]> {
  if (!hasValidKey || !input || input.trim().length < 3) return [];
  
  const query = input.trim().toLowerCase();
  if (autocompleteCache[query]) {
    console.log(`[Autocomplete Cache] Returning cached suggestions for: "${query}"`);
    return autocompleteCache[query];
  }

  const gmaps = await getGoogleMapsNamespace();
  if (!gmaps) return [];

  try {
    // Dynamic import of the library via window.google.maps
    const placesLib = gmaps.importLibrary 
      ? await gmaps.importLibrary('places') 
      : (gmaps as any).places;

    if (!placesLib) return [];
    const service = new placesLib.AutocompleteService();

    return new Promise((resolve) => {
      service.getPlacePredictions({
        input: input,
        componentRestrictions: { country: 'br' }, // Restringe resultados para o Brasil (foco da distribuição)
        types: ['address']
      }, (predictions: any, status: string) => {
        if (status === 'OK' && predictions) {
          const results = predictions.map((p: any) => ({
            description: p.description,
            placeId: p.place_id
          }));
          autocompleteCache[query] = results;
          resolve(results);
        } else {
          resolve([]);
        }
      });
    });
  } catch (error) {
    console.error('[Autocomplete API] Failed to fetch auto-suggestions:', error);
    return [];
  }
}

/**
 * lock check to prevent multiple geocoding tries inside the same minute
 */
const lastLocationUpdate: Record<string, number> = {};

/**
 * Update client coordinates in Supabase with rate-limiting of 1 min maximum per client
 */
export async function ensureClientCoordinates(clientId: string) {
  const now = Date.now();
  const lastUpdate = lastLocationUpdate[clientId] || 0;
  
  // Rule: Max once per minute per location update to prevent abusive loads
  if (now - lastUpdate < 60000) {
    console.log(`[Optimization] Geolocation update for client ${clientId} ignored. Limit: Max 1 per minute.`);
    return;
  }

  const { data: client, error } = await supabase
    .from('clientes')
    .select('id, endereco, cidade, latitude, longitude')
    .eq('id', clientId)
    .single();

  if (error || !client) return;

  if (client.endereco && client.cidade && (!client.latitude || !client.longitude)) {
    const coords = await geocodeAddress(client.endereco, client.cidade);
    if (coords) {
      lastLocationUpdate[clientId] = now;
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
