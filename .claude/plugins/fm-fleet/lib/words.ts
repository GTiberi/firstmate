// The words the pane and the band use, and the width arithmetic behind fitting them to a row.
//
// Everything the captain reads goes through here, so AGENTS.md section 9 is kept in one place:
// the snapshot's state labels become his vocabulary, and a line the snapshot wrote in
// Firstmate's own terms (a worker's pane, a pipeline step, a worktree) is rewritten or left out.

export type Tone = 'plain' | 'dim' | 'warning' | 'error' | 'success'

export type StateWord = {
  word: string
  tone: Tone
  /** Sort position inside a project: what needs attention first. */
  rank: number
}

/** The snapshot's state for a piece under way, in the captain's words. */
export function workState(state: string): StateWord {
  switch (state) {
    case 'working':
      return { word: 'working', tone: 'plain', rank: 2 }
    case 'parked':
      return { word: 'waiting for a decision', tone: 'warning', rank: 1 }
    case 'blocked':
      return { word: 'stuck', tone: 'warning', rank: 0 }
    case 'failed':
      return { word: 'failed', tone: 'error', rank: 0 }
    case 'paused':
      return { word: 'paused on an outside wait', tone: 'dim', rank: 4 }
    case 'done':
      return { word: 'finished', tone: 'success', rank: 5 }
    default:
      return { word: 'state unclear', tone: 'dim', rank: 3 }
  }
}

export const WAITING_FOR_YOU = 'waiting for you'
export const WAITING_ON_PIECE = 'waiting on another piece'
export const WAITING_ON_DATE = 'waiting on a date'
export const READY_TO_START = 'ready to start'

// A line the snapshot printed in Firstmate's own terms, mapped to what it means for the work.
// Tried in order; the first match wins. An empty answer says nothing the state word does not.
const REWRITES: ReadonlyArray<readonly [RegExp, string]> = [
  [/^harness busy\b/i, ''],
  [/^(harness state unavailable|backend target gone|backend unreachable|no backend target|no metadata|worktree gone|no current-state source|unknown-remote|remote endpoint|alive on )/i, 'lost contact with the worker'],
  [/^ci running\b/i, 'waiting on the checks'],
  [/^(validating|run active|run completed)\b/i, 'checking the change'],
  [/^parked at\b/i, 'a review finding needs a decision'],
  [/^checks green\b/i, 'checks pass, ready for review'],
  [/^run passed\b/i, 'merged'],
  [/^run (failed|cancelled)\b/i, 'the checks did not pass'],
  [/^pr\b.*\bchecks green\b/i, 'checks pass, ready for review'],
]

// Words that belong to Firstmate's machinery. A line still holding one after the rewrites above
// is dropped, because the captain's vocabulary has no word for it.
const INTERNAL =
  /\b(harness|backend|pane|worktree|checkout|teardown|watcher|wake|daemon|run-step|pipeline|no-mistakes|needs-decision|stale|hook|metadata|endpoint|secondmate|crewmate|brief)\b/i

/** What a piece is doing, as the captain should read it; empty when there is nothing to add. */
export function plainDoing(doing: string): string {
  const flat = doing.replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim()
  if (flat === '') return ''
  for (const [pattern, words] of REWRITES) {
    if (pattern.test(flat)) return words
  }
  return INTERNAL.test(flat) ? '' : flat
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "2026-10-15" as "Oct 15"; anything else comes back as given. */
export function shortDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  if (match === null) return value
  const month = MONTHS[Number(match[2]) - 1]
  return month === undefined ? value : `${month} ${Number(match[3])}`
}

/** A span of time as one or two units of the largest size that fits: "just now", "5m", "3h", "2d". */
export function ageWords(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

/** How far back a timestamp reaches, for "updated … ago": "just now" stays as it is. */
export function agoWords(ms: number): string {
  const words = ageWords(ms)
  return words === 'just now' ? words : `${words} ago`
}

/** Terminal cells one character takes: 0 for a combining mark, 2 for a wide one, else 1. */
function cellsOf(codePoint: number): number {
  if (
    codePoint === 0 ||
    (codePoint >= 0x300 && codePoint <= 0x36f) ||
    codePoint === 0x200d ||
    (codePoint >= 0xfe00 && codePoint <= 0xfe0f)
  ) {
    return 0
  }
  if (
    (codePoint >= 0x1100 && codePoint <= 0x115f) ||
    (codePoint >= 0x2e80 && codePoint <= 0xa4cf) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
    (codePoint >= 0xff00 && codePoint <= 0xff60) ||
    (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
    (codePoint >= 0x1f300 && codePoint <= 0x1faff) ||
    (codePoint >= 0x20000 && codePoint <= 0x3fffd)
  ) {
    return 2
  }
  return 1
}

export function widthOf(value: string): number {
  let width = 0
  for (const char of value) width += cellsOf(char.codePointAt(0) ?? 0)
  return width
}

/** `value` cut to `width` cells ending in an ellipsis, whether or not it would have fitted. */
export function cutAlways(value: string, width: number): string {
  if (width <= 0) return ''
  if (width === 1) return '…'
  let out = ''
  let used = 0
  for (const char of value) {
    const next = cellsOf(char.codePointAt(0) ?? 0)
    if (used + next > width - 1) break
    out += char
    used += next
  }
  return `${out.trimEnd()}…`
}

/** `value` cut to at most `width` cells, with an ellipsis where it was cut. */
export function cut(value: string, width: number): string {
  if (width <= 0) return ''
  return widthOf(value) <= width ? value : cutAlways(value, width)
}

/** `value` cut to at most `width` cells with the ellipsis in the middle, so both ends survive. */
export function cutMiddle(value: string, width: number): string {
  if (width <= 0) return ''
  if (widthOf(value) <= width) return value
  if (width <= 3) return cut(value, width)
  const chars = [...value]
  const tail = Math.floor((width - 1) / 2)
  const head = width - 1 - tail
  return `${chars.slice(0, head).join('')}…${chars.slice(chars.length - tail).join('')}`
}

/** The first words of `value`: cut at a word boundary within `width` cells, with an ellipsis. */
export function firstWords(value: string, width: number): string {
  const flat = value.replace(/\s+/g, ' ').trim()
  if (widthOf(flat) <= width) return flat
  const cutAt = cut(flat, width)
  const withoutEllipsis = cutAt.endsWith('…') ? cutAt.slice(0, -1) : cutAt
  const boundary = withoutEllipsis.lastIndexOf(' ')
  const words = boundary > width / 2 ? withoutEllipsis.slice(0, boundary) : withoutEllipsis
  return `${words.trimEnd()}…`
}
