import { supabase } from './supabase';
import { subMonths, isBefore, parseISO } from 'date-fns';

export async function runAutomaticInactivation() {
  try {
    // 1. Fetch all clients
    const { data: allClients, error: fetchError } = await supabase
      .from('clientes')
      .select('id, cliente, ativo');

    if (fetchError) throw fetchError;
    if (!allClients || allClients.length === 0) return;

    // 2. Fetch the latest sale for each client
    const { data: sales, error: salesError } = await supabase
      .from('hist_vendas')
      .select('cliente_id, faturamento');

    if (salesError) throw salesError;

    const latestSalesMap: Record<string, string> = {};
    sales?.forEach(s => {
      if (!latestSalesMap[s.cliente_id] || isBefore(parseISO(latestSalesMap[s.cliente_id]), parseISO(s.faturamento))) {
        latestSalesMap[s.cliente_id] = s.faturamento;
      }
    });

    // 3. Define the threshold (6 months ago)
    const thresholdDate = subMonths(new Date(), 6);
    
    // 4. Identify clients to inactivate (Never automatically reactivate to honor manual choices)
    const idsToInactivate: string[] = [];

    allClients.forEach(client => {
      const lastPurchase = latestSalesMap[client.id];
      const hasRecentPurchase = lastPurchase && !isBefore(parseISO(lastPurchase), thresholdDate);

      // Only automatically inactivate those who are currently active but have no recent sales
      if (client.ativo === true && !hasRecentPurchase) {
        idsToInactivate.push(client.id);
      }
    });

    // 5. Perform updates
    if (idsToInactivate.length > 0) {
      console.log(`Inactivating ${idsToInactivate.length} clients...`);
      const { error: inactivateError } = await supabase
        .from('clientes')
        .update({ ativo: false })
        .in('id', idsToInactivate);
      if (inactivateError) throw inactivateError;
    }

    if (idsToInactivate.length === 0) {
      console.log('No changes needed for client status.');
    } else {
      console.log('Automatic status update completed successfully.');
    }
  } catch (err) {
    console.error('Error during automatic status update:', err);
  }
}
