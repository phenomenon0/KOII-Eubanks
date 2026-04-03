// ────────────────────────────────────────────────────────────
// KO Workbench — Audio slicer / transient detection
// ────────────────────────────────────────────────────────────

/**
 * Detect transients using amplitude envelope + peak picking.
 *
 * Algorithm:
 * 1. Compute RMS envelope over short windows (512 samples)
 * 2. Compute first derivative (onset strength)
 * 3. Pick peaks above a threshold controlled by `sensitivity`
 * 4. Enforce minimum gap between transients (~50 ms)
 *
 * @returns Array of sample indices where transients occur.
 */
export function detectTransients(
  samples: Float32Array,
  sampleRate: number,
  sensitivity = 0.5,
): number[] {
  const windowSize = 512
  const hopSize = 256
  const minGapSamples = Math.round(sampleRate * 0.05) // 50 ms

  // Step 1: RMS envelope
  const envelopeLen = Math.floor((samples.length - windowSize) / hopSize) + 1
  if (envelopeLen < 3) return []

  const envelope = new Float32Array(envelopeLen)
  for (let i = 0; i < envelopeLen; i++) {
    const start = i * hopSize
    let sum = 0
    for (let j = 0; j < windowSize; j++) {
      const s = samples[start + j] ?? 0
      sum += s * s
    }
    envelope[i] = Math.sqrt(sum / windowSize)
  }

  // Step 2: First derivative (onset strength function)
  const derivative = new Float32Array(envelopeLen)
  for (let i = 1; i < envelopeLen; i++) {
    derivative[i] = Math.max(0, envelope[i] - envelope[i - 1])
  }

  // Step 3: Adaptive threshold
  // Use median of derivative as base, scaled by inverse sensitivity
  const sorted = Float32Array.from(derivative).sort()
  const median = sorted[Math.floor(sorted.length / 2)]
  const maxDeriv = sorted[sorted.length - 1]
  if (maxDeriv === 0) return []

  // sensitivity 0..1 maps threshold from high (few hits) to low (many hits)
  const threshold = median + (1 - sensitivity) * (maxDeriv - median) * 0.5

  // Step 4: Peak picking with minimum gap
  const transients: number[] = []
  let lastPick = -minGapSamples

  for (let i = 1; i < envelopeLen - 1; i++) {
    if (
      derivative[i] > threshold &&
      derivative[i] >= derivative[i - 1] &&
      derivative[i] >= derivative[i + 1]
    ) {
      const samplePos = i * hopSize
      if (samplePos - lastPick >= minGapSamples) {
        transients.push(samplePos)
        lastPick = samplePos
      }
    }
  }

  return transients
}

/**
 * Divide a sample range into N equal slices.
 * @returns Array of N+1 boundary positions (including 0 and totalSamples).
 */
export function equalSlices(totalSamples: number, count: number): number[] {
  if (count < 1) return [0, totalSamples]
  const boundaries: number[] = []
  for (let i = 0; i <= count; i++) {
    boundaries.push(Math.round((i / count) * totalSamples))
  }
  return boundaries
}

/**
 * Extract a contiguous slice as a new Float32Array.
 */
export function extractSlice(
  samples: Float32Array,
  start: number,
  end: number,
): Float32Array {
  const s = Math.max(0, Math.min(start, samples.length))
  const e = Math.max(s, Math.min(end, samples.length))
  return samples.slice(s, e)
}
