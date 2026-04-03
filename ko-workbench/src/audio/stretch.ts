// ────────────────────────────────────────────────────────────
// KO Workbench — Time stretch / pitch shift
// Granular overlap-add time stretch + cubic interpolation pitch shift.
// Pure functions on Float32Array, no dependencies.
// ────────────────────────────────────────────────────────────

/**
 * Build a Hann window of the given length.
 * w(n) = 0.5 * (1 - cos(2 * pi * n / (N - 1)))
 */
function hannWindow(length: number): Float32Array {
  const win = new Float32Array(length)
  if (length <= 1) {
    win[0] = 1
    return win
  }
  const scale = (2 * Math.PI) / (length - 1)
  for (let i = 0; i < length; i++) {
    win[i] = 0.5 * (1 - Math.cos(scale * i))
  }
  return win
}

/**
 * Clamp a value between min and max.
 */
function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

/**
 * Cubic (Hermite) interpolation between four samples.
 * Returns the value at fractional position `t` between s1 and s2.
 */
function cubicInterp(s0: number, s1: number, s2: number, s3: number, t: number): number {
  const a = -0.5 * s0 + 1.5 * s1 - 1.5 * s2 + 0.5 * s3
  const b = s0 - 2.5 * s1 + 2 * s2 - 0.5 * s3
  const c = -0.5 * s0 + 0.5 * s2
  const d = s1
  return ((a * t + b) * t + c) * t + d
}

// ────────────────────────────────────────────────────────────
// Time stretch — granular overlap-add
// ────────────────────────────────────────────────────────────

/**
 * Time-stretch audio using granular overlap-add.
 *
 * - `ratio > 1` = slower (longer output, same pitch)
 * - `ratio < 1` = faster (shorter output, same pitch)
 *
 * Algorithm:
 *   1. Choose grain size (~30ms at the given sample rate).
 *   2. Read overlapping grains from the input at `analysisHop` intervals.
 *   3. Apply a Hann window to each grain.
 *   4. Place grains into the output at `synthesisHop = analysisHop * ratio` intervals.
 *   5. Normalize by the overlap envelope to avoid amplitude modulation.
 */
export function timeStretch(
  samples: Float32Array,
  sampleRate: number,
  ratio: number,
): Float32Array {
  if (ratio === 1) return new Float32Array(samples)
  if (samples.length === 0) return new Float32Array(0)

  ratio = clamp(ratio, 0.1, 10)

  const grainSize = Math.round(sampleRate * 0.03) // ~30ms grains
  const analysisHop = Math.round(grainSize * 0.25) // 75% overlap on input
  const synthesisHop = Math.round(analysisHop * ratio) // stretched hop on output

  const win = hannWindow(grainSize)
  const outLength = Math.round(samples.length * ratio)
  const out = new Float32Array(outLength)
  const envelope = new Float32Array(outLength) // tracks window sum for normalization

  // Number of grains we can read from the input
  const numGrains = Math.floor((samples.length - grainSize) / analysisHop) + 1

  for (let g = 0; g < numGrains; g++) {
    const readStart = g * analysisHop
    const writeStart = g * synthesisHop

    for (let j = 0; j < grainSize; j++) {
      const outIdx = writeStart + j
      if (outIdx >= outLength) break

      const srcIdx = readStart + j
      const sample = srcIdx < samples.length ? samples[srcIdx] : 0
      out[outIdx] += sample * win[j]
      envelope[outIdx] += win[j]
    }
  }

  // Normalize by the overlap envelope to prevent amplitude ripple.
  // Any position that received window weight > a small threshold gets divided.
  const threshold = 1e-6
  for (let i = 0; i < outLength; i++) {
    if (envelope[i] > threshold) {
      out[i] /= envelope[i]
    }
  }

  return out
}

// ────────────────────────────────────────────────────────────
// Pitch shift — cubic interpolation resampling
// ────────────────────────────────────────────────────────────

/**
 * Pitch-shift audio by resampling with cubic (Hermite) interpolation.
 *
 * - Positive semitones = higher pitch (shorter output).
 * - Negative semitones = lower pitch (longer output).
 * - Duration changes proportionally (no time correction).
 *
 * Clamped to +/- 24 semitones. Returns a copy if semitones === 0.
 */
export function pitchShift(
  samples: Float32Array,
  semitones: number,
): Float32Array {
  if (semitones === 0) return new Float32Array(samples)
  if (samples.length === 0) return new Float32Array(0)

  semitones = clamp(semitones, -24, 24)

  // Pitch ratio: +12 = 2x speed (half duration), -12 = 0.5x speed (double duration)
  const ratio = Math.pow(2, semitones / 12)
  const newLength = Math.round(samples.length / ratio)
  if (newLength < 1) return new Float32Array(0)

  const len = samples.length
  const out = new Float32Array(newLength)

  for (let i = 0; i < newLength; i++) {
    const srcPos = i * ratio
    const idx = Math.floor(srcPos)
    const frac = srcPos - idx

    // Four sample points for cubic interpolation, clamped at boundaries
    const s0 = samples[clamp(idx - 1, 0, len - 1)]
    const s1 = samples[clamp(idx, 0, len - 1)]
    const s2 = samples[clamp(idx + 1, 0, len - 1)]
    const s3 = samples[clamp(idx + 2, 0, len - 1)]

    out[i] = cubicInterp(s0, s1, s2, s3, frac)
  }

  return out
}

// ────────────────────────────────────────────────────────────
// Duration-preserving pitch shift (stretch + resample)
// ────────────────────────────────────────────────────────────

/**
 * Shift pitch while preserving the original duration.
 *
 * Method: time-stretch by the inverse of the pitch ratio, then resample
 * to the target pitch. The two operations cancel out in length,
 * leaving the original duration but a different pitch.
 *
 * This is what real hardware samplers (SP-1200, MPC, S950) do.
 */
export function timeStretchToPitch(
  samples: Float32Array,
  sampleRate: number,
  semitones: number,
): Float32Array {
  if (semitones === 0) return new Float32Array(samples)
  if (samples.length === 0) return new Float32Array(0)

  semitones = clamp(semitones, -24, 24)

  const pitchRatio = Math.pow(2, semitones / 12)

  // Step 1: Time-stretch by inverse of pitch ratio.
  // If pitching up 12st (2x), we first stretch to 2x length so that
  // after resampling at 2x speed the output matches the original duration.
  const stretched = timeStretch(samples, sampleRate, pitchRatio)

  // Step 2: Resample the stretched audio at the pitch ratio.
  // This changes pitch and shrinks/expands back to original length.
  const targetLength = samples.length
  const srcLen = stretched.length
  const out = new Float32Array(targetLength)

  if (srcLen === 0) return out

  const step = srcLen / targetLength

  for (let i = 0; i < targetLength; i++) {
    const srcPos = i * step
    const idx = Math.floor(srcPos)
    const frac = srcPos - idx

    const s0 = stretched[clamp(idx - 1, 0, srcLen - 1)]
    const s1 = stretched[clamp(idx, 0, srcLen - 1)]
    const s2 = stretched[clamp(idx + 1, 0, srcLen - 1)]
    const s3 = stretched[clamp(idx + 2, 0, srcLen - 1)]

    out[i] = cubicInterp(s0, s1, s2, s3, frac)
  }

  return out
}

// ────────────────────────────────────────────────────────────
// Convenience wrappers
// ────────────────────────────────────────────────────────────

/** Halve playback speed (2x duration, same pitch). */
export function halfSpeed(samples: Float32Array, sampleRate: number = 44100): Float32Array {
  return timeStretch(samples, sampleRate, 2)
}

/** Double playback speed (0.5x duration, same pitch). */
export function doubleSpeed(samples: Float32Array, sampleRate: number = 44100): Float32Array {
  return timeStretch(samples, sampleRate, 0.5)
}
