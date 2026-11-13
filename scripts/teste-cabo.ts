// Teste do transporte de cabo do APP (src/flipper/usb.ts) num Flipper real, no Node.
// Simula a Web Serial do navegador por cima da porta serial: o código testado é o mesmo do Chrome.
// Uso: npm run teste:cabo -- COM3
import { SerialPort } from 'serialport'
import { FlipperClient } from '../src/flipper/client'
import { UsbTransport } from '../src/flipper/usb'

const path = process.argv[2] ?? 'COM3'

function fakePort(): WebSerialPort {
  let sp: SerialPort
  const port = {
    readable: null as ReadableStream<Uint8Array> | null,
    writable: null as WritableStream<Uint8Array> | null,
    async open({ baudRate }: { baudRate: number }) {
      sp = new SerialPort({ path, baudRate, autoOpen: false })
      await new Promise<void>((res, rej) => sp.open((e) => (e ? rej(e) : res())))
      port.readable = new ReadableStream({
        start(c) {
          sp.on('data', (d: Buffer) => c.enqueue(new Uint8Array(d)))
          sp.on('close', () => {
            try {
              c.close()
            } catch {
              /* já cancelado pelo leitor */
            }
          })
        },
      })
      port.writable = new WritableStream({ write: (b) => new Promise((res, rej) => sp.write(Buffer.from(b), (e) => (e ? rej(e) : sp.drain(() => res())))) })
    },
    async close() {
      if (sp?.isOpen) await new Promise<void>((r) => sp.close(() => r()))
    },
    async setSignals(s: { dataTerminalReady?: boolean }) {
      await new Promise<void>((r) => sp.set({ dtr: s.dataTerminalReady ?? true }, () => r()))
    },
    getInfo: () => ({ usbVendorId: 0x0483, usbProductId: 0x5740 }),
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => true,
  }
  return port as unknown as WebSerialPort
}
Object.defineProperty(globalThis.navigator, 'serial', { value: { getPorts: async () => [fakePort()], requestPort: async () => fakePort() }, configurable: true })

let ok = 0
let fail = 0
async function step(name: string, fn: () => Promise<string>) {
  const t0 = Date.now()
  try {
    const r = await fn()
    ok++
    console.log(`✔ ${name} (${Date.now() - t0} ms) ${r}`)
  } catch (e) {
    fail++
    console.log(`✘ ${name}: ${(e as Error).message}`)
  }
}

let t = await UsbTransport.connect('serial', (s) => console.log('  ' + s))
let fz = new FlipperClient(t)
await step('ping', async () => (await fz.ping(), ''))
await step('device_info', async () => `${Object.keys(await fz.deviceInfo()).length} campos`)
await step('lista /ext', async () => `${(await fz.list('/ext')).length} itens`)
await step('tela', async () => {
  await fz.startScreen()
  const f = await fz.currentFrame()
  return f ? `quadro #${f.seq}` : 'sem quadro'
})
// Fecha SEM StopSession (como uma página recarregada) e reabre: testa a recuperação da sessão antiga.
await step('reabrir com sessão antiga presa', async () => {
  await (t as any).pipe.close()
  t = await UsbTransport.reconnect('serial', (s) => console.log('  ' + s))
  fz = new FlipperClient(t)
  await fz.ping()
  return 'ping ok'
})
await step('fechar limpo (StopSession)', async () => (await fz.stopScreen(), await t.close(), ''))
await step('reabrir depois de fechar limpo', async () => {
  t = await UsbTransport.reconnect('serial')
  fz = new FlipperClient(t)
  await fz.ping()
  await t.close()
  return 'ping ok'
})
console.log(`\n${ok} ok, ${fail} falhas`)
process.exit(fail ? 1 : 0)
