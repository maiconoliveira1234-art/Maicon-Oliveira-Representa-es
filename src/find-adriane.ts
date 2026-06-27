import { supabase } from './lib/supabase';

async function run() {
  const { data: clients, error } = await supabase.from('clientes').select('*').ilike('cliente', '%adriane ristow%');
  if (error) {
    console.error("Error fetching client:", error);
    return;
  }
  
  console.log("=== ADRIANE RISTOW FIND ===");
  console.log(clients);
  
  if (clients && clients.length > 0) {
    const cid = clients[0].id;
    const [hist, stock] = await Promise.all([
      supabase.from('hist_vendas').select('*').eq('cliente_id', cid),
      supabase.from('estoque_cliente').select('*').eq('cliente_id', cid)
    ]);
    
    console.log(`History count: ${hist.data?.length || 0}`);
    console.log(`Stock count: ${stock.data?.length || 0}`);
    if (hist.data && hist.data.length > 0) {
      console.log("Sample history:", hist.data[0]);
    }
  }
}

run();
