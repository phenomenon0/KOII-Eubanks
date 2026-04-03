// ────────────────────────────────────────────────────────────
// KO Workbench — Quantize Engine
// Musical clock that fires callbacks aligned to bar boundaries.
// Uses requestAnimationFrame for timing; no Web Audio clock yet.
// ────────────────────────────────────────────────────────────

type QuantizeCallback = () => void
type QuantizeMode = 'off' | '1bar' | '2bar' | '4bar'

export class QuantizeEngine {
  private bpm = 120
  private quantize: QuantizeMode = '1bar'
  private running = false
  private animFrameId: number | null = null
  private startTime = 0
  private lastBar = -1
  private pendingActions: { callback: QuantizeCallback; targetBar: number }[] = []
  private onBarCallback?: (barNumber: number) => void

  setBpm(bpm: number): void {
    this.bpm = Math.max(20, Math.min(300, bpm))
  }

  setQuantize(q: QuantizeMode): void {
    this.quantize = q
  }

  /** Register a callback that fires every time a new bar is reached. */
  onBar(callback: (barNumber: number) => void): void {
    this.onBarCallback = callback
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.startTime = performance.now()
    this.lastBar = -1
    this.pendingActions = []
    this.scheduleTick()
  }

  stop(): void {
    this.running = false
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId)
      this.animFrameId = null
    }
    this.pendingActions = []
  }

  /**
   * Schedule an action for the next quantize boundary.
   * If quantize is 'off', the callback fires immediately.
   */
  scheduleAtNextBoundary(callback: QuantizeCallback): void {
    if (this.quantize === 'off' || !this.running) {
      callback()
      return
    }

    const currentBar = this.getCurrentBar()
    const barMultiple = this.barMultiple()
    // Next boundary is the next multiple of barMultiple after current bar
    const targetBar = (Math.floor(currentBar / barMultiple) + 1) * barMultiple
    this.pendingActions.push({ callback, targetBar })
  }

  getCurrentBar(): number {
    if (!this.running) return 0
    const elapsed = performance.now() - this.startTime
    const beat = (elapsed / 60000) * this.bpm
    return Math.floor(beat / 4)
  }

  getBeatsIntoBar(): number {
    if (!this.running) return 0
    const elapsed = performance.now() - this.startTime
    const beat = (elapsed / 60000) * this.bpm
    return beat % 4
  }

  isRunning(): boolean {
    return this.running
  }

  dispose(): void {
    this.stop()
    this.onBarCallback = undefined
  }

  // ── Private ─────────────────────────────────────────────────

  private barMultiple(): number {
    switch (this.quantize) {
      case '2bar': return 2
      case '4bar': return 4
      default: return 1
    }
  }

  private scheduleTick(): void {
    this.animFrameId = requestAnimationFrame(() => this.tick())
  }

  private tick(): void {
    if (!this.running) return

    const elapsed = performance.now() - this.startTime
    const beat = (elapsed / 60000) * this.bpm
    const currentBar = Math.floor(beat / 4)

    if (currentBar > this.lastBar) {
      // We crossed one or more bar boundaries
      this.lastBar = currentBar

      // Fire pending actions whose target bar has arrived
      const ready = this.pendingActions.filter(a => currentBar >= a.targetBar)
      this.pendingActions = this.pendingActions.filter(a => currentBar < a.targetBar)
      for (const action of ready) {
        action.callback()
      }

      // Fire the onBar callback
      this.onBarCallback?.(currentBar)
    }

    this.scheduleTick()
  }
}
