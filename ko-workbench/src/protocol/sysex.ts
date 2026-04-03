// ────────────────────────────────────────────────────────────
// KO Workbench — TE SysEx framing & transport
// Reverse-engineered from ep_133_sample_tool bundle
// ────────────────────────────────────────────────────────────

import {
  MIDI_SYSEX_START, MIDI_SYSEX_END, MIDI_SYSEX_TE,
  TE_MIDI_ID_0, TE_MIDI_ID_1, TE_MIDI_ID_2,
  BIT_IS_REQUEST, BIT_REQUEST_ID_AVAILABLE,
  TE_STATUS, TeSysexMessage,
} from './types'

// ─── 7-bit packing (MIDI SysEx can't carry high bit) ──────────

/** Pack arbitrary bytes into 7-bit MIDI-safe groups */
export function packBytes(input: Uint8Array): Uint8Array {
  if (input.length === 0) return new Uint8Array(0)
  const groups = Math.ceil(input.length / 7)
  const out = new Uint8Array(groups * 8)
  let wi = 0
  for (let g = 0; g < groups; g++) {
    const base = g * 7
    let hi = 0
    for (let b = 0; b < 7 && base + b < input.length; b++) {
      hi |= ((input[base + b] >> 7) & 1) << b
    }
    out[wi++] = hi & 0x7F
    for (let b = 0; b < 7 && base + b < input.length; b++) {
      out[wi++] = input[base + b] & 0x7F
    }
  }
  return out.slice(0, wi)
}

/** Unpack 7-bit MIDI groups back to raw bytes */
export function unpackBytes(packed: Uint8Array): Uint8Array {
  if (packed.length === 0) return new Uint8Array(0)
  const groups = Math.floor(packed.length / 8)
  const remainder = packed.length % 8
  const outLen = groups * 7 + Math.max(0, remainder - 1)
  const out = new Uint8Array(outLen)
  let ri = 0
  for (let g = 0; g < groups; g++) {
    const base = g * 8
    const hi = packed[base]
    for (let b = 0; b < 7; b++) {
      out[ri++] = (packed[base + 1 + b] & 0x7F) | (((hi >> b) & 1) << 7)
    }
  }
  if (remainder > 1) {
    const base = groups * 8
    const hi = packed[base]
    for (let b = 1; b < remainder; b++) {
      out[ri++] = (packed[base + b] & 0x7F) | (((hi >> (b - 1)) & 1) << 7)
    }
  }
  return out
}

// ─── Message framing ──────────────────────────────────────────

let _requestIdCounter = 1

function nextRequestId(): number {
  const id = _requestIdCounter++
  if (_requestIdCounter > 0x0FFF) _requestIdCounter = 1
  return id
}

/**
 * Build a TE SysEx request message.
 *
 * Frame layout (before 7-bit packing of payload):
 * [0xF0, ID0, ID1, ID2, identity, 0x40, flags, req_id_hi, req_id_lo?, cmd, ...payload, 0xF7]
 *
 * From the reverse-engineered source:
 * - byte[0]  = 0xF0
 * - byte[1]  = 0x00 (TE_MIDI_ID_0)
 * - byte[2]  = 0x20 (TE_MIDI_ID_1)
 * - byte[3]  = 0x76 (TE_MIDI_ID_2)
 * - byte[4]  = identity_code (device-specific)
 * - byte[5]  = 0x40 (MIDI_SYSEX_TE)
 * - byte[6]  = flags (BIT_IS_REQUEST | BIT_REQUEST_ID_AVAILABLE | req_id_hi_5bits)
 * - byte[7]  = req_id_lo (7-bit)
 * - byte[8]  = command
 * - byte[9+] = packed payload
 * - last     = 0xF7
 */
export function buildRequest(
  identityCode: number,
  command: number,
  payload: Uint8Array = new Uint8Array(0),
): { bytes: Uint8Array; requestId: number } {
  const requestId = nextRequestId()
  const packed = packBytes(payload)

  const msg: number[] = [
    MIDI_SYSEX_START,
    TE_MIDI_ID_0,
    TE_MIDI_ID_1,
    TE_MIDI_ID_2,
    identityCode & 0x7F,
    MIDI_SYSEX_TE,
    (BIT_IS_REQUEST | BIT_REQUEST_ID_AVAILABLE | ((requestId >> 7) & 0x1F)) & 0x7F,
    requestId & 0x7F,
    command & 0x7F,
    ...packed,
    MIDI_SYSEX_END,
  ]

  return { bytes: new Uint8Array(msg), requestId }
}

/**
 * Parse a raw SysEx byte array into a TeSysexMessage.
 * Returns null if the message is not a valid TE SysEx message.
 */
export function parseResponse(raw: Uint8Array): TeSysexMessage | null {
  if (
    raw.length < 9 ||
    raw[0] !== MIDI_SYSEX_START ||
    raw[1] !== TE_MIDI_ID_0 ||
    raw[2] !== TE_MIDI_ID_1 ||
    raw[3] !== TE_MIDI_ID_2 ||
    raw[5] !== MIDI_SYSEX_TE ||
    raw[raw.length - 1] !== MIDI_SYSEX_END
  ) {
    return null
  }

  const flags = raw[6]
  const isResponse = !(flags & BIT_IS_REQUEST)
  const hasRequestId = !!(flags & BIT_REQUEST_ID_AVAILABLE)
  const requestId = hasRequestId ? ((flags & 0x1F) << 7) | (raw[7] & 0x7F) : 0

  let offset = 9
  const status = isResponse ? raw[offset++] : TE_STATUS.OK
  const command = raw[8]

  const packedData = raw.slice(offset, raw.length - 1)
  const data = unpackBytes(packedData)

  return {
    identity_code: raw[4],
    request_id: requestId,
    has_request_id: hasRequestId,
    status,
    command,
    type: isResponse ? 'response' : 'request',
    data,
  }
}

// ─── SysEx client ─────────────────────────────────────────────

export type OnMessageCallback = (msg: TeSysexMessage) => void

export class SysexClient {
  private pendingRequests = new Map<number, {
    resolve: (msg: TeSysexMessage) => void,
    reject: (err: Error) => void,
    timer: ReturnType<typeof setTimeout>,
    onProgress?: (msg: TeSysexMessage) => void,
  }>()

  constructor(
    private output: MIDIOutput,
    private onUnsolicited: OnMessageCallback = () => {},
  ) {}

  /** Called by MIDIInput.onmidimessage */
  handleIncoming(raw: Uint8Array): void {
    const msg = parseResponse(raw)
    if (!msg) return

    if (msg.has_request_id && this.pendingRequests.has(msg.request_id)) {
      const pending = this.pendingRequests.get(msg.request_id)!
      if (msg.status === TE_STATUS.SPECIFIC_SUCCESS_START) {
        // Streaming progress response — call progress handler but keep waiting
        pending.onProgress?.(msg)
        return
      }
      clearTimeout(pending.timer)
      this.pendingRequests.delete(msg.request_id)
      if (msg.status === TE_STATUS.OK) {
        pending.resolve(msg)
      } else {
        pending.reject(new Error(`SysEx error status=${msg.status} cmd=${msg.command}`))
      }
    } else {
      this.onUnsolicited(msg)
    }
  }

  /** Send a request and wait for the response */
  sendAndReceive(
    identityCode: number,
    command: number,
    payload: Uint8Array = new Uint8Array(0),
    timeoutMs = 20_000,
    onProgress?: (msg: TeSysexMessage) => void,
  ): Promise<TeSysexMessage> {
    const { bytes, requestId } = buildRequest(identityCode, command, payload)
    this.output.send(bytes)

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(requestId)
        reject(new Error(`SysEx timeout waiting for request_id=${requestId}`))
      }, timeoutMs)

      this.pendingRequests.set(requestId, { resolve, reject, timer, onProgress })
    })
  }

  /** Fire and forget */
  send(identityCode: number, command: number, payload: Uint8Array = new Uint8Array(0)): void {
    const { bytes } = buildRequest(identityCode, command, payload)
    this.output.send(bytes)
  }
}
