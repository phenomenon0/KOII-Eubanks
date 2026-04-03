// ────────────────────────────────────────────────────────────
// KO Workbench — Performance domain store
// Live performance state: scene launching, quantize, BPM,
// recording, cell launching, and cue mode.
// ────────────────────────────────────────────────────────────

import { createContext, useContext } from 'react'
import React from 'react'

// ─── State ───────────────────────────────────────────────────

export interface PerformanceState {
  activeSceneId: string | null
  quantize: 'off' | '1bar' | '2bar' | '4bar'
  bpm: number
  isRecording: boolean
  launchedCells: string[]
  cueState: 'live' | 'cue'
}

// ─── Actions ─────────────────────────────────────────────────

export type PerformanceAction =
  | { type: 'SET_SCENE'; id: string | null }
  | { type: 'SET_QUANTIZE'; quantize: PerformanceState['quantize'] }
  | { type: 'SET_BPM'; bpm: number }
  | { type: 'TOGGLE_RECORDING' }
  | { type: 'LAUNCH_CELL'; cellId: string }
  | { type: 'STOP_CELL'; cellId: string }
  | { type: 'SET_CUE'; cueState: PerformanceState['cueState'] }

// ─── Initial state ───────────────────────────────────────────

export const performanceInitialState: PerformanceState = {
  activeSceneId: null,
  quantize: 'off',
  bpm: 120,
  isRecording: false,
  launchedCells: [],
  cueState: 'live',
}

// ─── Reducer ─────────────────────────────────────────────────

export function performanceReducer(state: PerformanceState, action: PerformanceAction): PerformanceState {
  switch (action.type) {
    case 'SET_SCENE':
      return { ...state, activeSceneId: action.id }
    case 'SET_QUANTIZE':
      return { ...state, quantize: action.quantize }
    case 'SET_BPM':
      return { ...state, bpm: action.bpm }
    case 'TOGGLE_RECORDING':
      return { ...state, isRecording: !state.isRecording }
    case 'LAUNCH_CELL':
      return {
        ...state,
        launchedCells: state.launchedCells.includes(action.cellId)
          ? state.launchedCells
          : [...state.launchedCells, action.cellId],
      }
    case 'STOP_CELL':
      return {
        ...state,
        launchedCells: state.launchedCells.filter(id => id !== action.cellId),
      }
    case 'SET_CUE':
      return { ...state, cueState: action.cueState }
    default:
      return state
  }
}

// ─── Context ─────────────────────────────────────────────────

export const PerformanceStateContext = createContext<PerformanceState>(performanceInitialState)
export const PerformanceDispatchContext = createContext<React.Dispatch<PerformanceAction>>(() => {})

export function usePerformance(): PerformanceState {
  return useContext(PerformanceStateContext)
}

export function usePerformanceDispatch(): React.Dispatch<PerformanceAction> {
  return useContext(PerformanceDispatchContext)
}
