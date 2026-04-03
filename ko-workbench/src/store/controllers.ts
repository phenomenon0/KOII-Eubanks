// ────────────────────────────────────────────────────────────
// KO Workbench — Controllers domain store
// External controller registry, MIDI learn, mappings, and pages.
// ────────────────────────────────────────────────────────────

import { createContext, useContext } from 'react'
import React from 'react'

// ─── Types ────────────────────────────────────────────────────

export interface ControllerDevice {
  id: string
  name: string
  type: 'keyboard' | 'pad' | 'fader' | 'generic'
  inputId: string
}

export interface ControllerMapping {
  id: string
  controllerId: string
  control: string
  action: string
  page: number
}

// ─── State ───────────────────────────────────────────────────

export interface ControllerState {
  controllers: ControllerDevice[]
  mappings: ControllerMapping[]
  learnMode: { active: boolean; target: string | null }
  activePage: number
  lastTouched: { controllerId: string; control: string; value: number } | null
}

// ─── Actions ─────────────────────────────────────────────────

export type ControllerAction =
  | { type: 'ADD_CONTROLLER'; controller: ControllerDevice }
  | { type: 'REMOVE_CONTROLLER'; id: string }
  | { type: 'ADD_MAPPING'; mapping: ControllerMapping }
  | { type: 'REMOVE_MAPPING'; id: string }
  | { type: 'SET_LEARN_MODE'; active: boolean; target: string | null }
  | { type: 'SET_ACTIVE_PAGE'; page: number }
  | { type: 'SET_LAST_TOUCHED'; controllerId: string; control: string; value: number }

// ─── Initial state ───────────────────────────────────────────

export const controllerInitialState: ControllerState = {
  controllers: [],
  mappings: [],
  learnMode: { active: false, target: null },
  activePage: 0,
  lastTouched: null,
}

// ─── Reducer ─────────────────────────────────────────────────

export function controllerReducer(state: ControllerState, action: ControllerAction): ControllerState {
  switch (action.type) {
    case 'ADD_CONTROLLER':
      return { ...state, controllers: [...state.controllers, action.controller] }
    case 'REMOVE_CONTROLLER':
      return {
        ...state,
        controllers: state.controllers.filter(c => c.id !== action.id),
        mappings: state.mappings.filter(m => m.controllerId !== action.id),
      }
    case 'ADD_MAPPING':
      return { ...state, mappings: [...state.mappings, action.mapping] }
    case 'REMOVE_MAPPING':
      return { ...state, mappings: state.mappings.filter(m => m.id !== action.id) }
    case 'SET_LEARN_MODE':
      return { ...state, learnMode: { active: action.active, target: action.target } }
    case 'SET_ACTIVE_PAGE':
      return { ...state, activePage: action.page }
    case 'SET_LAST_TOUCHED':
      return {
        ...state,
        lastTouched: {
          controllerId: action.controllerId,
          control: action.control,
          value: action.value,
        },
      }
    default:
      return state
  }
}

// ─── Context ─────────────────────────────────────────────────

export const ControllerStateContext = createContext<ControllerState>(controllerInitialState)
export const ControllerDispatchContext = createContext<React.Dispatch<ControllerAction>>(() => {})

export function useControllers(): ControllerState {
  return useContext(ControllerStateContext)
}

export function useControllersDispatch(): React.Dispatch<ControllerAction> {
  return useContext(ControllerDispatchContext)
}
