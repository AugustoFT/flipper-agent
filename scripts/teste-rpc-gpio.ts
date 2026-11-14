// Teste das ferramentas flipper_app_control e flipper_gpio.
//
//   npm run teste:rpc-gpio            → Flipper simulado (confere a sequência de comandos RPC)
//   npm run teste:rpc-gpio -- COM3    → Flipper real no USB: SÓ LEITURA (abre o Infravermelho em modo
//                                        RPC sem transmitir, e lê pinos). Nada é transmitido nem escrito.

import { FlipperClient } from '../src/flipper/client'
import { DemoTransport } from '../src/flipper/demo'
import { FlipperLink } from '../src/flipper/link'
import { encodeMain, F } from '../src/flipper/rpc'
import { runTool } from '../src/agent/tools'
import { NodeSerialTransport } from './serial-node'

const port = process.argv[2]
const demo = !port
const transport = demo ? new DemoTransport() : await NodeSerialTransport.open(port)
const fz = new FlipperClient(transport)
const link = new FlipperLink()
link.set(fz)
const ctx = { link, vision: false, signal: new AbortController().signal }
let ok = 0
let fail = 0
const check = (cond: boolean, what: string, extra = '') => {
  cond ? ok++ : fail++
  console.log(`${cond ? '✔' : '✘'} ${what}${extra ? ` — ${extra}` : ''}`)
}
let n = 0
const call = (name: string, args: Record<string, unknown>) => runTool({ id: String(++n), name, args }, ctx)
const log = () => (demo ? (transport as DemoTransport).log.splice(0) : [])

console.log(`Flipper: ${demo ? 'simulado' : port}\n`)

if (demo) {
  // Infravermelho: abre em RPC, carrega, aperta o sinal pelo nome, solta e fecha.
  const ir = await call('flipper_app_control', { app: 'Infrared', file: '/ext/infrared/TV.ir', button: 'Power', seconds: 0.3 })
  const irLog = log()
  check(!ir.isError, 'infravermelho pelo RPC', ir.text.split('\n')[0])
  check(
    irLog.join(' | ') === 'start Infrared RPC | load /ext/infrared/TV.ir | press Power | release | exit',
    'sequência: start RPC → load → press → release → exit',
    irLog.join(' | '),
  )

  // Por índice e mantendo o app aberto.
  await call('flipper_app_control', { app: 'Sub-GHz', file: '/ext/subghz/Portao.sub', index: 0, seconds: 0.2, keep_open: true })
  const subLog = log()
  check(subLog.includes('press #0') && !subLog.includes('exit'), 'Sub-GHz por índice, app continua aberto', subLog.join(' | '))

  // NFC sem botão: só carrega (emula) e fecha.
  await call('flipper_app_control', { app: 'NFC', file: '/ext/nfc/Cartao.nfc', seconds: 0.2 })
  const nfcLog = log()
  check(!nfcLog.some((l) => l.startsWith('press')) && nfcLog.at(-1) === 'exit', 'NFC: carrega sem apertar botão e fecha', nfcLog.join(' | '))

  // Erro do app explicado com o texto do GetError.
  await fz.appExit()
  log()
  const errStart = await call('flipper_app_control', { app: 'Infrared', file: '/ext/../int/x.ir' })
  check(Boolean(errStart.isError) && /\.\./.test(errStart.text), 'caminho com .. é recusado antes de tocar no Flipper')
  log()

  // GPIO
  const w = await call('flipper_gpio', { action: 'write', pin: 'PA7', value: 1 })
  check(!w.isError && /pino 2/.test(w.text) && log().includes('write 7=1'), 'escreve 1 no PA7 (pino 2)', w.text)
  const rUp = await call('flipper_gpio', { action: 'read', pin: 'PB2', pull: 'UP' })
  check(/nível 1/.test(rUp.text), 'lê PB2 com pull UP = 1', rUp.text)
  const mode = await call('flipper_gpio', { action: 'mode', pin: 'PB2' })
  check(/entrada/.test(mode.text), 'modo do PB2 = entrada', mode.text)
  const otg = await call('flipper_gpio', { action: 'otg', on: true })
  const otgState = await call('flipper_gpio', { action: 'otg' })
  check(/ligada/.test(otg.text) && /ligada/.test(otgState.text), 'liga e lê a saída de 5 V', otgState.text)
  const bad = await call('flipper_gpio', { action: 'write', pin: 'PZ9', value: 1 })
  check(Boolean(bad.isError), 'pino inexistente é recusado', bad.text.split('.')[0])
  const badVal = await call('flipper_gpio', { action: 'write', pin: 'PA7', value: 5 })
  check(Boolean(badVal.isError), 'valor diferente de 0/1 é recusado')
} else {
  // Aparelho real, só leitura: modo RPC do Infravermelho sem transmitir, e GPIO só lendo.
  try {
    await fz.appStartRpc('Infrared')
    check(true, 'Infravermelho abriu em modo RPC')
    const err = await fz.appLoadFile('/ext/infrared/__nao_existe__.ir').then(
      () => null,
      (e: Error) => e,
    )
    const why = err ? await fz.appGetError().catch(() => null) : null
    check(Boolean(err), 'arquivo inexistente é recusado pelo app', `${err?.message ?? ''} ${why?.text ?? ''}`.trim())
  } finally {
    await fz.appExit().catch(() => {})
  }
  for (const pin of ['PA7', 'PC0'] as const) {
    const m = await call('flipper_gpio', { action: 'mode', pin })
    check(!m.isError, `modo do ${pin}`, m.text)
  }
  const otg = await call('flipper_gpio', { action: 'otg' })
  check(!otg.isError, 'estado da saída de 5 V', otg.text)
}

await transport.send(encodeMain(999, F.stopSession, () => {}))
await new Promise((r) => setTimeout(r, 300))
console.log(`\n${ok} ok, ${fail} falhas`)
process.exit(fail ? 1 : 0)
