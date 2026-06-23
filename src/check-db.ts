import { supabase } from './lib/supabase';

async function run() {
  console.log("Checking database functions...");
  // Querying pg_proc via a select if we have a view, or trying to see what we can query
  const { data: rpcFuncs, error } = await supabase
    .from('clientes')
    .select('*')
    .limit(1);

  // Let's try to query public schemas of functions if we can, but since PostgREST doesn't expose pg_proc directly,
  // we can check if we can query pg_catalog or information_schema.
  const { data: views, error: viewErr } = await supabase
    .from('pg_catalog.pg_proc' as any)
    .select('proname')
    .limit(10);
  
  if (viewErr) {
    console.log("Cannot query pg_proc directly:", viewErr.message);
  } else {
    console.log("pg_proc:", views);
  }
}

run();
