// Transporte BLE (Web Bluetooth) para o serviço serial do Flipper.
//
// Engenharia reversa (do relay Android do zeffin + firmware):
//   serviço  8fe5b3d5-2e7f-4a98-2a48-7acc60fe0000
//   ...61fe  Flipper → celular (indications)  — chegam os bytes do RPC
//   ...62fe  celular → Flipper (write com resposta)
//   ...63fe  controle de fluxo: espaço livre no buffer RPC do Flipper, uint32 big-endian
//
// O controle de fluxo é o ponto que mais quebra implementação ingênua:
// o Flipper concede uma janela (1024 bytes) e só reabastece quando ela ACABA e o buffer esvazia.
// Se você escreve além da janela, os bytes somem em silêncio. E o desconto tem que ser feito
// quando a escrita é DISPARADA, não quando é confirmada — o reabastecimento pode chegar antes
// da confirmação, e descontar depois deixaria o app achando que tem menos crédito do que tem.
// Um valor 0 anunciado significa que o Flipper fechou a sessão RPC (ex.: tela bloqueada com PIN).

import type { Transport } from './transport'

export const SERIAL_SERVICE = '8fe5b3d5-2e7f-4a98-2a48-7acc60fe0000'
const CH_RX = '19ed82ae-ed21-4c9d-4145-228e61fe0000'
const CH_TX = '19ed82ae-ed21-4c9d-4145-228e62fe0000'
const CH_FLOW = '19ed82ae-ed21-4c9d-4145-228e63fe0000'

/**
 * UUID de 16 bits que o Flipper ANUNCIA (não é o do serviço serial, que só aparece depois de conectar).
 * Firmware (serial_profile.c): Service_UUID_16 = 0x3080 | cor do aparelho (0 a 3).
 * Filtrar por ele acha o Flipper mesmo com nome personalizado — filtrar por "Flipper…" falha
 * quando o dono renomeou o aparelho (o Momentum anuncia o nome escolhido).
 */
// Em texto de 128 bits: a forma numérica (0x3080) é aceita pela especificação, mas nem toda
// implementação fora do Chrome aceita (ex.: navegadores Web BLE no iOS).
const ADV_UUIDS = [0x3080, 0x3081, 0x3082, 0x3083].map((u) => `0000${u.toString(16)}-0000-1000-8000-00805f9b34fb`)

/** Erro com a etapa em que a conexão falhou — é o que aparece no diagnóstico. */
export class BleStepError extends Error {
  constructor(public readonly step: string, cause: unknown) {
    const e = cause as Error
    super(`${step}: ${e?.name ?? 'Erro'}: ${e?.message ?? String(cause)}`)
    this.name = e?.name ?? 'Error'
  }
}

async function step<T>(name: string, log: (s: string) => void, fn: () => Promise<T>): Promise<T> {
  log(`→ ${name}`)
  try {
    const r = await fn()
    log(`✓ ${name}`)
    return r
  } catch (e) {
    log(`✘ ${name}: ${(e as Error)?.name}: ${(e as Error)?.message}`)
    throw new BleStepError(name, e)
  }
}

/** Web Bluetooth não expõe o MTU. Começamos grande e caímos para 20 bytes se o celular recusar. */
const CHUNK_SIZES = [244, 128, 20]

/**
 * Escrita SEM resposta (o firmware declara CHAR_PROP_WRITE_WITHOUT_RESP na characteristic de entrada):
 * poupa uma ida e volta pelo rádio a cada envio. Mas ela não pode passar do MTU negociado e não
 * existe "escrita longa" sem resposta. No iPhone o MTU é ≥ 185 (182 de dados), então só mensagens
 * até esse tamanho — teclas, ping e comandos, quase tudo — usam o caminho rápido. Arquivos grandes
 * continuam no caminho com resposta, em pedaços.
 */
const FAST_MAX = 182
const CREDIT_WAIT_MS = 20000

export function bleSupported(): boolean {
  return typeof navigator !== 'undefined' && 'bluetooth' in navigator
}

export class BleTransport implements Transport {
  private credit = 0
  private creditWaiters: Array<() => void> = []
  private dataHandlers: Array<(c: Uint8Array) => void> = []
  private closeHandlers: Array<(r: string) => void> = []
  private chunkIdx = 0
  private writing: Promise<void> = Promise.resolve()
  private closed = false
  /** Desliga sozinho se o celular recusar a escrita sem resposta. */
  private fastWrites: boolean
  /** Avisado quando o Flipper abre/fecha a sessão RPC (crédito > 0 / = 0). */
  onRpcState: (open: boolean) => void = () => {}

  private constructor(
    private device: BluetoothDevice,
    private tx: BluetoothRemoteGATTCharacteristic,
  ) {
    this.fastWrites = Boolean(tx.properties?.writeWithoutResponse) && typeof tx.writeValueWithoutResponse === 'function'
  }

  get writeMode() {
    return this.fastWrites ? 'sem resposta' : 'com resposta'
  }

  get name() {
    return this.device.name ?? 'Flipper'
  }

  /**
   * Abre o seletor de dispositivos do navegador, conecta e prepara as characteristics.
   * Na primeira vez o celular pede o PIN que aparece na tela do Flipper (pareamento).
   */
  static async connect(showAll = false, log: (s: string) => void = () => {}): Promise<BleTransport> {
    if (!bleSupported()) throw new Error('Este navegador não tem Web Bluetooth.')
    log(`navegador: ${navigator.userAgent}`)
    const avail = await navigator.bluetooth.getAvailability?.().catch(() => undefined)
    log(`bluetooth disponível: ${avail ?? 'desconhecido'} · modo: ${showAll ? 'todos os aparelhos' : 'filtro Flipper'}`)

    const device = await step('escolher aparelho', log, () =>
      navigator.bluetooth.requestDevice(
        showAll
          ? { acceptAllDevices: true, optionalServices: [SERIAL_SERVICE] }
          : {
              // Filtros são "OU": qualquer um que bater mostra o aparelho.
              filters: [...ADV_UUIDS.map((u) => ({ services: [u] })), { namePrefix: 'Flipper' }],
              optionalServices: [SERIAL_SERVICE, ...ADV_UUIDS],
            },
      ),
    )
    log(`aparelho: "${device.name ?? '(sem nome)'}" id=${device.id}`)
    const server = await step('conectar GATT', log, () => device.gatt!.connect())
    log('(se o iPhone pedir PIN, digite o que aparece na tela do Flipper)')
    const service = await step('abrir serviço serial', log, () => server.getPrimaryService(SERIAL_SERVICE))
    // Uma operação GATT por vez: algumas pilhas BLE do iOS falham com pedidos simultâneos.
    const rx = await step('characteristic RX', log, () => service.getCharacteristic(CH_RX))
    const tx = await step('characteristic TX', log, () => service.getCharacteristic(CH_TX))
    const flow = await step('characteristic fluxo', log, () => service.getCharacteristic(CH_FLOW))
    const t = new BleTransport(device, tx)

    device.addEventListener('gattserverdisconnected', () => t.finish('Bluetooth desconectado'))
    rx.addEventListener('characteristicvaluechanged', () => {
      const v = rx.value
      if (v) t.emitData(new Uint8Array(v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength)))
    })
    flow.addEventListener('characteristicvaluechanged', () => {
      if (flow.value) t.announce(flow.value)
    })
    await step('ativar notificações RX', log, () => rx.startNotifications())
    await step('ativar notificações fluxo', log, () => flow.startNotifications())
    t.announce(await step('ler crédito inicial', log, () => flow.readValue()))
    log(`escrita: ${t.writeMode}`)
    log(t.credit > 0 ? `Pronto (janela de ${t.credit} bytes).` : 'Conectado, mas o RPC está fechado: desbloqueie o Flipper.')
    return t
  }

  private emitData(chunk: Uint8Array) {
    for (const h of this.dataHandlers) h(chunk)
  }

  /** Valor anunciado pelo Flipper SUBSTITUI o contador (não soma). */
  private announce(view: DataView) {
    if (view.byteLength < 4) return
    const value = view.getUint32(0, false)
    const wasOpen = this.credit > 0
    this.credit = Math.min(value, 65536)
    if (this.credit > 0 !== wasOpen) this.onRpcState(this.credit > 0)
    if (this.credit > 0) {
      const w = this.creditWaiters
      this.creditWaiters = []
      for (const fn of w) fn()
    }
  }

  private waitCredit(): Promise<void> {
    if (this.credit > 0) return Promise.resolve()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.creditWaiters = this.creditWaiters.filter((w) => w !== ok)
        reject(new Error('O Flipper parou de liberar espaço (está bloqueado ou travado?)'))
      }, CREDIT_WAIT_MS)
      const ok = () => {
        clearTimeout(timer)
        resolve()
      }
      this.creditWaiters.push(ok)
    })
  }

  send(data: Uint8Array): Promise<void> {
    // Envios são serializados: duas mensagens nunca se intercalam no fio.
    const run = this.writing.then(() => this.sendNow(data))
    this.writing = run.catch(() => {})
    return run
  }

  private async sendNow(data: Uint8Array) {
    // Caminho rápido: mensagem pequena, cabe num pacote e no crédito → uma escrita sem resposta.
    // Só se couber no crédito ATUAL: o Flipper reabastece apenas quando o crédito zera, então
    // esperar "crédito ≥ tamanho" travaria para sempre. Senão, vai pelo caminho em pedaços abaixo.
    if (this.fastWrites && data.length <= FAST_MAX && data.length <= this.credit && !this.closed) {
      this.credit -= data.length
      try {
        await this.tx.writeValueWithoutResponse(data)
        return
      } catch {
        this.credit += data.length
        this.fastWrites = false // este celular não aceita: volta ao caminho com resposta
      }
    }
    let off = 0
    while (off < data.length) {
      if (this.closed) throw new Error('Bluetooth desconectado')
      await this.waitCredit()
      const size = Math.min(CHUNK_SIZES[this.chunkIdx], this.credit, data.length - off)
      const piece = data.slice(off, off + size)
      this.credit -= size // desconta ANTES de confirmar (ver comentário no topo)
      try {
        await this.tx.writeValueWithResponse(piece)
      } catch (e) {
        this.credit += size // a escrita não aconteceu: devolve o crédito
        if (this.chunkIdx < CHUNK_SIZES.length - 1 && !this.closed) {
          this.chunkIdx++ // pedaço grande demais para este celular: tenta menor
          continue
        }
        throw e
      }
      off += size
    }
  }

  onData(handler: (c: Uint8Array) => void) {
    this.dataHandlers.push(handler)
  }

  onClose(handler: (r: string) => void) {
    this.closeHandlers.push(handler)
  }

  private finish(reason: string) {
    if (this.closed) return
    this.closed = true
    for (const h of this.closeHandlers) h(reason)
  }

  async close() {
    this.finish('desconectado pelo app')
    if (this.device.gatt?.connected) this.device.gatt.disconnect()
  }
}
