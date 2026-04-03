// ────────────────────────────────────────────────────────────
// KO Studio — Quick audio operations
// Simple-but-mighty one-click transforms
// ────────────────────────────────────────────────────────────

/** Reverse audio samples in-place */
export function reverseAudio(samples: Float32Array): Float32Array {
  const out = new Float32Array(samples.length)
  for (let i = 0; i < samples.length; i++) {
    out[i] = samples[samples.length - 1 - i]
  }
  return out
}

/** Normalize audio to peak = 1.0 */
export function normalizeAudio(samples: Float32Array): Float32Array {
  let peak = 0
  for (let i = 0; i < samples.length; i++) {
    const v = Math.abs(samples[i])
    if (v > peak) peak = v
  }
  if (peak === 0 || peak >= 0.999) return samples
  const gain = 1.0 / peak
  const out = new Float32Array(samples.length)
  for (let i = 0; i < samples.length; i++) {
    out[i] = samples[i] * gain
  }
  return out
}

/** Simple pitch shift via playback rate change (resampling) */
export function pitchShift(samples: Float32Array, semitones: number): Float32Array {
  const ratio = Math.pow(2, semitones / 12)
  const newLength = Math.round(samples.length / ratio)
  const out = new Float32Array(newLength)
  for (let i = 0; i < newLength; i++) {
    const srcIdx = i * ratio
    const idx0 = Math.floor(srcIdx)
    const idx1 = Math.min(idx0 + 1, samples.length - 1)
    const frac = srcIdx - idx0
    out[i] = samples[idx0] * (1 - frac) + samples[idx1] * frac
  }
  return out
}

/** Fade in (linear) over N samples */
export function fadeIn(samples: Float32Array, fadeSamples: number): Float32Array {
  const out = new Float32Array(samples)
  const len = Math.min(fadeSamples, samples.length)
  for (let i = 0; i < len; i++) {
    out[i] *= i / len
  }
  return out
}

/** Fade out (linear) over N samples */
export function fadeOut(samples: Float32Array, fadeSamples: number): Float32Array {
  const out = new Float32Array(samples)
  const len = Math.min(fadeSamples, samples.length)
  const start = samples.length - len
  for (let i = 0; i < len; i++) {
    out[start + i] *= 1 - (i / len)
  }
  return out
}

/** Trim silence from start and end (below threshold) */
export function trimSilence(samples: Float32Array, threshold = 0.01): Float32Array {
  let start = 0
  let end = samples.length - 1
  while (start < samples.length && Math.abs(samples[start]) < threshold) start++
  while (end > start && Math.abs(samples[end]) < threshold) end--
  return samples.slice(start, end + 1)
}

/** Detect BPM via autocorrelation (works best on rhythmic loops) */
export function detectBpm(samples: Float32Array, sampleRate: number): number {
  // Build amplitude envelope
  const windowSize = Math.floor(sampleRate * 0.01) // 10ms windows
  const envLength = Math.floor(samples.length / windowSize)
  const envelope = new Float32Array(envLength)
  for (let i = 0; i < envLength; i++) {
    let sum = 0
    const start = i * windowSize
    for (let j = 0; j < windowSize && start + j < samples.length; j++) {
      sum += samples[start + j] * samples[start + j]
    }
    envelope[i] = Math.sqrt(sum / windowSize)
  }

  // Onset detection: first derivative of envelope
  const onset = new Float32Array(envLength - 1)
  for (let i = 0; i < onset.length; i++) {
    onset[i] = Math.max(0, envelope[i + 1] - envelope[i])
  }

  // Autocorrelation on onset signal
  // Search range: 60-200 BPM
  const minLag = Math.floor((60 / 200) * sampleRate / windowSize) // 200 BPM
  const maxLag = Math.floor((60 / 60) * sampleRate / windowSize)  // 60 BPM
  let bestLag = minLag
  let bestCorr = -1

  for (let lag = minLag; lag <= Math.min(maxLag, onset.length / 2); lag++) {
    let corr = 0
    const len = Math.min(onset.length - lag, onset.length / 2)
    for (let i = 0; i < len; i++) {
      corr += onset[i] * onset[i + lag]
    }
    if (corr > bestCorr) {
      bestCorr = corr
      bestLag = lag
    }
  }

  const beatPeriodSec = (bestLag * windowSize) / sampleRate
  const bpm = Math.round(60 / beatPeriodSec)
  return Math.max(60, Math.min(200, bpm))
}

/**
 * Simple browser-based audio preview using Web Audio API.
 * Returns a stop function.
 */
export function previewAudio(
  samples: Float32Array,
  sampleRate: number,
  startSample = 0,
  durationSamples?: number,
): () => void {
  const ctx = new AudioContext({ sampleRate })
  const len = durationSamples ?? (samples.length - startSample)
  const buffer = ctx.createBuffer(1, len, sampleRate)
  buffer.getChannelData(0).set(samples.subarray(startSample, startSample + len))
  const source = ctx.createBufferSource()
  source.buffer = buffer
  source.connect(ctx.destination)
  source.start()
  return () => {
    try { source.stop() } catch { /* already stopped */ }
    ctx.close()
  }
}
