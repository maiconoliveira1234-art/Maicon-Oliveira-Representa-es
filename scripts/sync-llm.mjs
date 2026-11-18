// Copies shared code next to each edge function that uses it.
// Edge functions are deployed folder by folder, so each keeps its own identical copy.
//   supabase/functions/_shared/llm.ts -> functions that call the AI models
//   src/lib/productMatch.ts           -> functions that recognize catalog products
import { copyFileSync } from 'node:fs';

const copies = [
  ['supabase/functions/_shared/llm.ts', 'llm.ts', ['whatsapp-cloud-audio-transcribe', 'whatsapp-suggest', 'whatsapp-order-analyze']],
  ['src/lib/productMatch.ts', 'productMatch.ts', ['whatsapp-order-analyze', 'whatsapp-learning-review']],
];
for (const [source, file, targets] of copies) {
  for (const name of targets) {
    copyFileSync(source, `supabase/functions/${name}/${file}`);
    console.log(`${file} -> ${name}`);
  }
}
