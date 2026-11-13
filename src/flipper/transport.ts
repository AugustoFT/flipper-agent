// Um transporte leva bytes do RPC entre o app e o Flipper. O RPC não sabe se é BLE ou USB:
// isso deixa o mesmo cliente rodar no celular (BLE) e no PC para testes (serial USB).

export interface Transport {
  /** Nome legível do dispositivo, para a interface. */
  readonly name: string
  /** Envia bytes já enquadrados (cada mensagem prefixada pelo tamanho em varint). */
  send(data: Uint8Array): Promise<void>
  /** Registra quem recebe os bytes que chegam do Flipper (pode chegar mensagem partida ou várias juntas). */
  onData(handler: (chunk: Uint8Array) => void): void
  /** Chamado quando a conexão cai, com o motivo. */
  onClose(handler: (reason: string) => void): void
  close(): Promise<void>
}
