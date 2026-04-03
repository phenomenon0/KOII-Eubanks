// ────────────────────────────────────────────────────────────
// KO Workbench — Combined store provider
// Nests all 4 domain stores and re-exports backwards-compat
// hooks so existing components continue to work unchanged.
// ────────────────────────────────────────────────────────────

import React, { createContext, useContext, useReducer, useMemo } from 'react'

// ─── Domain stores ───────────────────────────────────────────

import {
  DeviceStateContext,
  DeviceDispatchContext,
  deviceReducer,
  deviceInitialState,
} from './device'
import type { DeviceState, DeviceAction } from './device'

import {
  WorkspaceStateContext,
  WorkspaceDispatchContext,
  workspaceReducer,
  workspaceInitialState,
} from './workspace'

import {
  PerformanceStateContext,
  PerformanceDispatchContext,
  performanceReducer,
  performanceInitialState,
} from './performance'

import {
  ControllerStateContext,
  ControllerDispatchContext,
  controllerReducer,
  controllerInitialState,
} from './controllers'

// ─── Re-export domain hooks ──────────────────────────────────

export { useDevice, useDeviceDispatch } from './device'
export { useWorkspace, useWorkspaceDispatch } from './workspace'
export { usePerformance, usePerformanceDispatch } from './performance'
export { useControllers, useControllersDispatch } from './controllers'

// ─── Re-export types (backwards compat) ─────────────────────

export type { SoundEntry, ProjectEntry, UploadJob, BackupProgress, DeviceState, DeviceAction } from './device'
export type { Scene, LoopCell, SliceMarker, MacroBank, WorkspaceState, WorkspaceAction } from './workspace'
export type { PerformanceState, PerformanceAction } from './performance'
export type { ControllerDevice, ControllerMapping, ControllerState, ControllerAction } from './controllers'

// ─── Legacy AppState / AppAction aliases ─────────────────────
// Existing components import these — they map to DeviceState/DeviceAction.

export type AppState = DeviceState
export type AppAction = DeviceAction

// ─── StoreProvider ───────────────────────────────────────────
// Nests all four context providers in a single wrapper.

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [deviceState, deviceDispatch] = useReducer(deviceReducer, deviceInitialState)
  const [workspaceState, workspaceDispatch] = useReducer(workspaceReducer, workspaceInitialState)
  const [performanceState, performanceDispatch] = useReducer(performanceReducer, performanceInitialState)
  const [controllerState, controllerDispatch] = useReducer(controllerReducer, controllerInitialState)

  return React.createElement(
    DeviceStateContext.Provider,
    { value: deviceState },
    React.createElement(
      DeviceDispatchContext.Provider,
      { value: deviceDispatch },
      React.createElement(
        WorkspaceStateContext.Provider,
        { value: workspaceState },
        React.createElement(
          WorkspaceDispatchContext.Provider,
          { value: workspaceDispatch },
          React.createElement(
            PerformanceStateContext.Provider,
            { value: performanceState },
            React.createElement(
              PerformanceDispatchContext.Provider,
              { value: performanceDispatch },
              React.createElement(
                ControllerStateContext.Provider,
                { value: controllerState },
                React.createElement(
                  ControllerDispatchContext.Provider,
                  { value: controllerDispatch },
                  children,
                ),
              ),
            ),
          ),
        ),
      ),
    ),
  )
}

// ─── Backwards-compat hooks ─────────────────────────────────
// useStore() returns { state, dispatch } where state = DeviceState
// and dispatch = DeviceAction dispatcher. All existing components
// that import useStore/useDispatch keep working with zero changes.

export function useStore(): { state: DeviceState; dispatch: React.Dispatch<DeviceAction> } {
  const state = useContext(DeviceStateContext)
  const dispatch = useContext(DeviceDispatchContext)
  return useMemo(() => ({ state, dispatch }), [state, dispatch])
}

export function useDispatch(): React.Dispatch<DeviceAction> {
  return useContext(DeviceDispatchContext)
}

// Legacy context export (some code may reference StoreContext directly)

interface StoreContextValue {
  state: DeviceState
  dispatch: React.Dispatch<DeviceAction>
}

export const StoreContext = createContext<StoreContextValue>({
  state: deviceInitialState,
  dispatch: () => {},
})
