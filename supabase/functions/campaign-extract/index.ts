import { GoogleGenAI } from 'npm:@google/genai@1.29.0';
import { CAMPAIGN_EXTRACTION_PROMPT, createCampaignExtractHandler } from './handler.ts';

Deno.serve(createCampaignExtractHandler({
  apiKey: Deno.env.get('GEMINI_API_KEY'),
  generate: async ({ apiKey, mimeType, data }) => {
    const ai = new GoogleGenAI({ apiKey });
    const result = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [{
        role: 'user',
        parts: [
          { text: CAMPAIGN_EXTRACTION_PROMPT },
          { inlineData: { mimeType, data } },
        ],
      }],
      config: { responseMimeType: 'application/json', temperature: 0.1, httpOptions: { timeout: 60_000 } },
    });
    return result.text || '';
  },
}));
