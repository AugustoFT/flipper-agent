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
      // Pequeno atraso, como o rádio: ~40 ms.
      setTimeout(() => this.emit(this.reply(m.id, m.field)), 40)
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

  private reply(id: number, field: number): Uint8Array {
    const w = new PbWriter().uint(1, id)
    if (field === F.pingRequest) w.message(F.pingResponse, () => {})
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
