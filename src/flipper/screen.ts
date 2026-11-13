// Tela do Flipper: 128x64, 1 bit por pixel, empacotada na vertical.
// Cada byte cobre 8 linhas de uma coluna (bit 0 = linha de cima). São 8 "páginas" de 128 bytes.
// Bit ligado = pixel escuro.

export const WIDTH = 128
export const HEIGHT = 64
export const FRAME_BYTES = (WIDTH * HEIGHT) / 8

export interface Frame {
  seq: number
  at: number // performance.now() / Date.now() da chegada
  data: Uint8Array
  /** 0 horizontal, 1 horizontal invertida, 2 vertical, 3 vertical invertida. */
  orientation: number
}

/** Matriz de pixels já na orientação "normal" (sem rotação aplicada para vertical: raro no uso). */
export function toPixels(frame: Frame): Uint8Array {
  const px = new Uint8Array(WIDTH * HEIGHT)
  const d = frame.data
  for (let page = 0; page < HEIGHT / 8; page++) {
    for (let x = 0; x < WIDTH; x++) {
      const byte = d[page * WIDTH + x]
      if (!byte) continue
      for (let bit = 0; bit < 8; bit++) {
        if (byte & (1 << bit)) px[(page * 8 + bit) * WIDTH + x] = 1
      }
    }
  }
  if (frame.orientation === 1) px.reverse() // 180°: inverter o vetor inteiro gira a imagem
  return px
}

/** Representação em texto com meio-blocos (2 linhas por caractere): útil para modelos sem visão. */
export function toText(frame: Frame): string {
  const px = toPixels(frame)
  const lines: string[] = []
  for (let y = 0; y < HEIGHT; y += 2) {
    let line = ''
    for (let x = 0; x < WIDTH; x++) {
      const top = px[y * WIDTH + x]
      const bottom = px[(y + 1) * WIDTH + x]
      line += top && bottom ? '█' : top ? '▀' : bottom ? '▄' : ' '
    }
    lines.push(line.replace(/\s+$/, ''))
  }
  return lines.join('\n')
}

/** Guarda o quadro mais recente e permite esperar por quadros novos. */
export class ScreenStore {
  frame: Frame | null = null
  private seq = 0
  private waiters: Array<() => void> = []
  private listeners: Array<(f: Frame) => void> = []

  update(data: Uint8Array, orientation: number) {
    if (data.length !== FRAME_BYTES) return
    this.seq++
    this.frame = { seq: this.seq, at: Date.now(), data: data.slice(), orientation }
    const w = this.waiters
    this.waiters = []
    for (const fn of w) fn()
    for (const fn of this.listeners) fn(this.frame)
  }

  subscribe(fn: (f: Frame) => void): () => void {
    this.listeners.push(fn)
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn)
    }
  }

  get currentSeq() {
    return this.seq
  }

  /** Espera um quadro com seq > `after`. null se estourar o tempo. */
  waitNewer(after: number, timeoutMs: number): Promise<Frame | null> {
    if (this.seq > after) return Promise.resolve(this.frame)
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w !== done)
        resolve(null)
      }, timeoutMs)
      const done = () => {
        clearTimeout(timer)
        resolve(this.frame)
      }
      this.waiters.push(done)
    })
  }

  /**
   * Espera a tela reagir a uma ação e depois ficar quieta.
   * Lição tirada do zeffin: algumas animações (o golfinho da tela inicial) nunca param, então
   * "assentou" = nenhum quadro novo por `idleMs`, com teto de `maxMs`. Se bater o teto, `settled=false`.
   */
  async waitSettled(after: number, idleMs = 250, maxMs = 1500): Promise<{ frame: Frame | null; settled: boolean }> {
    const deadline = Date.now() + maxMs
    const first = await this.waitNewer(after, maxMs)
    if (!first) return { frame: this.frame, settled: true } // nada mudou na tela
    let last = this.seq
    for (;;) {
      const remaining = deadline - Date.now()
      if (remaining <= 0) return { frame: this.frame, settled: false }
      const next = await this.waitNewer(last, Math.min(idleMs, remaining))
      if (!next) return { frame: this.frame, settled: remaining >= idleMs }
      last = this.seq
    }
  }
}
