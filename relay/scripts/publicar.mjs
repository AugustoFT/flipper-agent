#!/usr/bin/env node
// Publica o SEU relay na sua conta Cloudflare (plano grátis serve) e mostra o endereço para o Claude.
//
//   cd relay
//   npm install
//   npm run publicar            (ou: npm run publicar -- --checar   para só conferir, sem criar nada)
//
// O que ele faz, na ordem:
//   1. confere se você está logado no wrangler (se não, abre o login no navegador);
//   2. confere se o armazenamento do login (KV "OAUTH_KV") do wrangler.jsonc existe na SUA conta.
//      O id que vem no repositório é da conta do autor: na sua, ele não existe, então o script cria
//      um KV novo (ou reaproveita um que já tenha o mesmo nome) e grava o id no wrangler.jsonc;
//   3. publica o Worker e mostra o endereço terminado em /mcp.
//
// Publish YOUR relay to your Cloudflare account (free plan is enough) and print the address for Claude.
// Run with --checar (--check) to only verify, without creating or deploying anything.

import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const configPath = join(root, 'wrangler.jsonc')
const KV_TITLE = 'flipper-relay-OAUTH_KV'
const onlyCheck = process.argv.includes('--checar') || process.argv.includes('--check')

function wrangler(args, { capture = true } = {}) {
  const r = spawnSync('npx', ['wrangler', ...args], {
    cwd: root,
    shell: true, // no Windows o npx é um .cmd
    encoding: 'utf8',
    stdio: capture ? ['inherit', 'pipe', 'pipe'] : 'inherit',
  })
  return { ok: r.status === 0, out: `${r.stdout ?? ''}${r.stderr ?? ''}` }
}

function fail(msg) {
  console.error(`\n✘ ${msg}`)
  process.exit(1)
}

// 1. login
console.log('1/3 Conta Cloudflare · Cloudflare account')
let who = wrangler(['whoami'])
if (!who.ok || /not authenticated|You are not/i.test(who.out)) {
  if (onlyCheck) fail('Você não está logado. Rode: npx wrangler login  ·  Not logged in.')
  console.log('   Abrindo o login no navegador… · Opening login in the browser…')
  if (!wrangler(['login'], { capture: false }).ok) fail('O login não terminou. · Login did not finish.')
  who = wrangler(['whoami'])
}
const email = who.out.match(/associated with the email ([^\s.]+@[^\s]+?)\.?\s/)?.[1]
console.log(`   ✔ logado${email ? ` (${email.replace(/^(.).*(@.*)$/, '$1…$2')})` : ''}`)

// 2. KV do login
console.log('2/3 Armazenamento do login (KV) · Login storage (KV)')
const config = readFileSync(configPath, 'utf8')
const currentId = config.match(/"binding":\s*"OAUTH_KV",\s*"id":\s*"([0-9a-f]+)"/)?.[1]
if (!currentId) fail('Não achei o KV OAUTH_KV no wrangler.jsonc. · OAUTH_KV not found in wrangler.jsonc.')

const listed = wrangler(['kv', 'namespace', 'list'])
if (!listed.ok) fail(`Não consegui listar os KV da conta:\n${listed.out}`)
let namespaces = []
try {
  namespaces = JSON.parse(listed.out.slice(listed.out.indexOf('[')))
} catch {
  fail(`Resposta inesperada do wrangler:\n${listed.out}`)
}

let kvId = currentId
if (namespaces.some((n) => n.id === currentId)) {
  console.log(`   ✔ o KV do wrangler.jsonc existe nesta conta (${currentId.slice(0, 8)}…)`)
} else {
  const reuse = namespaces.find((n) => n.title === KV_TITLE || n.title.endsWith('OAUTH_KV'))
  if (reuse) {
    kvId = reuse.id
    console.log(`   ✔ reaproveitando o KV "${reuse.title}" desta conta`)
  } else if (onlyCheck) {
    console.log('   • o KV do wrangler.jsonc não é desta conta: a publicação vai criar um novo')
  } else {
    const created = wrangler(['kv', 'namespace', 'create', 'OAUTH_KV'])
    kvId = created.out.match(/[0-9a-f]{32}/)?.[0]
    if (!created.ok || !kvId) fail(`Não consegui criar o KV:\n${created.out}`)
    console.log('   ✔ KV criado · KV created')
  }
  if (kvId !== currentId && !onlyCheck) {
    writeFileSync(configPath, config.replace(currentId, kvId))
    console.log('   ✔ id gravado no wrangler.jsonc · id saved to wrangler.jsonc')
  }
}

if (onlyCheck) {
  console.log('\n✔ Tudo certo para publicar (nada foi criado nem publicado). · Ready to deploy (nothing was changed).')
  process.exit(0)
}

// 3. publicar
console.log('3/3 Publicando o Worker · Deploying the Worker')
const deployed = wrangler(['deploy'])
process.stdout.write(deployed.out.split('\n').map((l) => `   ${l}`).join('\n'))
if (!deployed.ok) {
  if (/workers\.dev subdomain/i.test(deployed.out))
    fail(
      'Sua conta ainda não tem um subdomínio workers.dev. Abra o painel da Cloudflare → Workers & Pages, ' +
        'escolha um subdomínio e rode de novo. · Register a workers.dev subdomain in the dashboard and run again.',
    )
  fail('A publicação falhou (veja acima). · Deploy failed (see above).')
}
const url = deployed.out.match(/https:\/\/[^\s]+\.workers\.dev/)?.[0]

console.log(`
✔ Relay publicado · Relay deployed${url ? `: ${url}` : ''}

No Flipper Agent → Configurações → Endereço do relay:   ${url ?? '(o endereço https://….workers.dev acima)'}
No Claude → Configurações → Conectores → Adicionar:      ${url ? `${url}/mcp` : '(o mesmo endereço + /mcp)'}

In Flipper Agent → Settings → Relay address: ${url ?? '(the https://….workers.dev address above)'}
In Claude → Settings → Connectors → Add custom connector: ${url ? `${url}/mcp` : '(same address + /mcp)'}
`)
