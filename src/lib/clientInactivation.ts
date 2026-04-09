import { supabase } from './supabase';
import { subMonths, isBefore, parseISO } from 'date-fns';

export async function runAutomaticInactivation() {
  try {
    // 1. Fetch all active clients
    const { data: activeClients, error: fetchError } = await supabase
      .from('clientes')
      .select('id, cliente')
      .eq('ativo', true);

    if (fetchError) throw fetchError;
    if (!activeClients || activeClients.length === 0) return;

    // 2. Fetch the latest sale for each active client
    // We fetch all sales for these clients and then find the max date per client
    const { data: sales, error: salesError } = await supabase
      .from('hist_vendas')
      .select('cliente_id, faturamento')
      .in('cliente_id', activeClients.map(c => c.id));

    if (salesError) throw salesError;

    const latestSalesMap: Record<string, string> = {};
    sales?.forEach(s => {
      if (!latestSalesMap[s.cliente_id] || isBefore(parseISO(latestSalesMap[s.cliente_id]), parseISO(s.faturamento))) {
        latestSalesMap[s.cliente_id] = s.faturamento;
      }
    });

    // 3. Define the threshold (6 months ago)
    const thresholdDate = subMonths(new Date(), 6);
    
    // 4. Identify clients to inactivate
    const clientsToInactivate = activeClients.filter(client => {
      const lastPurchase = latestSalesMap[client.id];
      if (!lastPurchase) return true; // No purchase found = inactivate
      
      const lastPurchaseDate = parseISO(lastPurchase);
      return isBefore(lastPurchaseDate, thresholdDate);
    });

    if (clientsToInactivate.length === 0) {
      console.log('No clients to inactivate.');
      return;
    }

    console.log(`Inactivating ${clientsToInactivate.length} inactive clients...`);

    // 5. Update them in the database
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
