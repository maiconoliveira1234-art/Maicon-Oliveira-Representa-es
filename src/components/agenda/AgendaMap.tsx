import React, { useMemo, useState } from 'react';
import { Map, AdvancedMarker, Pin, InfoWindow, useAdvancedMarkerRef, useMap } from '@vis.gl/react-google-maps';
import { Visita } from '../../types/agenda';
import { cn } from '../../lib/utils';
import { MapPin } from 'lucide-react';

interface AgendaMapProps {
  visitas: Visita[];
  selectedVisita: Visita | null;
  onSelectVisita: (visita: Visita | null) => void;
}

const API_KEY =
  process.env.GOOGLE_MAPS_PLATFORM_KEY ||
  (import.meta as any).env?.VITE_GOOGLE_MAPS_PLATFORM_KEY ||
  (globalThis as any).GOOGLE_MAPS_PLATFORM_KEY ||
  '';
const hasValidKey = Boolean(API_KEY) && API_KEY !== 'YOUR_API_KEY';

const getStatusBadgeClass = (status: string) => {
  switch (status) {
    case 'concluida': return 'text-emerald-600 bg-emerald-50 border-emerald-100';
    case 'pendente': return 'text-orange-600 bg-orange-50 border-orange-100';
    case 'reagendada': return 'text-amber-600 bg-amber-50 border-amber-100';
    case 'cancelada': return 'text-rose-600 bg-rose-50 border-rose-100';
    default: return 'text-slate-600 bg-slate-50 border-slate-100';
  }
};

const getStatusLabel = (status: string) => {
  switch (status) {
    case 'concluida': return 'CONCLUÍDA';
    case 'pendente': return 'PENDENTE';
    case 'reagendada': return 'REAGENDADA';
    case 'cancelada': return 'CANCELADA';
    default: return status.toUpperCase();
  }
};

const getMarkerColors = (status: string, isSelected: boolean) => {
  let bg = '#64748b'; // default Slate 500
  switch (status) {
    case 'concluida':
      bg = '#10b981'; // Emerald 500
      break;
    case 'pendente':
      bg = '#f97316'; // Orange 500
      break;
    case 'reagendada':
      bg = '#f59e0b'; // Amber 500
      break;
    case 'cancelada':
      bg = '#f43f5e'; // Rose 500
      break;
  }
  
  return {
    bg,
    glyph: '#ffffff',
    border: isSelected ? '#171717' : '#ffffff'
  };
};

const VisitaMarker: React.FC<{
  visita: Visita;
  isSelected: boolean;
  onSelect: () => void;
  onClose: () => void;
}> = ({ visita, isSelected, onSelect, onClose }) => {
  const [markerRef, marker] = useAdvancedMarkerRef();
  const colors = getMarkerColors(visita.status, isSelected);

  return (
    <>
      <AdvancedMarker
        ref={markerRef}
        position={{ lat: visita.latitude!, lng: visita.longitude! }}
        onClick={onSelect}
      >
        <Pin background={colors.bg} glyphColor={colors.glyph} borderColor={colors.border} />
      </AdvancedMarker>
      {isSelected && (
        <InfoWindow anchor={marker} onCloseClick={onClose}>
          <div className="p-1 min-w-[150px]">
            <p className="text-xs font-black text-neutral-900 m-0">{visita.cliente_nome}</p>
            <p className="text-[10px] text-neutral-500 m-0">{visita.cidade}</p>
            <div className="mt-2 flex items-center justify-between gap-2 border-t border-neutral-100 pt-1.5">
              <span className={cn(
                "text-[8px] font-black tracking-tight px-1.5 py-0.5 rounded border uppercase",
                getStatusBadgeClass(visita.status)
              )}>
                {getStatusLabel(visita.status)}
              </span>
              <span className="text-[10px] font-bold text-neutral-700">{visita.horario_inicio}</span>
            </div>
          </div>
        </InfoWindow>
      )}
    </>
  );
};

const MapBoundsAdjuster: React.FC<{ visitas: Visita[] }> = ({ visitas }) => {
  const map = useMap();

  const coordsKey = useMemo(() => {
    return visitas
      .filter(v => v.latitude && v.longitude)
      .map(v => `${v.id}:${v.latitude},${v.longitude}`)
      .join('|');
  }, [visitas]);

  React.useEffect(() => {
    if (typeof google === 'undefined' || !map) return;
    const withCoords = visitas.filter(v => v.latitude && v.longitude);
    if (withCoords.length === 0) return;

    if (withCoords.length === 1) {
      map.setCenter({ lat: withCoords[0].latitude!, lng: withCoords[0].longitude! });
      map.setZoom(14);
    } else {
      const bounds = new google.maps.LatLngBounds();
      withCoords.forEach(v => {
        bounds.extend({ lat: v.latitude!, lng: v.longitude! });
      });
      map.fitBounds(bounds);

      const listener = google.maps.event.addListenerOnce(map, 'idle', () => {
        const currentZoom = map.getZoom();
        if (currentZoom !== undefined && currentZoom > 14) {
          map.setZoom(14);
        }
      });
      return () => {
        google.maps.event.removeListener(listener);
      };
    }
  }, [map, coordsKey]);

  return null;
};

const MapCenterAdjuster: React.FC<{ selectedVisita: Visita | null }> = ({ selectedVisita }) => {
  const map = useMap();

  React.useEffect(() => {
    if (!map || !selectedVisita?.latitude || !selectedVisita?.longitude) return;
    map.panTo({ lat: selectedVisita.latitude, lng: selectedVisita.longitude });
  }, [map, selectedVisita?.id]);

  return null;
};

export const AgendaMap: React.FC<AgendaMapProps> = ({ visitas, selectedVisita, onSelectVisita }) => {
  const center = useMemo<google.maps.LatLngLiteral>(() => {
    const withCoords = visitas.filter(v => v.latitude && v.longitude);
    if (withCoords.length === 0) return { lat: -29.6842, lng: -53.8069 }; // Default
    
    const lat = withCoords.reduce((acc, v) => acc + (v.latitude || 0), 0) / withCoords.length;
    const lng = withCoords.reduce((acc, v) => acc + (v.longitude || 0), 0) / withCoords.length;
    return { lat, lng };
  }, [visitas]);

  if (!hasValidKey) {
    return (
      <div className="w-full h-[400px] rounded-[2.5rem] bg-neutral-50 border border-neutral-200 flex flex-col items-center justify-center p-6 text-center mb-6">
        <div className="max-w-md space-y-4">
          <div className="w-12 h-12 bg-neutral-100 rounded-2xl flex items-center justify-center mx-auto text-neutral-500">
            <MapPin size={24} />
          </div>
          <h3 className="text-sm font-black uppercase tracking-widest text-neutral-800">
            Google Maps API Key Necessária
          </h3>
          <p className="text-xs text-neutral-500 leading-relaxed max-w-sm mx-auto">
            Para ativar a visão de mapa de alta precisão, configure sua API Key do Google Maps Platform.
          </p>
          <div className="bg-white border border-neutral-200 rounded-2xl p-4 text-left text-[11px] space-y-2.5 text-neutral-600 shadow-sm">
            <div className="flex gap-2">
              <span className="font-bold text-neutral-800">1.</span>
              <p>
                Obtenha uma API Key no <a href="https://console.cloud.google.com/google/maps-apis/start?utm_campaign=gmp-code-assist-ais" target="_blank" rel="noopener noreferrer" className="text-orange-600 font-bold hover:underline">Google Cloud Console</a>.
              </p>
            </div>
            <div className="flex gap-2 border-t border-neutral-100 pt-2.5">
              <span className="font-bold text-neutral-800">2.</span>
              <p>
                Abra as <strong>Configurações</strong> do Workspace (ícone de engrenagem no canto superior direito) → clique em <strong>Secrets</strong> → adicione o nome <code>GOOGLE_MAPS_PLATFORM_KEY</code> e cole a chave no valor.
              </p>
            </div>
          </div>
          <p className="text-[10px] text-neutral-400">
            O aplicativo será reconstruído automaticamente.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-[400px] rounded-[2.5rem] overflow-hidden border border-neutral-200 shadow-sm mb-6 z-0">
      <Map
        defaultCenter={center}
        defaultZoom={13}
        mapId="agenda_map_view"
        internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
        style={{ width: '100%', height: '100%' }}
      >
        <MapBoundsAdjuster visitas={visitas} />
        <MapCenterAdjuster selectedVisita={selectedVisita} />
        {visitas.map(v => {
          if (!v.latitude || !v.longitude) return null;
          return (
            <VisitaMarker
              key={v.id}
              visita={v}
              isSelected={selectedVisita?.id === v.id}
              onSelect={() => onSelectVisita(v)}
              onClose={() => onSelectVisita(null)}
            />
          );
        })}
      </Map>
    </div>
  );
};
