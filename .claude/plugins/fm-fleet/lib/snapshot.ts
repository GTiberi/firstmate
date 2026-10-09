// Turns the output of `bin/fm-bearings-snapshot.sh --json --fields work` into a Reading, the
// only form of the fleet the rest of the mod handles.
//
// The snapshot owns its fields (the script's header and --help are the contract); this module
// reads the ones the pane shows, checks each, and keeps nothing else. A row without an id is
// dropped rather than guessed at. Titles, filed dates and completion dates arrive only when the
// snapshot was asked for `--fields work`; an older code root answers without them, and the
// reading then carries null where they would be.
import type { DecisionRow, GateRow, LandedRow, Reading, SecondmateRow, WorkRow } from '../types'

/** The one command the mod runs, relative to the code root. */
export const SNAPSHOT_SCRIPT = 'bin/fm-bearings-snapshot.sh'
export const SNAPSHOT_ARGS = ['--json', '--fields', 'work'] as const
export const SNAPSHOT_SCHEMA = 'fm-bearings.v1'

export type Parsed = { isOk: true; reading: Reading } | { isOk: false; reason: string }

type Row = Record<string, unknown>

function isRow(value: unknown): value is Row {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** A string the snapshot filled in: empty, whitespace, and the "-" placeholder read as null. */
function textOrNull(value: unknown): string | null {
  const trimmed = text(value).trim()
  return trimmed === '' || trimmed === '-' ? null : trimmed
}

function rowsOf(value: unknown): Row[] {
  return Array.isArray(value) ? value.filter(isRow) : []
}

function withId<T>(rows: Row[], make: (row: Row, id: string) => T): T[] {
  const out: T[] = []
  for (const row of rows) {
    const id = text(row.id).trim()
    if (id !== '') out.push(make(row, id))
  }
  return out
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\/\S+$/.test(value)
}

/** The snapshot says a list was cut short with "<list> showing N of M". */
function isCappedBy(omitted: Row[]): boolean {
  return omitted.some((row) => /\bshowing \d+ of (at least )?\d+/.test(text(row.surface)))
}

export function parseSnapshot(output: string): Parsed {
  let data: unknown
  try {
    data = JSON.parse(output)
  } catch {
    return { isOk: false, reason: 'the snapshot did not print JSON' }
  }
  if (!isRow(data)) return { isOk: false, reason: 'the snapshot did not print a JSON object' }
  if (data.schema !== SNAPSHOT_SCHEMA) {
    return { isOk: false, reason: `unexpected snapshot format (${text(data.schema) || 'no schema'})` }
  }
  for (const list of ['in_flight', 'decisions_open', 'landed', 'gates'] as const) {
    if (!Array.isArray(data[list])) return { isOk: false, reason: `the snapshot has no ${list} list` }
  }

  const workRows = rowsOf(data.in_flight)
  const work = withId<WorkRow>(workRows, (row, id) => ({
    id,
    kind: text(row.kind),
    state: text(row.state),
    repo: textOrNull(row.repo),
    doing: text(row.doing).trim(),
    title: textOrNull(row.title),
    since: textOrNull(row.since),
  }))

  const secondmates = withId<SecondmateRow>(rowsOf(data.secondmates), (row, id) => ({
    id,
    state: text(row.state),
  }))

  const decisions = withId<DecisionRow>(rowsOf(data.decisions_open), (row, id) => ({
    id,
    summary: text(row.summary).trim(),
  }))

  const landed = withId<LandedRow>(rowsOf(data.landed), (row, id) => ({
    id,
    what: text(row.what).trim(),
    artifact: textOrNull(row.artifact) ?? '',
    date: textOrNull(row.date),
  }))

  const gates = withId<GateRow>(rowsOf(data.gates), (row, id) => ({
    id,
    title: text(row.title).trim(),
    blockedBy: (textOrNull(row.blocked_by) ?? '').split(',').map((part) => part.trim()).filter(Boolean),
    reason: textOrNull(row.reason) ?? '',
    repo: textOrNull(row.repo),
  }))

  const prs: Record<string, string> = {}
  for (const row of rowsOf(data.recorded_prs)) {
    const id = text(row.id).trim()
    const url = text(row.url).trim()
    if (id !== '' && isHttpUrl(url)) prs[id] = url
  }

  return {
    isOk: true,
    reading: {
      generated: text(data.generated),
      work,
      secondmates,
      decisions,
      landed,
      gates,
      prs,
      // The key is on every in_flight row of a snapshot that knew `--fields work`, whether or not
      // its value is; a snapshot with no work rows cannot tell, so it counts as knowing.
      hasWorkFields: workRows.every((row) => 'title' in row),
      isCapped: isCappedBy(rowsOf(data.omitted)),
    },
  }
}
