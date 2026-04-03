// ────────────────────────────────────────────────────────────
// KO Workbench — Time stretch / pitch shift
// Basic implementations; phase vocoder TBD.
// ────────────────────────────────────────────────────────────

/**
 * Time stretch via phase vocoder (stub).
 * ratio > 1 = slower, ratio < 1 = faster.
 * Currently returns input unchanged — real implementation later.
 */
export function timeStretch(
  samples: Float32Array,
  _sampleRate: number,
  ratio: number,
): Float32Array {
  if (ratio === 1) return samples
  console.log('timeStretch not yet implemented — returning original samples')
  return samples
}

/**
 * Pitch shift via linear-interpolation resampling.
 * Positive semitones = higher pitch, negative = lower.
 * This changes duration proportionally (no time correction).
 */
export function pitchShift(
  samples: Float32Array,
  semitones: number,
): Float32Array {
  if (semitones === 0) return samples

  // Pitch ratio: +12 semitones = 2x speed (half duration)
  const ratio = Math.pow(2, semitones / 12)
  const newLength = Math.round(samples.length / ratio)
  if (newLength < 1) return new Float32Array(0)

  const out = new Float32Array(newLength)
  for (let i = 0; i < newLength; i++) {
    const srcPos = i * ratio
    const idx = Math.floor(srcPos)
    const frac = srcPos - idx

    const a = samples[idx] ?? 0
    const b = samples[idx + 1] ?? a
    out[i] = a + frac * (b - a)
  }

  return out
}
