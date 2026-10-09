// What the fm-fleet mod keeps in $.state, and the shape of one reading of the Bearings snapshot.
// A reading is the snapshot cut down to what the pane shows: lib/snapshot.ts builds it, and
// nothing else in the mod reads the snapshot's own field names.

/** One piece of work under way, from the snapshot's in_flight rows. */
export type WorkRow = {
  id: string
  kind: string
  state: string
  /** The registry name of its project; null when the snapshot names none. */
  repo: string | null
  /** What the snapshot says it is doing, as printed. */
  doing: string
  /** The piece's own title, when the snapshot supplies one. */
  title: string | null
  /** The date or time the piece entered its state, when the snapshot supplies one. */
  since: string | null
}

/** A registered secondmate's home-level row, kept only to say when its home cannot be read. */
export type SecondmateRow = { id: string; state: string }

/** An open decision: a task held for the captain. */
export type DecisionRow = { id: string; summary: string }

/** One recent completion. */
export type LandedRow = {
  id: string
  what: string
  /** A pull request URL or a report path; empty when the snapshot names none. */
  artifact: string
  date: string | null
}

/** One queued piece of work. */
export type GateRow = {
  id: string
  title: string
  /** The ids of the pieces it waits on; empty when it waits on none. */
  blockedBy: string[]
  reason: string
  /** The registry name of its project; null when the snapshot names none. */
  repo: string | null
}

export type Reading = {
  generated: string
  work: WorkRow[]
  secondmates: SecondmateRow[]
  decisions: DecisionRow[]
  landed: LandedRow[]
  gates: GateRow[]
  /** The pull request URL recorded for a task, by task id. */
  prs: Record<string, string>
  /** False when the snapshot predates `--fields work`: its rows then carry no titles or dates. */
  hasWorkFields: boolean
  /** True when the snapshot says it cut a list short. */
  isCapped: boolean
}

/** The latest read that did not produce a reading. */
export type Failure = {
  kind: 'unavailable' | 'not-a-home'
  reason: string
  /** Epoch milliseconds. */
  at: number
}

/** When the pane first saw a piece in the state it shows. */
export type Witness = {
  state: string
  /** Epoch milliseconds of the reading that first showed the state. */
  since: number
  /** True when the pane watched the piece arrive in this state; false when it was already there. */
  isWitnessed: boolean
}

export type FleetState = {
  /** The last good reading; kept when a later read fails. */
  reading: Reading | null
  /** Epoch milliseconds when that reading was taken; 0 with none. */
  readAt: number
  failure: Failure | null
  seen: Record<string, Witness>
}

declare module 'claude-code' {
  interface PluginState {
    'fm-fleet': { fleet: FleetState }
  }
}
