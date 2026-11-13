// Teste da passagem de bastão (ferramentas esperando a reconexão) num Flipper real pelo USB.
// Uso: npm run teste:bastao -- COM3
import { runTool } from '../src/agent/tools'
import { FlipperClient } from '../src/flipper/client'
import { FlipperLink } from '../src/flipper/link'
import { NodeSerialTransport } from './serial-node'
import { encodeMain, F } from '../src/flipper/rpc'

const link = new FlipperLink()
const t = await NodeSerialTransport.open(process.argv[2] ?? 'COM3')
const fz = new FlipperClient(t)
const ctx = { link, vision: false, signal: new AbortController().signal, onProgress: (m: string) => console.log('  progresso:', m) }

// 1) Conexão "caída": a ferramenta espera; 1,5 s depois a conexão volta e ela termina.
link.set(null)
setTimeout(() => link.set(fz), 1500)
let t0 = Date.now()
let r = await runTool({ id: '1', name: 'flipper_power_info', args: {} }, ctx)
console.log(`${!r.isError && Date.now() - t0 >= 1400 ? '✔' : '✘'} ferramenta esperou a reconexão (${Date.now() - t0} ms)`)

// 2) Handoff sem queda (cabo): devolve a tela dizendo que a conexão não caiu.
t0 = Date.now()
r = await runTool({ id: '2', name: 'flipper_handoff', args: { message: 'teste' } }, ctx)
console.log(`${r.text.includes('NÃO caiu') ? '✔' : '✘'} handoff sem queda (${Date.now() - t0} ms)`)

// 3) Handoff com queda e volta simuladas: troca o cliente no meio.
const fz2 = new FlipperClient(t) // mesmo fio, "outra" conexão
// Queda simulada: a sessão "morre" (a tela dela para), e 2 s depois chega uma conexão nova.
setTimeout(() => (link.set(null), fz.stopScreen().catch(() => {})), 500)
setTimeout(() => link.set(fz2), 2500)
t0 = Date.now()
r = await runTool({ id: '3', name: 'flipper_handoff', args: { message: 'use o app e saia' } }, ctx)
console.log(`${r.text.includes('voltou') ? '✔' : '✘'} handoff com queda e volta (${Date.now() - t0} ms): ${r.text.split('\n')[0]}`)

await fz.stopScreen().catch(() => {})
await t.send(encodeMain(999, F.stopSession, () => {}))
await new Promise((r) => setTimeout(r, 300))
process.exit(0)
