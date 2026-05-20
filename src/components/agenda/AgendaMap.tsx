import React, { useMemo, useState } from 'react';
import { Map, AdvancedMarker, Pin, InfoWindow, useAdvancedMarkerRef } from '@vis.gl/react-google-maps';
import { Visita } from '../../types/agenda';
import { cn } from '../../lib/utils';
import { MapPin } from 'lucide-react';

interface AgendaMapProps {
  visitas: Visita[];
  selectedVisita: Visita | null;
  onSelectVisita: (visita: Visita) => void;
}

const API_KEY =
  process.env.GOOGLE_MAPS_PLATFORM_KEY ||
  (import.meta as any).env?.VITE_GOOGLE_MAPS_PLATFORM_KEY ||
  (globalThis as any).GOOGLE_MAPS_PLATFORM_KEY ||
  '';
const hasValidKey = Boolean(API_KEY) && API_KEY !== 'YOUR_API_KEY';

const getMarkerColors = (status: string, isSelected: boolean) => {
  if (status === 'concluida') return { bg: '#10b981', glyph: '#ffffff', border: '#ffffff' };
  if (isSelected) return { bg: '#f97316', glyph: '#ffffff', border: '#ffffff' };
  return { bg: '#3b82f6', glyph: '#ffffff', border: '#ffffff' };
};

const VisitaMarker: React.FC<{
  visita: Visita;
  isSelected: boolean;
  onSelect: () => void;
}> = ({ visita, isSelected, onSelect }) => {
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
        <InfoWindow anchor={marker} onCloseClick={() => {}}>
          <div className="p-1 min-w-[150px]">
            <p className="text-xs font-black text-neutral-900 m-0">{visita.cliente_nome}</p>
            <p className="text-[10px] text-neutral-500 m-0">{visita.cidade}</p>
            <div className="mt-2 flex items-center justify-between gap-2 border-t border-neutral-100 pt-1.5">
              <span className={cn(
                "text-[9px] font-black tracking-wider px-1.5 py-0.5 rounded-full uppercase",
                visita.status === 'concluida' ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'
              )}>
                {visita.status}
              </span>
              <span className="text-[10px] font-bold text-neutral-700">{visita.horario_inicio}</span>
            </div>
          </div>
        </InfoWindow>
      )}
    </>
  );
};

export const AgendaMap: React.FC<AgendaMapProps> = ({ visitas, selectedVisita, onSelectVisita }) => {
  const center = useMemo<google.maps.LatLngLiteral>(() => {
    const withCoords = visitas.filter(v => v.latitude && v.longitude);
    if (withCoords.length === 0) return { lat: -29.6842, lng: -53.8069 }; // Default
    
    const lat = withCoords.reduce((acc, v) => acc + (v.latitude || 0), 0) / withCoords.length;
    const lng = withCoords.reduce((acc, v) => acc + (v.longitude || 0), 0) / withCoords.length;
    return { lat, lng };
  }, [visitas]);

  const mapCenter = useMemo<google.maps.LatLngLiteral>(() => {
    if (selectedVisita?.latitude && selectedVisita?.longitude) {
      return { lat: selectedVisita.latitude, lng: selectedVisita.longitude };
    }
    return center;
  }, [selectedVisita, center]);

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
        center={mapCenter}
        zoom={12}
        mapId="agenda_map_view"
        internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
        style={{ width: '100%', height: '100%' }}
      >
        {visitas.map(v => {
          if (!v.latitude || !v.longitude) return null;
          return (
            <VisitaMarker
              key={v.id}
              visita={v}
              isSelected={selectedVisita?.id === v.id}
              onSelect={() => onSelectVisita(v)}
            />
          );
        })}
      </Map>
    </div>
  );
};
