// Teste ponta a ponta do relay, com o Flipper real no USB fazendo o papel do celular.
//
//   1. em outro terminal: cd relay && npx wrangler dev   (sobe em http://localhost:8787)
//   2. cd relay && npm run teste -- COM3      (ou `-- demo` para usar o Flipper simulado, sem aparelho)
//
// Faz o caminho inteiro do Claude: registro do cliente (DCR), login com PKCE, página de autorização
// com o código do aparelho, aprovação no "celular", token, e então MCP: initialize, tools/list e
// chamadas de ferramenta que chegam até o Flipper pelo WebSocket.

import { createHash, randomBytes } from 'node:crypto'
import { FlipperClient } from '../../src/flipper/client'
import { FlipperLink } from '../../src/flipper/link'
import { encodeMain, F } from '../../src/flipper/rpc'
import { RelayClient, type RelayState } from '../../src/relay/client'
import { NodeSerialTransport } from '../../scripts/serial-node'
import { DemoTransport } from '../../src/flipper/demo'

const BASE = process.env.RELAY ?? 'http://localhost:8787'
const port = process.argv[2] ?? 'COM3'
let ok = 0
let fail = 0
function check(cond: boolean, what: string, extra = '') {
  if (cond) ok++
  else fail++
  console.log(`${cond ? '✔' : '✘'} ${what}${extra ? ` — ${extra}` : ''}`)
}
const b64url = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// ---------- "celular": Flipper no USB + cliente do relay ----------
const transport = port === 'demo' ? new DemoTransport() : await NodeSerialTransport.open(port)
console.log(`  Flipper: ${port === 'demo' ? 'simulado (demo)' : port}`)
const fz = new FlipperClient(transport)
const link = new FlipperLink()
link.set(fz)
// Código novo a cada execução: o servidor "confia no primeiro uso", então reusar um código com outro
// segredo seria (corretamente) recusado.
const ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const id = { code: [...randomBytes(8)].map((b) => ALPHA[b % ALPHA.length]).join(''), secret: b64url(randomBytes(32)) }
let state: RelayState = 'off'
let approvals = 0
const phone = new RelayClient(
  BASE,
  id,
  link,
  {
    onState: (s) => (state = s),
    onApprove: async (client) => {
      approvals++
      console.log(`  celular: aprovando "${client}"`)
      return true
    },
    onToolStart: (c) => console.log(`  celular: executando ${c.name}`),
    onToolEnd: () => {},
  },
  false,
)
phone.start()
for (let i = 0; i < 50 && state !== 'online'; i++) await sleep(100)
check(state === 'online', 'celular conectado ao relay')

// Outro aparelho tentando assumir o mesmo código com outro segredo: precisa ser recusado.
{
  let s2: RelayState = 'off'
  let why = ''
  const intruder = new RelayClient(BASE, { code: id.code, secret: b64url(randomBytes(32)) }, link, {
    onState: (s, d) => {
      s2 = s
      why = d ?? ''
    },
    onApprove: async () => false,
    onToolStart: () => {},
    onToolEnd: () => {},
  })
  intruder.start()
  for (let i = 0; i < 30 && s2 !== 'denied'; i++) await sleep(100)
  check(s2 === 'denied', 'outro segredo com o mesmo código é recusado', why)
  intruder.stop()
}

// ---------- "Claude": cliente MCP com OAuth ----------
const noAuth = await fetch(`${BASE}/mcp`, { method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json' } })
check(noAuth.status === 401, '/mcp sem token responde 401', noAuth.headers.get('www-authenticate') ?? '')

const meta = await (await fetch(`${BASE}/.well-known/oauth-protected-resource/mcp`)).json().catch(() => null)
check(Boolean(meta?.resource), 'metadados do recurso publicados', meta?.resource)

const REDIRECT = 'http://localhost:9999/callback'
const reg = await (
  await fetch(`${BASE}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name: 'Teste do relay',
      redirect_uris: [REDIRECT],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    }),
  })
).json()
check(Boolean(reg.client_id), 'registro dinâmico do cliente (DCR)', reg.client_id ?? JSON.stringify(reg))

const verifier = b64url(randomBytes(32))
const challenge = b64url(createHash('sha256').update(verifier).digest())
const authUrl = new URL(`${BASE}/authorize`)
const authParams: Record<string, string> = {
  response_type: 'code',
  client_id: reg.client_id,
  redirect_uri: REDIRECT,
  code_challenge: challenge,
  code_challenge_method: 'S256',
  state: 'estado123',
  scope: 'flipper',
  resource: `${BASE}/mcp`,
}
for (const [k, v] of Object.entries(authParams)) authUrl.searchParams.set(k, v)
const authPage = await fetch(authUrl, { redirect: 'manual' })
const pageHtml = await authPage.text()
const handle = pageHtml.match(/name="handle" value="([^"]+)"/)?.[1]
const cookie = (authPage.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ')
check(authPage.status === 200 && Boolean(handle), 'página de autorização com o formulário', `status ${authPage.status}`)

const approve = await fetch(`${BASE}/authorize`, {
  method: 'POST',
  redirect: 'manual',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie },
  body: new URLSearchParams({ handle: handle ?? '', code: `${id.code.slice(0, 4).toLowerCase()}-${id.code.slice(4)}`, decision: 'approve' }),
})
const location = approve.headers.get('location') ?? ''
const authCode = location ? new URL(location).searchParams.get('code') : null
check(approve.status === 302 && Boolean(authCode) && approvals === 1, 'aprovado no celular → redireciona com código', location.slice(0, 80) || `status ${approve.status}`)

const tok = await (
  await fetch(`${BASE}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: authCode ?? '',
      redirect_uri: REDIRECT,
      client_id: reg.client_id,
      code_verifier: verifier,
      resource: `${BASE}/mcp`,
    }),
  })
).json()
check(Boolean(tok.access_token), 'token emitido', tok.error ?? '')

let rpcId = 0
async function mcp(method: string, params?: unknown) {
  const t0 = Date.now()
  const r = await fetch(`${BASE}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${tok.access_token}`,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }),
  })
  const body = await r.json().catch(() => ({}))
  return { status: r.status, body, ms: Date.now() - t0 }
}

const init = await mcp('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'teste', version: '1' } })
check(init.body.result?.serverInfo?.name === 'flipper-relay', 'MCP initialize', init.body.result?.protocolVersion ?? JSON.stringify(init.body))
const list = await mcp('tools/list')
const names: string[] = (list.body.result?.tools ?? []).map((t: { name: string }) => t.name)
check(names.includes('flipper_screen') && names.includes('flipper_press'), 'MCP tools/list', `${names.length} ferramentas`)
const power = await mcp('tools/call', { name: 'flipper_power_info', arguments: {} })
check(power.body.result?.isError === false && /charge/.test(power.body.result?.content?.[0]?.text ?? ''), 'tools/call chegou ao Flipper (bateria)', `${power.ms} ms`)
const screen = await mcp('tools/call', { name: 'flipper_screen', arguments: {} })
check(screen.body.result?.isError === false, 'tools/call tela do Flipper', `${screen.ms} ms`)
const bad = await mcp('tools/call', { name: 'flipper_list', arguments: { path: '/ext/../int' } })
check(bad.body.result?.isError === true, 'regras de segurança valem pelo relay (caminho com ..)')

// Limite de uso: rode o servidor com `npx wrangler dev --var LIMIT_PER_HOUR:8` e o teste com LIMITE=8.
if (process.env.LIMITE) {
  const max = Number(process.env.LIMITE)
  let hit = ''
  for (let i = 0; i < max + 2 && !hit; i++) {
    const r = await mcp('tools/call', { name: 'flipper_power_info', arguments: {} })
    if (/Usage limit/.test(r.body.result?.content?.[0]?.text ?? '')) hit = `bloqueou na chamada ${i + 4} desta sessão`
  }
  check(Boolean(hit), `limite de ${max} chamadas por hora`, hit)
}

// Celular desligado: a ferramenta responde com erro claro, sem travar.
phone.stop()
await sleep(500)
const off = await mcp('tools/call', { name: 'flipper_power_info', arguments: {} })
check(off.body.result?.isError === true && /not connected/.test(off.body.result?.content?.[0]?.text ?? ''), 'celular desligado → erro claro', `${off.ms} ms`)

await fz.stopScreen().catch(() => {})
await transport.send(encodeMain(999, F.stopSession, () => {}))
await sleep(300)
console.log(`\n${ok} ok, ${fail} falhas`)
process.exit(fail ? 1 : 0)
