// Copies supabase/functions/_shared/llm.ts next to each edge function that uses it.
// Edge functions are deployed folder by folder, so each keeps its own identical copy.
import { copyFileSync } from 'node:fs';

const targets = ['whatsapp-cloud-audio-transcribe', 'whatsapp-suggest', 'whatsapp-order-analyze'];
for (const name of targets) {
  copyFileSync('supabase/functions/_shared/llm.ts', `supabase/functions/${name}/llm.ts`);
  console.log(`llm.ts -> ${name}`);
}
