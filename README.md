# Maicon Oliveira Representações

Aplicativo web para apoiar a rotina comercial de representante de vendas.

## O que o app faz

- Agenda visitas de clientes
- Consulta e gerencia clientes
- Consulta preços e histórico de vendas
- Cria pedidos
- Controla estoque por cliente
- Acompanha metas e comissões
- Ajuda em rotas, mapas e organização de território
- Importa dados e mantém informações comerciais atualizadas

## Tecnologias usadas

- React
- TypeScript
- Vite
- Tailwind CSS
- Supabase
- Google Maps
- Gemini API

## Como rodar localmente

**Pré-requisito:** instalar o Node.js.

1. Instale as dependências:

```bash
npm install
```

2. Crie um arquivo `.env.local` com base no arquivo `.env.example`.

3. Preencha as chaves necessárias no `.env.local`.

4. Rode o app:

```bash
npm run dev
```

5. Abra o endereço mostrado no terminal. Normalmente será:

```text
http://localhost:3000
```

## Variáveis de ambiente

As principais configurações ficam no arquivo `.env.local`.

```env
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
VITE_GOOGLE_MAPS_PLATFORM_KEY=
GEMINI_API_KEY=
```

## Observação importante

Não coloque chaves secretas diretamente no código. Use sempre `.env.local` no computador e variáveis de ambiente na hospedagem.

O arquivo `.env.local` não deve ser enviado para o GitHub.
