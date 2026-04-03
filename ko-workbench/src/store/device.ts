// ────────────────────────────────────────────────────────────
// KO Workbench — Device domain store
// Manages device connection, sounds, projects, uploads, sync,
// backup, memory, and selection state.
// ────────────────────────────────────────────────────────────

import { createContext, useContext } from 'react'
import type { DeviceInfo } from '../protocol/types'
import type { ProcessedAudio } from '../audio/processor'

// ─── Types ────────────────────────────────────────────────────

export interface SoundEntry {
  nodeId: number
  path: string           // /sounds/somefile.wav
  name: string
  bank: string           // KICK, SNARE etc
  channels: number
  sampleRate: number
  durationSec?: number
  sizeBytes?: number
  waveform?: Float32Array
  isPlaying: boolean
  meta: Record<string, unknown>
}

export interface ProjectEntry {
  nodeId: number
  path: string
  name: string           // P00, P01 ...
  groupCount: number
}

export type UploadJob = {
  id: string
  file: File
  processed?: ProcessedAudio
  status: 'queued' | 'processing' | 'uploading' | 'done' | 'error'
  progress: number  // 0-100
  error?: string
  targetBank?: string
}

export interface BackupProgress {
  operation: 'backup' | 'restore'
  phase: 'scanning' | 'transferring' | 'packing' | 'unpacking' | 'done' | 'error'
  currentFile: string
  fileIndex: number
  fileCount: number
  bytesTransferred: number
  bytesTotal: number
  errorMessage?: string
}

// ─── State ───────────────────────────────────────────────────

export interface DeviceState {
  device: DeviceInfo | null
  deviceError: string | null
  isMidiScanning: boolean
  midiLog: string[]
  sounds: SoundEntry[]
  projects: ProjectEntry[]
  uploadQueue: UploadJob[]
  isSyncing: boolean
  syncError: string | null
  memoryUsedBytes: number
  memoryTotalBytes: number
  backupProgress: BackupProgress | null
  selectedSoundId: number | null
  selectedBank: string | null
  view: 'library' | 'pads' | 'backup' | 'settings'
}

// ─── Actions ─────────────────────────────────────────────────

export type DeviceAction =
  | { type: 'DEVICE_CONNECTED'; device: DeviceInfo }
  | { type: 'DEVICE_DISCONNECTED' }
  | { type: 'DEVICE_ERROR'; error: string }
  | { type: 'MIDI_SCANNING'; scanning: boolean }
  | { type: 'MIDI_LOG'; line: string }
  | { type: 'SET_SOUNDS'; sounds: SoundEntry[] }
  | { type: 'ADD_SOUND'; sound: SoundEntry }
  | { type: 'REMOVE_SOUND'; nodeId: number }
  | { type: 'UPDATE_SOUND'; nodeId: number; patch: Partial<SoundEntry> }
  | { type: 'SET_PROJECTS'; projects: ProjectEntry[] }
  | { type: 'SELECT_SOUND'; nodeId: number | null }
  | { type: 'SELECT_BANK'; bank: string | null }
  | { type: 'ENQUEUE_UPLOAD'; job: UploadJob }
  | { type: 'UPDATE_UPLOAD'; id: string; patch: Partial<UploadJob> }
  | { type: 'REMOVE_UPLOAD'; id: string }
  | { type: 'SET_SYNCING'; syncing: boolean; error?: string }
  | { type: 'SET_VIEW'; view: 'library' | 'pads' | 'backup' | 'settings' }
  | { type: 'SET_MEMORY'; used: number; total: number }
  | { type: 'BACKUP_PROGRESS'; progress: BackupProgress | null }

// ─── Initial state ───────────────────────────────────────────

export const deviceInitialState: DeviceState = {
  device: null,
  deviceError: null,
  isMidiScanning: true,
  midiLog: [],
  sounds: [],
  projects: [],
  selectedSoundId: null,
  selectedBank: null,
  uploadQueue: [],
  isSyncing: false,
  syncError: null,
  memoryUsedBytes: 0,
  memoryTotalBytes: 128 * 1024 * 1024,  // 128 MB
  backupProgress: null,
  view: 'library',
}

// ─── Reducer ─────────────────────────────────────────────────

export function deviceReducer(state: DeviceState, action: DeviceAction): DeviceState {
  switch (action.type) {
    case 'DEVICE_CONNECTED':
      return { ...state, device: action.device, deviceError: null, isMidiScanning: false }
    case 'DEVICE_DISCONNECTED':
      return { ...state, device: null, sounds: [], projects: [], isMidiScanning: false }
    case 'DEVICE_ERROR':
      return { ...state, deviceError: action.error, isMidiScanning: false }
    case 'MIDI_SCANNING':
      return { ...state, isMidiScanning: action.scanning }
    case 'MIDI_LOG':
      return { ...state, midiLog: [...state.midiLog.slice(-19), action.line] }
    case 'SET_SOUNDS':
      return { ...state, sounds: action.sounds }
    case 'ADD_SOUND':
      return { ...state, sounds: [...state.sounds, action.sound] }
    case 'REMOVE_SOUND':
      return {
        ...state,
        sounds: state.sounds.filter(s => s.nodeId !== action.nodeId),
        selectedSoundId: state.selectedSoundId === action.nodeId ? null : state.selectedSoundId,
      }
    case 'UPDATE_SOUND':
      return {
        ...state,
        sounds: state.sounds.map(s =>
          s.nodeId === action.nodeId ? { ...s, ...action.patch } : s
        ),
      }
    case 'SET_PROJECTS':
      return { ...state, projects: action.projects }
    case 'SELECT_SOUND':
      return { ...state, selectedSoundId: action.nodeId }
    case 'SELECT_BANK':
      return { ...state, selectedBank: action.bank }
    case 'ENQUEUE_UPLOAD':
      return { ...state, uploadQueue: [...state.uploadQueue, action.job] }
    case 'UPDATE_UPLOAD':
      return {
        ...state,
        uploadQueue: state.uploadQueue.map(j =>
          j.id === action.id ? { ...j, ...action.patch } : j
        ),
      }
    case 'REMOVE_UPLOAD':
      return { ...state, uploadQueue: state.uploadQueue.filter(j => j.id !== action.id) }
    case 'SET_SYNCING':
      return { ...state, isSyncing: action.syncing, syncError: action.error ?? null }
    case 'SET_VIEW':
      return { ...state, view: action.view }
    case 'SET_MEMORY':
      return { ...state, memoryUsedBytes: action.used, memoryTotalBytes: action.total }
    case 'BACKUP_PROGRESS':
      return { ...state, backupProgress: action.progress }
    default:
      return state
  }
}

// ─── Context ─────────────────────────────────────────────────

import React from 'react'

export const DeviceStateContext = createContext<DeviceState>(deviceInitialState)
export const DeviceDispatchContext = createContext<React.Dispatch<DeviceAction>>(() => {})

export function useDevice(): DeviceState {
  return useContext(DeviceStateContext)
}

export function useDeviceDispatch(): React.Dispatch<DeviceAction> {
  return useContext(DeviceDispatchContext)
}
