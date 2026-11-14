// Flipper Relay: deixa o Claude (claude.ai, app do Claude) usar o Flipper Agent aberto no celular.
//
//   Claude ──/mcp (OAuth)──► este Worker ──► Durable Object do aparelho ──WebSocket──► página no celular ──► Flipper
//
// Login: o Claude abre /authorize; a pessoa digita o código que aparece no app e APROVA no celular.
// O token emitido carrega só o código do aparelho (props.deviceId): o Claude nunca vê o segredo.
//
// As páginas saem em português ou inglês conforme o navegador (Accept-Language). As mensagens de erro
// das ferramentas vão em inglês: quem lê é o modelo, que responde no idioma da pessoa.

import { AuthorizationError, CimdFetchError, OAuthProvider, type OAuthHelpers } from '@cloudflare/workers-oauth-provider'
import { SYSTEM_PROMPT, TOOL_SPECS } from '../../src/agent/specs'
import { formatCode, normalizeCode } from '../../src/relay-protocol'
import { Device, GLOBAL_COUNTER, type Env as BaseEnv } from './device'

export { Device }

interface Env extends BaseEnv {
  OAUTH_PROVIDER: OAuthHelpers
}

interface Props {
  deviceId: string
}

const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26']
const SERVER_INFO = { name: 'flipper-relay', title: 'Flipper Zero (Flipper Agent)', version: '0.2.0' }
const REPO = 'https://github.com/AugustoFT/flipper-agent'

/** Limites de chamadas de ferramenta: por aparelho (hora e dia) e do servidor inteiro (dia). */
function limits(env: Env) {
  const n = (v: string | undefined, d: number) => (v && Number(v) > 0 ? Number(v) : d)
  return { perHour: n(env.LIMIT_PER_HOUR, 200), perDay: n(env.LIMIT_PER_DAY, 1000), globalPerDay: n(env.GLOBAL_PER_DAY, 20000) }
}

// ---------- MCP (Streamable HTTP, respostas JSON, sem sessão) ----------

type JsonRpc = { jsonrpc: '2.0'; id?: string | number | null; method?: string; params?: any }

const OFFLINE = 'Flipper Agent is not connected to the relay. On the phone: open the app, connect the Flipper and turn on Claude mode.'

/** Dia (desde 1970) em que o teto geral estourou, visto por este Worker. */
let globalFullOn = -1

const toolError = (id: JsonRpc['id'], text: string) => rpcResult(id, { content: [{ type: 'text', text }], isError: true })

const mcpHandler = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext & { props: Props }): Promise<Response> {
    if (request.method === 'GET') return new Response(null, { status: 405, headers: { Allow: 'POST' } })
    if (request.method === 'DELETE') return new Response(null, { status: 204 })
    if (request.method !== 'POST') return new Response(null, { status: 405 })

    let msg: JsonRpc
    try {
      msg = await request.json()
    } catch {
      return rpcError(null, -32700, 'invalid JSON')
    }
    if (Array.isArray(msg)) return rpcError(null, -32600, 'batches are not supported')
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
        if (!TOOL_SPECS.some((t) => t.name === name)) return rpcError(msg.id, -32602, `unknown tool: ${name}`)
        const args = (msg.params?.arguments ?? {}) as Record<string, unknown>

        // Limites: este relay é público e gratuito; sem eles, um uso descontrolado esgota o plano.
        const lim = limits(env)
        const today = Math.floor(Date.now() / 86_400_000)
        if (globalFullOn === today)
          return toolError(msg.id, `This public relay reached its daily limit. Try again tomorrow, or deploy your own relay: ${REPO}#deploy-your-own-relay`)
        // O contador geral roda em paralelo, sem segurar a resposta: se ele estourar, as próximas
        // chamadas deste Worker são recusadas até virar o dia. É um teto de proteção, não uma conta
        // exata — vale a troca por não pagar mais uma viagem de rede em toda chamada.
        const global = env.DEVICE.get(env.DEVICE.idFromName(GLOBAL_COUNTER))
        ctx.waitUntil(
          global
            .consume(Number.MAX_SAFE_INTEGER, lim.globalPerDay)
            .then((ok) => {
              if (!ok) globalFullOn = today
            })
            .catch(() => {}),
        )

        // Celular online + limite do aparelho + execução: tudo numa ida só ao objeto do aparelho.
        const r = await device.call(name, args, { perHour: lim.perHour, perDay: lim.perDay })
        if (!r.ok) {
          const why =
            r.reason === 'offline'
              ? OFFLINE
              : r.reason === 'limit'
                ? `Usage limit reached for this device (${lim.perHour} tool calls per hour, ${lim.perDay} per day). ` +
                  `Wait a little, or deploy your own relay: ${REPO}#deploy-your-own-relay`
                : 'The phone did not answer in time. It may have gone to the background: open the app (or the PiP window) and try again.'
          return toolError(msg.id, why)
        }
        const content: unknown[] = [{ type: 'text', text: r.value.text }]
        if (r.value.image) content.push({ type: 'image', data: r.value.image, mimeType: 'image/png' })
        return rpcResult(msg.id, { content, isError: Boolean(r.value.isError) })
      }
      default:
        return rpcError(msg.id, -32601, `method not supported: ${msg.method}`)
    }
  },
}

const rpcResult = (id: JsonRpc['id'], result: unknown) => Response.json({ jsonrpc: '2.0', id, result })
const rpcError = (id: JsonRpc['id'], code: number, message: string) =>
  Response.json({ jsonrpc: '2.0', id, error: { code, message } }, { status: id === null ? 400 : 200 })

// ---------- textos das páginas ----------

const PAGES = {
  pt: {
    lang: 'pt-BR',
    homeTitle: 'Flipper Relay',
    home: (mcp: string) => `<p>Ponte entre o Claude e o <strong>Flipper Agent</strong> no seu celular.</p>
<p>No Claude, adicione um conector personalizado com o endereço:</p>
<p><code>${mcp}</code></p>
<p class="hint">Quer o seu próprio relay? É um comando: <a href="${REPO}/blob/main/README.pt-BR.md#publicar-o-seu-relay">instruções</a>.</p>`,
    failTitle: 'Não deu certo',
    fail: (m: string) => `<p>${m}</p><p>Volte ao Claude e tente conectar de novo.</p>`,
    badRequest: 'Pedido inválido.',
    badClient: 'Não foi possível verificar este app.',
    authTitle: 'Conectar o Flipper',
    who: (name: string, domain: string | null) =>
      domain ? `<strong>${name}</strong> (${domain})` : `<strong>${name}</strong> (nome informado pelo próprio app, não verificado)`,
    wants: (who: string, host: string) => `${who} quer controlar o seu Flipper. O acesso vai para <strong>${host}</strong>.`,
    loopback: 'Isto envia o acesso para um programa no seu computador. Continue só se você acabou de pedir isso.',
    codeLabel: 'Código do aparelho',
    codeHint: 'Está no Flipper Agent, em Configurações → Modo Claude. Depois de tocar em Conectar, aprove no celular.',
    connect: 'Conectar',
    deny: 'Recusar',
    badCodeTitle: 'Código inválido',
    badCode: '<p>O código tem 8 letras e números (ex.: ABCD-EFGH). Volte e confira.</p>',
    notTitle: 'Não conectado',
    offline: (code: string) =>
      `O aparelho ${code} não está conectado. Abra o Flipper Agent no celular, ligue o modo Claude e conecte de novo pelo Claude.`,
    busy: 'Já existe um pedido esperando aprovação neste aparelho.',
    timeout: 'Ninguém aprovou no celular a tempo (90 s).',
    denied: 'O pedido foi recusado no celular.',
  },
  en: {
    lang: 'en',
    homeTitle: 'Flipper Relay',
    home: (mcp: string) => `<p>Bridge between Claude and <strong>Flipper Agent</strong> on your phone.</p>
<p>In Claude, add a custom connector with this address:</p>
<p><code>${mcp}</code></p>
<p class="hint">Want your own relay? It is one command: <a href="${REPO}#deploy-your-own-relay">instructions</a>.</p>`,
    failTitle: 'That did not work',
    fail: (m: string) => `<p>${m}</p><p>Go back to Claude and try connecting again.</p>`,
    badRequest: 'Invalid request.',
    badClient: 'Could not verify this app.',
    authTitle: 'Connect the Flipper',
    who: (name: string, domain: string | null) =>
      domain ? `<strong>${name}</strong> (${domain})` : `<strong>${name}</strong> (name given by the app itself, not verified)`,
    wants: (who: string, host: string) => `${who} wants to control your Flipper. Access goes to <strong>${host}</strong>.`,
    loopback: 'This sends access to a program on your computer. Continue only if you just asked for it.',
    codeLabel: 'Device code',
    codeHint: 'It is in Flipper Agent, under Settings → Claude mode. After tapping Connect, approve on the phone.',
    connect: 'Connect',
    deny: 'Deny',
    badCodeTitle: 'Invalid code',
    badCode: '<p>The code has 8 letters and digits (e.g. ABCD-EFGH). Go back and check it.</p>',
    notTitle: 'Not connected',
    offline: (code: string) =>
      `Device ${code} is not connected. Open Flipper Agent on the phone, turn on Claude mode and connect again from Claude.`,
    busy: 'There is already a request waiting for approval on this device.',
    timeout: 'Nobody approved on the phone in time (90 s).',
    denied: 'The request was denied on the phone.',
  },
}

type Texts = (typeof PAGES)['pt']
const texts = (request: Request): Texts => (/^pt/i.test(request.headers.get('Accept-Language') ?? '') ? PAGES.pt : PAGES.en)

// ---------- páginas: início, WebSocket do celular, autorização ----------

const defaultHandler = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const T = texts(request)

    if (url.pathname === '/device/ws') {
      const code = normalizeCode(url.searchParams.get('code') ?? '')
      if (!code) return new Response('invalid code', { status: 400 })
      return env.DEVICE.get(env.DEVICE.idFromName(code)).fetch(request)
    }

    if (url.pathname === '/authorize') {
      try {
        return request.method === 'POST' ? await authorizePost(request, env, T) : await authorizeGet(request, env, T)
      } catch (error) {
        if (error instanceof AuthorizationError && error.redirectTo) return Response.redirect(error.redirectTo, 302)
        if (error instanceof AuthorizationError || error instanceof CimdFetchError) {
          const msg = error instanceof AuthorizationError ? error.description : T.badClient
          return page(T, T.failTitle, T.fail(esc(msg ?? T.badRequest)), 400)
        }
        throw error
      }
    }

    if (url.pathname === '/') return page(T, T.homeTitle, T.home(esc(`${url.origin}/mcp`)))
    return new Response('not found', { status: 404 })
  },
}

async function authorizeGet(request: Request, env: Env, T: Texts): Promise<Response> {
  const oauth = env.OAUTH_PROVIDER
  const auth = await oauth.parseAuthRequest(request)
  const details = await oauth.describeConsent(auth)
  const consent = await oauth.beginConsent(auth)
  consent.headers.set('Content-Type', 'text/html; charset=utf-8')
  const who = T.who(esc(details.clientName), details.clientDomain ? esc(details.clientDomain) : null)
  const body = `
<p>${T.wants(who, esc(details.redirectHost))}</p>
${details.redirectIsLoopback ? `<p class="warn">${T.loopback}</p>` : ''}
<form method="post">
  <input type="hidden" name="handle" value="${esc(consent.handle)}">
  <label>${T.codeLabel}<br>
    <input name="code" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="ABCD-EFGH" required>
  </label>
  <p class="hint">${T.codeHint}</p>
  <p><button name="decision" value="approve">${T.connect}</button> <button name="decision" value="deny" class="quiet">${T.deny}</button></p>
</form>`
  return new Response(html(T, T.authTitle, body), { headers: consent.headers })
}

async function authorizePost(request: Request, env: Env, T: Texts): Promise<Response> {
  const oauth = env.OAUTH_PROVIDER
  const form = await request.formData()
  const handle = String(form.get('handle') ?? '')
  if (form.get('decision') !== 'approve') {
    const denied = await oauth.denyConsent(request, handle)
    return new Response(null, { status: 302, headers: denied.headers })
  }
  const code = normalizeCode(String(form.get('code') ?? ''))
  if (!code) return page(T, T.badCodeTitle, T.badCode, 400)

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
        ? T.offline(formatCode(code))
        : answer.reason === 'busy'
          ? T.busy
          : T.timeout
      : T.denied
    return page(T, T.notTitle, `<p>${esc(why)}</p>`, 403)
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

function html(T: Texts, title: string, body: string): string {
  return `<!doctype html><html lang="${T.lang}"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
body{font:16px/1.5 system-ui,sans-serif;max-width:30rem;margin:0 auto;padding:24px 16px;background:#e8e7e2;color:#1d1d1b}
@media (prefers-color-scheme:dark){body{background:#252524;color:#ecebe6}input{background:#1d1d1b;color:inherit}a{color:#ffa64d}}
h1{font-size:1.3rem}code{word-break:break-all}.hint{color:#6b6a64;font-size:.9rem}.warn{color:#c33a2c}
input{font:inherit;font-size:1.3rem;letter-spacing:.12em;width:100%;padding:10px;margin-top:4px;border:1px solid #cbc9c1;border-radius:10px;box-sizing:border-box;text-transform:uppercase}
button{font:inherit;font-weight:600;padding:10px 18px;border-radius:10px;border:0;background:#ff8200;color:#1b1b1b}
button.quiet{background:transparent;color:inherit;border:1px solid #cbc9c1}
</style><h1>${esc(title)}</h1>${body}</html>`
}

const page = (T: Texts, title: string, body: string, status = 200) =>
  new Response(html(T, title, body), { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'X-Frame-Options': 'DENY' } })

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
