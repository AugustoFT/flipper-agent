// Textos da interface em português e inglês. Sem biblioteca: um objeto por idioma, com a mesma forma
// (o TypeScript reclama se faltar uma frase no inglês). Mensagens técnicas do diagnóstico da conexão
// ficam em português de propósito: são para quem mantém o app.

export type Lang = 'pt' | 'en'
export type LangSetting = Lang | 'auto'

const pt = {
  // barra de status
  connecting: 'Conectando',
  reconnecting: 'Reconectando',
  noFlipper: 'Sem Flipper',
  latencyTitle: 'Latência da conexão (ida e volta)',
  batteryTitle: 'Bateria do Flipper',
  help: 'Ajuda',
  settings: 'Configurações',

  // sem Bluetooth / conectar
  noBluetooth: 'Sem Bluetooth neste navegador',
  whereIphone: 'Instale o navegador Bluefy (grátis na App Store) e abra este mesmo endereço nele.',
  whereAndroid: 'Abra no Chrome.',
  wherePc: 'Chrome ou Edge.',
  computer: 'Computador',
  reconnectingScreen: 'Reconectando…',
  reconnectUsb: 'O cabo foi desconectado. Encaixe de novo e a conexão volta sozinha.',
  reconnectBle:
    'Se você abriu um app de Bluetooth no Flipper (Remote, Bad KB), ele trocou o rádio para modo teclado e a conexão caiu. Saia do app no Flipper e a conexão volta sozinha.',
  stopTrying: 'Parar de tentar',
  searching: 'Procurando…',
  waiting: 'Aguardando Flipper',
  connectingBtn: 'Conectando…',
  connectBle: 'Conectar por Bluetooth',
  connectUsb: 'Conectar pelo cabo USB',
  showAllBle: 'Não aparece? Mostrar todos os aparelhos Bluetooth',
  bleHint:
    'Deixe o Bluetooth do Flipper ligado e na tela inicial. Feche o app oficial do Flipper: ele prende a conexão. Na primeira vez, digite o PIN que aparece no Flipper.',
  cableHint: (otg: boolean) =>
    ` Pelo cabo${otg ? ' (OTG)' : ''}, o Bluetooth do Flipper fica livre: Bad KB e Bluetooth Remote funcionam sem derrubar a conexão.`,
  diagSummary: (n: number) => `Diagnóstico da conexão (${n} linhas)`,
  copyDiag: 'Copiar diagnóstico',
  openingList: 'Abrindo a lista de dispositivos…',
  openingPorts: 'Abrindo a lista de portas USB…',
  attempt: (n: number) => `Tentativa ${n}…`,
  notConnected: (msg: string) => `Não conectou: ${msg}`,
  noPort: 'Nenhuma porta escolhida. O Flipper está ligado no cabo e desbloqueado? No Android, use um cabo OTG.',

  // mensagens na conversa
  rpcReopened: 'RPC reaberto.',
  rpcClosed: 'O Flipper fechou o RPC (bloqueado?). Desbloqueie para continuar.',
  dropped: (why: string) => `Conexão caiu (${why}). Tentando reconectar…`,
  reconnected: (name: string) => `Reconectado a ${name}.`,
  gaveUp: 'Não reconectou em 10 minutos. Toque em Conectar.',
  connected: (name: string) => `Conectado a ${name}.`,
  connectedUsb: (name: string) => `Conectado a ${name}. O Bluetooth do Flipper está livre para Bad KB e Remote.`,
  stopped: 'Parado.',
  error: (msg: string) => `Erro: ${msg}`,
  restored: 'Conversa anterior restaurada.',
  historyTrimmed: 'A conversa anterior era grande demais para guardar inteira: o agente não lembra do começo.',

  // conversa
  claudeEmpty: 'Modo Claude ligado: converse pelo app do Claude. O que ele fizer no Flipper aparece aqui.',
  needKeyA: 'Para conversar com o agente, escolha uma IA em ',
  needKeyLink: 'configurações',
  needKeyB: '. O Gemini tem plano grátis.',
  tryOne: 'Experimente um pedido (você pode editar antes de enviar):',
  recipes: [
    'Qual a bateria e a versão do firmware?',
    'Abra o Infravermelho e me diga quais controles eu tenho salvos',
    'Liste o que tem no cartão SD',
    'Abra o NFC para ler um cartão',
    'Abra o Sub-GHz no modo de leitura',
    'Volte para a tela inicial',
  ],
  newChat: 'Nova conversa',
  msgLabel: 'Mensagem para o agente',
  askPlaceholder: 'Peça algo ao agente',
  connectFirst: 'Conecte o Flipper primeiro',
  stopAgent: 'Parar o agente',
  send: 'Enviar',
  agentScreenAlt: 'Tela do Flipper vista pelo agente',
  long: '(longo)',
  toolLabels: {
    flipper_screen: 'olhou a tela',
    flipper_press: 'apertou',
    flipper_wait: 'esperou',
    flipper_app_start: 'abriu app',
    flipper_app_exit: 'fechou app',
    flipper_list: 'listou',
    flipper_read: 'leu',
    flipper_write: 'gravou',
    flipper_mkdir: 'criou pasta',
    flipper_delete: 'apagou',
    flipper_rename: 'renomeou',
    flipper_device_info: 'info do aparelho',
    flipper_power_info: 'bateria',
    flipper_handoff: 'passou o bastão',
  } as Record<string, string>,
  waitingReconnect: 'esperando o Flipper reconectar…',
  waitingExitApp: 'esperando você sair do app no Flipper',

  // dicas de erro da conexão Bluetooth
  hintClosedList:
    'A lista fechou sem aparelho escolhido. Se o Flipper não estava na lista: Bluetooth dele ligado? App oficial do Flipper fechado? Tente "Mostrar todos".',
  hintSecurity: 'O navegador bloqueou o Bluetooth. Em Ajustes do iPhone → Bluefy, permita o Bluetooth.',
  hintGatt:
    'Achou o Flipper mas não conectou. Ele pode estar conectado a outro app/celular: feche o app oficial e, em Ajustes → Bluetooth, desconecte o Flipper.',
  hintSerial: 'Conectou, mas o serviço serial não apareceu. Se o Flipper estiver em modo "Bad BT"/HID, saia desse app e tente de novo.',
  hintPairing:
    'Falhou no pareamento ou na permissão. No iPhone: Ajustes → Bluetooth → "Esquecer" o Flipper e conectar de novo, aceitando o PIN.',
  hintOther: 'Copie o diagnóstico abaixo e mande junto ao relatar o problema.',

  // tela e controle
  device: 'Flipper',
  liveScreen: 'Tela do Flipper ao vivo',
  controls: 'Controle',
  keyUp: 'Para cima',
  keyLeft: 'Esquerda',
  keyRight: 'Direita',
  keyDown: 'Para baixo',
  keyBack: 'Voltar',
  agentUsing: 'O agente está usando o Flipper. Toque em Parar para assumir.',
  paused: 'Pausada · toque para ver',
  resume: 'Ver a tela ao vivo',

  // modo Claude
  relay: {
    off: 'Claude desligado',
    connecting: 'Claude: conectando…',
    online: 'Claude pronto',
    denied: 'Claude: recusado',
  } as Record<string, string>,
  deviceCode: 'Código do aparelho',
  pipTitle: 'Abre a tela do Flipper em picture-in-picture: mantém o modo Claude vivo enquanto você usa o app do Claude',
  pipClose: 'Fechar PiP',
  approveTitle: 'Conectar ao Claude?',
  approveA: ' quer controlar este Flipper. O acesso vai para ',
  approveNote: 'Aprove só se foi você quem acabou de conectar o Flipper no Claude.',
  approve: 'Aprovar',
  deny: 'Recusar',

  // configurações
  close: 'Fechar',
  language: 'Idioma',
  langAuto: 'Automático (do aparelho)',
  provider: 'Provedor do modelo',
  provGemini: 'Google Gemini (tier grátis)',
  provOpenRouter: 'OpenRouter (modelos :free)',
  provCompat: 'Outro compatível com OpenAI (OpenAI, DeepSeek, Groq, Ollama…)',
  apiUrl: 'Endereço da API',
  apiUrlEx: 'Ex.: https://api.deepseek.com/v1 · https://api.groq.com/openai/v1 · Ollama: http://IP-do-PC:11434/v1',
  apiKey: 'Chave da API',
  keyOptional: 'opcional (Ollama local não pede)',
  keyPaste: 'cole a chave aqui',
  keyLinkGemini: 'Criar chave grátis no Google AI Studio',
  keyLinkOpenRouter: 'Criar chave grátis no OpenRouter',
  keyLinkCompat: 'Chave da OpenAI (ou do provedor que você usar)',
  model: 'Modelo',
  modelId: 'id do modelo',
  list: 'Listar',
  choose: '— escolha —',
  noImage: ' (sem imagem)',
  fetchingModels: 'Buscando modelos…',
  nModels: (n: number) => `${n} modelos.`,
  noModels: 'Nenhum modelo encontrado.',
  vision: 'O modelo enxerga imagens (desligue se o modelo for só texto: a tela vai como desenho em texto)',
  showAll: 'Mostrar todos os dispositivos Bluetooth ao conectar (use se o seu Flipper não aparecer)',
  claudeMode: 'Modo Claude',
  claudeNote:
    'Use o Claude (sua assinatura, sem chave de API) para controlar o Flipper. O Claude chama este app por um conector; o app precisa ficar aberto (ou em picture-in-picture) com o Flipper conectado.',
  relayUrl: 'Endereço do relay',
  relayUrlNote: 'O relay padrão é uma demonstração compartilhada. Para uso frequente, publique o seu: é um comando (veja o README).',
  claudeOn: 'Ligar o modo Claude',
  thisCode: 'Código deste aparelho',
  newCode: 'Gerar outro',
  codeNote:
    'No Claude: Configurações → Conectores → Adicionar conector personalizado, com o endereço do relay terminado em /mcp. Na tela de login, digite este código e aprove aqui no celular. Gerar outro código desconecta o Claude.',
  keyNote:
    'A chave fica salva só neste aparelho. Nos planos grátis, o provedor pode usar o que recebe — inclusive telas e arquivos do Flipper — para treinar modelos.',
  saveChat: 'Guardar a conversa neste aparelho (continua de onde parou ao reabrir)',

  // aviso de uso responsável (primeiro uso)
  safetyTitle: 'Antes de começar',
  safetyBody: [
    'Este app deixa uma IA controlar o seu Flipper Zero: ela pode apertar teclas, abrir apps e mexer nos arquivos do cartão SD.',
    'Use só em aparelhos, cartões, controles e redes que são seus ou que você tem permissão para testar. Transmitir em Sub-GHz, clonar cartões ou usar Bad USB em computadores de outras pessoas pode ser crime.',
    'A IA erra. Confira o que ela fez na tela, e ela sempre pede confirmação antes de apagar ou sobrescrever arquivos.',
  ],
  safetyOk: 'Entendi',

  // ajuda
  helpTitle: 'Ajuda',
  helpItems: [
    ['O iPhone não acha o Flipper', 'O Safari não tem Bluetooth para páginas. Use o navegador Bluefy (grátis). Feche o app oficial do Flipper: ele prende a conexão. Na primeira vez, digite o PIN que aparece no Flipper.'],
    ['A conexão cai ao abrir Bad KB ou Bluetooth Remote', 'Esses apps usam o Bluetooth do Flipper como teclado e derrubam a conexão. É esperado: saia do app no Flipper e a conexão volta sozinha. O agente sabe disso e espera. Pelo cabo USB (Android ou computador) isso não acontece.'],
    ['Usar com cabo', 'No computador (Chrome/Edge) e no Android (Chrome, com cabo OTG) aparece "Conectar pelo cabo USB". No iPhone não existe: o iOS não deixa páginas falarem com o USB.'],
    ['Qual IA usar', 'O Gemini tem plano grátis: crie a chave no Google AI Studio e cole em Configurações. O OpenRouter tem modelos ":free". Também serve qualquer API compatível com a da OpenAI, inclusive Ollama no seu PC.'],
    ['Usar com o Claude (sem chave)', 'Em Configurações, ligue o Modo Claude e anote o código. No Claude: Configurações → Conectores → Adicionar conector personalizado, com o endereço do relay + /mcp. Digite o código no login e aprove aqui. Toque em PiP antes de ir para o app do Claude: é isso que mantém esta página viva.'],
    ['A tela está pausada', 'Para poupar o Bluetooth, a tela ao vivo pausa depois de um tempo parada. Toque nela para voltar. O agente religa sozinho quando precisa.'],
    ['Latência alta', 'O número ao lado do nome é o tempo de ida e volta. Perto do Flipper fica em 40–80 ms. Animações na tela do Flipper (como o golfinho) aumentam o tráfego.'],
    ['Privacidade', 'Chave, conversa e configurações ficam só neste aparelho. As telas e arquivos que o agente lê vão para o provedor de IA escolhido. No modo Claude, passam pelo relay sem ficar guardados.'],
  ] as [string, string][],
  safetyAgain: 'Ver o aviso de uso responsável',
  source: 'Código-fonte e problemas: github.com/AugustoFT/flipper-agent',
}

export type Strings = typeof pt

const en: Strings = {
  connecting: 'Connecting',
  reconnecting: 'Reconnecting',
  noFlipper: 'No Flipper',
  latencyTitle: 'Connection latency (round trip)',
  batteryTitle: 'Flipper battery',
  help: 'Help',
  settings: 'Settings',

  noBluetooth: 'No Bluetooth in this browser',
  whereIphone: 'Install the Bluefy browser (free on the App Store) and open this same address in it.',
  whereAndroid: 'Open it in Chrome.',
  wherePc: 'Chrome or Edge.',
  computer: 'Computer',
  reconnectingScreen: 'Reconnecting…',
  reconnectUsb: 'The cable was unplugged. Plug it back in and the connection comes back by itself.',
  reconnectBle:
    'If you opened a Bluetooth app on the Flipper (Remote, Bad KB), it switched the radio to keyboard mode and the connection dropped. Exit the app on the Flipper and the connection comes back by itself.',
  stopTrying: 'Stop trying',
  searching: 'Searching…',
  waiting: 'Waiting for Flipper',
  connectingBtn: 'Connecting…',
  connectBle: 'Connect via Bluetooth',
  connectUsb: 'Connect via USB cable',
  showAllBle: "Not listed? Show all Bluetooth devices",
  bleHint:
    "Keep the Flipper's Bluetooth on and at the home screen. Close the official Flipper app: it holds the connection. The first time, type the PIN shown on the Flipper.",
  cableHint: (otg: boolean) =>
    ` Over the cable${otg ? ' (OTG)' : ''}, the Flipper's Bluetooth stays free: Bad KB and Bluetooth Remote work without dropping the connection.`,
  diagSummary: (n: number) => `Connection diagnostics (${n} lines)`,
  copyDiag: 'Copy diagnostics',
  openingList: 'Opening the device list…',
  openingPorts: 'Opening the USB port list…',
  attempt: (n: number) => `Attempt ${n}…`,
  notConnected: (msg: string) => `Could not connect: ${msg}`,
  noPort: 'No port chosen. Is the Flipper plugged in and unlocked? On Android, use an OTG cable.',

  rpcReopened: 'RPC reopened.',
  rpcClosed: 'The Flipper closed the RPC (locked?). Unlock it to continue.',
  dropped: (why: string) => `Connection dropped (${why}). Trying to reconnect…`,
  reconnected: (name: string) => `Reconnected to ${name}.`,
  gaveUp: 'Did not reconnect in 10 minutes. Tap Connect.',
  connected: (name: string) => `Connected to ${name}.`,
  connectedUsb: (name: string) => `Connected to ${name}. The Flipper's Bluetooth is free for Bad KB and Remote.`,
  stopped: 'Stopped.',
  error: (msg: string) => `Error: ${msg}`,
  restored: 'Previous conversation restored.',
  historyTrimmed: 'The previous conversation was too large to keep in full: the agent does not remember the beginning.',

  claudeEmpty: 'Claude mode is on: chat in the Claude app. What it does on the Flipper shows up here.',
  needKeyA: 'To chat with the agent, choose an AI in ',
  needKeyLink: 'settings',
  needKeyB: '. Gemini has a free plan.',
  tryOne: 'Try a request (you can edit it before sending):',
  recipes: [
    "What's the battery level and firmware version?",
    'Open Infrared and tell me which remotes I have saved',
    "List what's on the SD card",
    'Open NFC to read a card',
    'Open Sub-GHz in read mode',
    'Go back to the home screen',
  ],
  newChat: 'New chat',
  msgLabel: 'Message to the agent',
  askPlaceholder: 'Ask the agent something',
  connectFirst: 'Connect the Flipper first',
  stopAgent: 'Stop the agent',
  send: 'Send',
  agentScreenAlt: 'Flipper screen as seen by the agent',
  long: '(long)',
  toolLabels: {
    flipper_screen: 'looked at the screen',
    flipper_press: 'pressed',
    flipper_wait: 'waited',
    flipper_app_start: 'opened app',
    flipper_app_exit: 'closed app',
    flipper_list: 'listed',
    flipper_read: 'read',
    flipper_write: 'wrote',
    flipper_mkdir: 'created folder',
    flipper_delete: 'deleted',
    flipper_rename: 'renamed',
    flipper_device_info: 'device info',
    flipper_power_info: 'battery',
    flipper_handoff: 'handed off',
  },
  waitingReconnect: 'waiting for the Flipper to reconnect…',
  waitingExitApp: 'waiting for you to exit the app on the Flipper',

  hintClosedList:
    "The list closed without a device chosen. If the Flipper wasn't listed: is its Bluetooth on? Is the official Flipper app closed? Try \"Show all\".",
  hintSecurity: 'The browser blocked Bluetooth. In iPhone Settings → Bluefy, allow Bluetooth.',
  hintGatt:
    'Found the Flipper but could not connect. It may be connected to another app/phone: close the official app and disconnect the Flipper in Settings → Bluetooth.',
  hintSerial: 'Connected, but the serial service did not show up. If the Flipper is in "Bad BT"/HID mode, exit that app and try again.',
  hintPairing: 'Pairing or permission failed. On iPhone: Settings → Bluetooth → "Forget" the Flipper and connect again, accepting the PIN.',
  hintOther: 'Copy the diagnostics below and include them when reporting the problem.',

  device: 'Flipper',
  liveScreen: 'Live Flipper screen',
  controls: 'Controls',
  keyUp: 'Up',
  keyLeft: 'Left',
  keyRight: 'Right',
  keyDown: 'Down',
  keyBack: 'Back',
  agentUsing: 'The agent is using the Flipper. Tap Stop to take over.',
  paused: 'Paused · tap to view',
  resume: 'Show the live screen',

  relay: {
    off: 'Claude off',
    connecting: 'Claude: connecting…',
    online: 'Claude ready',
    denied: 'Claude: refused',
  },
  deviceCode: 'Device code',
  pipTitle: 'Opens the Flipper screen in picture-in-picture: keeps Claude mode alive while you use the Claude app',
  pipClose: 'Close PiP',
  approveTitle: 'Connect to Claude?',
  approveA: ' wants to control this Flipper. Access goes to ',
  approveNote: 'Approve only if you just connected the Flipper in Claude yourself.',
  approve: 'Approve',
  deny: 'Deny',

  close: 'Close',
  language: 'Language',
  langAuto: 'Automatic (device)',
  provider: 'Model provider',
  provGemini: 'Google Gemini (free tier)',
  provOpenRouter: 'OpenRouter (:free models)',
  provCompat: 'Other OpenAI-compatible (OpenAI, DeepSeek, Groq, Ollama…)',
  apiUrl: 'API address',
  apiUrlEx: 'E.g.: https://api.deepseek.com/v1 · https://api.groq.com/openai/v1 · Ollama: http://PC-IP:11434/v1',
  apiKey: 'API key',
  keyOptional: 'optional (local Ollama needs none)',
  keyPaste: 'paste the key here',
  keyLinkGemini: 'Create a free key in Google AI Studio',
  keyLinkOpenRouter: 'Create a free key on OpenRouter',
  keyLinkCompat: 'OpenAI key (or your provider’s)',
  model: 'Model',
  modelId: 'model id',
  list: 'List',
  choose: '— choose —',
  noImage: ' (no images)',
  fetchingModels: 'Fetching models…',
  nModels: (n: number) => `${n} models.`,
  noModels: 'No models found.',
  vision: 'The model can see images (turn off for text-only models: the screen is sent as text art)',
  showAll: 'Show all Bluetooth devices when connecting (use it if your Flipper does not show up)',
  claudeMode: 'Claude mode',
  claudeNote:
    'Use Claude (your subscription, no API key) to control the Flipper. Claude calls this app through a connector; the app must stay open (or in picture-in-picture) with the Flipper connected.',
  relayUrl: 'Relay address',
  relayUrlNote: 'The default relay is a shared demo. For regular use, deploy your own: it is one command (see the README).',
  claudeOn: 'Turn on Claude mode',
  thisCode: 'This device’s code',
  newCode: 'New code',
  codeNote:
    'In Claude: Settings → Connectors → Add custom connector, with the relay address ending in /mcp. On the login page, type this code and approve here on the phone. A new code disconnects Claude.',
  keyNote:
    'The key is stored only on this device. On free plans, the provider may use what it receives — including Flipper screens and files — to train models.',
  saveChat: 'Keep the conversation on this device (pick up where you left off)',

  safetyTitle: 'Before you start',
  safetyBody: [
    'This app lets an AI control your Flipper Zero: it can press keys, open apps and change files on the SD card.',
    'Use it only on devices, cards, remotes and networks you own or are allowed to test. Transmitting on Sub-GHz, cloning cards or running Bad USB on other people’s computers can be a crime.',
    'The AI makes mistakes. Check what it did on the screen; it always asks before deleting or overwriting files.',
  ],
  safetyOk: 'Got it',

  helpTitle: 'Help',
  helpItems: [
    ['My iPhone can’t find the Flipper', 'Safari has no Bluetooth for web pages. Use the Bluefy browser (free). Close the official Flipper app: it holds the connection. The first time, type the PIN shown on the Flipper.'],
    ['The connection drops when opening Bad KB or Bluetooth Remote', 'Those apps use the Flipper’s Bluetooth as a keyboard and drop the connection. That’s expected: exit the app on the Flipper and the connection comes back by itself. The agent knows and waits. Over a USB cable (Android or computer) this doesn’t happen.'],
    ['Using a cable', 'On a computer (Chrome/Edge) and on Android (Chrome, with an OTG cable) you get "Connect via USB cable". Not on iPhone: iOS doesn’t let web pages talk to USB.'],
    ['Which AI to use', 'Gemini has a free plan: create a key in Google AI Studio and paste it in Settings. OpenRouter has ":free" models. Any OpenAI-compatible API works too, including Ollama on your PC.'],
    ['Using Claude (no key)', 'In Settings, turn on Claude mode and note the code. In Claude: Settings → Connectors → Add custom connector, with the relay address + /mcp. Type the code at login and approve here. Tap PiP before switching to the Claude app: that keeps this page alive.'],
    ['The screen is paused', 'To save Bluetooth bandwidth, the live screen pauses after a while without activity. Tap it to resume. The agent turns it back on when it needs it.'],
    ['High latency', 'The number next to the name is the round-trip time. Close to the Flipper it stays at 40–80 ms. Animations on the Flipper screen (like the dolphin) add traffic.'],
    ['Privacy', 'Key, conversation and settings stay on this device. Screens and files the agent reads go to the AI provider you chose. In Claude mode they pass through the relay without being stored.'],
  ],
  safetyAgain: 'Show the responsible use notice',
  source: 'Source code and issues: github.com/AugustoFT/flipper-agent',
}

function detect(): Lang {
  const nav = typeof navigator !== 'undefined' ? navigator.language : 'pt'
  return /^pt/i.test(nav) ? 'pt' : 'en'
}

let lang: Lang = detect()

/** Troca o idioma; 'auto' segue o do aparelho (português se for português, inglês em qualquer outro). */
export function setLang(s: LangSetting) {
  lang = s === 'auto' ? detect() : s
  if (typeof document !== 'undefined') document.documentElement.lang = lang === 'pt' ? 'pt-BR' : 'en'
}

export const t = (): Strings => (lang === 'en' ? en : pt)
