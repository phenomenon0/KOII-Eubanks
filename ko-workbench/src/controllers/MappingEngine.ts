// ────────────────────────────────────────────────────────────
// KO Workbench — MIDI Controller Mapping Engine
// Maps incoming MIDI events to application actions
// ────────────────────────────────────────────────────────────

import { MidiEvent } from './ControllerBus'

export interface ControllerMapping {
  id: string
  controllerId: string
  control: string    // 'note:60', 'cc:1', 'cc:74', 'pitchBend', 'aftertouch'
  action: string     // 'playPad:0', 'setMacro:filter', 'recallScene:intro', 'transport:play'
  page: number       // 0 = all pages, 1-4 = specific page
}

type MappingCreatedCallback = (mapping: ControllerMapping) => void

export class MappingEngine {
  private mappings: ControllerMapping[] = []
  private learnTarget: string | null = null
  private learnCallback: MappingCreatedCallback | null = null

  /**
   * Replace all mappings (e.g. loaded from saved config).
   */
  setMappings(mappings: ControllerMapping[]): void {
    this.mappings = [...mappings]
  }

  /**
   * Get a copy of current mappings.
   */
  getMappings(): ControllerMapping[] {
    return [...this.mappings]
  }

  /**
   * Add a single mapping.
   */
  addMapping(mapping: ControllerMapping): void {
    this.mappings.push(mapping)
  }

  /**
   * Remove a mapping by ID.
   */
  removeMapping(id: string): void {
    this.mappings = this.mappings.filter(m => m.id !== id)
  }

  /**
   * Arm learn mode: the next incoming MIDI event will create
   * a mapping targeting the given action.
   */
  startLearn(targetAction: string, callback: MappingCreatedCallback): void {
    this.learnTarget = targetAction
    this.learnCallback = callback
  }

  /**
   * Cancel learn mode without creating a mapping.
   */
  stopLearn(): void {
    this.learnTarget = null
    this.learnCallback = null
  }

  /**
   * Whether the engine is currently in learn mode.
   */
  get isLearning(): boolean {
    return this.learnTarget !== null
  }

  /**
   * Process an incoming MIDI event.
   * - If in learn mode: creates a mapping and returns null.
   * - Otherwise: finds a matching mapping and returns its action string, or null.
   */
  processEvent(event: MidiEvent, activePage: number): string | null {
    const control = this.eventToControl(event)
    if (!control) return null

    // Learn mode: create mapping from this event
    if (this.learnTarget !== null) {
      const mapping: ControllerMapping = {
        id: `map_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        controllerId: event.controllerId,
        control,
        action: this.learnTarget,
        page: 0,  // default to "all pages"
      }

      this.mappings.push(mapping)

      if (this.learnCallback) {
        this.learnCallback(mapping)
      }

      this.learnTarget = null
      this.learnCallback = null
      return null
    }

    // Normal mode: find matching mapping
    for (const mapping of this.mappings) {
      if (mapping.controllerId !== event.controllerId) continue
      if (mapping.control !== control) continue
      // page 0 matches all pages; otherwise must match active page
      if (mapping.page !== 0 && mapping.page !== activePage) continue
      return mapping.action
    }

    return null
  }

  // ── Internal helpers ──────────────────────────────────────

  /**
   * Convert a MidiEvent into a canonical control string for mapping lookup.
   */
  private eventToControl(event: MidiEvent): string | null {
    switch (event.type) {
      case 'noteOn':
      case 'noteOff':
        return event.note !== undefined ? `note:${event.note}` : null
      case 'cc':
        return event.cc !== undefined ? `cc:${event.cc}` : null
      case 'pitchBend':
        return 'pitchBend'
      case 'aftertouch':
        return event.note !== undefined ? `aftertouch:${event.note}` : 'aftertouch'
      default:
        return null
    }
  }
}
