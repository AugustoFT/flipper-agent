// Teste do núcleo RPC num Flipper real pelo USB. Só LEITURA: não aperta teclas nem grava nada.
// Uso: npm run teste:usb -- COM3

import { FlipperClient } from '../src/flipper/client'
import { encodeMain, F } from '../src/flipper/rpc'
import { toText } from '../src/flipper/screen'
import { NodeSerialTransport } from './serial-node'

const port = process.argv[2] ?? 'COM3'
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

const transport = await NodeSerialTransport.open(port)
const fz = new FlipperClient(transport)

await step('ping', async () => (await fz.ping(), ''))
await step('device_info', async () => {
  const i = await fz.deviceInfo()
  return `${Object.keys(i).length} campos · firmware=${i['firmware.version'] ?? i['firmware_version']} · origem=${i['firmware.origin.fork']}`
})
await step('power_info', async () => {
  const p = await fz.powerInfo()
  return `bateria=${p['charge.level'] ?? p['charge_level']}%`
})
await step('lock_status', async () => `bloqueado=${await fz.isLocked()}`)
await step('listar /ext', async () => {
  const l = await fz.list('/ext')
  return l.map((e) => (e.dir ? `${e.name}/` : e.name)).join(' ')
})
await step('stat + ler arquivo pequeno', async () => {
  const dirs = ['/ext/infrared', '/ext/subghz', '/ext/nfc', '/ext/badusb']
  for (const d of dirs) {
    const files = (await fz.list(d).catch(() => [])).filter((e) => !e.dir && e.size > 0 && e.size < 4096)
    if (files.length) {
      const path = `${d}/${files[0].name}`
      const data = await fz.read(path)
      const st = await fz.stat(path)
      if (data.length !== st.size) throw new Error(`li ${data.length} bytes, stat diz ${st.size}`)
      return `${path} (${data.length} bytes, bate com stat)`
    }
  }
  return '(nenhum arquivo pequeno para testar)'
})
await step('erro esperado (arquivo inexistente)', async () => {
  try {
    await fz.stat('/ext/__nao_existe__.txt')
  } catch (e) {
    return `ok → ${(e as Error).message}`
  }
  throw new Error('deveria ter falhado')
})
await step('tela (screen stream)', async () => {
  const f = await fz.currentFrame(5000)
  if (!f) throw new Error('nenhum quadro em 5 s')
  console.log(toText(f))
  return `quadro #${f.seq}, orientação ${f.orientation}`
})

// Volta o Flipper ao CLI (fecha a sessão RPC) antes de soltar a porta.
await fz.stopScreen()
await transport.send(encodeMain(999, F.stopSession, () => {}))
await new Promise((r) => setTimeout(r, 300))
await transport.close()

console.log(`\n${ok} ok, ${fail} falha(s)`)
process.exit(fail ? 1 : 0)
