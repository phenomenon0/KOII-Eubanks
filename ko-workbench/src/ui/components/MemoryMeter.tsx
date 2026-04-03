interface MemoryMeterProps {
  usedBytes: number
  totalBytes: number
}

function formatBytes(b: number): string {
  if (b < 1024) return `${b}B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)}KB`
  return `${(b / 1024 / 1024).toFixed(1)}MB`
}

export function MemoryMeter({ usedBytes, totalBytes }: MemoryMeterProps) {
  const pct = totalBytes > 0 ? (usedBytes / totalBytes) * 100 : 0
  const fillClass = pct > 90 ? 'danger' : pct > 70 ? 'warn' : ''

  return (
    <div className="memory-meter">
      <div className="memory-label">
        <span>MEMORY</span>
        <span>{formatBytes(usedBytes)} / {formatBytes(totalBytes)}</span>
      </div>
      <div className="memory-bar-bg">
        <div
          className={`memory-bar-fill ${fillClass}`}
          style={{ width: `${Math.min(100, pct).toFixed(1)}%` }}
        />
      </div>
    </div>
  )
}
