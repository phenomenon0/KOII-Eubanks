// ────────────────────────────────────────────────────────────
// KO Workbench — Workspace domain store
// Scenes, loop cells, slice markers, macro banks, and tabs.
// ────────────────────────────────────────────────────────────

import { createContext, useContext } from 'react'
import React from 'react'

// ─── Types ────────────────────────────────────────────────────

export interface Scene {
  id: string
  name: string
  padStates: Record<number, number>
  muteGroups: string[]
  macroValues: Record<string, number>
}

export interface LoopCell {
  id: string
  soundNodeId: number
  state: 'stopped' | 'queued' | 'playing'
  quantize: string
}

export interface SliceMarker {
  id: string
  position: number
  label?: string
}

export interface MacroBank {
  id: string
  name: string
  faders: { label: string; value: number; target: string }[]
}

// ─── State ───────────────────────────────────────────────────

export interface WorkspaceState {
  scenes: Scene[]
  selectedSceneId: string | null
  loopCells: LoopCell[]
  sliceMarkers: SliceMarker[]
  macros: MacroBank[]
  activeTab: 'perform' | 'sample' | 'play' | 'device'
}

// ─── Actions ─────────────────────────────────────────────────

export type WorkspaceAction =
  | { type: 'ADD_SCENE'; scene: Scene }
  | { type: 'REMOVE_SCENE'; id: string }
  | { type: 'SELECT_SCENE'; id: string | null }
  | { type: 'SET_LOOP_CELL'; cell: LoopCell }
  | { type: 'ADD_SLICE_MARKER'; marker: SliceMarker }
  | { type: 'REMOVE_SLICE_MARKER'; id: string }
  | { type: 'SET_MACRO'; macro: MacroBank }
  | { type: 'SET_ACTIVE_TAB'; tab: WorkspaceState['activeTab'] }

// ─── Initial state ───────────────────────────────────────────

export const workspaceInitialState: WorkspaceState = {
  scenes: [],
  selectedSceneId: null,
  loopCells: [],
  sliceMarkers: [],
  macros: [],
  activeTab: 'device',
}

// ─── Reducer ─────────────────────────────────────────────────

export function workspaceReducer(state: WorkspaceState, action: WorkspaceAction): WorkspaceState {
  switch (action.type) {
    case 'ADD_SCENE':
      return { ...state, scenes: [...state.scenes, action.scene] }
    case 'REMOVE_SCENE':
      return {
        ...state,
        scenes: state.scenes.filter(s => s.id !== action.id),
        selectedSceneId: state.selectedSceneId === action.id ? null : state.selectedSceneId,
      }
    case 'SELECT_SCENE':
      return { ...state, selectedSceneId: action.id }
    case 'SET_LOOP_CELL': {
      const idx = state.loopCells.findIndex(c => c.id === action.cell.id)
      if (idx >= 0) {
        const cells = [...state.loopCells]
        cells[idx] = action.cell
        return { ...state, loopCells: cells }
      }
      return { ...state, loopCells: [...state.loopCells, action.cell] }
    }
    case 'ADD_SLICE_MARKER':
      return { ...state, sliceMarkers: [...state.sliceMarkers, action.marker] }
    case 'REMOVE_SLICE_MARKER':
      return { ...state, sliceMarkers: state.sliceMarkers.filter(m => m.id !== action.id) }
    case 'SET_MACRO': {
      const idx = state.macros.findIndex(m => m.id === action.macro.id)
      if (idx >= 0) {
        const macros = [...state.macros]
        macros[idx] = action.macro
        return { ...state, macros }
      }
      return { ...state, macros: [...state.macros, action.macro] }
    }
    case 'SET_ACTIVE_TAB':
      return { ...state, activeTab: action.tab }
    default:
      return state
  }
}

// ─── Context ─────────────────────────────────────────────────

export const WorkspaceStateContext = createContext<WorkspaceState>(workspaceInitialState)
export const WorkspaceDispatchContext = createContext<React.Dispatch<WorkspaceAction>>(() => {})

export function useWorkspace(): WorkspaceState {
  return useContext(WorkspaceStateContext)
}

export function useWorkspaceDispatch(): React.Dispatch<WorkspaceAction> {
  return useContext(WorkspaceDispatchContext)
}
