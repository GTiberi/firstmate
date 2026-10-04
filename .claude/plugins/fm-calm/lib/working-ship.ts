// Firstmate's Calm-only animated working presentation for the Claude Code mod.
//
// A tiny two-row boat replaces the stock spinner while one agent run is active. This module
// owns only the sprite geometry, the bounce track, the two animation cadences, and the
// freeze/resume state; register.ts owns when the presentation is shown and drives the timer.
// docs/calm.md owns the captain-facing contract.
//
// The geometry, cadence math, and bounce rules are the same ones the Pi extension keeps in
// .pi/extensions/lib/fm-calm-working-ship.ts. A mod loaded from a marketplace is copied on its
// own, so it cannot import that file; tests/fm-calm-claude-mod.test.sh replays both
// implementations tick for tick and fails if their frames ever differ.
//
// Cadence: one scheduler drives two logically independent clocks. Every tick advances the
// water phase, and only every CALM_WORKING_SHIP_TICKS_PER_MOVE-th tick moves the boat, so the
// water visibly ripples several times between boat steps and the boat itself reads as calm.
// Ticks, not wall-clock timestamps, drive every state change, so tests seek time exactly and
// hidden elapsed time never advances the animation.
//
// Continuity: one animation instance survives the working periods of a session. Stopping the
// timer restores the last rendered column, direction, water phase, and tick cadence, so the
// next working period resumes there; a fresh session calls reset().
//
// A frame is a list of rows, each a list of colored runs, because the mods API draws colour
// through Text props and accepts no escape sequences inside text. ansiRowOf() maps a row to the
// standard ANSI string the Pi extension draws, which is what the parity test compares.

export type ShipColor = 'blue' | 'yellow'
export type ShipRun = { text: string; color?: ShipColor }
export type ShipRow = readonly ShipRun[]

// The hull is symmetric and replaces waves on its row rather than adding a third row.
const HULL = '\\__/'
// A mainsail extends aft of the mast, so it trails behind the bow relative to travel.
const SAIL_RIGHT = '<|'
const SAIL_LEFT = '|>'
// Centers the two-cell sail over the four-cell hull.
const SAIL_OFFSET = 1
const HULL_WIDTH = HULL.length
const SAIL_WIDTH = SAIL_RIGHT.length

// Bounded deterministic fixed-cell water phases. Every entry is exactly one column, so
// advancing the phase ripples the surface without changing visible width or row count.
const WAVE_CYCLE = ['~', '~', '-', '~'] as const

/** Scheduler period. One tick advances the water by one phase. */
export const CALM_WORKING_SHIP_TICK_MS = 220
/** Boat moves one column every Nth tick, so it travels at 220 * 4 = 880ms per column. */
export const CALM_WORKING_SHIP_TICKS_PER_MOVE = 4

export type CalmWorkingShipAnimation = {
  /** Render one frame that exactly fits `width`, clamping the track to it first. */
  render(width: number): ShipRow[]
  /** Advance one scheduler tick: water every tick, boat on its slower cadence. */
  tick(): void
  restoreLastRendered(): void
  /** Restore the normal initial column, direction, water phase, and cadence. */
  reset(): void
  /** Clamp the frozen column and direction to `width` without advancing time. */
  clampToWidth(width: number): void
  /** Current hull column, exposed for deterministic motion assertions. */
  position(): number
  /** Current travel direction: 1 travelling right, -1 travelling left. */
  direction(): number
  /** Current water phase, exposed for deterministic ripple assertions. */
  waterPhase(): number
}

/** Longest hull start column that still fits the sprite in `width` usable cells. */
function trackSpan(width: number): number {
  if (width >= HULL_WIDTH) return width - HULL_WIDTH
  if (width >= SAIL_WIDTH) return width - SAIL_WIDTH
  return 0
}

export function createCalmWorkingShipAnimation(): CalmWorkingShipAnimation {
  let position = 0
  let direction = 1
  let span = 0
  let phase = 0
  let ticks = 0
  let renderedPosition = position
  let renderedDirection = direction
  let renderedSpan = span
  let renderedPhase = phase
  let renderedTicks = ticks

  // Reversing the moment the boat lands on an endpoint means the endpoint frame itself
  // already shows the new heading, so no frame at or after a bounce shows the old sail.
  const settleDirectionAtEdges = (): void => {
    if (span <= 0) return
    if (position >= span) direction = -1
    else if (position <= 0) direction = 1
  }

  const applyWidth = (width: number): void => {
    if (width <= 0) {
      span = 0
      position = 0
      return
    }
    span = trackSpan(width)
    position = Math.min(position, span)
    settleDirectionAtEdges()
  }

  const commitRenderedState = (): void => {
    renderedPosition = position
    renderedDirection = direction
    renderedSpan = span
    renderedPhase = phase
    renderedTicks = ticks
  }

  const restoreLastRenderedState = (): void => {
    position = renderedPosition
    direction = renderedDirection
    span = renderedSpan
    phase = renderedPhase
    ticks = renderedTicks
  }

  /** One run of water covering absolute columns [from, from + count). */
  const water = (from: number, count: number): ShipRun[] => {
    if (count <= 0) return []
    let cells = ''
    for (let column = from; column < from + count; column += 1) {
      cells += WAVE_CYCLE[(column + phase) % WAVE_CYCLE.length]
    }
    return [{ text: cells, color: 'blue' }]
  }

  const boat = (text: string): ShipRun => ({ text, color: 'yellow' })

  return {
    position: () => position,
    direction: () => direction,
    waterPhase: () => phase,

    restoreLastRendered: restoreLastRenderedState,

    reset(): void {
      position = 0
      direction = 1
      span = 0
      phase = 0
      ticks = 0
      commitRenderedState()
    },

    clampToWidth(width: number): void {
      applyWidth(width)
    },

    tick(): void {
      ticks += 1
      phase = (phase + 1) % WAVE_CYCLE.length
      if (ticks % CALM_WORKING_SHIP_TICKS_PER_MOVE !== 0) return
      if (span <= 0) {
        position = 0
        return
      }
      position = Math.min(span, Math.max(0, position + direction))
      settleDirectionAtEdges()
    },

    render(width: number): ShipRow[] {
      if (width <= 0) return []

      // A resize lands here before the next frame, so recompute and clamp the track
      // immediately rather than trusting a position measured against the old width.
      applyWidth(width)

      const sail = direction >= 0 ? SAIL_RIGHT : SAIL_LEFT

      let frame: ShipRow[]
      if (width < SAIL_WIDTH) {
        // Too narrow for even the sail: a deterministic single row of water.
        frame = [water(0, width)]
      } else if (width < HULL_WIDTH) {
        // Too narrow for the hull: the sail alone rides the water row.
        frame = [
          [
            ...water(0, position),
            boat(sail),
            ...water(position + SAIL_WIDTH, width - position - SAIL_WIDTH),
          ],
        ]
      } else {
        frame = [
          [{ text: ' '.repeat(position + SAIL_OFFSET) }, boat(sail)],
          [
            ...water(0, position),
            boat(HULL),
            ...water(position + HULL_WIDTH, width - position - HULL_WIDTH),
          ],
        ]
      }

      commitRenderedState()
      return frame
    },
  }
}

// Standard ANSI foreground codes only, the exact bytes the Pi widget draws.
const ANSI_FOREGROUND = { blue: '\u001b[34m', yellow: '\u001b[33m' } as const
const ANSI_RESET = '\u001b[39m'

/** The row as the Pi extension draws it: each colored run wrapped in its code and a reset. */
export function ansiRowOf(row: ShipRow): string {
  return row
    .map((run) =>
      run.color === undefined ? run.text : `${ANSI_FOREGROUND[run.color]}${run.text}${ANSI_RESET}`,
    )
    .join('')
}
