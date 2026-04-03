// ────────────────────────────────────────────────────────────
// KO Workbench — Device Controller
// Wires MidiManager + EP133FileSystem + AudioProcessor → AppState
// ────────────────────────────────────────────────────────────

import { MidiManager } from './protocol/midi'
import { SysexClient } from './protocol/sysex'
import { EP133FileSystem, FSNode } from './protocol/filesystem'
import { AudioProcessor } from './audio/processor'
import { FS_PATH, DeviceInfo } from './protocol/types'
import { AppAction, SoundEntry, ProjectEntry } from './store'
import { BackupService } from './services/BackupService'
import { ControllerBus, MidiEvent } from './controllers/ControllerBus'
import { MappingEngine, ControllerMapping } from './controllers/MappingEngine'

type Dispatch = (action: AppAction) => void

export class DeviceController {
  private midi = new MidiManager()
  private fs: EP133FileSystem | null = null
  private audio = new AudioProcessor()
  private dispatch: Dispatch
  private currentDevice: DeviceInfo | null = null

  // Controller subsystem
  readonly controllerBus = new ControllerBus()
  readonly mappingEngine = new MappingEngine()
  private activePage = 1
  private unsubBus: (() => void) | null = null

  constructor(dispatch: Dispatch) {
    this.dispatch = dispatch

    // Wire ControllerBus events through MappingEngine
    this.unsubBus = this.controllerBus.onEvent((event: MidiEvent) => {
      const action = this.mappingEngine.processEvent(event, this.activePage)
      if (action) {
        this.dispatchControllerAction(action, event)
      }
    })
  }

  async init(): Promise<void> {
    this.dispatch({ type: 'MIDI_SCANNING', scanning: true })

    await this.midi.init({
      onDeviceConnected: (device, client) => this.onDeviceConnected(device, client),
      onDeviceDisconnected: (inputId) => this.onDeviceDisconnectedByInputId(inputId),
      onControllerConnected: (controller) => {
        console.log('[MIDI] Controller connected:', controller.name)
        this.dispatch({ type: 'MIDI_LOG', line: `Controller connected: ${controller.name}` })
      },
      onControllerDisconnected: (inputId) => {
        console.log('[MIDI] Controller disconnected:', inputId)
        this.dispatch({ type: 'MIDI_LOG', line: `Controller disconnected: ${inputId}` })
      },
      onControllerMidi: (data, controllerId) => {
        this.controllerBus.handleRawMidi(data, controllerId)
      },
      onError: (err) => {
        this.dispatch({ type: 'DEVICE_ERROR', error: err.message })
        this.dispatch({ type: 'MIDI_LOG', line: '✗ ' + err.message })
      },
      onLog: (line) => {
        console.log('[MIDI]', line)
        this.dispatch({ type: 'MIDI_LOG', line })
      },
    })
  }

  private async onDeviceConnected(device: DeviceInfo, client: SysexClient): Promise<void> {
    this.currentDevice = device
    this.fs = new EP133FileSystem(client, device.identityCode)
    this.dispatch({ type: 'DEVICE_CONNECTED', device })

    // Load library
    await this.refreshLibrary()
  }

  private onDeviceDisconnectedByInputId(inputId: string): void {
    if (this.currentDevice?.input_id === inputId) {
      this.currentDevice = null
      this.fs = null
      this.dispatch({ type: 'DEVICE_DISCONNECTED' })
    }
  }

  async refreshLibrary(): Promise<void> {
    if (!this.fs) return
    this.dispatch({ type: 'SET_SYNCING', syncing: true })

    try {
      // INIT: get device chunk size
      await this.fs.init()

      // List sounds
      const soundsNodeId = await this.fs.getNodeId(FS_PATH.SOUNDS)
      const soundNodes = await this.fs.list(soundsNodeId, FS_PATH.SOUNDS)
      const sounds = await this.buildSoundEntries(soundNodes)

      // Estimate memory (sum of file sizes)
      const usedBytes = sounds.reduce((sum, s) => sum + (s.sizeBytes ?? 0), 0)
      this.dispatch({ type: 'SET_SOUNDS', sounds })
      this.dispatch({ type: 'SET_MEMORY', used: usedBytes, total: 60 * 1024 * 1024 })

      // List projects
      const projects = await this.loadProjects()
      this.dispatch({ type: 'SET_PROJECTS', projects })

    } catch (e) {
      console.error('Library load error:', e)
      this.dispatch({ type: 'SET_SYNCING', syncing: false, error: String(e) })
      return
    }

    this.dispatch({ type: 'SET_SYNCING', syncing: false })
  }

  private async buildSoundEntries(nodes: FSNode[]): Promise<SoundEntry[]> {
    const entries: SoundEntry[] = []

    for (const node of nodes) {
      if (node.type !== 'file') continue
      try {
        const meta = this.fs ? await this.fs.getMetadata(node.nodeId) : {}
        const bank = this.detectBank(node.name, meta)
        const ch = (meta.channels as number) ?? 1
        const sr = (meta.samplerate as number) ?? 46875
        const durSec = node.size > 0 ? node.size / (sr * ch * 2) : undefined
        entries.push({
          nodeId: node.nodeId,
          path: node.path,
          name: node.name,
          bank,
          channels: ch,
          sampleRate: sr,
          durationSec: durSec,
          sizeBytes: node.size,
          isPlaying: false,
          meta: meta as Record<string, unknown>,
        })
      } catch {
        entries.push({
          nodeId: node.nodeId,
          path: node.path,
          name: node.name,
          bank: 'USER 1',
          channels: 1,
          sampleRate: 46875,
          isPlaying: false,
          meta: {},
        })
      }
    }

    return entries
  }

  private detectBank(name: string, meta: Record<string, unknown>): string {
    // Try to infer bank from path or metadata
    const lower = name.toLowerCase()
    if (/kick|bd|bass.?drum/.test(lower)) return 'KICK'
    if (/snare|sn|sd/.test(lower)) return 'SNARE'
    if (/cymb|hh|hat|crash|ride/.test(lower)) return 'CYMB'
    if (/perc|tom|clap|clave/.test(lower)) return 'PERC'
    if (/bass|sub/.test(lower)) return 'BASS'
    if (/loop|break|phrase/.test(lower)) return 'LOOP'
    return 'USER 1'
  }

  private async loadProjects(): Promise<ProjectEntry[]> {
    if (!this.fs) return []
    try {
      const projectsNodeId = await this.fs.getNodeId(FS_PATH.PROJECTS)
      const projectNodes = await this.fs.list(projectsNodeId, FS_PATH.PROJECTS)
      const projects: ProjectEntry[] = []
      for (const node of projectNodes) {
        if (node.type !== 'dir') continue
        let groupCount = 0
        try {
          const groupsNodeId = await this.fs.getNodeId(FS_PATH.groups(node.name))
          const groups = await this.fs.list(groupsNodeId)
          groupCount = groups.length
        } catch {}
        projects.push({
          nodeId: node.nodeId,
          path: node.path,
          name: node.name,
          groupCount,
        })
      }
      return projects
    } catch (e) {
      console.error('Projects load error:', e)
      return []
    }
  }

  // ── Upload flow ──────────────────────────────────────────

  async processAndUploadFile(jobId: string, file: File): Promise<void> {
    if (!this.fs || !this.currentDevice) {
      this.dispatch({ type: 'UPDATE_UPLOAD', id: jobId, patch: { status: 'error', error: 'No device' } })
      return
    }

    try {
      // Step 1: decode + resample
      this.dispatch({ type: 'UPDATE_UPLOAD', id: jobId, patch: { status: 'processing', progress: 0 } })
      const processed = await this.audio.process(file)
      this.dispatch({ type: 'UPDATE_UPLOAD', id: jobId, patch: { processed, progress: 20 } })

      // Step 2: get parent node ID
      const soundsNodeId = await this.fs.getNodeId(FS_PATH.SOUNDS)

      // Step 3: upload
      this.dispatch({ type: 'UPDATE_UPLOAD', id: jobId, patch: { status: 'uploading', progress: 30 } })

      const normalName = file.name.replace(/\.[^.]+$/, '') + '.wav'
      const nodeId = await this.fs.put(
        processed.rawS16,
        normalName,
        soundsNodeId,
        null,
        {
          name: normalName,
          channels: processed.meta.channels,
          samplerate: processed.meta.sampleRate,
          format: 's16',
        },
        (done, total) => {
          const progress = 30 + Math.round((done / total) * 65)
          this.dispatch({ type: 'UPDATE_UPLOAD', id: jobId, patch: { progress } })
        },
      )

      // Step 4: add to library
      const bank = this.detectBank(file.name, {})
      this.dispatch({
        type: 'ADD_SOUND',
        sound: {
          nodeId,
          path: `${FS_PATH.SOUNDS}/${normalName}`,
          name: normalName,
          bank,
          channels: processed.meta.channels,
          sampleRate: processed.meta.sampleRate,
          durationSec: processed.meta.durationSec,
          sizeBytes: processed.meta.sizeBytes,
          waveform: processed.waveformData,
          isPlaying: false,
          meta: {},
        },
      })

      this.dispatch({ type: 'UPDATE_UPLOAD', id: jobId, patch: { status: 'done', progress: 100 } })
    } catch (e) {
      this.dispatch({ type: 'UPDATE_UPLOAD', id: jobId, patch: { status: 'error', error: String(e) } })
    }
  }

  // ── Playback ──────────────────────────────────────────────

  async playSound(nodeId: number): Promise<void> {
    if (!this.fs) return
    try {
      await this.fs.startPlayback(nodeId)
      this.dispatch({ type: 'UPDATE_SOUND', nodeId, patch: { isPlaying: true } })
    } catch (e) {
      console.error('Playback error:', e)
    }
  }

  async stopSound(nodeId: number): Promise<void> {
    if (!this.fs) return
    try {
      await this.fs.stopPlayback(nodeId)
      this.dispatch({ type: 'UPDATE_SOUND', nodeId, patch: { isPlaying: false } })
    } catch (e) {
      console.error('Stop playback error:', e)
    }
  }

  // ── Delete ────────────────────────────────────────────────

  async deleteSound(nodeId: number): Promise<void> {
    if (!this.fs) return
    try {
      await this.fs.delete(nodeId)
      this.dispatch({ type: 'REMOVE_SOUND', nodeId })
    } catch (e) {
      console.error('Delete error:', e)
      throw e
    }
  }

  // ── Export ────────────────────────────────────────────────

  async exportSound(nodeId: number, filename: string): Promise<Blob | null> {
    if (!this.fs) return null
    try {
      const raw = await this.fs.get(nodeId)
      const meta = await this.fs.getMetadata(nodeId)
      const waveform = this.audio.getWaveformFromS16(raw, (meta.channels as number) ?? 1)
      // Build a simple WAV blob
      const channels = (meta.channels as number) ?? 1
      const sampleRate = (meta.samplerate as number) ?? 46875
      const header = buildWavHeader(sampleRate, channels, raw.length)
      return new Blob([header.buffer as ArrayBuffer, raw.buffer as ArrayBuffer], { type: 'audio/wav' })
    } catch (e) {
      console.error('Export error:', e)
      return null
    }
  }

  // ── Pad assignment ────────────────────────────────────────

  async assignPad(soundNodeId: number, padIndex: number): Promise<void> {
    if (!this.fs) throw new Error('No device connected')
    const meta = await this.fs.getMetadata(soundNodeId)
    const updated = { ...meta, sym: padIndex }
    await this.fs.setMetadata(soundNodeId, updated)
    this.dispatch({ type: 'UPDATE_SOUND', nodeId: soundNodeId, patch: { meta: updated } })
  }

  async clearPad(soundNodeId: number): Promise<void> {
    if (!this.fs) throw new Error('No device connected')
    const meta = await this.fs.getMetadata(soundNodeId)
    const { sym: _, ...rest } = meta
    await this.fs.setMetadata(soundNodeId, rest)
    this.dispatch({ type: 'UPDATE_SOUND', nodeId: soundNodeId, patch: { meta: rest } })
  }

  async deleteAllSounds(): Promise<void> {
    if (!this.fs) throw new Error('No device connected')
    console.log('[deleteAll] starting...')
    const soundsId = await this.fs.getNodeId('/sounds')
    const nodes = await this.fs.list(soundsId, '/sounds')
    console.log(`[deleteAll] found ${nodes.length} nodes in /sounds`)
    let deleted = 0
    for (const node of nodes) {
      if (node.type === 'file') {
        console.log(`[deleteAll] deleting ${node.name} (id=${node.nodeId})`)
        await this.fs.delete(node.nodeId)
        deleted++
      }
    }
    console.log(`[deleteAll] deleted ${deleted} files`)
    this.dispatch({ type: 'SET_SOUNDS', sounds: [] })
    this.dispatch({ type: 'SET_MEMORY', used: 0, total: 60 * 1024 * 1024 })
  }

  // ── Backup / Restore ──────────────────────────────────────

  async backup(opts: { projectsOnly: boolean }): Promise<void> {
    if (!this.fs || !this.currentDevice) throw new Error('No device connected')
    const svc = new BackupService(this.fs, this.dispatch, this.currentDevice)
    await svc.createBackup(opts)
    this.dispatch({ type: 'BACKUP_PROGRESS', progress: null })
  }

  async backupProject(projectPath: string): Promise<void> {
    if (!this.fs || !this.currentDevice) throw new Error('No device connected')
    const svc = new BackupService(this.fs, this.dispatch, this.currentDevice)
    await svc.createProjectBackup(projectPath)
    this.dispatch({ type: 'BACKUP_PROGRESS', progress: null })
  }

  async restore(): Promise<void> {
    if (!this.fs || !this.currentDevice) throw new Error('No device connected')
    const svc = new BackupService(this.fs, this.dispatch, this.currentDevice)
    await svc.restoreFromZip()
    await this.refreshLibrary()
    this.dispatch({ type: 'BACKUP_PROGRESS', progress: null })
  }

  async restoreProject(projectPath: string): Promise<void> {
    if (!this.fs || !this.currentDevice) throw new Error('No device connected')
    const svc = new BackupService(this.fs, this.dispatch, this.currentDevice)
    await svc.restoreProject(projectPath)
    await this.refreshLibrary()
    this.dispatch({ type: 'BACKUP_PROGRESS', progress: null })
  }

  // ── Controller mapping ─────────────────────────────────────

  /**
   * Set the active page for page-aware mappings (1-4).
   */
  setActivePage(page: number): void {
    this.activePage = page
  }

  /**
   * Arm learn mode: next MIDI event from any controller will
   * create a mapping targeting the given action string.
   */
  startLearnMode(targetAction: string, callback?: (mapping: ControllerMapping) => void): void {
    this.mappingEngine.startLearn(targetAction, (mapping) => {
      console.log('[Controller] Mapping learned:', mapping)
      this.dispatch({ type: 'MIDI_LOG', line: `Mapping learned: ${mapping.control} → ${mapping.action}` })
      callback?.(mapping)
    })
  }

  stopLearnMode(): void {
    this.mappingEngine.stopLearn()
  }

  getMappings(): ControllerMapping[] {
    return this.mappingEngine.getMappings()
  }

  addMapping(mapping: ControllerMapping): void {
    this.mappingEngine.addMapping(mapping)
  }

  removeMapping(id: string): void {
    this.mappingEngine.removeMapping(id)
  }

  /**
   * Dispatch an action string resolved by the MappingEngine.
   * Action format: 'category:argument' e.g. 'playPad:3', 'transport:play'
   */
  private dispatchControllerAction(action: string, _event: MidiEvent): void {
    console.log('[Controller] Action:', action)
    this.dispatch({ type: 'MIDI_LOG', line: `Controller action: ${action}` })

    // Parse action string
    const colonIdx = action.indexOf(':')
    const category = colonIdx >= 0 ? action.slice(0, colonIdx) : action
    const arg = colonIdx >= 0 ? action.slice(colonIdx + 1) : ''

    switch (category) {
      case 'playPad': {
        const padIdx = parseInt(arg, 10)
        if (!isNaN(padIdx)) {
          // Find sound assigned to this pad and trigger playback
          // This is a dispatch hook — UI layer can listen and act
          this.dispatch({ type: 'MIDI_LOG', line: `Pad trigger: ${padIdx}` })
        }
        break
      }
      case 'transport':
        this.dispatch({ type: 'MIDI_LOG', line: `Transport: ${arg}` })
        break
      case 'selectBank':
        if (arg) {
          this.dispatch({ type: 'SELECT_BANK', bank: arg })
        }
        break
      case 'setView':
        if (arg === 'library' || arg === 'pads' || arg === 'backup' || arg === 'settings') {
          this.dispatch({ type: 'SET_VIEW', view: arg })
        }
        break
      default:
        console.log('[Controller] Unhandled action category:', category)
    }
  }

  dispose(): void {
    if (this.unsubBus) {
      this.unsubBus()
      this.unsubBus = null
    }
    this.controllerBus.dispose()
    this.midi.dispose()
  }
}

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
  view.setUint16(20, 1, true)
  view.setUint16(22, channels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * channels * 2, true)
  view.setUint16(32, channels * 2, true)
  view.setUint16(34, 16, true)
  writeStr(36, 'data')
  view.setUint32(40, dataBytes, true)
  return new Uint8Array(buf)
}
