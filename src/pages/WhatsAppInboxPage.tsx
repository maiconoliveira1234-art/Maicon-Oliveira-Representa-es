import React from 'react';
import { WhatsAppContactsPage } from './WhatsAppContactsPage';

// Opening the inbox no longer marks every message as seen: each conversation is marked when it is opened.
export function WhatsAppInboxPage() {
  return <WhatsAppContactsPage />;
}
