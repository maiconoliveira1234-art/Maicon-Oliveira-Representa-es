import React, { useEffect } from 'react';
import { EyeOff, ShieldCheck } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { WhatsAppContactsPage } from './WhatsAppContactsPage';

export function WhatsAppInboxPage() {
  const navigate = useNavigate();

  useEffect(() => {
    const markCapturedMessagesAsSeen = async () => {
      const { error } = await supabase
        .from('whatsapp_mensagens')
        .update({ visualizada_em: new Date().toISOString() })
        .is('visualizada_em', null);

      if (error) {
        console.warn('Não foi possível marcar as mensagens do WhatsApp como visualizadas no CRM:', error);
      }
    };

    void markCapturedMessagesAsSeen();
  }, []);

  return (
    <>
      <div className="mx-auto mb-3 flex max-w-3xl justify-end gap-2">
        <button
          type="button"
          onClick={() => navigate('/whatsapp/ocultos')}
          className="inline-flex items-center gap-2 rounded-xl border border-neutral-200 bg-white px-3 py-2 text-xs font-black text-neutral-700"
        >
          <EyeOff size={15} /> Ocultos
        </button>
        <button
          type="button"
          onClick={() => navigate('/whatsapp/regras')}
          className="inline-flex items-center gap-2 rounded-xl border border-violet-200 bg-violet-50 px-3 py-2 text-xs font-black text-violet-700"
        >
          <ShieldCheck size={15} /> Regras da IA
        </button>
      </div>
      <WhatsAppContactsPage />
    </>
  );
}
