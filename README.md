# Flipper Agent

Agente de IA que controla o Flipper Zero **direto do celular, pelo Bluetooth**. Sem PC, sem servidor,
sem app na loja. É uma página web (PWA): o celular fala BLE com o Flipper e chama o modelo de IA
direto do navegador.

```
Flipper Zero  ⇄  BLE  ⇄  celular (esta página)  ⇄  HTTPS  ⇄  Gemini / OpenRouter
```

## Onde roda

| Aparelho | Navegador |
|---|---|
| iPhone | **Bluefy** (grátis na App Store). O Safari não tem Web Bluetooth. |
| Android | Chrome |
| PC | Chrome ou Edge |

Cabo (Lightning/USB-C) no iPhone **não** serve para controle: o iOS não deixa apps comuns falarem
com dispositivos seriais USB. Só dá energia.

## Modelo de IA (grátis)

- **Google Gemini** — chave em <https://aistudio.google.com/apikey>. Padrão: `gemini-flash-latest`.
- **OpenRouter** — chave em <https://openrouter.ai/keys>; use modelos com sufixo `:free`
  (botão "Listar" mostra só os que suportam ferramentas).

A chave fica salva só no aparelho. Nos planos grátis o provedor pode usar o que recebe (telas e
arquivos do Flipper inclusive) para treinar modelos.

## O que o agente consegue fazer

Ver a tela, apertar teclas (curto/longo), abrir apps pelo nome, listar/ler/gravar/apagar/renomear
arquivos do SD, ler info do aparelho e da bateria. Tudo que vem do Flipper chega ao modelo marcado
como dado não confiável (um arquivo no SD não consegue dar ordens ao agente).

## Desenvolvimento

```bash
npm install
npm run dev          # http://localhost:5173 (no PC, Web Bluetooth funciona em localhost)
npm run build        # gera dist/ para publicar
```

Testes no Flipper real pelo USB (só leitura — não aperta tecla nem grava):

```bash
npm run teste:usb -- COM3
npm run teste:ferramentas -- COM3
```

## Publicar (precisa de HTTPS para o Bluetooth funcionar no celular)

O `dist/` é estático: serve em GitHub Pages, Vercel ou Netlify. O `base: './'` do Vite deixa
funcionar em qualquer subcaminho.

## Como funciona (engenharia reversa)

Protocolo levantado a partir do [zeffin](https://github.com/samartined/zeffin) (AGPL — nenhum código
copiado, só o entendimento do protocolo) e dos `.proto` do firmware:

- **RPC**: mensagens `PB.Main` em protobuf, cada uma prefixada pelo tamanho (varint). Codec
  escrito à mão em `src/flipper/pb.ts` (os `.proto` oficiais não têm licença declarada).
- **BLE**: serviço `8fe5b3d5-…`, characteristic de leitura `…61fe`, escrita `…62fe` e controle de
  fluxo `…63fe` (`src/flipper/ble.ts`). O Flipper concede 1024 bytes de crédito e só reabastece
  quando a janela acaba — escrever além disso perde dados em silêncio.
- **Teclas**: `PRESS → SHORT/LONG → RELEASE` num envio só; outra ordem é descartada pelo firmware.
- **Tela**: 128×64, 1 bit, empacotada na vertical (8 linhas por byte). Depois de apertar, espera
  250 ms sem quadro novo (teto 1,5 s) porque algumas animações nunca param.

## Estrutura

```
src/flipper/   pb.ts (codec) · rpc.ts (sessão) · client.ts (operações) · screen.ts · ble.ts
src/agent/     agent.ts (loop + prompt) · tools.ts · providers.ts (Gemini/OpenRouter)
src/ui/        App.tsx · Screen.tsx (tela ao vivo + controle) · SettingsPanel.tsx
scripts/       testes pelo USB (Node + serialport)
```
