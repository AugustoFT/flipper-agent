// Lado do celular no modo Claude: mantém um WebSocket com o servidor do relay e executa no Flipper as
// ferramentas que o Claude pede — com o MESMO runTool que o agente Gemini usa, então as regras de
// segurança (dados do Flipper marcados como não confiáveis, caminhos checados) valem igual.

import type { SafetyCtx } from '../agent/safety'
import { runTool } from '../agent/tools'
import type { ToolCall, ToolResult } from '../agent/types'
import type { FlipperLink } from '../flipper/link'
import { CODE_ALPHABET, CODE_LENGTH, type FromDevice, type ToDevice } from '../relay-protocol'

export type RelayState = 'off' | 'connecting' | 'online' | 'denied'

export interface RelayIdentity {
  /** Código público do aparelho (digitado no Claude ao conectar). */
  code: string
  /** Segredo que prova ao servidor que este celular é o dono do código. Nunca sai daqui, a não ser para o relay. */
  secret: string
}

const ID_KEY = 'flipper-agent:relay-id'

function randomCode(): string {
  // Sorteio sem viés: descarta bytes acima do maior múltiplo do tamanho do alfabeto.
  const n = CODE_ALPHABET.length
  const limit = 256 - (256 % n)
  let out = ''
  while (out.length < CODE_LENGTH) {
    for (const b of crypto.getRandomValues(new Uint8Array(16))) {
      if (b < limit && out.length < CODE_LENGTH) out += CODE_ALPHABET[b % n]
    }
  }
  return out
}

function randomSecret(): string {
  const b = crypto.getRandomValues(new Uint8Array(32))
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function loadIdentity(): RelayIdentity {
  try {
    const raw = localStorage.getItem(ID_KEY)
    if (raw) {
      const id = JSON.parse(raw) as RelayIdentity
      if (id.code?.length === CODE_LENGTH && id.secret?.length >= 32) return id
    }
  } catch {
    /* sem armazenamento: gera um novo abaixo */
  }
  const id = { code: randomCode(), secret: randomSecret() }
  try {
    localStorage.setItem(ID_KEY, JSON.stringify(id))
  } catch {
    /* navegação privada: o código muda a cada visita */
  }
  return id
}

/** Gera um código novo (o antigo deixa de funcionar no Claude). */
export function resetIdentity(): RelayIdentity {
  try {
    localStorage.removeItem(ID_KEY)
  } catch {
    /* nada */
  }
  return loadIdentity()
}

export interface RelayEvents {
  /** Política de segurança vigente (lida a cada chamada do Claude, para valer a mudança nas configurações). */
  getSafety?(): SafetyCtx
  onState(state: RelayState, detail?: string): void
  /** O Claude pediu para conectar: devolva true para aprovar. */
  onApprove(client: string, redirectHost: string): Promise<boolean>
  onToolStart(call: ToolCall): void
  onToolEnd(result: ToolResult): void
}

const PING_MS = 25_000

export class RelayClient {
  private ws: WebSocket | null = null
  private stopped = false
  private attempt = 0
  private retry: ReturnType<typeof setTimeout> | undefined
  private ping: ReturnType<typeof setInterval> | undefined
  private abort = new AbortController()

  constructor(
    private baseUrl: string,
    private id: RelayIdentity,
    private link: FlipperLink,
    private ev: RelayEvents,
    /** Manda a tela como imagem PNG (no celular, sim; nos testes em Node, que não tem canvas, não). */
    private vision = true,
  ) {}

  start() {
    this.stopped = false
    this.open()
  }

  stop() {
    this.stopped = true
    clearTimeout(this.retry)
    clearInterval(this.ping)
    this.abort.abort()
    this.ws?.close(1000, 'desligado')
    this.ws = null
    this.ev.onState('off')
  }

  private open() {
    const url = `${this.baseUrl.replace(/\/+$/, '').replace(/^http/, 'ws')}/device/ws?code=${this.id.code}`
    this.ev.onState('connecting')
    let ws: WebSocket
    try {
      ws = new WebSocket(url)
    } catch (e) {
      this.ev.onState('denied', `endereço do relay inválido: ${(e as Error).message}`)
      return
    }
    this.ws = ws
    let denied = false
    ws.onopen = () => this.send({ t: 'hello', secret: this.id.secret })
    ws.onmessage = (e) => {
      if (e.data === 'pong') return
      let m: ToDevice
      try {
        m = JSON.parse(String(e.data))
      } catch {
        return
      }
      if (m.t === 'ready') {
        this.attempt = 0
        clearInterval(this.ping)
        this.ping = setInterval(() => ws.readyState === WebSocket.OPEN && ws.send('ping'), PING_MS)
        this.ev.onState('online')
      } else if (m.t === 'denied') {
        denied = true
        this.ev.onState('denied', m.reason)
      } else if (m.t === 'call') {
        void this.runCall(m.id, m.name, m.args)
      } else if (m.t === 'approve') {
        this.ev.onApprove(m.client, m.redirectHost).then(
          (ok) => this.send({ t: 'approval', id: m.id, ok }),
          () => this.send({ t: 'approval', id: m.id, ok: false }),
        )
      }
    }
    ws.onclose = () => {
      clearInterval(this.ping)
      if (this.ws === ws) this.ws = null
      if (this.stopped || denied) return
      // Reconecta com espera crescente: 1, 2, 4… até 15 s.
      const wait = Math.min(1000 * 2 ** this.attempt++, 15_000)
      this.ev.onState('connecting', `reconectando em ${Math.round(wait / 1000)} s`)
      this.retry = setTimeout(() => this.open(), wait)
    }
  }

  private async runCall(id: string, name: string, args: Record<string, unknown>) {
    const call: ToolCall = { id, name, args }
    this.ev.onToolStart(call)
    const r = await runTool(call, { link: this.link, vision: this.vision, signal: this.abort.signal, safety: this.ev.getSafety?.() })
    this.ev.onToolEnd(r)
    this.send({ t: 'result', id, result: { text: r.text, image: r.image, isError: r.isError } })
  }

  private send(m: FromDevice) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m))
  }
}
