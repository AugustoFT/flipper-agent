// Cliente de alto nível: as operações que o agente e a interface usam.
// Tudo aqui é independente de BLE/USB — fala só com RpcSession.

import { fields, text, type PbWriter } from './pb'
import { F, RpcSession, type MainMsg } from './rpc'
import { ScreenStore, type Frame } from './screen'
import type { Transport } from './transport'

export type Key = 'UP' | 'DOWN' | 'RIGHT' | 'LEFT' | 'OK' | 'BACK'
const KEY_CODE: Record<Key, number> = { UP: 0, DOWN: 1, RIGHT: 2, LEFT: 3, OK: 4, BACK: 5 }
const INPUT = { PRESS: 0, RELEASE: 1, SHORT: 2, LONG: 3, REPEAT: 4 } as const
export type InputType = keyof typeof INPUT

/** Pinos que o RPC controla, na ordem do enum GpioPin do protobuf (o índice é o valor no fio). */
export const GPIO_PINS = ['PC0', 'PC1', 'PC3', 'PB2', 'PB3', 'PA4', 'PA6', 'PA7'] as const
export type GpioPin = (typeof GPIO_PINS)[number]
/** Número do pino no conector de cima do Flipper, para explicar ao usuário onde ligar. */
export const GPIO_HEADER: Record<GpioPin, number> = { PA7: 2, PA6: 3, PA4: 4, PB3: 5, PB2: 6, PC3: 7, PC1: 15, PC0: 16 }

export interface FileEntry {
  name: string
  dir: boolean
  size: number
}

/** Tamanho de cada pedaço numa escrita de arquivo (o firmware aceita até 512 bytes de dados por mensagem). */
const WRITE_CHUNK = 512

export class FlipperClient {
  readonly rpc: RpcSession
  readonly screen = new ScreenStore()
  private streaming = false

  constructor(transport: Transport) {
    this.rpc = new RpcSession(transport)
    this.rpc.onUnsolicited((m) => {
      if (m.field === F.guiScreenFrame) this.onFrame(m)
    })
  }

  get name() {
    return this.rpc.transport.name
  }

  private onFrame(m: MainMsg) {
    let data: Uint8Array | null = null
    let orientation = 0
    for (const f of fields(m.body)) {
      if (f.field === 1 && f.wire === 2) data = f.data
      else if (f.field === 2) orientation = f.int
    }
    if (data) this.screen.update(data, orientation)
  }

  // ---------- sistema ----------

  async ping(): Promise<void> {
    await this.rpc.request('ping', F.pingRequest, (w) => w.bytes(1, new Uint8Array([0x46, 0x5a])), { timeoutMs: 8000 })
  }

  /** Pares chave/valor (firmware, hardware, rádio...). Vem em várias partes. */
  async deviceInfo(): Promise<Record<string, string>> {
    const parts = await this.rpc.request('device_info', F.deviceInfoRequest, undefined, { timeoutMs: 40000 })
    return keyValues(parts)
  }

  async powerInfo(): Promise<Record<string, string>> {
    const parts = await this.rpc.request('power_info', F.powerInfoRequest, undefined, { timeoutMs: 15000 })
    return keyValues(parts)
  }

  // ---------- armazenamento ----------

  async list(path: string): Promise<FileEntry[]> {
    const parts = await this.rpc.request('listar', F.storageListRequest, (w) => w.string(1, path), { timeoutMs: 30000 })
    const out: FileEntry[] = []
    for (const p of parts) {
      for (const f of fields(p.body)) if (f.field === 1 && f.wire === 2) out.push(parseFile(f.data))
    }
    return out
  }

  async stat(path: string): Promise<FileEntry> {
    const [p] = await this.rpc.request('stat', F.storageStatRequest, (w) => w.string(1, path))
    for (const f of fields(p.body)) if (f.field === 1 && f.wire === 2) return parseFile(f.data)
    throw new Error(`stat ${path}: resposta vazia`)
  }

  async read(path: string, maxBytes = 256 * 1024): Promise<Uint8Array> {
    const info = await this.stat(path)
    if (info.dir) throw new Error(`${path} é uma pasta`)
    if (info.size > maxBytes) throw new Error(`${path} tem ${info.size} bytes (limite ${maxBytes})`)
    const parts = await this.rpc.request('ler', F.storageReadRequest, (w) => w.string(1, path), {
      timeoutMs: 20000 + info.size * 2, // BLE é lento (~1-5 KB/s)
    })
    const chunks: Uint8Array[] = []
    for (const p of parts) {
      for (const f of fields(p.body)) {
        if (f.field !== 1 || f.wire !== 2) continue
        for (const g of fields(f.data)) if (g.field === 4 && g.wire === 2) chunks.push(g.data.slice())
      }
    }
    return concat(chunks)
  }

  async write(path: string, data: Uint8Array): Promise<void> {
    const chunks: Array<(w: PbWriter) => void> = []
    for (let off = 0; off === 0 || off < data.length; off += WRITE_CHUNK) {
      const piece = data.subarray(off, off + WRITE_CHUNK)
      chunks.push((w) => w.string(1, path).message(2, (file) => file.bytes(4, piece)))
      if (data.length === 0) break
    }
    await this.rpc.request('escrever', F.storageWriteRequest, undefined, { chunks, timeoutMs: 30000 + data.length * 3 })
  }

  async mkdir(path: string) {
    await this.rpc.request('criar_pasta', F.storageMkdirRequest, (w) => w.string(1, path))
  }

  async remove(path: string, recursive = false) {
    await this.rpc.request('apagar', F.storageDeleteRequest, (w) => w.string(1, path).uint(2, recursive), {
      timeoutMs: 60000,
    })
  }

  async rename(from: string, to: string) {
    await this.rpc.request('renomear', F.storageRenameRequest, (w) => w.string(1, from).string(2, to))
  }

  // ---------- apps ----------

  /** `name` é o nome do app no menu (ex.: "Infrared") ou o caminho de um .fap. `args` costuma ser um arquivo. */
  async appStart(name: string, args = '') {
    await this.rpc.request('abrir_app', F.appStartRequest, (w) => w.string(1, name).string(2, args), { timeoutMs: 15000 })
  }

  /** Só funciona em apps com suporte a RPC; para os outros, o agente usa BACK (longo). */
  async appExit() {
    await this.rpc.request('fechar_app', F.appExitRequest)
  }

  // ---------- apps em modo RPC ----------
  // Apps como Infravermelho, Sub-GHz, NFC, RFID e iButton aceitam ser comandados direto, sem menus:
  // abertos com o argumento "RPC", carregam um arquivo e "apertam" um botão (no infravermelho, o nome
  // de um sinal do .ir; no Sub-GHz, transmite o .sub; em NFC/RFID/iButton, carregar já emula).
  // É o mesmo caminho do app oficial do celular. Fonte: rpc_app.c do firmware.

  /** Abre o app em modo RPC (a tela do Flipper mostra que ele está sendo comandado de fora). */
  async appStartRpc(name: string) {
    await this.appStart(name, 'RPC')
  }

  async appLoadFile(path: string) {
    await this.rpc.request('carregar_arquivo', F.appLoadFileRequest, (w) => w.string(1, path), { timeoutMs: 15000 })
  }

  /** "Aperta" um botão do app: por nome (`args`, ex.: o sinal "Power" de um .ir) ou por índice. */
  async appButtonPress(args: string, index = 0) {
    await this.rpc.request('botao_app', F.appButtonPressRequest, (w) => w.string(1, args).uint(2, index), { timeoutMs: 15000 })
  }

  async appButtonRelease() {
    await this.rpc.request('soltar_botao_app', F.appButtonReleaseRequest, undefined, { timeoutMs: 15000 })
  }

  /** Último erro do app em modo RPC (código e texto), para explicar um ERROR_APP_CMD_ERROR. */
  async appGetError(): Promise<{ code: number; text: string }> {
    const [p] = await this.rpc.request('erro_app', F.appGetErrorRequest)
    let code = 0
    let text = ''
    for (const f of fields(p.body)) {
      if (f.field === 1) code = f.int
      else if (f.field === 2 && f.wire === 2) text = new TextDecoder().decode(f.data)
    }
    return { code, text }
  }

  // ---------- GPIO (pinos do conector de cima) ----------
  // Pinos expostos pelo RPC, na ordem do enum GpioPin do protobuf. O número físico do conector vem
  // ao lado (2=PA7, 3=PA6, 4=PA4, 5=PB3, 6=PB2, 7=PC3, 15=PC1, 16=PC0).

  async gpioSetMode(pin: GpioPin, mode: 'OUTPUT' | 'INPUT') {
    await this.rpc.request('gpio_modo', F.gpioSetPinMode, (w) => w.uint(1, GPIO_PINS.indexOf(pin)).uint(2, mode === 'INPUT' ? 1 : 0))
  }

  async gpioSetPull(pin: GpioPin, pull: 'NO' | 'UP' | 'DOWN') {
    await this.rpc.request('gpio_pull', F.gpioSetInputPull, (w) => w.uint(1, GPIO_PINS.indexOf(pin)).uint(2, ['NO', 'UP', 'DOWN'].indexOf(pull)))
  }

  async gpioGetMode(pin: GpioPin): Promise<'OUTPUT' | 'INPUT'> {
    const [p] = await this.rpc.request('gpio_ler_modo', F.gpioGetPinMode, (w) => w.uint(1, GPIO_PINS.indexOf(pin)))
    for (const f of fields(p.body)) if (f.field === 1) return f.int === 1 ? 'INPUT' : 'OUTPUT'
    return 'OUTPUT' // proto3 não manda o valor 0
  }

  async gpioRead(pin: GpioPin): Promise<number> {
    const [p] = await this.rpc.request('gpio_ler', F.gpioReadPin, (w) => w.uint(1, GPIO_PINS.indexOf(pin)))
    for (const f of fields(p.body)) if (f.field === 2) return f.int // ReadPinResponse.value é o campo 2
    return 0
  }

  async gpioWrite(pin: GpioPin, value: 0 | 1) {
    await this.rpc.request('gpio_escrever', F.gpioWritePin, (w) => w.uint(1, GPIO_PINS.indexOf(pin)).uint(2, value))
  }

  /** Saída de 5 V do pino 1 (OTG): liga ou desliga a alimentação de um módulo externo. */
  async gpioGetOtg(): Promise<boolean> {
    const [p] = await this.rpc.request('otg_ler', F.gpioGetOtgMode)
    for (const f of fields(p.body)) if (f.field === 1) return f.int === 1
    return false
  }

  async gpioSetOtg(on: boolean) {
    await this.rpc.request('otg_mudar', F.gpioSetOtgMode, (w) => w.uint(1, on ? 1 : 0))
  }

  async isLocked(): Promise<boolean> {
    const [p] = await this.rpc.request('lock_status', F.appLockStatusRequest)
    for (const f of fields(p.body)) if (f.field === 1) return f.int !== 0
    return false
  }

  // ---------- tela e teclas ----------

  /** A tela está sendo transmitida agora (ou o pedido para transmitir já saiu). */
  get isStreaming() {
    return this.streaming
  }

  async startScreen() {
    if (this.streaming) return
    const seq = this.screen.currentSeq
    this.streaming = true // antes do pedido: o primeiro quadro pode chegar junto com a resposta
    try {
      await this.rpc.request('iniciar_tela', F.guiStartScreenStream)
    } catch (e) {
      this.streaming = false
      throw e
    }
    // Religando depois de uma pausa: o último quadro guardado pode estar velho. Espera o primeiro
    // quadro novo (o Flipper manda um ao começar), para ninguém agir olhando a tela antiga.
    if (seq > 0) await this.screen.waitNewer(seq, 1500)
  }

  async stopScreen() {
    if (!this.streaming) return
    this.streaming = false
    await this.rpc.request('parar_tela', F.guiStopScreenStream).catch(() => {})
  }

  /**
   * Aperta uma tecla: PRESS, depois SHORT ou LONG, depois RELEASE — num envio só.
   * Lição do zeffin: o firmware descarta a sequência PRESS, RELEASE, SHORT; a ordem certa é
   * PRESS → SHORT/LONG → RELEASE.
   */
  async press(key: Key, long = false) {
    const code = KEY_CODE[key]
    const ev = (type: number) => ({ field: F.guiSendInputEvent, build: (w: PbWriter) => w.uint(1, code).uint(2, type) })
    await this.rpc.sendBatch([ev(INPUT.PRESS), ev(long ? INPUT.LONG : INPUT.SHORT), ev(INPUT.RELEASE)], `tecla ${key}`)
  }

  /**
   * Um evento de tecla isolado, sem esperar a resposta (o controle remoto da tela usa isto para se
   * comportar como o botão físico: PRESS ao encostar, LONG/REPEAT segurando, SHORT+RELEASE ao soltar).
   */
  inputEvent(key: Key, type: InputType): void {
    const code = KEY_CODE[key]
    this.rpc
      .sendBatch([{ field: F.guiSendInputEvent, build: (w: PbWriter) => w.uint(1, code).uint(2, INPUT[type]) }], `tecla ${key}`)
      .catch(() => {})
  }

  /** Aperta e espera a tela assentar. Devolve o quadro final. */
  async pressAndSettle(key: Key, long = false): Promise<{ frame: Frame | null; settled: boolean }> {
    const before = this.screen.currentSeq
    await this.press(key, long)
    return this.screen.waitSettled(before, 250, long ? 2500 : 1500)
  }

  /** Quadro atual; se ainda não chegou nenhum, espera um. */
  async currentFrame(timeoutMs = 4000): Promise<Frame | null> {
    await this.startScreen()
    return this.screen.frame ?? (await this.screen.waitNewer(0, timeoutMs))
  }

  async close() {
    await this.stopScreen()
    await this.rpc.transport.close()
  }
}

function keyValues(parts: MainMsg[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const p of parts) {
    let k = ''
    let v = ''
    for (const f of fields(p.body)) {
      if (f.field === 1 && f.wire === 2) k = text(f.data)
      else if (f.field === 2 && f.wire === 2) v = text(f.data)
    }
    if (k) out[k] = v
  }
  return out
}

function parseFile(buf: Uint8Array): FileEntry {
  const e: FileEntry = { name: '', dir: false, size: 0 }
  for (const f of fields(buf)) {
    if (f.field === 1) e.dir = f.int === 1
    else if (f.field === 2 && f.wire === 2) e.name = text(f.data)
    else if (f.field === 3) e.size = f.int
  }
  return e
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0))
  let off = 0
  for (const c of chunks) {
    out.set(c, off)
    off += c.length
  }
  return out
}
