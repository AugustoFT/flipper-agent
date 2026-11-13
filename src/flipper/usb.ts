// Conexão pelo cabo USB, para quem pode: Web Serial (Chrome/Edge no computador) ou WebUSB (Chrome no
// Android, com cabo OTG). No iPhone nenhum navegador expõe USB — lá fica só o Bluetooth.
//
// Vantagem do cabo: o Bluetooth do Flipper fica livre. Apps que viram teclado/controle Bluetooth
// (Bad KB em BT, Bluetooth Remote) rodam sem derrubar a conexão, com o agente vendo a tela.
//
// O protocolo é o mesmo do teste no PC (scripts/serial-node.ts): o Flipper começa no CLI de texto,
// `start_rpc_session` troca para o RPC binário, e a partir daí os bytes são os mesmos do BLE.

import { encodeMain, F } from './rpc'
import type { Transport } from './transport'

const FLIPPER_VID = 0x0483
const FLIPPER_PID = 0x5740
const CDC_CONTROL = 0x02
const CDC_DATA = 0x0a
const SET_CONTROL_LINE_STATE = 0x22

export type UsbKind = 'serial' | 'webusb'

/** Qual API de cabo este navegador tem (Web Serial é preferida: o sistema cuida do driver). */
export function usbKind(): UsbKind | null {
  if (typeof navigator === 'undefined') return null
  if (navigator.serial) return 'serial'
  if (navigator.usb) return 'webusb'
  return null
}

/** Canal de bytes cru, antes do aperto de mão do CLI. */
interface Pipe {
  name: string
  write(b: Uint8Array): Promise<void>
  /** Começa a ler. `onData` pode ser trocado depois (handshake → RPC). */
  start(sink: { onData: (c: Uint8Array) => void; onClose: (r: string) => void }): void
  close(): Promise<void>
}

// ---------- Web Serial (computador) ----------

async function serialPipe(port: WebSerialPort): Promise<Pipe> {
  await port.open({ baudRate: 230400 })
  await port.setSignals({ dataTerminalReady: true }).catch(() => {})
  const writer = port.writable!.getWriter()
  const reader = port.readable!.getReader()
  let closed = false
  return {
    name: 'Flipper (cabo USB)',
    write: (b) => writer.write(b),
    start(sink) {
      void (async () => {
        try {
          for (;;) {
            const { value, done } = await reader.read()
            if (done) break
            if (value?.length) sink.onData(value)
          }
        } catch {
          /* cabo puxado: cai no onClose abaixo */
        }
        if (!closed) sink.onClose('cabo USB desconectado')
      })()
    },
    async close() {
      closed = true
      await reader.cancel().catch(() => {})
      reader.releaseLock()
      writer.releaseLock()
      await port.close().catch(() => {})
    },
  }
}

// ---------- WebUSB (Android) ----------

async function webUsbPipe(dev: WebUsbDevice): Promise<Pipe> {
  if (!dev.opened) await dev.open()
  if (!dev.configuration) await dev.selectConfiguration(1)
  const ifaces = dev.configuration!.interfaces
  const ctrl = ifaces.find((i) => i.alternate.interfaceClass === CDC_CONTROL)
  const data = ifaces.find((i) => i.alternate.interfaceClass === CDC_DATA)
  if (!data) throw new Error('o Flipper não expôs a porta serial no USB (está em modo Bad USB?)')
  const epIn = data.alternate.endpoints.find((e) => e.direction === 'in' && e.type === 'bulk')
  const epOut = data.alternate.endpoints.find((e) => e.direction === 'out' && e.type === 'bulk')
  if (!epIn || !epOut) throw new Error('porta serial do Flipper sem canais de dados')
  if (ctrl) await dev.claimInterface(ctrl.interfaceNumber).catch(() => {})
  await dev.claimInterface(data.interfaceNumber)
  // DTR ligado = "terminal aberto". Sem isso o CLI do Flipper não responde.
  if (ctrl) {
    await dev
      .controlTransferOut({ requestType: 'class', recipient: 'interface', request: SET_CONTROL_LINE_STATE, value: 0x03, index: ctrl.interfaceNumber })
      .catch(() => {})
  }
  let closed = false
  return {
    name: dev.productName || 'Flipper (cabo USB)',
    write: async (b) => {
      await dev.transferOut(epOut.endpointNumber, b)
    },
    start(sink) {
      void (async () => {
        try {
          for (;;) {
            const r = await dev.transferIn(epIn.endpointNumber, 4096)
            if (r.data && r.data.byteLength) sink.onData(new Uint8Array(r.data.buffer, r.data.byteOffset, r.data.byteLength))
          }
        } catch {
          /* cabo puxado ou fechado */
        }
        if (!closed) sink.onClose('cabo USB desconectado')
      })()
    },
    async close() {
      closed = true
      await dev.close().catch(() => {})
    },
  }
}

// ---------- transporte ----------

export class UsbTransport implements Transport {
  private dataHandlers: Array<(c: Uint8Array) => void> = []
  private closeHandlers: Array<(r: string) => void> = []
  private finished = false
  /** RPC que chegou antes de o cliente registrar quem lê (entregue no primeiro onData). */
  private early: Uint8Array[] = []

  private constructor(private pipe: Pipe) {}

  get name() {
    return this.pipe.name
  }

  /** Abre o seletor do navegador (precisa de toque do usuário). */
  static async connect(kind: UsbKind, log: (s: string) => void = () => {}): Promise<UsbTransport> {
    if (kind === 'serial') {
      const port = await navigator.serial!.requestPort({ filters: [{ usbVendorId: FLIPPER_VID, usbProductId: FLIPPER_PID }] })
      return UsbTransport.handshake(await serialPipe(port), log)
    }
    const dev = await navigator.usb!.requestDevice({ filters: [{ vendorId: FLIPPER_VID, productId: FLIPPER_PID }] })
    return UsbTransport.handshake(await webUsbPipe(dev), log)
  }

  /** Reabre uma porta já autorizada antes, sem seletor (reconexão automática). */
  static async reconnect(kind: UsbKind, log: (s: string) => void = () => {}): Promise<UsbTransport> {
    if (kind === 'serial') {
      const ports = await navigator.serial!.getPorts()
      const port = ports.find((p) => p.getInfo().usbVendorId === FLIPPER_VID)
      if (!port) throw new Error('cabo não conectado')
      return UsbTransport.handshake(await serialPipe(port), log)
    }
    const devs = await navigator.usb!.getDevices()
    if (!devs[0]) throw new Error('cabo não conectado')
    return UsbTransport.handshake(await webUsbPipe(devs[0]), log)
  }

  /**
   * Sai do CLI de texto e entra no RPC. Se uma sessão RPC antiga ficou aberta (página recarregada),
   * o CLI não responde: mandamos StopSession, que devolve a porta ao CLI, e tentamos de novo.
   */
  private static async handshake(pipe: Pipe, log: (s: string) => void): Promise<UsbTransport> {
    const t = new UsbTransport(pipe)
    // Texto do CLI guardado 1 caractere = 1 byte (fromCharCode), para recuperar os bytes exatos
    // do RPC que vierem grudados no eco. (TextDecoder 'latin1' é na verdade windows-1252 e trocaria alguns.)
    let text = ''
    let rpcMode = false
    let closedReason: string | null = null
    pipe.start({
      onData: (c) => {
        if (rpcMode) t.emit(c)
        else for (const b of c) text += String.fromCharCode(b)
      },
      onClose: (r) => {
        closedReason = r
        t.finish(r)
      },
    })
    const waitText = async (needle: string, ms: number) => {
      const end = performance.now() + ms
      while (!text.includes(needle)) {
        if (closedReason) throw new Error(closedReason)
        if (performance.now() > end) return false
        await new Promise((r) => setTimeout(r, 20))
      }
      return true
    }
    try {
      log('cabo: procurando o terminal do Flipper')
      await pipe.write(new TextEncoder().encode('\r'))
      if (!(await waitText('>: ', 1500))) {
        log('cabo: sessão antiga aberta, encerrando')
        await pipe.write(encodeMain(999, F.stopSession, () => {}))
        await new Promise((r) => setTimeout(r, 300))
        text = ''
        await pipe.write(new TextEncoder().encode('\r'))
        if (!(await waitText('>: ', 3000))) throw new Error('o Flipper não respondeu no cabo (desbloqueie a tela e tente de novo)')
      }
      text = ''
      const cmd = 'start_rpc_session\r'
      await pipe.write(new TextEncoder().encode(cmd))
      if (!(await waitText('start_rpc_session\r\n', 3000))) throw new Error('o Flipper não abriu a sessão RPC')
      // O que veio depois do eco já é RPC binário.
      const after = text.slice(text.indexOf('start_rpc_session\r\n') + 'start_rpc_session\r\n'.length)
      if (after) t.early.push(Uint8Array.from(after, (ch) => ch.charCodeAt(0)))
      rpcMode = true
      log('cabo: sessão RPC aberta')
      return t
    } catch (e) {
      await pipe.close()
      throw e
    }
  }

  private emit(c: Uint8Array) {
    if (this.dataHandlers.length) for (const h of this.dataHandlers) h(c)
    else this.early.push(c)
  }

  send(data: Uint8Array): Promise<void> {
    if (this.finished) return Promise.reject(new Error('cabo USB desconectado'))
    return this.pipe.write(data)
  }

  onData(handler: (c: Uint8Array) => void) {
    this.dataHandlers.push(handler)
    // Depois do construtor de quem registrou (o RpcSession registra no próprio construtor).
    queueMicrotask(() => {
      const pending = this.early
      this.early = []
      for (const c of pending) handler(c)
    })
  }

  onClose(handler: (r: string) => void) {
    this.closeHandlers.push(handler)
  }

  private finish(reason: string) {
    if (this.finished) return
    this.finished = true
    for (const h of this.closeHandlers) h(reason)
  }

  async close() {
    // Devolve a porta ao CLI para a próxima conexão começar limpa.
    if (!this.finished) await this.pipe.write(encodeMain(999, F.stopSession, () => {})).catch(() => {})
    this.finish('desconectado pelo app')
    await this.pipe.close()
  }
}
