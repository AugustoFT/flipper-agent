// Transporte USB serial (Node) — só para testar o RPC no PC. O app no celular usa BLE.
//
// Pelo USB, o Flipper começa no CLI de texto. O comando `start_rpc_session` troca a porta para
// o RPC binário; a partir daí os bytes são os mesmos do BLE. `StopSession` volta ao CLI.

import { SerialPort } from 'serialport'
import type { Transport } from '../src/flipper/transport'

export class NodeSerialTransport implements Transport {
  private dataHandlers: Array<(c: Uint8Array) => void> = []
  private closeHandlers: Array<(r: string) => void> = []

  private constructor(private port: SerialPort, readonly name: string) {}

  static async open(path: string): Promise<NodeSerialTransport> {
    const port = new SerialPort({ path, baudRate: 230400, autoOpen: false })
    await new Promise<void>((res, rej) => port.open((e) => (e ? rej(e) : res())))
    port.set({ dtr: true }, () => {})

    // Sai do CLI: espera o prompt, pede a sessão RPC e descarta o eco do comando.
    let buf = ''
    const onText = (d: Buffer) => (buf += d.toString('latin1'))
    port.on('data', onText)
    port.write('\r')
    await waitFor(() => buf.includes('>: '), 3000, 'prompt do CLI')
    buf = ''
    port.write('start_rpc_session\r')
    await waitFor(() => buf.includes('start_rpc_session\r\n'), 3000, 'eco do start_rpc_session')
    port.off('data', onText)
    const leftover = Buffer.from(buf.slice(buf.indexOf('start_rpc_session\r\n') + 'start_rpc_session\r\n'.length), 'latin1')

    const t = new NodeSerialTransport(port, path)
    port.on('data', (d: Buffer) => t.dataHandlers.forEach((h) => h(new Uint8Array(d))))
    port.on('close', () => t.closeHandlers.forEach((h) => h('porta fechada')))
    if (leftover.length) setTimeout(() => t.dataHandlers.forEach((h) => h(new Uint8Array(leftover))), 0)
    return t
  }

  send(data: Uint8Array): Promise<void> {
    return new Promise((res, rej) => this.port.write(Buffer.from(data), (e) => (e ? rej(e) : this.port.drain(() => res()))))
  }

  onData(h: (c: Uint8Array) => void) {
    this.dataHandlers.push(h)
  }

  onClose(h: (r: string) => void) {
    this.closeHandlers.push(h)
  }

  close(): Promise<void> {
    return new Promise((res) => (this.port.isOpen ? this.port.close(() => res()) : res()))
  }
}

async function waitFor(cond: () => boolean, ms: number, what: string) {
  const end = Date.now() + ms
  while (!cond()) {
    if (Date.now() > end) throw new Error(`timeout esperando ${what}`)
    await new Promise((r) => setTimeout(r, 20))
  }
}
