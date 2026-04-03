// ────────────────────────────────────────────────────────────
// KO Workbench — MIDI device manager
// Protocol reverse-engineered from ep_133_sample_tool
// ────────────────────────────────────────────────────────────

import { SysexClient } from './sysex'
import { DeviceInfo, TE_CMD, TE_MIDI_ID_0, TE_MIDI_ID_1, TE_MIDI_ID_2 } from './types'

// Standard Universal SysEx Identity Request
const IDENTITY_REQUEST = new Uint8Array([0xF0, 0x7E, 0x7F, 0x06, 0x01, 0xF7])

// Parse standard MIDI identity response (17 bytes)
// Returns { identityCode, manufacturer, family, model } or null
function parseMidiIdentityResponse(data: Uint8Array): {
  identityCode: number
  manufacturer: number[]
  family: [number, number]
  model:  [number, number]
} | null {
  if (data.length !== 17) return null
  if (data[0] !== 0xF0 || data[1] !== 0x7E) return null
  if (data[3] !== 0x06 || data[4] !== 0x02) return null
  // data[2] = device channel / identity_code used in TE SysEx
  return {
    identityCode: data[2],
    manufacturer: [data[5], data[6], data[7]],
    family:       [data[8],  data[9]],
    model:        [data[10], data[11]],
  }
}

function isTEDevice(manufacturer: number[]): boolean {
  return manufacturer[0] === TE_MIDI_ID_0 &&
         manufacturer[1] === TE_MIDI_ID_1 &&
         manufacturer[2] === TE_MIDI_ID_2
}

// Parse GREET response: "chip_id:xxx;mode:xxx;os_version:xxx;product:xxx;serial:xxx;sku:xxx;sw_version:xxx"
function parseGreetMeta(rawString: string): Record<string, string> {
  const meta: Record<string, string> = {}
  rawString.split(';').forEach(pair => {
    const sep = pair.indexOf(':')
    if (sep > 0) {
      meta[pair.slice(0, sep)] = pair.slice(sep + 1)
    }
  })
  return meta
}

export interface ControllerInfo {
  id: string
  name: string
  inputId: string
}

export interface DeviceEvents {
  onDeviceConnected:        (device: DeviceInfo, client: SysexClient) => void
  onDeviceDisconnected:     (inputId: string) => void
  onControllerConnected:    (controller: ControllerInfo) => void
  onControllerDisconnected: (inputId: string) => void
  onControllerMidi:         (data: Uint8Array, controllerId: string) => void
  onError:                  (err: Error) => void
  onLog:                    (line: string) => void
}

export class MidiManager {
  private access: MIDIAccess | null = null
  private connectedSerials = new Set<string>()
  private connectedInputIds = new Set<string>()
  private connectedControllerIds = new Set<string>()
  private controllerListeners = new Map<string, (ev: Event) => void>()

  async init(events: DeviceEvents): Promise<void> {
    if (!navigator.requestMIDIAccess) {
      events.onLog('Web MIDI API not available in this context')
      events.onError(new Error('Web MIDI API not available'))
      return
    }

    events.onLog('Requesting MIDI access (sysex=true)...')
    try {
      this.access = await navigator.requestMIDIAccess({ sysex: true })
      events.onLog(`MIDI access granted — inputs: ${this.access.inputs.size}, outputs: ${this.access.outputs.size}`)
      for (const input of this.access.inputs.values()) events.onLog(`  IN: "${input.name}"`)
      for (const output of this.access.outputs.values()) events.onLog(`  OUT: "${output.name}"`)
    } catch (e) {
      events.onLog('MIDI access denied: ' + String(e))
      events.onError(new Error('MIDI access denied — ' + String(e)))
      return
    }

    this.access.addEventListener('statechange', (ev: Event) => {
      const port = (ev as MIDIConnectionEvent).port
      if (!port) return
      if (port.state === 'connected') {
        setTimeout(() => this.scanPorts(events), 300)
      } else if (port.state === 'disconnected') {
        if (port.type === 'input') {
          if (this.connectedInputIds.has(port.id)) {
            events.onDeviceDisconnected(port.id)
            this.connectedInputIds.delete(port.id)
          }
          if (this.connectedControllerIds.has(port.id)) {
            // Remove the midimessage listener for this controller
            const listener = this.controllerListeners.get(port.id)
            if (listener) {
              // Port is disconnected so removing listener is best-effort
              this.controllerListeners.delete(port.id)
            }
            this.connectedControllerIds.delete(port.id)
            events.onControllerDisconnected(port.id)
          }
        }
      }
    })

    await this.scanPorts(events)
  }

  private async scanPorts(events: DeviceEvents): Promise<void> {
    if (!this.access) return
    const inputs  = [...this.access.inputs.values()]
    const outputs = [...this.access.outputs.values()]

    for (const input of inputs) {
      if (this.connectedInputIds.has(input.id)) continue       // already connected as TE device
      if (this.connectedControllerIds.has(input.id)) continue  // already connected as controller
      // Find matching output (same name or name heuristic)
      const output = outputs.find(o => o.name === input.name || this.portsMatch(input.name, o.name))
      await this.probeDevice(input, output ?? null, events)
    }
  }

  private portsMatch(a: string | null, b: string | null): boolean {
    if (!a || !b) return false
    const norm = (s: string) => s.toLowerCase().replace(/\s*(midi\s*)?(in(put)?|out(put)?)\s*/g, '').trim()
    return norm(a) === norm(b)
  }

  private async probeDevice(input: MIDIInput, output: MIDIOutput | null, events: DeviceEvents): Promise<void> {
    events.onLog(`Probing: "${input.name}"`)

    // Step 1: send Universal SysEx Identity Request, wait up to 2s
    let identityCode = 0x00
    let isTEConfirmed = false

    if (output) {
      try {
        const idBytes = await this.sendIdentityRequest(input, output)
        if (idBytes) {
          const id = parseMidiIdentityResponse(idBytes)
          if (id) {
            events.onLog(`  Identity response: mfr=[${id.manufacturer.map(b => '0x'+b.toString(16)).join(',')}] isTe=${isTEDevice(id.manufacturer)}`)
            if (isTEDevice(id.manufacturer)) {
              identityCode = id.identityCode
              isTEConfirmed = true
              events.onLog(`  TE device confirmed, identityCode=${identityCode}`)
            }
          } else {
            events.onLog(`  Identity response: not valid (len=${idBytes.length})`)
          }
        } else {
          events.onLog(`  No identity response (timeout)`)
        }
      } catch (e) {
        events.onLog(`  Identity request error: ${String(e)}`)
      }
    }

    // Step 2: fallback to name matching for TE devices
    if (!isTEConfirmed) {
      const name = input.name?.toLowerCase() ?? ''
      if (!name.includes('ep-133') && !name.includes('ep133') && !name.includes('ep-1320')) {
        // Not a TE device — register as a generic MIDI controller
        this.registerController(input, events)
        return
      }
      events.onLog(`  Name match: "${input.name}" — proceeding with identityCode=0`)
    }

    if (!output) {
      // TE name match but no output port — can't proceed with SysEx
      events.onLog(`  No output port for TE device "${input.name}" — skipping`)
      return
    }

    // Step 3: Set up SysexClient and wire input
    const client = new SysexClient(output)
    const onMessage = (ev: Event) => {
      const mev = ev as MIDIMessageEvent
      if (mev.data) client.handleIncoming(mev.data)
    }
    input.addEventListener('midimessage', onMessage)

    // Step 4: Send GREET
    events.onLog(`  Sending GREET (identityCode=${identityCode})...`)
    try {
      const greetResp = await client.sendAndReceive(identityCode, TE_CMD.GREET, new Uint8Array(0), 5000)
      const raw = new TextDecoder().decode(greetResp.data)
      events.onLog(`  GREET response: "${raw.slice(0, 80)}"`)
      const meta = parseGreetMeta(raw)

      const serial = meta.serial || `EP133-${input.id.slice(-6)}`
      if (this.connectedSerials.has(serial)) {
        input.removeEventListener('midimessage', onMessage)
        events.onLog(`  Duplicate serial ${serial} — skipping`)
        return
      }
      this.connectedSerials.add(serial)
      this.connectedInputIds.add(input.id)

      const device: DeviceInfo = {
        serial,
        sku:          meta.sku      || 'EP-133',
        name:         meta.product  || input.name || 'EP-133',
        firmware:     meta.os_version || meta.sw_version || 'unknown',
        input_id:     input.id,
        output_id:    output.id,
        identityCode,
      }

      events.onLog(`  Connected: ${device.name} serial=${device.serial} fw=${device.firmware}`)
      events.onDeviceConnected(device, client)

    } catch (e) {
      input.removeEventListener('midimessage', onMessage)
      events.onLog(`  GREET failed: ${String(e)}`)
    }
  }

  private registerController(input: MIDIInput, events: DeviceEvents): void {
    const controllerId = input.id
    const controllerName = input.name || 'Unknown Controller'
    events.onLog(`  Registering controller: "${controllerName}" (id=${controllerId})`)

    this.connectedControllerIds.add(controllerId)

    // Wire a midimessage listener that forwards non-SysEx to the bus
    const listener = (ev: Event) => {
      const mev = ev as MIDIMessageEvent
      if (!mev.data || mev.data.length === 0) return
      // Skip SysEx messages (0xF0) — only forward standard MIDI
      if (mev.data[0] >= 0xF0) return
      events.onControllerMidi(mev.data, controllerId)
    }

    input.addEventListener('midimessage', listener)
    this.controllerListeners.set(controllerId, listener)

    events.onControllerConnected({
      id: controllerId,
      name: controllerName,
      inputId: controllerId,
    })
  }

  private sendIdentityRequest(input: MIDIInput, output: MIDIOutput): Promise<Uint8Array | null> {
    return new Promise(resolve => {
      const timer = setTimeout(() => {
        input.removeEventListener('midimessage', handler)
        resolve(null)
      }, 2000)

      const handler = (ev: Event) => {
        const mev = ev as MIDIMessageEvent
        if (mev.data && mev.data[0] === 0xF0 && mev.data[1] === 0x7E) {
          clearTimeout(timer)
          input.removeEventListener('midimessage', handler)
          resolve(mev.data)
        }
      }
      input.addEventListener('midimessage', handler)
      output.send(IDENTITY_REQUEST)
    })
  }

  dispose(): void {
    this.connectedSerials.clear()
    this.connectedInputIds.clear()
    this.connectedControllerIds.clear()
    this.controllerListeners.clear()
    this.access = null
  }
}
