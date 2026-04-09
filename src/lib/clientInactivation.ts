import { supabase } from './supabase';
import { subMonths, isBefore, parseISO } from 'date-fns';

export async function runAutomaticInactivation() {
  try {
    // 1. Fetch all active clients
    const { data: activeClients, error: fetchError } = await supabase
      .from('clientes')
      .select('id, ultima_compra, ativo')
      .eq('ativo', true);

    if (fetchError) throw fetchError;
    if (!activeClients || activeClients.length === 0) return;

    // 2. Define the threshold (6 months ago)
    const thresholdDate = subMonths(new Date(), 6);
    
    // 3. Identify clients to inactivate
    const clientsToInactivate = activeClients.filter(client => {
      if (!client.ultima_compra) return true; // No purchase ever = inactivate if active? 
      // User said "only remains active if has purchase in last 6 months". 
      // If they never bought, they don't have a purchase in the last 6 months.
      
      const lastPurchaseDate = parseISO(client.ultima_compra);
      return isBefore(lastPurchaseDate, thresholdDate);
    });

    if (clientsToInactivate.length === 0) return;

    console.log(`Inactivating ${clientsToInactivate.length} inactive clients...`);

    // 4. Update them in the database
    const idsToUpdate = clientsToInactivate.map(c => c.id);
    
    const { error: updateError } = await supabase
      .from('clientes')
      .update({ ativo: false })
      .in('id', idsToUpdate);

    if (updateError) throw updateError;
    
    console.log('Automatic inactivation completed successfully.');
  } catch (err) {
    console.error('Error during automatic inactivation:', err);
  }
}
