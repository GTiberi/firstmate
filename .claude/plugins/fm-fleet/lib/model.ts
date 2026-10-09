// A Reading arranged the way the pane and the band show it: what waits on the captain, the pieces
// under way grouped by project, recent completions, and queued work, each in his words.
//
// Pure: no mods API, no clock of its own. `now` is passed in, so a test pins the ages.
import type { GateRow, Reading, Witness } from '../types'
import {
  ageWords,
  plainDoing,
  READY_TO_START,
  shortDate,
  type Tone,
  WAITING_FOR_YOU,
  WAITING_ON_DATE,
  WAITING_ON_PIECE,
  workState,
} from './words'

/** One row under a project: a piece of work and where it stands. */
export type WorkItem = {
  word: string
  tone: Tone
  rank: number
  title: string | null
  doing: string
  /** How long the pane has watched it so ("5m"), else the date it started ("Oct 8"); null when nothing says. */
  age: string | null
  /** The pull request recorded for it, when there is one. */
  url: string | null
}

export type Group = { name: string; items: WorkItem[] }

/** Something that waits on the captain's own word. */
export type WaitingItem = { text: string; url: string | null }

export type LandedItem = {
  what: string
  /** "today", "yesterday", "Oct 8"; null when the snapshot carries no date. */
  when: string | null
  artifact: string
  url: string | null
}

export type QueuedItem = {
  word: string
  tone: Tone
  title: string
  /** The project it belongs to, when the snapshot names one. */
  repo: string | null
  /** The blocker or the date, in words. */
  note: string
}

export type Model = {
  /** Every piece under way, in any state. */
  pieces: number
  running: number
  waiting: number
  queued: number
  waitingItems: WaitingItem[]
  groups: Group[]
  landed: LandedItem[]
  queuedItems: QueuedItem[]
  notices: string[]
}

export const OTHER_WORK = 'Other work'

/** A row whose time in its state the pane watches: the key is its id, the state the one it is in. */
export type Tracked = { key: string; state: string }

export function workKey(id: string): string {
  return `work:${id}`
}

/** Every piece under way, with the state it is in: the rows whose age the pane can show. */
export function trackedRows(reading: Reading): Tracked[] {
  return reading.work.map((row) => ({ key: workKey(row.id), state: row.state }))
}

/**
 * Carries the pane's record of when it first saw each row in its state forward one reading.
 * A row already there in the same state keeps its time; one that changed state, or arrived after
 * the first reading, is stamped now and counts as watched; on the first reading every row is
 * stamped but unwatched, because it may have been in that state for days.
 */
export function witness(
  previous: Record<string, Witness>,
  rows: Tracked[],
  now: number,
  isFirstReading: boolean,
): Record<string, Witness> {
  const next: Record<string, Witness> = {}
  for (const { key, state } of rows) {
    const before = previous[key]
    if (before !== undefined && before.state === state) next[key] = before
    else next[key] = { state, since: now, isWitnessed: !isFirstReading }
  }
  return next
}

function ageOf(
  since: string | null,
  seen: Witness | undefined,
  state: string,
  now: number,
): string | null {
  if (seen !== undefined && seen.isWitnessed && seen.state === state) return ageWords(now - seen.since)
  if (since !== null && !Number.isNaN(Date.parse(since))) return shortDate(since)
  return null
}

function dayOf(epoch: number): string {
  return new Date(epoch).toISOString().slice(0, 10)
}

function whenOf(date: string | null, now: number): string | null {
  if (date === null) return null
  if (date === dayOf(now)) return 'today'
  if (date === dayOf(now - 86_400_000)) return 'yesterday'
  return shortDate(date)
}

const BLOCKER_NOTE = /^blocked-by [^:]*(:\s*|$)/
const UNTIL_NOTE = /^until (\d{4}-\d{2}-\d{2})(?::\s*)?/
const HELD_NOTE = /^held (\d+)d(?::\s*)?/

/** A queued row in the captain's words: what it waits on, in words and never in ids. */
function queuedItem(gate: GateRow): QueuedItem {
  const blocker = BLOCKER_NOTE.exec(gate.reason)
  const until = UNTIL_NOTE.exec(gate.reason)
  const held = HELD_NOTE.exec(gate.reason)
  const rest = (match: RegExpExecArray | null): string =>
    match === null ? gate.reason : gate.reason.slice(match[0].length).trim()

  if (gate.blockedBy.length > 0 || blocker !== null) {
    const count = gate.blockedBy.length
    const fallback = count > 1 ? `${count} other pieces` : 'one other piece'
    const note = rest(blocker)
    return { word: WAITING_ON_PIECE, tone: 'dim', title: gate.title, repo: gate.repo, note: note === '' ? fallback : note }
  }
  if (until !== null) {
    const note = rest(until)
    return {
      word: WAITING_ON_DATE,
      tone: 'dim',
      title: gate.title,
      repo: gate.repo,
      note: note === '' ? `until ${shortDate(until[1] ?? '')}` : `until ${shortDate(until[1] ?? '')}: ${note}`,
    }
  }
  if (held !== null) {
    const days = Number(held[1])
    const note = rest(held)
    const heldFor = `held ${days} day${days === 1 ? '' : 's'}`
    return {
      word: WAITING_FOR_YOU,
      tone: 'warning',
      title: gate.title,
      repo: gate.repo,
      note: note === '' ? heldFor : `${heldFor}: ${note}`,
    }
  }
  return { word: READY_TO_START, tone: 'plain', title: gate.title, repo: gate.repo, note: gate.reason }
}

const MAIN_INVENTORY = '(main-inventory)'

export function buildModel(reading: Reading, seen: Record<string, Witness>, now: number): Model {
  const notices: string[] = []

  const waitingItems: WaitingItem[] = reading.decisions.map((row) => ({
    text: row.summary,
    url: reading.prs[row.id] ?? null,
  }))

  const groupsByName = new Map<string, WorkItem[]>()
  let running = 0
  for (const row of reading.work) {
    const state = workState(row.state)
    if (row.state === 'working') running += 1
    const url = reading.prs[row.id] ?? null
    if (row.state === 'done' && url !== null) {
      const name = row.title ?? (row.repo === null ? 'A piece of work' : row.repo)
      waitingItems.push({ text: `${name}: pull request ready for your word`, url })
    }
    const name = row.repo ?? OTHER_WORK
    const items = groupsByName.get(name) ?? []
    items.push({
      word: state.word,
      tone: state.tone,
      rank: state.rank,
      title: row.title,
      doing: plainDoing(row.doing),
      age: ageOf(row.since, seen[workKey(row.id)], row.state, now),
      url,
    })
    groupsByName.set(name, items)
  }
  const groups: Group[] = [...groupsByName.entries()]
    .map(([name, items]) => ({ name, items: [...items].sort((a, b) => a.rank - b.rank) }))
    .sort((a, b) => {
      if (a.name === OTHER_WORK) return 1
      if (b.name === OTHER_WORK) return -1
      return a.name.toLowerCase().localeCompare(b.name.toLowerCase())
    })

  const landed: LandedItem[] = reading.landed.map((row) => ({
    what: row.what,
    when: whenOf(row.date, now),
    artifact: row.artifact,
    url: /^https?:\/\/\S+$/.test(row.artifact) ? row.artifact : null,
  }))

  const queuedItems: QueuedItem[] = []
  for (const gate of reading.gates) {
    if (gate.id === MAIN_INVENTORY) {
      notices.push("Firstmate's records for this fleet need repair.")
      continue
    }
    queuedItems.push(queuedItem(gate))
  }

  for (const home of reading.secondmates) {
    if (home.state === 'unknown') notices.push(`${home.id}: its state cannot be read right now.`)
    else if (home.state === 'externally_held') notices.push(`${home.id}: on hold.`)
  }
  if (!reading.hasWorkFields) notices.push('This reading has no titles or dates: Firstmate here is older than the fleet view.')
  if (reading.isCapped) notices.push('Some lists are cut short.')

  return {
    pieces: reading.work.length,
    running,
    waiting: waitingItems.length,
    queued: queuedItems.length,
    waitingItems,
    groups,
    landed,
    queuedItems,
    notices,
  }
}
