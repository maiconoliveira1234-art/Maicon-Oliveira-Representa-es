import React, { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { supabase } from '../../lib/supabase';

const WARN_AT = 0.7;
const DANGER_AT = 0.9;
const mb = (bytes: number) => bytes >= 1073741824 ? `${(bytes / 1073741824).toFixed(1)} GB` : `${Math.round(bytes / 1048576)} MB`;

type Usage = { armazenamento_bytes: number; armazenamento_limite: number; banco_bytes: number; banco_limite: number };

/** Aviso discreto: so aparece quando arquivos ou banco passam de 70% do limite do plano. */
export function StorageUsageAlert() {
  const [usage, setUsage] = useState<Usage | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const { data, error } = await supabase.rpc('whatsapp_uso_armazenamento');
        if (error || !active) return;
        const row = Array.isArray(data) ? data[0] : data;
        if (row) setUsage({
          armazenamento_bytes: Number(row.armazenamento_bytes), armazenamento_limite: Number(row.armazenamento_limite),
          banco_bytes: Number(row.banco_bytes), banco_limite: Number(row.banco_limite),
        });
      } catch { /* o aviso e opcional */ }
    })();
    return () => { active = false; };
  }, []);

  if (!usage) return null;
  const items = [
    { label: 'Arquivos', used: usage.armazenamento_bytes, limit: usage.armazenamento_limite },
    { label: 'Banco de dados', used: usage.banco_bytes, limit: usage.banco_limite },
  ].filter(item => item.limit > 0 && item.used / item.limit >= WARN_AT);
  if (!items.length) return null;

  return (
    <div role="alert" className="mb-3 space-y-1">
      {items.map(item => {
        const ratio = item.used / item.limit;
        const danger = ratio >= DANGER_AT;
        return (
          <div key={item.label} className={`flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-bold ${danger ? 'bg-red-50 text-red-800' : 'bg-amber-50 text-amber-800'}`}>
            <AlertTriangle size={16} className="shrink-0" />
            {item.label} do Supabase em {Math.round(ratio * 100)}% ({mb(item.used)} de {mb(item.limit)})
          </div>
        );
      })}
    </div>
  );
}
