// Flipper Relay: deixa o Claude (claude.ai, app do Claude) usar o Flipper Agent aberto no celular.
//
//   Claude ──/mcp (OAuth)──► este Worker ──► Durable Object do aparelho ──WebSocket──► página no celular ──► Flipper
//
// Login: o Claude abre /authorize; a pessoa digita o código que aparece no app e APROVA no celular.
// O token emitido carrega só o código do aparelho (props.deviceId): o Claude nunca vê o segredo.

import { AuthorizationError, CimdFetchError, OAuthProvider, type OAuthHelpers } from '@cloudflare/workers-oauth-provider'
import { SYSTEM_PROMPT, TOOL_SPECS } from '../../src/agent/specs'
import { formatCode, normalizeCode } from '../../src/relay-protocol'
import { Device, type Env as BaseEnv } from './device'

export { Device }

interface Env extends BaseEnv {
  OAUTH_PROVIDER: OAuthHelpers
}

interface Props {
  deviceId: string
}

const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26']
const SERVER_INFO = { name: 'flipper-relay', title: 'Flipper Zero (Flipper Agent)', version: '0.1.0' }

// ---------- MCP (Streamable HTTP, respostas JSON, sem sessão) ----------

type JsonRpc = { jsonrpc: '2.0'; id?: string | number | null; method?: string; params?: any }

const mcpHandler = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext & { props: Props }): Promise<Response> {
    if (request.method === 'GET') return new Response(null, { status: 405, headers: { Allow: 'POST' } })
    if (request.method === 'DELETE') return new Response(null, { status: 204 })
    if (request.method !== 'POST') return new Response(null, { status: 405 })

    let msg: JsonRpc
    try {
      msg = await request.json()
    } catch {
      return rpcError(null, -32700, 'JSON inválido')
    }
    if (Array.isArray(msg)) return rpcError(null, -32600, 'lotes não são suportados')
    // Notificações (sem id) e respostas do cliente: só confirmamos o recebimento.
    if (msg.id === undefined || msg.id === null || !msg.method) return new Response(null, { status: 202 })

    const device = env.DEVICE.get(env.DEVICE.idFromName(ctx.props.deviceId))
    switch (msg.method) {
      case 'initialize': {
        const asked = msg.params?.protocolVersion
        return rpcResult(msg.id, {
          protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
          instructions: SYSTEM_PROMPT,
        })
      }
      case 'ping':
        return rpcResult(msg.id, {})
      case 'tools/list':
        return rpcResult(msg.id, {
          tools: TOOL_SPECS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.parameters })),
        })
      case 'tools/call': {
        const name = String(msg.params?.name ?? '')
        if (!TOOL_SPECS.some((t) => t.name === name)) return rpcError(msg.id, -32602, `ferramenta desconhecida: ${name}`)
        const args = (msg.params?.arguments ?? {}) as Record<string, unknown>
        const r = await device.call(name, args)
        if (!r.ok) {
          const why =
            r.reason === 'offline'
              ? 'O Flipper Agent não está conectado ao relay. No celular: abra o app, conecte o Flipper e ligue o modo Claude.'
              : 'O celular não respondeu a tempo. Ele pode ter ido para segundo plano: abra o app (ou o PiP) e tente de novo.'
          return rpcResult(msg.id, { content: [{ type: 'text', text: why }], isError: true })
        }
        const content: unknown[] = [{ type: 'text', text: r.value.text }]
        if (r.value.image) content.push({ type: 'image', data: r.value.image, mimeType: 'image/png' })
        return rpcResult(msg.id, { content, isError: Boolean(r.value.isError) })
      }
      default:
        return rpcError(msg.id, -32601, `método não suportado: ${msg.method}`)
    }
  },
}

const rpcResult = (id: JsonRpc['id'], result: unknown) => Response.json({ jsonrpc: '2.0', id, result })
const rpcError = (id: JsonRpc['id'], code: number, message: string) =>
  Response.json({ jsonrpc: '2.0', id, error: { code, message } }, { status: id === null ? 400 : 200 })

// ---------- páginas: início, WebSocket do celular, autorização ----------

const defaultHandler = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/device/ws') {
      const code = normalizeCode(url.searchParams.get('code') ?? '')
      if (!code) return new Response('código inválido', { status: 400 })
      return env.DEVICE.get(env.DEVICE.idFromName(code)).fetch(request)
    }

    if (url.pathname === '/authorize') {
      try {
        return request.method === 'POST' ? await authorizePost(request, env) : await authorizeGet(request, env)
      } catch (error) {
        if (error instanceof AuthorizationError && error.redirectTo) return Response.redirect(error.redirectTo, 302)
        if (error instanceof AuthorizationError || error instanceof CimdFetchError) {
          const msg = error instanceof AuthorizationError ? error.description : 'Não foi possível verificar este app.'
          return page('Não deu certo', `<p>${esc(msg ?? 'Pedido inválido.')}</p><p>Volte ao Claude e tente conectar de novo.</p>`, 400)
        }
        throw error
      }
    }

    if (url.pathname === '/') {
      return page(
        'Flipper Relay',
        `<p>Ponte entre o Claude e o <strong>Flipper Agent</strong> no seu celular.</p>
<p>No Claude, adicione um conector personalizado com o endereço:</p>
<p><code>${esc(url.origin)}/mcp</code></p>`,
      )
    }
    return new Response('não encontrado', { status: 404 })
  },
}

async function authorizeGet(request: Request, env: Env): Promise<Response> {
  const oauth = env.OAUTH_PROVIDER
  const auth = await oauth.parseAuthRequest(request)
  const details = await oauth.describeConsent(auth)
  const consent = await oauth.beginConsent(auth)
  consent.headers.set('Content-Type', 'text/html; charset=utf-8')
  const who = details.clientDomain
    ? `<strong>${esc(details.clientName)}</strong> (${esc(details.clientDomain)})`
    : `<strong>${esc(details.clientName)}</strong> (nome informado pelo próprio app, não verificado)`
  const body = `
<p>${who} quer controlar o seu Flipper. O acesso vai para <strong>${esc(details.redirectHost)}</strong>.</p>
${details.redirectIsLoopback ? '<p class="warn">Isto envia o acesso para um programa no seu computador. Continue só se você acabou de pedir isso.</p>' : ''}
<form method="post">
  <input type="hidden" name="handle" value="${esc(consent.handle)}">
  <label>Código do aparelho<br>
    <input name="code" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="ABCD-EFGH" required>
  </label>
  <p class="hint">Está no Flipper Agent, em Configurações → Modo Claude. Depois de tocar em Conectar, aprove no celular.</p>
  <p><button name="decision" value="approve">Conectar</button> <button name="decision" value="deny" class="quiet">Recusar</button></p>
</form>`
  return new Response(html('Conectar o Flipper', body), { headers: consent.headers })
}

async function authorizePost(request: Request, env: Env): Promise<Response> {
  const oauth = env.OAUTH_PROVIDER
  const form = await request.formData()
  const handle = String(form.get('handle') ?? '')
  if (form.get('decision') !== 'approve') {
    const denied = await oauth.denyConsent(request, handle)
    return new Response(null, { status: 302, headers: denied.headers })
  }
  const code = normalizeCode(String(form.get('code') ?? ''))
  if (!code) return page('Código inválido', '<p>O código tem 8 letras e números (ex.: ABCD-EFGH). Volte e confira.</p>', 400)

  // O handle só vale uma vez: consumimos o formulário (o pedido guardado no servidor, nunca o que veio
  // do navegador), mostramos o pedido no celular e só emitimos o token se a pessoa aprovar lá.
  // Recusado ou sem resposta, o Claude precisa começar de novo — o token nunca chega a existir.
  const device = env.DEVICE.get(env.DEVICE.idFromName(code))
  const approved = await oauth.approveConsent(request, handle).catch((e) => e as Error)
  if (approved instanceof Error) throw approved
  const details = await oauth.describeConsent(approved.request)
  const answer = await device.approve(details.clientName, details.redirectHost)
  if (!answer.ok || !answer.value) {
    const why = !answer.ok
      ? answer.reason === 'offline'
        ? `O aparelho ${formatCode(code)} não está conectado. Abra o Flipper Agent no celular, ligue o modo Claude e conecte de novo pelo Claude.`
        : answer.reason === 'busy'
          ? 'Já existe um pedido esperando aprovação neste aparelho.'
          : 'Ninguém aprovou no celular a tempo (90 s).'
      : 'O pedido foi recusado no celular.'
    return page('Não conectado', `<p>${esc(why)}</p>`, 403)
  }
  const { redirectTo } = await oauth.completeAuthorization({
    request: approved.request,
    userId: code,
    metadata: { device: code },
    scope: approved.request.scope,
    props: { deviceId: code } satisfies Props,
  })
  approved.headers.set('Location', redirectTo)
  return new Response(null, { status: 302, headers: approved.headers })
}

const esc = (v: string) => v.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

function html(title: string, body: string): string {
  return `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
body{font:16px/1.5 system-ui,sans-serif;max-width:30rem;margin:0 auto;padding:24px 16px;background:#e8e7e2;color:#1d1d1b}
@media (prefers-color-scheme:dark){body{background:#252524;color:#ecebe6}input{background:#1d1d1b;color:inherit}}
h1{font-size:1.3rem}code{word-break:break-all}.hint{color:#6b6a64;font-size:.9rem}.warn{color:#c33a2c}
input{font:inherit;font-size:1.3rem;letter-spacing:.12em;width:100%;padding:10px;margin-top:4px;border:1px solid #cbc9c1;border-radius:10px;box-sizing:border-box;text-transform:uppercase}
button{font:inherit;font-weight:600;padding:10px 18px;border-radius:10px;border:0;background:#ff8200;color:#1b1b1b}
button.quiet{background:transparent;color:inherit;border:1px solid #cbc9c1}
</style><h1>${esc(title)}</h1>${body}</html>`
}

const page = (title: string, body: string, status = 200) =>
  new Response(html(title, body), { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'X-Frame-Options': 'DENY' } })

// ---------- montagem ----------
// O endereço público só é conhecido na primeira requisição (workers.dev ou domínio próprio), então o
// provider é criado ali, com o recurso canônico `<origem>/mcp`.

let provider: OAuthProvider<Env> | null = null

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (!provider) {
      const origin = new URL(request.url).origin
      provider = new OAuthProvider<Env>({
        apiRoute: '/mcp',
        apiHandler: mcpHandler as any,
        defaultHandler: defaultHandler as any,
        authorizeEndpoint: '/authorize',
        tokenEndpoint: '/token',
        clientRegistrationEndpoint: '/register',
        clientIdMetadataDocumentEnabled: true,
        scopesSupported: ['flipper'],
        resourceMetadata: { resource: `${origin}/mcp`, authorization_servers: [origin] },
      })
    }
    return provider.fetch(request, env, ctx)
  },
} satisfies ExportedHandler<Env>
