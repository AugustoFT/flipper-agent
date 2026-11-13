// RPC do Flipper: cada mensagem no fio é um PB.Main precedido do seu tamanho em varint.
//
// PB.Main = { 1: command_id, 2: command_status, 3: has_next, <campo do comando>: mensagem }
// Uma resposta longa (listar pasta, ler arquivo, device info) vem em várias PB.Main com o mesmo
// command_id e has_next=true, e a última com has_next=false. Mensagens com command_id 0 são
// espontâneas do Flipper (ex.: quadros da tela durante o screen stream).

import { fields, PbError, PbWriter, readVarint } from './pb'
import type { Transport } from './transport'

/** Números de campo do `oneof content` de PB.Main (flipper.proto). */
export const F = {
  empty: 4,
  stopSession: 19,
  pingRequest: 5,
  pingResponse: 6,
  deviceInfoRequest: 32,
  deviceInfoResponse: 33,
  powerInfoRequest: 44,
  powerInfoResponse: 45,
  storageInfoRequest: 28,
  storageInfoResponse: 29,
  storageStatRequest: 24,
  storageStatResponse: 25,
  storageListRequest: 7,
  storageListResponse: 8,
  storageReadRequest: 9,
  storageReadResponse: 10,
  storageWriteRequest: 11,
  storageDeleteRequest: 12,
  storageMkdirRequest: 13,
  storageRenameRequest: 30,
  appStartRequest: 16,
  appLockStatusRequest: 17,
  appLockStatusResponse: 18,
  appExitRequest: 47,
  appLoadFileRequest: 48,
  guiStartScreenStream: 20,
  guiStopScreenStream: 21,
  guiScreenFrame: 22,
  guiSendInputEvent: 23,
} as const

const STATUS: Record<number, string> = {
  0: 'OK', 1: 'ERROR', 2: 'ERROR_DECODE', 3: 'ERROR_NOT_IMPLEMENTED', 4: 'ERROR_BUSY',
  5: 'ERROR_STORAGE_NOT_READY', 6: 'ERROR_STORAGE_EXIST', 7: 'ERROR_STORAGE_NOT_EXIST',
  8: 'ERROR_STORAGE_INVALID_PARAMETER', 9: 'ERROR_STORAGE_DENIED', 10: 'ERROR_STORAGE_INVALID_NAME',
  11: 'ERROR_STORAGE_INTERNAL', 12: 'ERROR_STORAGE_NOT_IMPLEMENTED', 13: 'ERROR_STORAGE_ALREADY_OPEN',
  14: 'ERROR_CONTINUOUS_COMMAND_INTERRUPTED', 15: 'ERROR_INVALID_PARAMETERS', 16: 'ERROR_APP_CANT_START',
  17: 'ERROR_APP_SYSTEM_LOCKED', 18: 'ERROR_STORAGE_DIR_NOT_EMPTY', 21: 'ERROR_APP_NOT_RUNNING',
  22: 'ERROR_APP_CMD_ERROR',
}

export class RpcError extends Error {
  constructor(public readonly status: number, public readonly command: string) {
    super(`${command}: ${STATUS[status] ?? `status ${status}`}`)
  }
}

/** Uma PB.Main decodificada: cabeçalho + o único campo de conteúdo (número e bytes). */
export interface MainMsg {
  id: number
  status: number
  hasNext: boolean
  field: number
  body: Uint8Array
}

export function decodeMain(buf: Uint8Array): MainMsg {
  const m: MainMsg = { id: 0, status: 0, hasNext: false, field: 0, body: new Uint8Array(0) }
  for (const f of fields(buf)) {
    if (f.field === 1) m.id = f.int
    else if (f.field === 2) m.status = f.int
    else if (f.field === 3) m.hasNext = f.int !== 0
    else if (f.wire === 2) {
      m.field = f.field
      m.body = f.data
    }
  }
  return m
}

/** Monta uma PB.Main já com o prefixo de tamanho. */
export function encodeMain(id: number, field: number, build: (w: PbWriter) => void, hasNext = false): Uint8Array {
  const main = new PbWriter().uint(1, id).uint(3, hasNext).message(field, build).finish()
  const out = new PbWriter().varintRaw(main.length).finish()
  const framed = new Uint8Array(out.length + main.length)
  framed.set(out)
  framed.set(main, out.length)
  return framed
}

/** Junta bytes que chegam picados e devolve mensagens inteiras. */
export class Deframer {
  private buf = new Uint8Array(0)
  static readonly MAX = 65536

  push(chunk: Uint8Array): Uint8Array[] {
    const joined = new Uint8Array(this.buf.length + chunk.length)
    joined.set(this.buf)
    joined.set(chunk, this.buf.length)
    this.buf = joined
    const out: Uint8Array[] = []
    for (;;) {
      if (this.buf.length === 0) break
      let len: number, start: number
      try {
        ;[len, start] = readVarint(this.buf, 0)
      } catch (e) {
        if (e instanceof PbError && this.buf.length < 5) break // prefixo ainda incompleto
        throw e
      }
      if (len > Deframer.MAX) throw new PbError(`mensagem de ${len} bytes: fluxo corrompido`)
      if (this.buf.length < start + len) break
      out.push(this.buf.slice(start, start + len))
      this.buf = this.buf.slice(start + len)
    }
    return out
  }
}

interface Pending {
  name: string
  parts: MainMsg[]
  resolve: (parts: MainMsg[]) => void
  reject: (e: Error) => void
  timer: ReturnType<typeof setTimeout>
}

/**
 * Sessão RPC sobre um transporte. Uma requisição por vez? Não: o Flipper aceita várias em voo,
 * cada uma com seu command_id. Mas o agente chama ferramentas em sequência, então na prática é uma.
 */
export class RpcSession {
  private nextId = 1
  private pending = new Map<number, Pending>()
  private deframer = new Deframer()
  private unsolicited: Array<(m: MainMsg) => void> = []
  private closedReason: string | null = null

  constructor(public readonly transport: Transport) {
    transport.onData((chunk) => {
      let msgs: Uint8Array[]
      try {
        msgs = this.deframer.push(chunk)
      } catch (e) {
        // Fluxo corrompido (ex.: o iOS congelou a página e perdeu pedaços): não dá para
        // ressincronizar sem saber onde começa a próxima mensagem. Fecha o transporte para a
        // interface ver "desconectado" — antes, a sessão morria por dentro e a tela dizia "conectado".
        this.fail(`fluxo RPC inválido: ${(e as Error).message}`)
        transport.close().catch(() => {})
        return
      }
      for (const raw of msgs) this.dispatch(decodeMain(raw))
    })
    transport.onClose((reason) => this.fail(reason))
  }

  get closed() {
    return this.closedReason
  }

  /** Mensagens com command_id 0 (quadros de tela, eventos). */
  onUnsolicited(handler: (m: MainMsg) => void) {
    this.unsolicited.push(handler)
  }

  private dispatch(m: MainMsg) {
    if (m.id === 0) {
      for (const h of this.unsolicited) h(m)
      return
    }
    const p = this.pending.get(m.id)
    if (!p) return // resposta atrasada de algo que já expirou
    p.parts.push(m)
    if (m.status !== 0) {
      this.finish(m.id)
      p.reject(new RpcError(m.status, p.name))
    } else if (!m.hasNext) {
      this.finish(m.id)
      p.resolve(p.parts)
    }
  }

  private finish(id: number) {
    const p = this.pending.get(id)
    if (p) clearTimeout(p.timer)
    this.pending.delete(id)
  }

  private fail(reason: string) {
    if (this.closedReason) return
    this.closedReason = reason
    for (const [id, p] of this.pending) {
      this.finish(id)
      p.reject(new Error(`${p.name}: conexão encerrada (${reason})`))
    }
  }

  private allocId() {
    const id = this.nextId
    this.nextId = this.nextId >= 0x0fffffff ? 1 : this.nextId + 1
    return id
  }

  /**
   * Envia um comando e espera todas as partes da resposta.
   * `extra` são mensagens adicionais do MESMO comando (ex.: escrita em pedaços com has_next).
   */
  async request(
    name: string,
    field: number,
    build: (w: PbWriter) => void = () => {},
    opts: { timeoutMs?: number; chunks?: Array<(w: PbWriter) => void> } = {},
  ): Promise<MainMsg[]> {
    if (this.closedReason) throw new Error(`${name}: sem conexão (${this.closedReason})`)
    const id = this.allocId()
    const timeoutMs = opts.timeoutMs ?? 20000
    const done = new Promise<MainMsg[]>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.finish(id)
        reject(new Error(`${name}: sem resposta em ${timeoutMs / 1000}s (resultado desconhecido)`))
      }, timeoutMs)
      this.pending.set(id, { name, parts: [], resolve, reject, timer })
    })
    const builders = opts.chunks && opts.chunks.length > 0 ? opts.chunks : [build]
    for (let i = 0; i < builders.length; i++) {
      await this.transport.send(encodeMain(id, field, builders[i], i < builders.length - 1))
    }
    return done
  }

  /** Envia sem esperar resposta (o chamador acompanha pelo id, se quiser). */
  async fire(field: number, build: (w: PbWriter) => void): Promise<number> {
    const id = this.allocId()
    await this.transport.send(encodeMain(id, field, build))
    return id
  }

  /** Vários comandos num único envio (uma escrita só no transporte). */
  async sendBatch(items: Array<{ field: number; build: (w: PbWriter) => void }>, name: string, timeoutMs = 8000) {
    const frames: Uint8Array[] = []
    const waits: Promise<MainMsg[]>[] = []
    for (const it of items) {
      const id = this.allocId()
      waits.push(
        new Promise<MainMsg[]>((resolve, reject) => {
          const timer = setTimeout(() => {
            this.finish(id)
            reject(new Error(`${name}: sem resposta em ${timeoutMs / 1000}s`))
          }, timeoutMs)
          this.pending.set(id, { name, parts: [], resolve, reject, timer })
        }),
      )
      frames.push(encodeMain(id, it.field, it.build))
    }
    const total = frames.reduce((n, f) => n + f.length, 0)
    const joined = new Uint8Array(total)
    let off = 0
    for (const f of frames) {
      joined.set(f, off)
      off += f.length
    }
    await this.transport.send(joined)
    return Promise.all(waits)
  }
}
