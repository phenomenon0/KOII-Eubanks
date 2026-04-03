// ────────────────────────────────────────────────────────────
// KO Workbench — Controller Bus
// Parses raw MIDI bytes from non-TE controllers into typed events
// ────────────────────────────────────────────────────────────

export type MidiEventType = 'noteOn' | 'noteOff' | 'cc' | 'pitchBend' | 'aftertouch'

export interface MidiEvent {
  type: MidiEventType
  channel: number       // 0-15
  note?: number         // for noteOn/noteOff
  velocity?: number     // for noteOn/noteOff
  cc?: number           // for cc
  value: number         // 0-127 for cc/note, 0-16383 for pitchBend
  controllerId: string
  timestamp: number
}

type MidiEventListener = (event: MidiEvent) => void

export class ControllerBus {
  private listeners: MidiEventListener[] = []

  /**
   * Called by MidiManager when a non-TE MIDI message arrives.
   * Parses the raw bytes and notifies all listeners.
   */
  handleRawMidi(data: Uint8Array, controllerId: string): void {
    const event = this.parse(data, controllerId)
    if (!event) return
    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch (e) {
        console.error('[ControllerBus] listener error:', e)
      }
    }
  }

  /**
   * Subscribe to parsed MIDI events. Returns an unsubscribe function.
   */
  onEvent(listener: MidiEventListener): () => void {
    this.listeners.push(listener)
    return () => {
      const idx = this.listeners.indexOf(listener)
      if (idx >= 0) this.listeners.splice(idx, 1)
    }
  }

  /**
   * Remove all listeners.
   */
  dispose(): void {
    this.listeners.length = 0
  }

  // ── Internal parsing ──────────────────────────────────────

  private parse(data: Uint8Array, controllerId: string): MidiEvent | null {
    if (data.length < 1) return null

    const status = data[0]

    // Ignore SysEx and realtime messages
    if (status >= 0xF0) return null

    const channel = status & 0x0F
    const msgType = status & 0xF0
    const now = performance.now()

    switch (msgType) {
      // Note Off: 0x80-0x8F [note, velocity]
      case 0x80: {
        if (data.length < 3) return null
        return {
          type: 'noteOff',
          channel,
          note: data[1],
          velocity: data[2],
          value: data[2],
          controllerId,
          timestamp: now,
        }
      }

      // Note On: 0x90-0x9F [note, velocity]
      // velocity=0 is treated as noteOff per MIDI spec
      case 0x90: {
        if (data.length < 3) return null
        const velocity = data[2]
        return {
          type: velocity === 0 ? 'noteOff' : 'noteOn',
          channel,
          note: data[1],
          velocity,
          value: velocity,
          controllerId,
          timestamp: now,
        }
      }

      // Polyphonic Aftertouch: 0xA0-0xAF [note, pressure]
      case 0xA0: {
        if (data.length < 3) return null
        return {
          type: 'aftertouch',
          channel,
          note: data[1],
          value: data[2],
          controllerId,
          timestamp: now,
        }
      }

      // Control Change: 0xB0-0xBF [cc#, value]
      case 0xB0: {
        if (data.length < 3) return null
        return {
          type: 'cc',
          channel,
          cc: data[1],
          value: data[2],
          controllerId,
          timestamp: now,
        }
      }

      // Channel Aftertouch: 0xD0-0xDF [pressure]
      case 0xD0: {
        if (data.length < 2) return null
        return {
          type: 'aftertouch',
          channel,
          value: data[1],
          controllerId,
          timestamp: now,
        }
      }

      // Pitch Bend: 0xE0-0xEF [lsb, msb] → 0-16383, center=8192
      case 0xE0: {
        if (data.length < 3) return null
        const value = data[1] | (data[2] << 7)
        return {
          type: 'pitchBend',
          channel,
          value,
          controllerId,
          timestamp: now,
        }
      }

      // Program Change (0xC0) — not mapped, skip
      default:
        return null
    }
  }
}
