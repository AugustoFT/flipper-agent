// Testa o gate de segurança e a validação de caminhos SEM Flipper (cliente falso).
// Uso: npm run teste:seguranca

import { gate, riskOf, type SafetyCtx } from '../src/agent/safety'
import { runTool } from '../src/agent/tools'
import { FlipperLink } from '../src/flipper/link'

const link = new FlipperLink()
link.set({} as never) // nenhum caso chega a usar o cliente: tudo falha ou é barrado antes
const signal = new AbortController().signal
let falhas = 0
const ok = (nome: string, cond: boolean) => {
  if (!cond) falhas++
  console.log(`${cond ? '✔' : '✘'} ${nome}`)
}
const call = (name: string, args: Record<string, unknown> = {}) => ({ id: '1', name, args })
const run = (c: ReturnType<typeof call>, safety?: SafetyCtx) => runTool(c, { link, vision: false, signal, safety })

// Classificação de risco
ok('risco: list = low', riskOf('flipper_list', {}) === 'low')
ok('risco: press = medium', riskOf('flipper_press', {}) === 'medium')
ok('risco: write/delete/app_control/handoff = high', ['flipper_write', 'flipper_delete', 'flipper_app_control', 'flipper_handoff'].every((n) => riskOf(n, {}) === 'high'))
ok('risco: gpio write = high, read = low, otg on = high', riskOf('flipper_gpio', { action: 'write' }) === 'high' && riskOf('flipper_gpio', { action: 'read' }) === 'low' && riskOf('flipper_gpio', { action: 'otg', on: true }) === 'high')
ok('risco: ferramenta desconhecida = high', riskOf('flipper_xyz', {}) === 'high')

// Fail-closed e modos
let r = await run(call('flipper_delete', { path: '/ext/x' }))
ok('sem canal de confirmação: high é bloqueado', r.isError === true && /confirmação/.test(r.text))
r = await run(call('flipper_press', { keys: ['UP'] }), { mode: 'readonly', source: 'local' })
ok('readonly bloqueia press', r.isError === true && /leitura/.test(r.text))
r = await run(call('flipper_write', { path: '/ext/x', content: 'a' }), { mode: 'readonly', source: 'local', confirm: async () => true })
ok('readonly bloqueia write mesmo com confirm', r.isError === true && /leitura/.test(r.text))
r = await run(call('flipper_delete', { path: '/ext/x' }), { mode: 'confirm-high', source: 'local', confirm: async () => false })
ok('recusa do usuário: não executa', r.isError === true && /recusou/.test(r.text))
let asked = 0
const g1 = await gate(call('flipper_press'), { mode: 'confirm-high', source: 'local', confirm: async () => (asked++, true) }, signal)
ok('confirm-high não pergunta em press', g1.ok && asked === 0)
const g2 = await gate(call('flipper_press'), { mode: 'confirm-all', source: 'local', confirm: async () => (asked++, true) }, signal)
ok('confirm-all pergunta em press', g2.ok && asked === 1)

// Aborto fecha o diálogo como recusa
const ctrl = new AbortController()
const pend = gate(call('flipper_write', { path: '/ext/a', content: 'x' }), { mode: 'confirm-high', source: 'local', confirm: () => new Promise<boolean>(() => {}) }, ctrl.signal)
setTimeout(() => ctrl.abort(), 50)
const g3 = await pend
ok('abort do agente conta como recusa', !g3.ok)

// Caminhos (aprovados pelo "usuário", barrados no código)
const yes: SafetyCtx = { mode: 'confirm-high', source: 'script', confirm: async () => true }
for (const [name, args, rx] of [
  ['flipper_list', { path: '/extra' }, /\/ext ou \/int/],
  ['flipper_list', { path: '/ext/../int' }, /\.\./],
  ['flipper_list', { path: '/ext/./a' }, /\.\./],
  ['flipper_read', { path: '/internal/x' }, /\/ext ou \/int/],
  ['flipper_write', { path: '/int/x', content: 'a' }, /somente leitura/],
  ['flipper_delete', { path: '/int/x' }, /somente leitura/],
  ['flipper_delete', { path: '/ext' }, /raiz/],
  ['flipper_rename', { from: '/ext/a', to: '/int/b' }, /somente leitura/],
  ['flipper_mkdir', { path: '/int/d' }, /somente leitura/],
  ['flipper_app_start', { name: 'x', args: '/extra/y' }, /\/ext ou \/int/],
  ['flipper_app_start', { name: 'x', args: 'a'.repeat(300) }, /longo/],
] as const) {
  const res = await run(call(name, args as Record<string, unknown>), yes)
  ok(`${name} ${JSON.stringify(args).slice(0, 40)} barrado`, res.isError === true && rx.test(res.text))
}

console.log(falhas ? `\n${falhas} falha(s)` : '\nTudo certo')
process.exit(falhas ? 1 : 0)
