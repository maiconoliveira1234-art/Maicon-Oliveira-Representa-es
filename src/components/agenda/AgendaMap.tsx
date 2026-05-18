import React, { useMemo, useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import { Visita } from '../../types/agenda';
import { cn } from '../../lib/utils';

interface AgendaMapProps {
  visitas: Visita[];
  selectedVisita: Visita | null;
  onSelectVisita: (visita: Visita) => void;
}

// Fix for Leaflet default icon issues
const createCustomIcon = (status: string, isSelected: boolean) => {
  const color = status === 'concluida' ? '#10b981' : isSelected ? '#f54900' : '#4285F4';
  
  return L.divIcon({
    className: 'custom-div-icon',
    html: `
      <div style="
        background-color: ${color};
        width: 12px;
        height: 12px;
        border-radius: 50%;
        border: 2px solid white;
        box-shadow: 0 0 4px rgba(0,0,0,0.3);
        transform: scale(${isSelected ? 1.5 : 1});
        transition: all 0.2s;
      "></div>
    `,
    iconSize: [12, 12],
    iconAnchor: [6, 6],
    popupAnchor: [0, -6]
  });
};

// Component to handle map center changes
const MapEffect = ({ center, visitas }: { center: [number, number], visitas: Visita[] }) => {
  const map = useMap();
  
  useEffect(() => {
    map.setView(center, map.getZoom());
  }, [center, map]);

  return null;
};

export const AgendaMap: React.FC<AgendaMapProps> = ({ visitas, selectedVisita, onSelectVisita }) => {
  const center = useMemo<[number, number]>(() => {
    const withCoords = visitas.filter(v => v.latitude && v.longitude);
    if (withCoords.length === 0) return [-29.6842, -53.8069]; // Default
    
    const lat = withCoords.reduce((acc, v) => acc + (v.latitude || 0), 0) / withCoords.length;
    const lng = withCoords.reduce((acc, v) => acc + (v.longitude || 0), 0) / withCoords.length;
    return [lat, lng];
  }, [visitas]);

  return (
    <div className="w-full h-[400px] rounded-[2.5rem] overflow-hidden border border-neutral-200 shadow-sm mb-6 z-0">
      <MapContainer
        center={center}
        zoom={12}
        scrollWheelZoom={true}
        style={{ width: '100%', height: '100%' }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <MapEffect center={center} visitas={visitas} />
        {visitas.map(v => {
          if (!v.latitude || !v.longitude) return null;
          
          return (
            <Marker 
              key={v.id} 
              position={[v.latitude, v.longitude]}
              icon={createCustomIcon(v.status, selectedVisita?.id === v.id)}
              eventHandlers={{
                click: () => onSelectVisita(v),
              }}
            >
              <Popup>
                <div className="p-0.5">
                  <p className="text-xs font-black text-neutral-900 m-0">{v.cliente_nome}</p>
                  <p className="text-[10px] text-neutral-500 m-0">{v.cidade}</p>
                  <div className="mt-1.5 flex items-center justify-between gap-3">
                    <span className={cn(
                      "text-[9px] font-bold px-1.5 py-0.5 rounded-full",
                      v.status === 'concluida' ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'
                    )}>
                      {v.status.toUpperCase()}
                    </span>
                    <span className="text-[10px] font-black">{v.horario_inicio}</span>
                  </div>
                </div>
              </Popup>
            </Marker>
          );
        })}
      </MapContainer>
    </div>
  );
};
