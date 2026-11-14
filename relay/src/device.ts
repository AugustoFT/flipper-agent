// Um Durable Object por aparelho (nome = código do aparelho). Guarda o WebSocket do celular e repassa
// para ele as chamadas de ferramenta do Claude e os pedidos de aprovação de login.
//
// Usa a API de WebSocket com hibernação: com o celular conectado e nada acontecendo, o objeto dorme
// e não gasta. "ping" → "pong" é respondido pela própria Cloudflare, sem acordar o objeto.

import { DurableObject } from 'cloudflare:workers'
import type { FromDevice, RelayToolResult, ToDevice } from '../../src/relay-protocol'

export interface Env {
  DEVICE: DurableObjectNamespace<Device>
  OAUTH_KV: KVNamespace
  /** Limites de uso (wrangler.jsonc → vars). Ver `limits()` em index.ts. */
  LIMIT_PER_HOUR?: string
  LIMIT_PER_DAY?: string
  GLOBAL_PER_DAY?: string
}

/** Resposta de `ask`: o que o celular mandou, ou por que não mandou. */
export type AskOutcome<T> = { ok: true; value: T } | { ok: false; reason: 'offline' | 'timeout' | 'busy' | 'limit' }

const CALL_TIMEOUT_MS = 11 * 60_000 // passagem de bastão espera até 10 min no celular
const APPROVE_TIMEOUT_MS = 90_000

/** Nome do Durable Object que conta o uso do servidor inteiro (tem "_", que nenhum código tem). */
export const GLOBAL_COUNTER = '_global'

interface Usage {
  /** Hora e dia (desde 1970) da contagem atual, e quantas chamadas em cada um. */
  h: number
  hc: number
  d: number
  dc: number
}

interface Attachment {
  authed: boolean
}

export class Device extends DurableObject<Env> {
  private pending = new Map<string, { resolve: (m: FromDevice) => void; timer: ReturnType<typeof setTimeout> }>()
  private approving = false

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'))
  }

  /** Só para o WebSocket do celular (o Worker repassa o upgrade para cá). */
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('esperado WebSocket', { status: 426 })
    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair)
    this.ctx.acceptWebSocket(server)
    server.serializeAttachment({ authed: false } satisfies Attachment)
    return new Response(null, { status: 101, webSocket: client })
  }

  /**
   * Conta uma chamada de ferramenta e diz se ainda cabe nos limites. O Durable Object roda uma
   * requisição por vez, então o contador não tem corrida. O mesmo método conta o uso do servidor
   * inteiro, no objeto de nome GLOBAL_COUNTER.
   */
  async consume(perHour: number, perDay: number): Promise<boolean> {
    const now = Date.now()
    const h = Math.floor(now / 3_600_000)
    const d = Math.floor(now / 86_400_000)
    const u = (await this.ctx.storage.get<Usage>('usage')) ?? { h, hc: 0, d, dc: 0 }
    if (u.h !== h) Object.assign(u, { h, hc: 0 })
    if (u.d !== d) Object.assign(u, { d, dc: 0 })
    if (u.hc >= perHour || u.dc >= perDay) return false
    u.hc++
    u.dc++
    await this.ctx.storage.put('usage', u)
    return true
  }

  /** O celular está conectado e autenticado agora? */
  async online(): Promise<boolean> {
    return this.socket() !== null
  }

  /**
   * Executa uma ferramenta no celular e devolve o resultado. Com `limit`, confere tudo aqui dentro,
   * numa ida só ao objeto: celular online (chamada sem celular não gasta o limite), depois o limite.
   * Cada ida a um Durable Object custa uma viagem de rede; três idas separadas dobravam o tempo.
   */
  async call(
    name: string,
    args: Record<string, unknown>,
    limit?: { perHour: number; perDay: number },
  ): Promise<AskOutcome<RelayToolResult>> {
    if (!this.socket()) return { ok: false, reason: 'offline' }
    if (limit && !(await this.consume(limit.perHour, limit.perDay))) return { ok: false, reason: 'limit' }
    const r = await this.ask({ t: 'call', name, args }, CALL_TIMEOUT_MS)
    if (!r.ok) return r
    return r.value.t === 'result' ? { ok: true, value: r.value.result } : { ok: false, reason: 'timeout' }
  }

  /** Pede ao dono do celular para aprovar o login de um cliente (o Claude). Um pedido por vez. */
  async approve(client: string, redirectHost: string): Promise<AskOutcome<boolean>> {
    if (this.approving) return { ok: false, reason: 'busy' }
    this.approving = true
    try {
      const r = await this.ask({ t: 'approve', client, redirectHost }, APPROVE_TIMEOUT_MS)
      if (!r.ok) return r
      return { ok: true, value: r.value.t === 'approval' && r.value.ok }
    } finally {
      this.approving = false
    }
  }

  private socket(): WebSocket | null {
    for (const ws of this.ctx.getWebSockets()) {
      if ((ws.deserializeAttachment() as Attachment | null)?.authed) return ws
    }
    return null
  }

  private ask(msg: DistributiveOmit<ToDevice, 'id'>, timeoutMs: number): Promise<AskOutcome<FromDevice>> {
    const ws = this.socket()
    if (!ws) return Promise.resolve({ ok: false, reason: 'offline' })
    const id = crypto.randomUUID()
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        resolve({ ok: false, reason: 'timeout' })
      }, timeoutMs)
      this.pending.set(id, { resolve: (m) => resolve({ ok: true, value: m }), timer })
      ws.send(JSON.stringify({ ...msg, id }))
    })
  }

  async webSocketMessage(ws: WebSocket, data: string | ArrayBuffer) {
    let m: FromDevice
    try {
      m = JSON.parse(typeof data === 'string' ? data : new TextDecoder().decode(data))
    } catch {
      return
    }
    const att = ws.deserializeAttachment() as Attachment | null

    if (m.t === 'hello') {
      // "Confiar no primeiro uso": o primeiro celular que se apresenta com este código fica dono dele.
      // Guardamos só o hash do segredo; quem não tiver o segredo não assume o código depois.
      if (typeof m.secret !== 'string' || m.secret.length < 32) return this.refuse(ws, 'segredo inválido')
      const hash = await sha256(m.secret)
      const stored = await this.ctx.storage.get<string>('secretHash')
      if (!stored) await this.ctx.storage.put('secretHash', hash)
      else if (stored !== hash) return this.refuse(ws, 'este código pertence a outro aparelho')
      // Um celular por vez: a conexão nova substitui a antiga (ex.: página recarregada).
      for (const other of this.ctx.getWebSockets()) {
        if (other !== ws && (other.deserializeAttachment() as Attachment | null)?.authed) other.close(4000, 'substituído')
      }
      ws.serializeAttachment({ authed: true } satisfies Attachment)
      ws.send(JSON.stringify({ t: 'ready' } satisfies ToDevice))
      return
    }

    if (!att?.authed) return
    if ((m.t === 'result' || m.t === 'approval') && this.pending.has(m.id)) {
      const p = this.pending.get(m.id)!
      clearTimeout(p.timer)
      this.pending.delete(m.id)
      p.resolve(m)
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string) {
    try {
      ws.close(code, reason)
    } catch {
      /* já fechado */
    }
  }

  private refuse(ws: WebSocket, reason: string) {
    ws.send(JSON.stringify({ t: 'denied', reason } satisfies ToDevice))
    ws.close(4001, reason)
  }
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

async function sha256(text: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
