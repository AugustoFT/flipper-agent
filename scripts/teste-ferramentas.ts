// Testa as ferramentas do agente (as mesmas que o modelo chama) num Flipper real pelo USB.
// Só leitura + validações: nenhuma tecla é apertada e nada é gravado.
// Uso: npm run teste:ferramentas -- COM3

import { runTool } from '../src/agent/tools'
import { FlipperClient } from '../src/flipper/client'
import { encodeMain, F } from '../src/flipper/rpc'
import { NodeSerialTransport } from './serial-node'

const transport = await NodeSerialTransport.open(process.argv[2] ?? 'COM3')
const fz = new FlipperClient(transport)
const ctx = { fz, vision: false, signal: new AbortController().signal }

const casos: Array<{ name: string; args: Record<string, unknown>; esperaErro?: boolean }> = [
  { name: 'flipper_power_info', args: {} },
  { name: 'flipper_list', args: { path: '/ext/infrared' } },
  { name: 'flipper_read', args: { path: '/ext/infrared/Samsung.ir' } },
  { name: 'flipper_screen', args: {} },
  { name: 'flipper_press', args: { keys: ['CIMA'] }, esperaErro: true },
  { name: 'flipper_press', args: { keys: Array(21).fill('UP') }, esperaErro: true },
  { name: 'flipper_list', args: { path: '/ext/../int' }, esperaErro: true },
  { name: 'flipper_delete', args: { path: '/ext' }, esperaErro: true },
  { name: 'flipper_nao_existe', args: {}, esperaErro: true },
]

let falhas = 0
for (const [i, c] of casos.entries()) {
  const r = await runTool({ id: String(i), name: c.name, args: c.args }, ctx)
  const certo = Boolean(r.isError) === Boolean(c.esperaErro)
  if (!certo) falhas++
  const resumo = r.text.replace(/\s+/g, ' ').slice(0, 110)
  console.log(`${certo ? '✔' : '✘'} ${c.name} ${JSON.stringify(c.args).slice(0, 40)} → ${resumo}`)
}

await fz.stopScreen()
await transport.send(encodeMain(999, F.stopSession, () => {}))
await new Promise((r) => setTimeout(r, 300))
await transport.close()
console.log(`\n${casos.length - falhas}/${casos.length} como esperado`)
process.exit(falhas ? 1 : 0)
