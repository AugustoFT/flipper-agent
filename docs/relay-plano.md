# Plano do modo relay (Claude Pro → Flipper)

Objetivo: usar o Claude (assinatura Pro, sem chave de API) para controlar o Flipper.
O Claude chama o nosso app como **conector MCP**; o app no celular executa no Flipper.

```
App Claude ──HTTPS──► Worker /mcp (Cloudflare) ──WebSocket──► página no Bluefy (modo relay) ──BLE/USB──► Flipper
```

## Peças

1. **Specs compartilhadas**: mover `TOOL_SPECS` de `src/agent/tools.ts` para `src/agent/specs.ts`
   (sem dependências de canvas), importado pelo app e pelo Worker.
2. **Worker** (`relay/`, TypeScript, wrangler 4.x):
   - `@cloudflare/workers-oauth-provider` 1.2.4 com DCR (`clientRegistrationEndpoint`), binding KV `OAUTH_KV`,
     `apiRoute: '/mcp'`, metadados do recurso canônico em `/mcp`.
   - Página de consentimento: usuário digita o **código do aparelho** (mostrado no celular); o Worker pede
     aprovação ao celular pelo WebSocket; o celular toca "Aprovar" em até 90 s → `completeAuthorization`
     com `props: { deviceId }`.
   - `/mcp` em Streamable HTTP com respostas JSON: `initialize` (com `instructions` = regras de segurança do
     `SYSTEM_PROMPT`), `notifications/initialized` (202), `tools/list`, `tools/call` (texto + imagem PNG), `ping`.
   - **Durable Object por aparelho**: WebSocket com hibernação; segredo do aparelho em "confiar no primeiro uso"
     (guarda só o hash SHA-256); repassa `tools/call` ao celular e espera o resultado; erro claro se o celular
     não estiver conectado.
3. **Página (modo relay)**: liga/desliga nas configurações; gera `deviceId` + segredo (localStorage);
   WebSocket com reconexão; executa com `runTool(call, { link, vision: true, signal })`; janela de aprovação;
   botão de picture-in-picture para manter vivo em segundo plano (reaproveitar o código do `BackgroundTest`).
4. **Testes locais**: `wrangler dev` + script Node fazendo o papel do celular (Flipper no COM3) + cliente MCP
   simulado (registro, PKCE, consentimento, token, `tools/list`, `tools/call flipper_screen`).
5. **Deploy**: Augusto cria conta grátis na Cloudflare e roda `npx wrangler login`; depois `wrangler deploy`
   e adiciona o conector no Claude (Configurações → Conectores) com a URL `/mcp`.

## Pendências de aprovação

- `npm install` de `wrangler`, `@cloudflare/workers-oauth-provider` e `@cloudflare/workers-types` (pasta `relay/`).
- Deploy na conta Cloudflare dele.
