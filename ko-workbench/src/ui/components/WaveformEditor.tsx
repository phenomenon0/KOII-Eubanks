// ────────────────────────────────────────────────────────────
// KO Workbench — Interactive waveform editor (canvas-based)
// Zoomable, scrollable, with draggable slice markers and loop region.
// ────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState } from 'react'

export interface WaveformMarker {
  id: string
  position: number   // sample index
  label?: string
}

export interface WaveformEditorProps {
  audioData: Float32Array
  sampleRate: number
  markers: WaveformMarker[]
  loopStart?: number
  loopEnd?: number
  onMarkerAdd: (position: number) => void
  onMarkerMove: (id: string, position: number) => void
  onMarkerRemove: (id: string) => void
  onLoopChange: (start: number, end: number) => void
  onSeek: (position: number) => void
  playbackPosition?: number
}

// ── Constants ──────────────────────────────────────────────

const WAVEFORM_COLOR = '#01A79D'
const MARKER_COLOR = '#EF4E27'
const LOOP_COLOR = 'rgba(100, 180, 255, 0.15)'
const LOOP_BORDER_COLOR = 'rgba(100, 180, 255, 0.5)'
const CURSOR_COLOR = '#FFFFFF'
const BG_COLOR = '#0a0a0a'
const GRID_COLOR = '#1a1a1a'
const MARKER_HANDLE_H = 14
const MARKER_HIT_WIDTH = 8

export function WaveformEditor({
  audioData,
  sampleRate,
  markers,
  loopStart,
  loopEnd,
  onMarkerAdd,
  onMarkerMove,
  onMarkerRemove,
  onLoopChange,
  onSeek,
  playbackPosition,
}: WaveformEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const animFrameRef = useRef(0)

  // Zoom / scroll state
  const [samplesPerPixel, setSamplesPerPixel] = useState(0) // 0 = fit-all
  const [scrollOffset, setScrollOffset] = useState(0) // in samples

  // Interaction state refs (avoid re-renders during drag)
  const dragRef = useRef<{
    type: 'marker' | 'pan' | 'none'
    markerId?: string
    startX?: number
    startScroll?: number
  }>({ type: 'none' })

  // Context menu
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; samplePos: number } | null>(null)

  // ── Computed zoom ────────────────────────────────────────

  const getCanvasWidth = useCallback(() => {
    return containerRef.current?.clientWidth ?? 800
  }, [])

  const getEffectiveSPP = useCallback(() => {
    if (samplesPerPixel > 0) return samplesPerPixel
    const w = getCanvasWidth()
    return w > 0 ? audioData.length / w : 1
  }, [samplesPerPixel, audioData.length, getCanvasWidth])

  const pixelToSample = useCallback(
    (px: number) => {
      return Math.round(scrollOffset + px * getEffectiveSPP())
    },
    [scrollOffset, getEffectiveSPP],
  )

  const sampleToPixel = useCallback(
    (sample: number) => {
      return (sample - scrollOffset) / getEffectiveSPP()
    },
    [scrollOffset, getEffectiveSPP],
  )

  // ── Drawing ──────────────────────────────────────────────

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const container = containerRef.current
    if (!container) return

    const dpr = window.devicePixelRatio || 1
    const w = container.clientWidth
    const h = container.clientHeight
    canvas.width = w * dpr
    canvas.height = h * dpr
    canvas.style.width = `${w}px`
    canvas.style.height = `${h}px`

    const ctx = canvas.getContext('2d')!
    ctx.scale(dpr, dpr)

    const spp = getEffectiveSPP()
    const midY = h / 2

    // Background
    ctx.fillStyle = BG_COLOR
    ctx.fillRect(0, 0, w, h)

    // Grid lines (time)
    ctx.strokeStyle = GRID_COLOR
    ctx.lineWidth = 1
    const secPerPixel = spp / sampleRate
    // Pick a nice grid interval
    let gridSec = 0.1
    const gridOptions = [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10]
    for (const g of gridOptions) {
      if (g / secPerPixel > 40) {
        gridSec = g
        break
      }
    }
    const startSec = Math.floor((scrollOffset / sampleRate) / gridSec) * gridSec
    for (let t = startSec; ; t += gridSec) {
      const px = sampleToPixel(t * sampleRate)
      if (px > w) break
      if (px < 0) continue
      ctx.beginPath()
      ctx.moveTo(px, 0)
      ctx.lineTo(px, h)
      ctx.stroke()
    }

    // Center line
    ctx.strokeStyle = '#2a2a2a'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(0, midY)
    ctx.lineTo(w, midY)
    ctx.stroke()

    // Loop region
    if (loopStart != null && loopEnd != null) {
      const lx0 = sampleToPixel(loopStart)
      const lx1 = sampleToPixel(loopEnd)
      ctx.fillStyle = LOOP_COLOR
      ctx.fillRect(lx0, 0, lx1 - lx0, h)
      ctx.strokeStyle = LOOP_BORDER_COLOR
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(lx0, 0); ctx.lineTo(lx0, h)
      ctx.moveTo(lx1, 0); ctx.lineTo(lx1, h)
      ctx.stroke()
    }

    // Waveform (filled polygon — positive and negative)
    ctx.fillStyle = WAVEFORM_COLOR
    ctx.beginPath()
    ctx.moveTo(0, midY)
    for (let px = 0; px < w; px++) {
      const sampleStart = Math.floor(scrollOffset + px * spp)
      const sampleEnd = Math.floor(scrollOffset + (px + 1) * spp)
      let maxVal = 0
      for (let s = sampleStart; s < sampleEnd && s < audioData.length; s++) {
        const v = Math.abs(audioData[s] ?? 0)
        if (v > maxVal) maxVal = v
      }
      ctx.lineTo(px, midY - maxVal * midY)
    }
    // Mirror back for negative side
    for (let px = w - 1; px >= 0; px--) {
      const sampleStart = Math.floor(scrollOffset + px * spp)
      const sampleEnd = Math.floor(scrollOffset + (px + 1) * spp)
      let maxVal = 0
      for (let s = sampleStart; s < sampleEnd && s < audioData.length; s++) {
        const v = Math.abs(audioData[s] ?? 0)
        if (v > maxVal) maxVal = v
      }
      ctx.lineTo(px, midY + maxVal * midY)
    }
    ctx.closePath()
    ctx.fill()

    // Markers
    for (const m of markers) {
      const mx = sampleToPixel(m.position)
      if (mx < -10 || mx > w + 10) continue

      // Line
      ctx.strokeStyle = MARKER_COLOR
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.moveTo(mx, 0)
      ctx.lineTo(mx, h)
      ctx.stroke()

      // Handle (triangle/rect at top)
      ctx.fillStyle = MARKER_COLOR
      ctx.beginPath()
      ctx.moveTo(mx - 5, 0)
      ctx.lineTo(mx + 5, 0)
      ctx.lineTo(mx + 5, MARKER_HANDLE_H)
      ctx.lineTo(mx, MARKER_HANDLE_H + 4)
      ctx.lineTo(mx - 5, MARKER_HANDLE_H)
      ctx.closePath()
      ctx.fill()

      // Label
      if (m.label) {
        ctx.fillStyle = '#fff'
        ctx.font = '9px "Courier New", monospace'
        ctx.fillText(m.label, mx + 6, MARKER_HANDLE_H)
      }
    }

    // Playback cursor
    if (playbackPosition != null && playbackPosition >= 0) {
      const cx = sampleToPixel(playbackPosition)
      if (cx >= 0 && cx <= w) {
        ctx.strokeStyle = CURSOR_COLOR
        ctx.lineWidth = 1.5
        ctx.beginPath()
        ctx.moveTo(cx, 0)
        ctx.lineTo(cx, h)
        ctx.stroke()
      }
    }

    // Time labels at bottom
    ctx.fillStyle = '#555'
    ctx.font = '9px "Courier New", monospace'
    for (let t = startSec; ; t += gridSec) {
      const px = sampleToPixel(t * sampleRate)
      if (px > w) break
      if (px < 0) continue
      const label = t >= 1 ? `${t.toFixed(1)}s` : `${(t * 1000).toFixed(0)}ms`
      ctx.fillText(label, px + 2, h - 3)
    }
  }, [
    audioData, sampleRate, markers, loopStart, loopEnd,
    playbackPosition, scrollOffset, getEffectiveSPP, sampleToPixel,
  ])

  // Redraw on state changes
  useEffect(() => {
    draw()
  }, [draw])

  // Animation frame loop for cursor
  useEffect(() => {
    if (playbackPosition == null) return
    const tick = () => {
      draw()
      animFrameRef.current = requestAnimationFrame(tick)
    }
    animFrameRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(animFrameRef.current)
  }, [playbackPosition, draw])

  // ── Mouse handlers ───────────────────────────────────────

  const getCanvasMouseX = (e: React.MouseEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect()
    return e.clientX - rect.left
  }

  const findMarkerAt = (px: number): WaveformMarker | null => {
    for (const m of markers) {
      const mx = sampleToPixel(m.position)
      if (Math.abs(px - mx) < MARKER_HIT_WIDTH) return m
    }
    return null
  }

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button === 2) return // context menu handled separately
    setCtxMenu(null)

    const px = getCanvasMouseX(e)
    const marker = findMarkerAt(px)

    if (marker) {
      dragRef.current = { type: 'marker', markerId: marker.id, startX: px }
    } else {
      // Pan or seek
      if (samplesPerPixel > 0) {
        // Zoomed in — pan mode
        dragRef.current = { type: 'pan', startX: px, startScroll: scrollOffset }
      } else {
        // Fit-all — seek
        const pos = pixelToSample(px)
        onSeek(Math.max(0, Math.min(pos, audioData.length - 1)))
        dragRef.current = { type: 'none' }
      }
    }
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    const drag = dragRef.current
    if (drag.type === 'none') return

    const px = getCanvasMouseX(e)

    if (drag.type === 'marker' && drag.markerId) {
      const pos = pixelToSample(px)
      onMarkerMove(drag.markerId, Math.max(0, Math.min(pos, audioData.length - 1)))
    } else if (drag.type === 'pan' && drag.startX != null && drag.startScroll != null) {
      const dx = drag.startX - px
      const spp = getEffectiveSPP()
      const newScroll = Math.max(0, Math.min(
        drag.startScroll + dx * spp,
        audioData.length - getCanvasWidth() * spp,
      ))
      setScrollOffset(newScroll)
    }
  }

  const handleMouseUp = (e: React.MouseEvent) => {
    const drag = dragRef.current
    if (drag.type === 'none' && e.button === 0) {
      // Click without drag on zoomed-in view
      const px = getCanvasMouseX(e)
      const pos = pixelToSample(px)
      onSeek(Math.max(0, Math.min(pos, audioData.length - 1)))
    }
    dragRef.current = { type: 'none' }
  }

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault()
    const w = getCanvasWidth()
    const spp = getEffectiveSPP()
    const px = getCanvasMouseX(e as unknown as React.MouseEvent)
    const sampleAtCursor = scrollOffset + px * spp

    // Zoom direction: scroll up = zoom in
    const factor = e.deltaY > 0 ? 1.2 : 1 / 1.2
    const minSPP = 1
    const maxSPP = audioData.length / w
    const newSPP = Math.max(minSPP, Math.min(maxSPP, spp * factor))

    // Keep the sample under cursor in place
    const newScroll = Math.max(0, sampleAtCursor - px * newSPP)
    setSamplesPerPixel(newSPP >= maxSPP * 0.99 ? 0 : newSPP)
    setScrollOffset(newScroll)
  }

  // ── Context menu ─────────────────────────────────────────

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    const px = getCanvasMouseX(e)
    const pos = pixelToSample(px)
    setCtxMenu({ x: e.clientX, y: e.clientY, samplePos: pos })
  }

  const handleCtxAction = (action: 'marker' | 'loopStart' | 'loopEnd' | 'remove') => {
    if (!ctxMenu) return
    switch (action) {
      case 'marker':
        onMarkerAdd(ctxMenu.samplePos)
        break
      case 'loopStart':
        onLoopChange(ctxMenu.samplePos, loopEnd ?? audioData.length)
        break
      case 'loopEnd':
        onLoopChange(loopStart ?? 0, ctxMenu.samplePos)
        break
      case 'remove': {
        const px = sampleToPixel(ctxMenu.samplePos)
        const m = findMarkerAt(px)
        if (m) onMarkerRemove(m.id)
        break
      }
    }
    setCtxMenu(null)
  }

  // Close context menu on outside click
  useEffect(() => {
    if (!ctxMenu) return
    const close = () => setCtxMenu(null)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [ctxMenu])

  // ── Zoom controls ────────────────────────────────────────

  const zoomIn = () => {
    const w = getCanvasWidth()
    const spp = getEffectiveSPP()
    const center = scrollOffset + (w / 2) * spp
    const newSPP = Math.max(1, spp / 1.5)
    setSamplesPerPixel(newSPP)
    setScrollOffset(Math.max(0, center - (w / 2) * newSPP))
  }

  const zoomOut = () => {
    const w = getCanvasWidth()
    const spp = getEffectiveSPP()
    const maxSPP = audioData.length / w
    const center = scrollOffset + (w / 2) * spp
    const newSPP = Math.min(maxSPP, spp * 1.5)
    setSamplesPerPixel(newSPP >= maxSPP * 0.99 ? 0 : newSPP)
    setScrollOffset(Math.max(0, center - (w / 2) * newSPP))
  }

  const zoomFit = () => {
    setSamplesPerPixel(0)
    setScrollOffset(0)
  }

  // Duration display
  const durationSec = audioData.length / sampleRate

  return (
    <div className="waveform-editor">
      <div className="waveform-editor-toolbar">
        <span className="waveform-editor-info">
          {durationSec.toFixed(2)}s &middot; {sampleRate} Hz &middot; {audioData.length.toLocaleString()} samples
        </span>
        <div className="waveform-editor-zoom">
          <button className="btn btn-sm" onClick={zoomIn} title="Zoom in">+</button>
          <button className="btn btn-sm" onClick={zoomOut} title="Zoom out">&minus;</button>
          <button className="btn btn-sm" onClick={zoomFit} title="Fit all">Fit</button>
        </div>
      </div>

      <div
        ref={containerRef}
        className="waveform-editor-canvas-wrap"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={() => { dragRef.current = { type: 'none' } }}
        onWheel={handleWheel}
        onContextMenu={handleContextMenu}
      >
        <canvas ref={canvasRef} />
      </div>

      {ctxMenu && (
        <div
          className="waveform-ctx-menu"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
          onClick={e => e.stopPropagation()}
        >
          <button onClick={() => handleCtxAction('marker')}>Add marker here</button>
          <button onClick={() => handleCtxAction('loopStart')}>Set loop start</button>
          <button onClick={() => handleCtxAction('loopEnd')}>Set loop end</button>
          {findMarkerAt(sampleToPixel(ctxMenu.samplePos)) && (
            <button onClick={() => handleCtxAction('remove')}>Remove marker</button>
          )}
        </div>
      )}
    </div>
  )
}
