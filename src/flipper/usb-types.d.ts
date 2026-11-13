// Tipos mínimos de Web Serial e WebUSB: só o que o app usa. O TypeScript ainda não traz essas APIs
// no lib "DOM", e assim não precisamos instalar pacotes de tipos.

interface SerialPortFilter {
  usbVendorId?: number
  usbProductId?: number
}
interface SerialPortInfo {
  usbVendorId?: number
  usbProductId?: number
}
interface WebSerialPort extends EventTarget {
  readonly readable: ReadableStream<Uint8Array> | null
  readonly writable: WritableStream<Uint8Array> | null
  open(options: { baudRate: number }): Promise<void>
  close(): Promise<void>
  setSignals(signals: { dataTerminalReady?: boolean; requestToSend?: boolean }): Promise<void>
  getInfo(): SerialPortInfo
}
interface WebSerial extends EventTarget {
  requestPort(options?: { filters?: SerialPortFilter[] }): Promise<WebSerialPort>
  getPorts(): Promise<WebSerialPort[]>
}

interface WebUsbEndpoint {
  readonly endpointNumber: number
  readonly direction: 'in' | 'out'
  readonly type: 'bulk' | 'interrupt' | 'isochronous'
  readonly packetSize: number
}
interface WebUsbAlternate {
  readonly interfaceClass: number
  readonly endpoints: WebUsbEndpoint[]
}
interface WebUsbInterface {
  readonly interfaceNumber: number
  readonly alternate: WebUsbAlternate
}
interface WebUsbConfiguration {
  readonly interfaces: WebUsbInterface[]
}
interface WebUsbDevice {
  readonly productName?: string
  readonly configuration: WebUsbConfiguration | null
  readonly opened: boolean
  open(): Promise<void>
  close(): Promise<void>
  selectConfiguration(value: number): Promise<void>
  claimInterface(n: number): Promise<void>
  controlTransferOut(
    setup: { requestType: 'class'; recipient: 'interface'; request: number; value: number; index: number },
    data?: BufferSource,
  ): Promise<unknown>
  transferIn(endpoint: number, length: number): Promise<{ data?: DataView; status: string }>
  transferOut(endpoint: number, data: BufferSource): Promise<{ status: string }>
}
interface WebUsb extends EventTarget {
  requestDevice(options: { filters: Array<{ vendorId?: number; productId?: number }> }): Promise<WebUsbDevice>
  getDevices(): Promise<WebUsbDevice[]>
}

interface Navigator {
  readonly serial?: WebSerial
  readonly usb?: WebUsb
}
