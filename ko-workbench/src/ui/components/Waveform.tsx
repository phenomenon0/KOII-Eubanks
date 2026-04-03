import { useEffect, useRef } from 'react'

interface WaveformProps {
  data: Float32Array
  width?: number
  height?: number
  color?: string
  trimStart?: number  // 0-1
  trimEnd?: number    // 0-1
}

export function Waveform({ data, width = 512, height = 80, color = '#00a69c', trimStart = 0, trimEnd = 1 }: WaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || data.length === 0) return

    const dpr = window.devicePixelRatio || 1
    canvas.width = width * dpr
    canvas.height = height * dpr
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`

    const ctx = canvas.getContext('2d')!
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, width, height)

    // Background
    ctx.fillStyle = '#1e1e1e'
    ctx.fillRect(0, 0, width, height)

    // Trim region shading
    const startX = trimStart * width
    const endX = trimEnd * width

    ctx.fillStyle = 'rgba(239, 78, 39, 0.08)'
    ctx.fillRect(0, 0, startX, height)
    ctx.fillRect(endX, 0, width - endX, height)

    // Active region background
    ctx.fillStyle = 'rgba(0, 166, 156, 0.05)'
    ctx.fillRect(startX, 0, endX - startX, height)

    // Center line
    ctx.strokeStyle = '#2a2a2a'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(0, height / 2)
    ctx.lineTo(width, height / 2)
    ctx.stroke()

    // Waveform
    const barWidth = width / data.length
    const midY = height / 2

    ctx.fillStyle = color
    for (let i = 0; i < data.length; i++) {
      const x = i * barWidth
      const amp = data[i] * midY
      ctx.fillRect(x, midY - amp, Math.max(1, barWidth - 0.5), amp * 2)
    }

    // Trim handles
    ctx.strokeStyle = '#ef4e27'
    ctx.lineWidth = 2

    ctx.beginPath()
    ctx.moveTo(startX, 0)
    ctx.lineTo(startX, height)
    ctx.stroke()

    ctx.beginPath()
    ctx.moveTo(endX, 0)
    ctx.lineTo(endX, height)
    ctx.stroke()

  }, [data, width, height, color, trimStart, trimEnd])

  return (
    <canvas
      ref={canvasRef}
      className="waveform-canvas"
      style={{ width: '100%', height: `${height}px` }}
    />
  )
}
