// Codec protobuf mínimo, escrito à mão.
//
// Por que não usar protobufjs? Só precisamos de três tipos de campo (varint, bytes/string e
// mensagem aninhada) e os .proto oficiais do Flipper não têm licença declarada — então não
// os copiamos. Os números de campo vêm da documentação do protocolo (fatos de interoperabilidade).
//
// Formato de cada campo no fio: tag = (número << 3) | tipo, seguido do valor.
//   tipo 0 = varint (uint32, bool, enum)
//   tipo 2 = length-delimited (string, bytes, mensagem aninhada)

const WIRE_VARINT = 0
const WIRE_LEN = 2
const enc = new TextEncoder()
const dec = new TextDecoder()

export class PbWriter {
  private parts: number[] = []

  varintRaw(value: number): this {
    // Valores do Flipper cabem em uint32; usamos aritmética (não bitwise) para não estourar em 2^31.
    let v = value
    while (v > 0x7f) {
      this.parts.push((v % 128) | 0x80)
      v = Math.floor(v / 128)
    }
    this.parts.push(v)
    return this
  }

  /** uint32 / enum / bool. Zero é omitido, como o proto3 faz. */
  uint(field: number, value: number | boolean | undefined): this {
    const v = typeof value === 'boolean' ? (value ? 1 : 0) : value ?? 0
    if (v === 0) return this
    this.varintRaw(field * 8 + WIRE_VARINT)
    return this.varintRaw(v)
  }

  bytes(field: number, value: Uint8Array | undefined, keepEmpty = false): this {
    if (!value || (value.length === 0 && !keepEmpty)) return this
    this.varintRaw(field * 8 + WIRE_LEN)
    this.varintRaw(value.length)
    for (const b of value) this.parts.push(b)
    return this
  }

  string(field: number, value: string | undefined): this {
    return value ? this.bytes(field, enc.encode(value)) : this
  }

  /** Mensagem aninhada. Mensagem vazia é mantida: no `oneof` do Main ela é o que diz o tipo do comando. */
  message(field: number, build: (w: PbWriter) => void): this {
    const inner = new PbWriter()
    build(inner)
    return this.bytes(field, inner.finish(), true)
  }

  finish(): Uint8Array {
    return Uint8Array.from(this.parts)
  }
}

/** Um campo lido: número, tipo e valor (número para varint, bytes para length-delimited). */
export interface PbField {
  field: number
  wire: number
  int: number
  data: Uint8Array
}

export class PbError extends Error {}

/** Lê um varint a partir de `pos`. Devolve [valor, nova posição]. */
export function readVarint(buf: Uint8Array, pos: number): [number, number] {
  let result = 0
  let mult = 1
  for (let i = 0; i < 10; i++) {
    if (pos >= buf.length) throw new PbError('varint truncado')
    const b = buf[pos++]
    result += (b & 0x7f) * mult
    if ((b & 0x80) === 0) return [result, pos]
    mult *= 128
  }
  throw new PbError('varint com mais de 10 bytes')
}

/** Percorre todos os campos de uma mensagem. Tipos 1 e 5 (64/32 bits fixos) são pulados. */
export function* fields(buf: Uint8Array): Generator<PbField> {
  let pos = 0
  while (pos < buf.length) {
    const [tag, p1] = readVarint(buf, pos)
    pos = p1
    const field = Math.floor(tag / 8)
    const wire = tag % 8
    if (field === 0) throw new PbError('campo 0 é inválido')
    if (wire === WIRE_VARINT) {
      const [v, p2] = readVarint(buf, pos)
      pos = p2
      yield { field, wire, int: v, data: EMPTY }
    } else if (wire === WIRE_LEN) {
      const [len, p2] = readVarint(buf, pos)
      if (p2 + len > buf.length) throw new PbError('campo passa do fim da mensagem')
      yield { field, wire, int: 0, data: buf.subarray(p2, p2 + len) }
      pos = p2 + len
    } else if (wire === 1) {
      pos += 8
    } else if (wire === 5) {
      pos += 4
    } else {
      throw new PbError(`tipo de campo ${wire} não suportado`)
    }
  }
}

const EMPTY = new Uint8Array(0)

export const text = (b: Uint8Array) => dec.decode(b)
