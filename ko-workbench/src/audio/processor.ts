// ────────────────────────────────────────────────────────────
// KO Workbench — Audio processor
// Uses the Web Audio API for decoding + resampling to 46875 Hz s16
// Falls back to the WASM modules from ep_133_sample_tool if available
// ────────────────────────────────────────────────────────────

import { DEVICE_SAMPLE_RATE, MAX_SAMPLE_LENGTH_SECS } from '../protocol/types'

export interface AudioMeta {
  name: string
  durationSec: number
  sampleRate: number
  channels: number
  format: string
  sizeBytes: number
}

export interface ProcessedAudio {
  meta: AudioMeta
  rawS16: Uint8Array        // 46875 Hz, s16, interleaved
  waveformData: Float32Array // downsampled for display (mono, 512 points)
}

// ─── WAV builder ──────────────────────────────────────────────

function buildWavHeader(sampleRate: number, channels: number, dataBytes: number): Uint8Array {
  const buf = new ArrayBuffer(44)
  const view = new DataView(buf)
  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i))
  }
  writeStr(0, 'RIFF')
  view.setUint32(4, 36 + dataBytes, true)
  writeStr(8, 'WAVE')
  writeStr(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)              // PCM
  view.setUint16(22, channels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * channels * 2, true) // byte rate
  view.setUint16(32, channels * 2, true)   // block align
  view.setUint16(34, 16, true)             // bits per sample
  writeStr(36, 'data')
  view.setUint32(40, dataBytes, true)
  return new Uint8Array(buf)
}

// ─── Processor ────────────────────────────────────────────────

export class AudioProcessor {
  private audioCtx: AudioContext | null = null

  private getAudioContext(): AudioContext {
    if (!this.audioCtx || this.audioCtx.state === 'closed') {
      this.audioCtx = new AudioContext({ sampleRate: DEVICE_SAMPLE_RATE })
    }
    return this.audioCtx
  }

  /** Decode any browser-supported audio file and resample to 46875 Hz s16 */
  async process(file: File): Promise<ProcessedAudio> {
    const arrayBuffer = await file.arrayBuffer()

    // Decode using browser's AudioContext (handles WAV, MP3, FLAC, OGG, AIFF)
    const ctx = this.getAudioContext()
    let audioBuffer: AudioBuffer

    try {
      audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0))
    } catch (e) {
      throw new Error(`Cannot decode audio: ${file.name} — ${String(e)}`)
    }

    const durationSec = audioBuffer.duration
    if (durationSec > MAX_SAMPLE_LENGTH_SECS) {
      throw new Error(`Sample too long: ${durationSec.toFixed(1)}s (max ${MAX_SAMPLE_LENGTH_SECS}s)`)
    }

    // Resample to DEVICE_SAMPLE_RATE using OfflineAudioContext
    const targetSamples = Math.ceil(durationSec * DEVICE_SAMPLE_RATE)
    const offlineCtx = new OfflineAudioContext(
      audioBuffer.numberOfChannels,
      targetSamples,
      DEVICE_SAMPLE_RATE,
    )

    const source = offlineCtx.createBufferSource()
    source.buffer = audioBuffer
    source.connect(offlineCtx.destination)
    source.start()

    const resampled = await offlineCtx.startRendering()

    // Convert to s16 interleaved
    const channels = resampled.numberOfChannels
    const length = resampled.length
    const s16 = new Int16Array(length * channels)
    for (let ch = 0; ch < channels; ch++) {
      const floatData = resampled.getChannelData(ch)
      for (let i = 0; i < length; i++) {
        const sample = Math.max(-1, Math.min(1, floatData[i]))
        s16[i * channels + ch] = sample < 0
          ? Math.round(sample * 32768)
          : Math.round(sample * 32767)
      }
    }

    // Build waveform preview (mono, 512 points)
    const waveformData = this.buildWaveform(resampled)

    const rawS16 = new Uint8Array(s16.buffer)

    return {
      meta: {
        name: file.name,
        durationSec,
        sampleRate: DEVICE_SAMPLE_RATE,
        channels,
        format: 's16',
        sizeBytes: rawS16.length,
      },
      rawS16,
      waveformData,
    }
  }

  private buildWaveform(audioBuffer: AudioBuffer, points = 512): Float32Array {
    const ch0 = audioBuffer.getChannelData(0)
    const waveform = new Float32Array(points)
    const samplesPerPoint = Math.floor(ch0.length / points)
    for (let i = 0; i < points; i++) {
      const start = i * samplesPerPoint
      let max = 0
      for (let j = 0; j < samplesPerPoint; j++) {
        const v = Math.abs(ch0[start + j] ?? 0)
        if (v > max) max = v
      }
      waveform[i] = max
    }
    return waveform
  }

  /** Create a WAV file blob from processed audio for export */
  createWavBlob(audio: ProcessedAudio): Blob {
    const header = buildWavHeader(
      audio.meta.sampleRate,
      audio.meta.channels,
      audio.meta.sizeBytes,
    )
    return new Blob([header.buffer as ArrayBuffer, audio.rawS16.buffer as ArrayBuffer], { type: 'audio/wav' })
  }

  /** Get waveform data from raw device s16 bytes (for downloaded samples) */
  getWaveformFromS16(rawS16: Uint8Array, channels = 1, points = 512): Float32Array {
    const samples = rawS16.length / 2 / channels
    const waveform = new Float32Array(points)
    const samplesPerPoint = Math.floor(samples / points)
    const view = new DataView(rawS16.buffer, rawS16.byteOffset)

    for (let i = 0; i < points; i++) {
      const start = i * samplesPerPoint * channels
      let max = 0
      for (let j = 0; j < samplesPerPoint; j++) {
        const offset = (start + j * channels) * 2
        if (offset + 1 < rawS16.length) {
          const v = Math.abs(view.getInt16(offset, true)) / 32768
          if (v > max) max = v
        }
      }
      waveform[i] = max
    }
    return waveform
  }
}
