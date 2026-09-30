import React, { useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { WhatsAppContactsPage } from './WhatsAppContactsPage';

export function WhatsAppInboxPage() {
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

  return <WhatsAppContactsPage />;
}
