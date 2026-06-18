import { createClient } from '@supabase/supabase-js';

const getEnv = (key: string) => {
  const metaEnv = (import.meta as any).env;
  const val = (metaEnv && metaEnv[key]) || (process.env && (process.env as any)[key]);
  return (val && val !== 'undefined' && val !== 'null') ? val : null;
};

const supabaseUrl =
  getEnv('VITE_SUPABASE_URL') ||
  getEnv('NEXT_PUBLIC_SUPABASE_URL') ||
  'https://ljrzmbxposgfxcymamwk.supabase.co';

const supabaseAnonKey =
  getEnv('VITE_SUPABASE_ANON_KEY') ||
  getEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY') ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxqcnptYnhwb3NnZnhjeW1hbXdrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQxNzI4MjMsImV4cCI6MjA4OTc0ODgyM30.IkQxtru2CKYl8E9IguGR6GZvlOSDsU8cmgCMDWMuXcI';

if (!supabaseUrl.startsWith('http')) {
  console.warn('[Supabase] URL inválida. Verifique as variáveis de ambiente.');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
