// Flipper simulado (abra o app com ?demo). Responde ao RPC como o aparelho: OK para qualquer comando,
// e um stream de tela animado. Serve para conhecer o app sem um Flipper e para revisar o design.

import { fields, PbWriter } from './pb'
import { Deframer, decodeMain, F } from './rpc'
import { FRAME_BYTES, HEIGHT, WIDTH } from './screen'
import type { Transport } from './transport'

const KEY_NAMES = ['UP', 'DOWN', 'RIGHT', 'LEFT', 'OK', 'BACK']
const MENU = ['Sub-GHz', '125 kHz RFID', 'NFC', 'Infrared', 'GPIO', 'iButton', 'Bad USB', 'U2F', 'Apps']

export class DemoTransport implements Transport {
  readonly name = 'Flipper demo'
  private data: Array<(c: Uint8Array) => void> = []
  private deframer = new Deframer()
  private stream: ReturnType<typeof setInterval> | undefined
  private sel = 0
  private lastKey = ''
  // Apps em modo RPC e GPIO simulados: guardam o estado e o que foi feito (os testes leem `log`).
  private rpcApp: string | null = null
  private loaded: string | null = null
  private pins = new Map<number, { mode: number; pull: number; level: number }>()
  private otg = false
  readonly log: string[] = []

  onData(h: (c: Uint8Array) => void) {
    this.data.push(h)
  }
  onClose() {}

  async close() {
    clearInterval(this.stream)
  }

  async send(bytes: Uint8Array) {
    for (const raw of this.deframer.push(bytes)) {
      const m = decodeMain(raw)
      if (m.field === F.guiStartScreenStream && !this.stream) this.stream = setInterval(() => this.frame(), 100)
      if (m.field === F.guiStopScreenStream) clearInterval(this.stream), (this.stream = undefined)
      if (m.field === F.guiSendInputEvent) this.input(m.body)
      const [status, build] = this.handle(m.field, m.body)
      // Pequeno atraso, como o rádio: ~40 ms.
      setTimeout(() => this.emit(this.reply(m.id, m.field, status, build)), 40)
    }
  }

  private input(body: Uint8Array) {
    let key = 0
    let type = 0
    for (const f of fields(body)) {
      if (f.field === 1) key = f.int
      if (f.field === 2) type = f.int
    }
    if (type !== 2 && type !== 4) return // só SHORT e REPEAT mexem no menu
    const name = KEY_NAMES[key]
    this.lastKey = name
    if (name === 'UP') this.sel = (this.sel + MENU.length - 1) % MENU.length
    if (name === 'DOWN') this.sel = (this.sel + 1) % MENU.length
    this.frame()
  }

  /** Apps em modo RPC e GPIO: devolve o status (0 = OK) e, se houver, a resposta. */
  private handle(field: number, body: Uint8Array): [number, ((w: PbWriter) => void)?] {
    const f: Record<number, { int: number; str: string }> = {}
    for (const x of fields(body)) f[x.field] = { int: x.int, str: x.wire === 2 ? new TextDecoder().decode(x.data) : '' }
    const pin = (n: number) => this.pins.get(n) ?? { mode: 0, pull: 0, level: 0 }
    switch (field) {
      case F.appStartRequest:
        this.rpcApp = f[2]?.str === 'RPC' ? (f[1]?.str ?? '') : null
        this.loaded = null
        this.log.push(`start ${f[1]?.str} ${f[2]?.str ?? ''}`.trim())
        return [0]
      case F.appLoadFileRequest:
        if (!this.rpcApp) return [21] // ERROR_APP_NOT_RUNNING
        this.loaded = f[1]?.str ?? ''
        this.log.push(`load ${this.loaded}`)
        return [0]
      case F.appButtonPressRequest:
        if (!this.loaded) return [22] // ERROR_APP_CMD_ERROR
        this.log.push(`press ${f[1]?.str || `#${f[2]?.int ?? 0}`}`)
        return [0]
      case F.appButtonReleaseRequest:
        this.log.push('release')
        return [0]
      case F.appExitRequest:
        this.log.push('exit')
        this.rpcApp = this.loaded = null
        return [0]
      case F.appGetErrorRequest:
        return [0, (w) => w.message(F.appGetErrorResponse, (b) => b.uint(1, 1).string(2, 'demo: nenhum arquivo carregado'))]
      case F.gpioSetPinMode:
        this.pins.set(f[1]?.int ?? 0, { ...pin(f[1]?.int ?? 0), mode: f[2]?.int ?? 0 })
        return [0]
      case F.gpioSetInputPull:
        this.pins.set(f[1]?.int ?? 0, { ...pin(f[1]?.int ?? 0), pull: f[2]?.int ?? 0 })
        return [0]
      case F.gpioWritePin:
        this.pins.set(f[1]?.int ?? 0, { ...pin(f[1]?.int ?? 0), level: f[2]?.int ?? 0 })
        this.log.push(`write ${f[1]?.int ?? 0}=${f[2]?.int ?? 0}`)
        return [0]
      case F.gpioReadPin: {
        const p = pin(f[1]?.int ?? 0)
        const level = p.mode === 1 ? (p.pull === 1 ? 1 : 0) : p.level // entrada solta: pull UP lê 1
        return [0, (w) => w.message(F.gpioReadPinResponse, (b) => b.uint(2, level))]
      }
      case F.gpioGetPinMode:
        return [0, (w) => w.message(F.gpioGetPinModeResponse, (b) => b.uint(1, pin(f[1]?.int ?? 0).mode))]
      case F.gpioGetOtgMode:
        return [0, (w) => w.message(F.gpioGetOtgModeResponse, (b) => b.uint(1, this.otg ? 1 : 0))]
      case F.gpioSetOtgMode:
        this.otg = (f[1]?.int ?? 0) === 1
        this.log.push(`otg ${this.otg ? 'on' : 'off'}`)
        return [0]
    }
    return [0]
  }

  private reply(id: number, field: number, status = 0, build?: (w: PbWriter) => void): Uint8Array {
    const w = new PbWriter().uint(1, id)
    if (status) w.uint(2, status)
    if (build) build(w)
    else if (field === F.pingRequest) w.message(F.pingResponse, () => {})
    else if (field === F.powerInfoRequest) w.message(F.powerInfoResponse, (b) => b.string(1, 'charge.level').string(2, '87'))
    else w.message(F.empty, () => {})
    const main = w.finish()
    const out = new PbWriter().varintRaw(main.length).finish()
    const framed = new Uint8Array(out.length + main.length)
    framed.set(out)
    framed.set(main, out.length)
    return framed
  }

  private frame() {
    const px = new Uint8Array(WIDTH * HEIGHT)
    const set = (x: number, y: number) => x >= 0 && x < WIDTH && y >= 0 && y < HEIGHT && (px[y * WIDTH + x] = 1)
    // Menu com a seleção (barras no lugar do texto) e um "golfinho" que pisca na direita.
    for (let i = 0; i < 5; i++) {
      const item = (this.sel - 2 + i + MENU.length) % MENU.length
      const y = 4 + i * 12
      const w = 20 + MENU[item].length * 5
      if (i === 2) for (let yy = y - 2; yy < y + 9; yy++) for (let x = 2; x < 84; x++) set(x, yy)
      for (let x = 6; x < 6 + w && x < 82; x++) for (let yy = y + 2; yy < y + 5; yy++) if ((x + yy) % 3) i === 2 ? (px[yy * WIDTH + x] = 0) : set(x, yy)
    }
    const t = Date.now() / 300
    const cx = 106
    const cy = 30 + Math.round(Math.sin(t) * 6)
    for (let a = 0; a < 360; a += 6) set(cx + Math.round(Math.cos((a * Math.PI) / 180) * 12), cy + Math.round(Math.sin((a * Math.PI) / 180) * 9))
    set(cx + 5, cy - 3)
    if (this.lastKey) for (let x = 92; x < 122; x++) set(x, 58)
    const data = new Uint8Array(FRAME_BYTES)
    for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < WIDTH; x++) if (px[y * WIDTH + x]) data[(y >> 3) * WIDTH + x] |= 1 << (y & 7)
    const w = new PbWriter().message(F.guiScreenFrame, (f) => f.bytes(1, data))
    const main = w.finish()
    const out = new PbWriter().varintRaw(main.length).finish()
    const framed = new Uint8Array(out.length + main.length)
    framed.set(out)
    framed.set(main, out.length)
    this.emit(framed)
  }

  private emit(b: Uint8Array) {
    for (const h of this.data) h(b)
  }
}
