# Leitura de encartes com IA

A tela de campanhas envia a imagem para a Edge Function `campaign-extract`,
que chama o Gemini no servidor e devolve um rascunho para revisão humana.
O deploy do frontend na Vercel não publica essa função no Supabase.

## Configuração e publicação

1. No projeto Supabase usado pelo CRM, confira a presença de `GEMINI_API_KEY`
   em **Edge Functions → Secrets**. Configure o valor nessa interface segura.
   Uma variável definida apenas na Vercel ou no `.env.local` não configura a
   função remota. Não envie o valor da chave em mensagens ou logs.
2. Com a CLI Supabase já autenticada e acesso ao projeto, execute na raiz:

   ```bash
   supabase functions deploy campaign-extract --project-ref ljrzmbxposgfxcymamwk
   ```

   Publique a pasta completa, incluindo `handler.ts`. Preserve a verificação
   de JWT padrão; não use `--no-verify-jwt` para contornar falhas de autenticação.
3. Publique também o frontend atualizado pelo fluxo habitual do repositório.
4. Na aplicação, anexe um encarte JPG, PNG ou WebP de até 1 MB e use
   **Ler imagem com IA**. Confira as condições antes de salvar ou ativar.

## Diagnóstico

A tela lê o JSON de falha da função, inclusive de versões anteriores que
retornam apenas `{ "error": "..." }`, em vez de exibir o erro genérico
`Edge Function returned a non-2xx status code` do SDK.

- `AI_NOT_CONFIGURED` (503): falta `GEMINI_API_KEY` nos Secrets do Supabase.
- `AI_CONFIGURATION_ERROR` (503): o provedor recusou a solicitação; confira
  chave, permissões e configuração do serviço.
- `AI_RATE_LIMITED` (429): confira cota/faturamento no projeto Gemini e tente
  novamente depois.
- `AI_MODEL_UNAVAILABLE` (503): confira disponibilidade do modelo configurado
  na função (`gemini-2.5-flash`).
- `AI_TIMEOUT` (504) ou `AI_UNAVAILABLE` (503): tente novamente mais tarde.
- HTTP 401/403 do gateway: confira a autenticação e o projeto configurado no
  cliente. HTTP 404: confira se a função foi publicada no projeto correto.
- `BOOT_ERROR`: confira os logs de inicialização da função no Supabase.

As falhas mantêm o status HTTP de erro. O formulário e a imagem permanecem
disponíveis para nova tentativa. Logs da função registram status/nome do erro
do provedor, sem imagem, credenciais ou mensagem bruta do provedor.

## Validação local

```bash
npm run lint
./node_modules/.bin/tsx src/tests/campaignExtraction.test.ts
./node_modules/.bin/tsx src/tests/campaignEngine.test.ts
./node_modules/.bin/tsx src/tests/campaignSkuSearch.test.ts
npm run build
```

Os testes de extração percorrem o SDK Supabase real com transporte local e
provedor de IA simulado. Eles não consomem cota nem comprovam que a chave ou
o serviço remoto estejam funcionando. Para verificar também o entrypoint
da função com seu SDK Gemini fixado, use Deno:

```bash
deno check --no-lock --node-modules-dir=none supabase/functions/campaign-extract/index.ts
```
