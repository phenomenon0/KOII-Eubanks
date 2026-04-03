// ────────────────────────────────────────────────────────────
// KO Workbench — Scene Engine
// Captures and recalls performance scenes (pad assignments,
// macro values, mute groups).
// ────────────────────────────────────────────────────────────

import type { Scene } from '../store/workspace'

export class SceneEngine {
  /**
   * Capture the current performance state into a new Scene object.
   */
  static captureScene(
    name: string,
    padSounds: { padIndex: number; soundNodeId: number }[],
    macroValues: Record<string, number>,
  ): Scene {
    return {
      id: `scene_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      name,
      padStates: Object.fromEntries(padSounds.map(p => [p.padIndex, p.soundNodeId])),
      muteGroups: [],
      macroValues: { ...macroValues },
    }
  }

  /**
   * Recall a scene — returns the data needed to restore performance state.
   */
  static recallScene(scene: Scene): {
    padAssignments: { padIndex: number; soundNodeId: number }[]
    macroValues: Record<string, number>
    muteGroups: string[]
  } {
    return {
      padAssignments: Object.entries(scene.padStates).map(([k, v]) => ({
        padIndex: Number(k),
        soundNodeId: v,
      })),
      macroValues: scene.macroValues,
      muteGroups: scene.muteGroups,
    }
  }
}
